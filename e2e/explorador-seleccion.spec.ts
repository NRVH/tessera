// =============================================================================
// La selección múltiple del explorador pulsada de verdad. `test-seleccion-arbol.mts` fija
// la decisión; aquí, que el acorde llega: en macOS el menú «Edición» tiene `role:
// 'selectAll'` (⌘A) y podría quedarse el acorde, y Ctrl+clic es el clic derecho del
// sistema (la mitad negativa solo se ve pulsando). El caso del menú va por la capa NATIVA
// (`osascript`), que se salta sin permiso de Accesibilidad. Lo que no depende del sistema
// (⌘/Ctrl+clic suma, el fantasma existe) va con `MOD` y corre también en Windows.
// Decisiones: docs/decisiones/pruebas/que-va-en-e2e-y-que-en-test-mts.md
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  abrirTessera,
  borrarTemporal,
  MOD,
  PERFILES_SIN_SANDBOX,
  PLATAFORMA,
  type SesionTessera
} from './tessera'

/** El modificador que en esta plataforma NO manda: Ctrl en Mac. */
const MOD_AJENO = MOD === 'Meta' ? 'Control' : 'Meta'

/**
 * Proyecto de usar y tirar con nombres CONOCIDOS y ordenados, para no depender de
 * cómo esté el repo. Nada de subcarpetas: lo que se mide aquí son acordes de teclado
 * sobre filas que están a la vista desde el primer render.
 */
const NOMBRES = ['a1.txt', 'a2.txt', 'a3.txt', 'a4.txt']
function crearProyecto(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tessera-e2e-sel-'))
  mkdirSync(join(dir, 'sub'), { recursive: true })
  for (const n of NOMBRES) writeFileSync(join(dir, n), `contenido de ${n}\n`)
  writeFileSync(join(dir, 'sub', 'dentro.txt'), 'dentro\n')
  return dir
}

/** Deja que React confirme el render provocado por el gesto (ver `atajos.spec.ts`). */
async function asentar(win: Page): Promise<void> {
  await win.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  )
}

/** Nombres de las filas SELECCIONADAS, sin la letra de git que el árbol pega detrás. */
async function seleccionadas(win: Page): Promise<string[]> {
  // `Array.from` y no un spread: el `lib` de este tsconfig no le da iterador a
  // `NodeListOf`, y el spread no compila.
  return win.evaluate(() =>
    Array.from(document.querySelectorAll('.sidebar .tree-row.seleccionada')).map((e) =>
      (e.querySelector('.tree-label')?.textContent ?? e.textContent ?? '').trim()
    )
  )
}

/** La fila cuyo nombre es `nombre`. Se usa como objetivo de clic. */
function fila(win: Page, nombre: string) {
  return win.locator('.sidebar .tree-row', { hasText: nombre }).first()
}

/** Corre un AppleScript; `null` si `osascript` falla (sin permiso). */
function osascript(guion: string): string | null {
  try {
    return execFileSync('osascript', ['-e', guion], { stdio: ['ignore', 'pipe', 'pipe'] })
      .toString()
      .trim()
  } catch {
    return null
  }
}

/**
 * ¿Hay permiso de ACCESIBILIDAD? `UI elements enabled` es la pregunta directa; la de
 * «¿quién está al frente?» NO sirve de guarda porque funciona sin el permiso y deja
 * que la prueba se estrelle después, en el `keystroke` (ver `portapapeles.spec.ts`).
 */
function accesibilidadConcedida(): boolean {
  return osascript('tell application "System Events" to get UI elements enabled') === 'true'
}

