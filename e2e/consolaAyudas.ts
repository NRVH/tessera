// =============================================================================
// Ayudas de los specs de la consola de BD: localizar filas del árbol, pestañas y la consola,
// ejecutar SQL y esperar a que acabe, y arrastrar una pestaña. Copian la semántica de las
// funciones locales de `conexiones.spec.ts` (un spec no se importa desde otro: Playwright
// lo registraría dos veces). No es un spec: `playwright.config.ts` no lo ejecuta.
// =============================================================================

import { expect, type Locator, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { esperarConsolaLista, monacoConsola } from './monaco'

/** La consola visible. */
export const CONSOLA = 'section.db-consola:not(.hidden)'
/** Las pestañas de la vista (no las de proyecto ni las de resultados de una consola). */
export const PESTANAS = '.db-area:not(.hidden) .db-tabs [role="tab"]'

/** Deja que React confirme el render provocado por el gesto. */
export async function asentar(win: Page): Promise<void> {
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/** La ventana está a la vista: sin esto, `getBoundingClientRect` y los clics mienten. */
export async function aLaVista(win: Page): Promise<void> {
  await expect.poll(() => win.evaluate(() => document.visibilityState)).toBe('visible')
}

/** Una fila del árbol por su tipo y su nombre EXACTO. */
export function fila(win: Page, tipo: string, nombre: string): Locator {
  return win
    .locator(`.db-arbol .db-fila-${tipo}`)
    .filter({ has: win.locator('.db-fila-nombre', { hasText: new RegExp(`^${nombre}$`) }) })
}

/**
 * La primera fila de ese tipo (y nombre) que cuelga de `ancla`, SOLO dentro de su
 * subárbol (se corta en la siguiente fila del tipo del ancla). La marca con `data-e2e`
 * y devuelve su localizador: sobrevive a los repintados de la lista virtual.
 */
export async function filaTras(win: Page, ancla: Locator, tipo: string, marca: string, nombre?: string): Promise<Locator> {
  await expect
    .poll(
      () =>
        ancla.first().evaluate(
          (el, a) => {
            const filas = Array.from(document.querySelectorAll('.db-arbol .db-fila'))
            const desde = filas.indexOf(el)
            if (desde < 0) return false
            const tipoAncla = el.getAttribute('data-tipo')
            for (const f of filas.slice(desde + 1)) {
              if (f.getAttribute('data-tipo') === tipoAncla) return false
              if (!f.classList.contains(`db-fila-${a.tipo}`)) continue
              if (a.nombre !== null && f.querySelector('.db-fila-nombre')?.textContent !== a.nombre) continue
              f.setAttribute('data-e2e', a.marca)
              return true
            }
            return false
          },
          { tipo, marca, nombre: nombre ?? null }
        ),
      { timeout: 15_000, message: `no aparece una fila ${tipo}${nombre ? ` «${nombre}»` : ''} bajo el ancla` }
    )
    .toBe(true)
  return win.locator(`[data-e2e="${marca}"]`)
}

async function desplegada(f: Locator): Promise<boolean> {
  return f.locator('.db-chevron svg').first().evaluate((s) => s.classList.contains('open')).catch(() => false)
}

/** Despliega una fila por su chevron, solo si está plegada. */
export async function desplegar(f: Locator): Promise<void> {
  await expect(f).toHaveCount(1)
  if (!(await desplegada(f))) await f.locator('.db-chevron').click()
}

/** Pliega una fila por su chevron, solo si está desplegada. */
export async function plegar(f: Locator): Promise<void> {
  await expect(f).toHaveCount(1)
  if (await desplegada(f)) await f.locator('.db-chevron').click()
}

/** Los nombres de las pestañas de la vista, en orden (sin el `[ALIAS]`). */
export async function nombresPestanas(win: Page): Promise<string[]> {
  return win.locator(`${PESTANAS} .db-tab-nombre`).allTextContents()
}

/** La pestaña de la vista cuyo nombre es EXACTAMENTE `nombre`. */
export function pestana(win: Page, nombre: string): Locator {
  return win.locator(PESTANAS).filter({ has: win.locator('.db-tab-nombre', { hasText: new RegExp(`^${escaparRegex(nombre)}$`) }) })
}

function escaparRegex(t: string): string {
  return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Pulsa una entrada del menú contextual abierto por su texto EXACTO. */
export async function elegirDelMenu(win: Page, etiqueta: string): Promise<void> {
  const menu = win.locator('.ctx-menu')
  await expect(menu).toBeVisible()
  await menu.locator('.ctx-menu-item', { hasText: new RegExp(`^${escaparRegex(etiqueta)}`) }).first().click()
}

/** ¿Está deshabilitada esa entrada del menú contextual abierto? */
export async function entradaDeshabilitada(win: Page, etiqueta: string): Promise<boolean> {
  const item = win.locator('.ctx-menu .ctx-menu-item', { hasText: new RegExp(`^${escaparRegex(etiqueta)}`) }).first()
  await expect(item).toBeVisible()
  return item.evaluate((el) => (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true')
}

/**
 * Abre una consola NUEVA con el acorde (`MOD+KeyN`, el de `tessera.ts`) y espera a que sea
 * ELLA la que queda lista. Esperar solo con `esperarConsolaLista` tras el acorde tenía una
 * carrera: si ya había otra consola a la vista, esa contestaba «lista» antes de que la nueva
 * se activara, y la primera escritura caía en una consola sin editor todavía («se crea en su
 * primer `visible`»). Se espera primero a la pestaña de más, que es lo que hacen a mano las
 * specs que no fallaban.
 */
export async function abrirConsolaNueva(win: Page, acorde: string): Promise<void> {
  const antes = await win.locator(PESTANAS).count()
  await win.keyboard.press(acorde)
  await expect(win.locator(PESTANAS)).toHaveCount(antes + 1)
  await expect(win.locator(CONSOLA)).toBeVisible()
  await esperarConsolaLista(win)
}

/** Carga un texto en la consola, lo selecciona entero y pulsa ▷ (como el usuario con el ratón). */
export async function ejecutarTodoSeleccionado(win: Page, sql: string): Promise<void> {
  await monacoConsola(win, { op: 'fijar', texto: sql })
  await monacoConsola(win, { op: 'seleccionarTodo' })
  await win.locator(`${CONSOLA} .db-consola-run`).click()
}

/** Espera a que la consola visible termine de ejecutar (■ vuelve a deshabilitarse). */
export async function esperarFinEjecucion(win: Page): Promise<void> {
  await expect(win.locator(`${CONSOLA} .db-consola-detener`)).toBeDisabled({ timeout: 30_000 })
}

/** Activa la pestaña «Salida» de la consola visible. */
export async function verSalida(win: Page): Promise<Locator> {
  await win.locator(`${CONSOLA} .db-resultados-tabs [role="tab"]`).first().click()
  const salida = win.locator(`${CONSOLA} .db-salida`)
  await expect(salida).toBeVisible()
  return salida
}

/** Una celda del resultado ACTIVO de la consola, por fila y columna de datos (desde 0). */
export function celdaResultado(win: Page, f: number, c: number): Locator {
  return win.locator(
    `${CONSOLA} .db-resultados-panel:not(.oculto) .db-rejilla-fila[aria-rowindex="${f + 2}"] .db-celda[aria-colindex="${c + 2}"]`
  )
}

/**
 * ARRASTRA una pestaña de la tira con el ratón de verdad (DnD HTML5 de Chromium) hasta
 * el borde IZQUIERDO de otra: la raya de inserción cae ANTES de ella. Se mueve en
 * pasos: Chromium no empieza un arrastre sin movimiento tras el `mousedown`, y un
 * salto único llegaría sin `dragover` intermedios.
 */
export async function arrastrarPestanaAntesDe(win: Page, origen: Locator, destino: Locator): Promise<void> {
  const a = await origen.boundingBox()
  const b = await destino.boundingBox()
  if (!a || !b) throw new Error('las pestañas del arrastre no tienen caja')
  // Desde el NOMBRE de la pestaña (no desde el aspa, que no arrastra).
  await win.mouse.move(a.x + Math.min(20, a.width / 3), a.y + a.height / 2)
  await win.mouse.down()
  await win.mouse.move(a.x + Math.min(30, a.width / 2), a.y + a.height / 2, { steps: 4 })
  await win.mouse.move(b.x + 4, b.y + b.height / 2, { steps: 12 })
  await asentar(win)
  await win.mouse.up()
  await asentar(win)
}

/** Proyecto de la prueba: un repo git mínimo (la app abre con un proyecto). */
export function crearProyecto(raiz: string): string {
  const dir = join(raiz, 'proyecto-consola')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'LEEME.md'), '# proyecto de la prueba de la consola de BD\n')
  const git = (...args: string[]): void => {
    spawnSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@tessera.invalid', ...args], { cwd: dir, windowsHide: true })
  }
  git('init', '-q')
  git('add', '.')
  git('commit', '-q', '-m', 'inicio')
  return dir
}
