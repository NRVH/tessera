// =============================================================================
// Ayudas de la rejilla para seis specs `conexiones-*` y `edicionAyudas.ts`: arrancar
// Tessera con un PostgreSQL efímero,
// abrir una tabla desde el árbol y leer lo que la rejilla pinta, copia y enseña. El árbol
// es una lista VIRTUAL y los hijos llegan con el catálogo, así que todo lo que busca una
// fila ESPERA. Siembra propia (`SIEMBRA_REJILLA`): una tabla de más de 500 filas con clave
// primaria, un `jsonb` con un número que no cabe en un double, un `bytea`, un texto de
// más de 64 KiB y una tabla sin clave primaria para la mitad negativa del visor.
// =============================================================================

import { expect, type Locator, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { arrancarPostgres, type PostgresEfimero } from './postgresEfimero'
import { abrirTessera, borrarTemporal, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

export const ALIAS_REJILLA = 'PG-REJILLA'

/** Filas de `public.grande`: más de dos páginas de 500, y ninguna página redonda. */
export const FILAS_GRANDE = 1234
/** Caracteres de `largo` en la fila 1: más que los 64 KiB que el main deja en una celda. */
export const LARGO_FILA_1 = 100_000

/**
 * `grande`: PK `id` (el visor vuelve a encontrar la fila), `datos` jsonb con un número
 * de 20 cifras (el visor NO lo puede redondear al formatear), `bin` bytea de 4 bytes
 * (el volcado hex) y `largo` con 100 000 caracteres solo en la fila 1 (recortado a
 * 64 KiB en la rejilla; el visor trae el resto). `sin_pk`: un texto largo en una tabla
 * sin clave primaria (el visor dice por qué no hay más).
 */
export const SIEMBRA_REJILLA = `
CREATE TABLE public.grande (
  id int PRIMARY KEY,
  nombre text NOT NULL,
  datos jsonb,
  bin bytea,
  largo text
);
INSERT INTO public.grande
SELECT n,
       'fila ' || n,
       jsonb_build_object('n', n, 'grande', 12345678901234567890::numeric),
       decode(lpad(to_hex(n), 8, '0'), 'hex'),
       CASE WHEN n = 1 THEN repeat('abcdefghij', ${LARGO_FILA_1 / 10}) END
FROM generate_series(1, ${FILAS_GRANDE}) AS n;
CREATE TABLE public.sin_pk (n int, largo text);
INSERT INTO public.sin_pk VALUES (1, repeat('z', 70000));
`

/** Deja que React confirme el render provocado por el gesto. */
export async function asentar(win: Page): Promise<void> {
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/** El botón de una vista en el riel, por su `title`. */
export function botonVista(win: Page, titulo: 'Archivos' | 'Conexiones a bases de datos'): Locator {
  return win.locator(`.activity-item[title="${titulo}"]`)
}

/** Una fila del árbol por su tipo y su nombre EXACTO. */
export function fila(win: Page, tipo: string, nombre: string): Locator {
  return win
    .locator(`.db-arbol .db-fila-${tipo}`)
    .filter({ has: win.locator('.db-fila-nombre', { hasText: new RegExp(`^${nombre}$`) }) })
}

/**
 * La primera fila de ese tipo (y nombre) que cuelga de `ancla`, marcada con un
 * `data-e2e` (ver `conexiones.spec.ts`: sólo dentro del subárbol del ancla).
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

/** Despliega una fila por su chevron, sólo si está plegada. */
export async function desplegar(f: Locator): Promise<void> {
  await expect(f).toHaveCount(1)
  if (!(await desplegada(f))) await f.locator('.db-chevron').click()
}

/** Las pestañas de la vista. */
export const PESTANAS = '.db-area:not(.hidden) .db-tabs [role="tab"]'
/** El pane de la pestaña activa. */
export const PANE = '.db-area:not(.hidden) .db-pane:not(.hidden)'
/** El host del Monaco del visor de valor (el modal va por portal sobre <body>). */
export const HOST_VISOR = '.db-visor-modal .db-visor-host'

/** Una celda de la rejilla del pane activo, por fila y columna de DATOS (desde 0). */
export function celda(win: Page, f: number, c: number): Locator {
  return win.locator(`${PANE} .db-rejilla-fila[aria-rowindex="${f + 2}"] .db-celda[aria-colindex="${c + 2}"]`)
}

/** El texto de la píldora (su primer hijo: el recuento o «Trayendo filas…»). */
export function textoPildora(win: Page): Locator {
  return win.locator(`${PANE} .db-pildora`).locator(':scope > :first-child')
}

/** Las entradas del menú contextual abierto, en orden y con '—' por separador. */
export async function entradasMenu(win: Page): Promise<string[]> {
  const menu = win.locator('.ctx-menu')
  await expect(menu).toBeVisible()
  return menu.evaluate((m) =>
    Array.from(m.children).map((c) => (c.classList.contains('ctx-menu-separator') ? '—' : (c.textContent ?? '').trim()))
  )
}

/** Una opción del menú contextual abierto por su texto exacto. */
export function opcionMenu(win: Page, texto: string): Locator {
  return win.locator('.ctx-menu').getByRole('menuitem', { name: texto, exact: true })
}

/** Corre `cuerpo` y DEVUELVE el portapapeles del sistema como estaba. */
export async function conPortapapeles(win: Page, cuerpo: () => Promise<void>): Promise<void> {
  const previo = await win.evaluate(() => window.tessera.clipboard.read())
  try {
    await cuerpo()
  } finally {
    await win.evaluate((t) => window.tessera.clipboard.write(t), previo)
  }
}

/** El portapapeles del sistema, con los finales de línea normalizados a `\n`. */
export async function leerPortapapeles(win: Page): Promise<string> {
  return (await win.evaluate(() => window.tessera.clipboard.read())).replace(/\r\n/g, '\n')
}

/** Proyecto mínimo (un repo git): la vista necesita un perfil con algo abierto. */
function crearProyecto(raiz: string): string {
  const dir = join(raiz, 'proyecto-rejilla')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'LEEME.md'), '# proyecto de la prueba de la rejilla\n')
  spawnSync('git', ['init', '-q'], { cwd: dir, windowsHide: true })
  return dir
}

export interface EntornoRejilla {
  s: SesionTessera
  pg: PostgresEfimero
  cerrar: () => Promise<void>
}

/**
 * Levanta PostgreSQL con `SIEMBRA_REJILLA` y Tessera con un proyecto y el agente
 * falso, entra en la vista de bases de datos y crea la conexión (por la API del
 * preload, con contraseña). Sin Docker o sin la imagen devuelve el MOTIVO para
 * saltar; si la siembra falla, lanza (es un error de la prueba).
 */
export async function arrancarRejilla(): Promise<EntornoRejilla | { motivo: string }> {
  const r = await arrancarPostgres(SIEMBRA_REJILLA)
  if (!r.ok) {
    if (r.fallo) throw new Error(r.motivo)
    return { motivo: `sin PostgreSQL de pruebas: ${r.motivo}` }
  }
  const pg = r.pg
  let falso: AgenteFalso | null = null
  let sesion: SesionTessera | null = null
  try {
    falso = montarAgenteFalso()
    const proyecto = crearProyecto(falso.raiz)
    const s = await abrirTessera(falso.env, {
      sembrar: (datos) => {
        writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX)
        writeFileSync(
          join(datos, 'workspace-state.json'),
          JSON.stringify({
            version: 1,
            activeProfileId: 'personal',
            byProfile: {
              personal: {
                openProjects: [{ projectHostPath: proyecto, name: 'proyecto-rejilla', estado: 'active' }],
                activePath: proyecto
              }
            },
            settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${proyecto}`] }
          })
        )
      }
    })
    sesion = s
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1600, 1000)
    })
    await expect(s.win.locator('.tabs-projects .project-tab')).toHaveCount(1, { timeout: 30_000 })
    await botonVista(s.win, 'Conexiones a bases de datos').click()
    await expect(s.win.locator('.db-area:not(.hidden)')).toBeVisible()
    const creada = await s.win.evaluate(
      (c) =>
        window.tessera.db.create({
          profileId: 'personal',
          alias: c.alias,
          motor: 'postgres',
          host: c.host,
          port: c.port,
          database: 'postgres',
          user: 'postgres',
          password: c.password,
          readonly: false
        }),
      { alias: ALIAS_REJILLA, host: pg.host, port: pg.port, password: pg.password }
    )
    if (!creada.tieneSecreto) throw new Error('la conexión de la prueba no guardó la contraseña')
    const raizFalso = falso.raiz
    return {
      s,
      pg,
      cerrar: async () => {
        await s.cerrar()
        pg.parar()
        await borrarTemporal(raizFalso)
      }
    }
  } catch (err) {
    // Lo que se llegó a levantar se recoge: una app o un contenedor vivos harían
    // fallar la prueba siguiente por un motivo que no es el suyo.
    await sesion?.cerrar()
    pg.parar()
    if (falso) await borrarTemporal(falso.raiz)
    throw err
  }
}

/**
 * Abre `public.<tabla>` desde el árbol (doble clic) y espera a su primera celda. Deja
 * desplegados la conexión, `public` y sus tablas: las pruebas van en serie.
 */
export async function abrirTablaPublica(win: Page, tabla: string): Promise<void> {
  await desplegar(fila(win, 'conexion', ALIAS_REJILLA))
  const publico = fila(win, 'esquema', 'public')
  await desplegar(publico)
  const tablas = await filaTras(win, publico, 'carpeta', `tablas-public-${tabla}`, 'tablas')
  await desplegar(tablas)
  await expect(fila(win, 'objeto', tabla)).toHaveCount(1, { timeout: 15_000 })
  await fila(win, 'objeto', tabla).dblclick()
  await expect(win.locator(PESTANAS, { hasText: tabla })).toHaveClass(/\bactive\b/)
  await expect(celda(win, 0, 0)).toBeVisible({ timeout: 30_000 })
}