test.describe('selección múltiple del explorador', () => {
  let s: SesionTessera
  let proyecto: string

  test.beforeAll(async () => {
    proyecto = crearProyecto()
    s = await abrirTessera(
      {},
      { args: [proyecto], sembrar: (datos) => writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX) }
    )
    // El árbol se puebla por IPC tras anclar la contenedora: se espera a la primera
    // fila real en vez de dormir un número fijo.
    await s.win.waitForSelector('.sidebar .tree-row', { timeout: 30_000 })
    await expect(fila(s.win, 'a1.txt')).toBeVisible({ timeout: 30_000 })
  })
  test.afterAll(async () => {
    await s?.cerrar()
    if (proyecto) await borrarTemporal(proyecto)
  })

  /**
   * Devuelve el foco a una FILA del árbol después de abrir un archivo.
   *
   * INSISTE HASTA QUE EL FOCO SE QUEDA, y es lo que hace determinista todo lo que viene
   * detrás. `EditorPane` pide el foco en el frame SIGUIENTE al hacerse visible —lo
   * necesita para que su ⌘F dispare—, así que entre abrir el archivo y pulsar una tecla
   * en el árbol hay una carrera: si ese `focus()` pendiente aterriza DESPUÉS del de la
   * fila, la tecla se la queda Monaco. Se vio de las dos formas: el diálogo de borrado
   * abriéndose con el foco ya en el editor y, al arreglar eso, el Supr comido y el
   * diálogo sin abrirse siquiera.
   *
   * SE COMPRUEBA QUE AGUANTA DOS FOTOGRAMAS, y ése es el punto. Mirar el foco justo
   * después de pedirlo no basta: el `focus()` del editor estaba programado para el
   * frame siguiente y aterrizaba en el hueco entre esa comprobación y la tecla (medido:
   * el elemento activo pasaba de `tree-row` a `inputarea` entre una línea y la
   * siguiente). Esperar en cambio a que el editor tome el foco tampoco vale: si el
   * archivo YA estaba abierto no vuelve a pedirlo y la espera caduca sola.
   *
   * Y SE COMPARA CONTRA ESTA FILA, no contra «alguna fila»: `fila()` casa por SUBCADENA
   * y se queda con la primera, así que un nombre que sea prefijo de otro («a1» con
   * «a1.txt» y «a10.txt») podría dar por bueno el foco en la fila equivocada y dejar que
   * el Supr de después abriera el diálogo sobre OTRO archivo, con la comprobación
   * diciendo que todo bien.
   */
  async function devolverFocoAFila(win: Page, nombre: string): Promise<void> {
    const f = fila(win, nombre)
    await expect
      .poll(
        async () => {
          await f.focus()
          return f.evaluate(
            (el) =>
              new Promise<boolean>((listo) => {
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => listo(el === document.activeElement))
                )
              })
          )
        },
        { message: `el foco no se queda en la fila ${nombre}: se lo lleva el editor` }
      )
      .toBe(true)
  }

  /**
   * Deja la selección vacía con Escape, que el árbol atiende en su CONTENEDOR
   * (`manejarTeclaArbol` de `tecladoArbol.ts`): o sea, sólo si el foco está dentro del árbol.
   *
   * Y el clic de aquí abajo se lo quita: abre a1 en el editor, y el editor se enfoca al
   * abrir (es lo que deja usar Ctrl+F sin hacer clic antes). Un Escape pulsado después
   * se lo queda Monaco, a1 sigue marcado, y el siguiente ⌘/Ctrl+clic sobre a1 lo
   * DESMARCA en vez de sumarlo. Lo destapó la primera pasada en Windows (quedaban «sub» y
   * «a2», sin «a1»); en Mac pasaba en verde, pero por tiempo y no por diseño. Por eso se
   * espera a la pestaña, se devuelve el foco a una fila —con `focus()` y no con otro
   * clic, que la volvería a abrir— y se COMPRUEBA que la selección quedó vacía.
   */
  async function limpiar(): Promise<void> {
    await fila(s.win, 'a1.txt').click()
    await expect(s.win.locator('.editor-tab.active', { hasText: 'a1.txt' })).toHaveCount(1)
    await devolverFocoAFila(s.win, 'a1.txt')
    await s.win.keyboard.press('Escape')
    await asentar(s.win)
    await expect.poll(() => seleccionadas(s.win)).toEqual([])
  }

  // ---------------------------------------------------------------------------
  test('⌘+clic SUMA a la selección, y no abre el archivo ni despliega', async () => {
    await limpiar()
    await fila(s.win, 'a1.txt').click({ modifiers: [MOD] })
    await fila(s.win, 'a2.txt').click({ modifiers: [MOD] })
    await fila(s.win, 'sub').click({ modifiers: [MOD] })
    await asentar(s.win)

    const sel = await seleccionadas(s.win)
    expect(sel, 'las tres filas quedan marcadas').toHaveLength(3)
    // Con ⌘+clic no se activa nada: ni se abre el archivo ni se despliega la carpeta.
    // Sin esto, marcar cinco archivos abriría cinco pestañas.
    await expect(
      s.win.locator('.sidebar .tree-row', { hasText: 'dentro.txt' }),
      'la carpeta NO se desplegó'
    ).toHaveCount(0)
  })

  test('Ctrl+clic NO suma a la selección en Mac (ahí Ctrl es el clic derecho)', async () => {
    test.skip(PLATAFORMA !== 'mac', 'la mitad negativa sólo tiene sentido en macOS')
    await limpiar()
    await fila(s.win, 'a1.txt').click()
    await asentar(s.win)
    await fila(s.win, 'a2.txt').click({ modifiers: [MOD_AJENO] })
    await asentar(s.win)

    const sel = await seleccionadas(s.win)
    // Lo que se fija es que Ctrl NO es un modificador de selección: si lo fuera,
    // habría dos marcadas. Que además abra el menú del sistema es cosa del sistema.
    expect(sel.length, 'Ctrl no acumula selección en Mac').toBeLessThanOrEqual(1)
    // Y si el menú contextual de Tessera se abrió, se cierra para no dejar estado.
    await s.win.keyboard.press('Escape')
  })

  test('Shift+clic marca el RANGO', async () => {
    await limpiar()
    await fila(s.win, 'a1.txt').click()
    await fila(s.win, 'a4.txt').click({ modifiers: ['Shift'] })
    await asentar(s.win)

    const sel = await seleccionadas(s.win)
    expect(sel, 'del primero al último, ambos incluidos').toHaveLength(4)
  })

  // PENDIENTE DE REHACER, y no por Windows: el fantasma dejó de ser un nodo del DOM en
  // f137c00 («arrastrar varios archivos fuera»), cuando pasó a dibujarse en un canvas
  // (`pintarFantasma` en `arrastreArbol.ts`) para que el arrastre nativo, que quiere una
  // imagen, enseñara lo mismo. Esta prueba sigue buscando `.arrastre-fantasma`, que ya no
  // existe, así que falla en las DOS plataformas desde ese commit. Rehacerla es medir el
  // canvas que se entrega en el `dragstart`, no un elemento fuera de pantalla.
  test.fixme('el FANTASMA de arrastre existe con grupo y se monta rasterizable', async () => {
    await limpiar()
    await fila(s.win, 'a1.txt').click({ modifiers: [MOD] })
    await fila(s.win, 'a2.txt').click({ modifiers: [MOD] })
    await asentar(s.win)

    // `setDragImage` hace una INSTANTÁNEA del elemento: tiene que estar en el
    // documento y renderizado. Un `display:none` daría una imagen en blanco, y eso
    // no se ve en ninguna captura ni en ningún test puro.
    const caja = await s.win.evaluate(() => {
      const f = document.querySelector('.arrastre-fantasma')
      if (!f) return null
      const b = f.getBoundingClientRect()
      const cs = getComputedStyle(f)
      return { w: b.width, h: b.height, x: b.x, display: cs.display, vis: cs.visibility }
    })
    expect(caja, 'con dos filas marcadas el fantasma se monta').not.toBeNull()
    expect(caja!.w, 'y tiene tamaño real (rasterizable)').toBeGreaterThan(40)
    expect(caja!.h).toBeGreaterThan(20)
    expect(caja!.display).not.toBe('none')
    expect(caja!.vis).not.toBe('hidden')
    expect(caja!.x, 'vive fuera de pantalla: nunca se ve, y no parpadea').toBeLessThan(-1000)
  })

  // ---------------------------------------------------------------------------
  // EL DIÁLOGO DE BORRADO. El foco de seguridad está en «Cancelar» (un Enter
  // accidental cancela), pero el ANILLO sólo sale cuando se llegó con el teclado: es
  // del color de acento —el del perfil— y, pintado en «Cancelar» tras un clic de ratón,
  // se leía como si la acción señalada fuera cancelar. Ver `ConfirmDialog.tsx`.
  // ---------------------------------------------------------------------------

  /** Qué botón tiene el foco en el diálogo abierto, y si pinta el anillo. */
  async function focoDelDialogo(): Promise<{ boton: string; anillo: boolean }> {
    await expect(s.win.locator('.modal-card')).toHaveCount(1)
    return s.win.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      return { boton: el?.textContent?.trim() ?? '', anillo: el?.matches(':focus-visible') ?? false }
    })
  }

  test('borrar con el RATÓN: el foco va a «Cancelar», sin el anillo del color del perfil', async () => {
    await limpiar()
    await fila(s.win, 'a2.txt').click({ button: 'right' })
    await s.win.locator('.ctx-menu-item', { hasText: 'Eliminar archivo' }).click()
    expect(await focoDelDialogo()).toEqual({ boton: 'Cancelar', anillo: false })
    await s.win.keyboard.press('Escape')
    await expect(s.win.locator('.modal-card')).toHaveCount(0)
    await expect(fila(s.win, 'a2.txt'), 'Escape cancela: el archivo sigue ahí').toBeVisible()
  })

  test('borrar con el TECLADO (Supr): el foco va a «Cancelar», y ahí sí se ve el anillo', async () => {
    await limpiar()
    await fila(s.win, 'a3.txt').click()
    await expect(s.win.locator('.editor-tab.active', { hasText: 'a3.txt' })).toHaveCount(1)
    // El clic abrió a3 y el editor se quedó el foco: se devuelve a la fila, sin otro
    // clic, para que la tecla la atienda el árbol y no borre texto en Monaco.
    await devolverFocoAFila(s.win, 'a3.txt')
    await s.win.keyboard.press('Delete')
    expect(await focoDelDialogo()).toEqual({ boton: 'Cancelar', anillo: true })
    // Y ese anillo NO es el del perfil: el contorno del color del perfil es la marca de
    // «Eliminar», y en «Cancelar» se leería como la acción señalada.
    // La sonda va AL LADO del botón y no en `body`: el color del perfil se publica en
    // `--accent` de un contenedor de la app, y en `body` se leería el acento por
    // defecto, con lo que la comparación pasaría siempre (medido: pasaba con el bug).
    const colores = await s.win.evaluate(() => {
      const el = document.activeElement as HTMLElement
      const sonda = document.createElement('span')
      sonda.style.color = 'var(--accent)'
      el.parentElement!.appendChild(sonda)
      const acento = getComputedStyle(sonda).color
      sonda.remove()
      return { anillo: getComputedStyle(el).outlineColor, acento }
    })
    expect(colores.anillo, 'el anillo de «Cancelar» no lleva el color del perfil').not.toBe(colores.acento)
    await s.win.keyboard.press('Escape')
    await expect(s.win.locator('.modal-card')).toHaveCount(0)
    await expect(fila(s.win, 'a3.txt'), 'Escape cancela: el archivo sigue ahí').toBeVisible()
  })

  test('Enter con el foco en «Cancelar» CANCELA: no borra nada', async () => {
    await limpiar()
    await fila(s.win, 'a4.txt').click()
    await expect(s.win.locator('.editor-tab.active', { hasText: 'a4.txt' })).toHaveCount(1)
    await devolverFocoAFila(s.win, 'a4.txt')
    await s.win.keyboard.press('Delete')
    expect((await focoDelDialogo()).boton).toBe('Cancelar')
    // El foco de seguridad existe para ESTO: un Enter reflejo sobre el diálogo.
    await s.win.keyboard.press('Enter')
    await expect(s.win.locator('.modal-card')).toHaveCount(0)
    // Se le da tiempo a un borrado que no debería llegar antes de afirmar que no llegó.
    await s.win.waitForTimeout(800)
    expect(existsSync(join(proyecto, 'a4.txt')), 'Enter sobre «Cancelar» no puede borrar').toBe(true)
  })

  test('repintar el explorador con el diálogo abierto no devuelve el foco a «Cancelar»', async () => {
    await limpiar()
    await fila(s.win, 'a2.txt').click({ button: 'right' })
    await s.win.locator('.ctx-menu-item', { hasText: 'Eliminar archivo' }).click()
    expect((await focoDelDialogo()).boton).toBe('Cancelar')
    await s.win.keyboard.press('Tab')
    expect((await focoDelDialogo()).boton).toBe('Eliminar')
    // Un archivo nuevo en el proyecto: el vigilante del disco refresca el árbol, y el
    // explorador —que es quien pinta el diálogo— se vuelve a renderizar con callbacks
    // nuevos. Si el foco dependiera de ellos, saltaría solo de vuelta a «Cancelar».
    writeFileSync(join(proyecto, 'nuevo-con-el-dialogo-abierto.txt'), 'x')
    await expect(fila(s.win, 'nuevo-con-el-dialogo-abierto.txt')).toBeVisible({ timeout: 15_000 })
    expect((await focoDelDialogo()).boton, 'el repintado no puede mover el foco').toBe('Eliminar')
    await s.win.keyboard.press('Escape')
    await expect(s.win.locator('.modal-card')).toHaveCount(0)
  })

  // ---------------------------------------------------------------------------
  // CAPA NATIVA. Aquí es donde se sabe si el MENÚ de macOS se come el acorde.
  // ---------------------------------------------------------------------------

  test('⌘A selecciona todo el árbol AUNQUE el menú «Edición» tenga selectAll', async () => {
    test.skip(PLATAFORMA !== 'mac', 'el menú de aplicación sólo existe en macOS')
    test.skip(
      !accesibilidadConcedida(),
      'sin permiso de Accesibilidad no se pueden mandar teclas nativas: es el permiso, no el producto'
    )
    await limpiar()
    // Clic normal para que el foco esté DENTRO del árbol: los atajos del explorador
    // van en el onKeyDown de su div, nunca en `window`.
    await fila(s.win, 'a1.txt').click()
    await asentar(s.win)

    const pid = s.app.process().pid
    expect(pid, 'hace falta el pid para poner ESTA Tessera al frente').toBeDefined()
    // Al frente por PID y no por nombre: la Tessera INSTALADA del usuario se llama
    // igual, y teclear en su ventana sería peor que fallar.
    osascript(`tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`)
    const alFrente = osascript(
      `tell application "System Events" to get unix id of (first process whose frontmost is true)`
    )
    test.skip(alFrente !== String(pid), 'no se pudo poner esta Tessera al frente; no se teclea a ciegas')

    osascript('tell application "System Events" to keystroke "a" using command down')
    await asentar(s.win)

    const sel = await seleccionadas(s.win)
    expect(
      sel.length,
      'si esto es 0 o 1, el ⌘A se lo comió el `role: selectAll` del menú «Edición» ' +
        'antes de llegar al renderer: hay que darle al ítem un manejador propio que ' +
        'reenvíe al árbol, o quitarle el acelerador'
    ).toBeGreaterThan(1)
  })

  test('⌘⌫ (el gesto del Finder) abre el diálogo de borrado', async () => {
    test.skip(PLATAFORMA !== 'mac', 'en Windows el gesto es Supr, cubierto por `test:atajos`')
    test.skip(!accesibilidadConcedida(), 'sin permiso de Accesibilidad no hay teclas nativas')
    await limpiar()
    await fila(s.win, 'a1.txt').click()
    await asentar(s.win)

    const pid = s.app.process().pid
    osascript(`tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`)
    const alFrente = osascript(
      `tell application "System Events" to get unix id of (first process whose frontmost is true)`
    )
    test.skip(alFrente !== String(pid), 'no se pudo poner esta Tessera al frente')

    // `key code 51` es ⌫ (delete). Con `command down` es el borrar del Finder.
    osascript('tell application "System Events" to key code 51 using command down')
    await asentar(s.win)

    const dialogo = s.win.locator('.modal-card', { hasText: 'Eliminar' })
    await expect(dialogo, 'el gesto nativo de borrar de Mac llega al árbol').toBeVisible({
      timeout: 5_000
    })
    // CANCELAR: una prueba no puede dejar el proyecto sin un archivo.
    await s.win.keyboard.press('Escape')
    await asentar(s.win)
    await expect(fila(s.win, 'a1.txt'), 'cancelar no borra nada').toBeVisible()
  })
})
