// =============================================================================
// La rejilla del explorador de BD («uso diario») sobre la app empaquetada y contra un
// PostgreSQL de `postgresEfimero.ts` (`rejillaAyudas.ts`): el menú de dos pasos de «Copiar
// como» que escribe en el portapapeles del sistema, Mayús+Intro con sus mitades negativas
// y el visor por portal con un Monaco que nace con caja, «Traer todas» por `leerMas`, y
// exportar con `dialog.showSaveDialog` sustituido EN EL MAIN (el camino desde el IPC es el
// real) y el filtro aplicado. «Mostrar en …» no se pulsa: abriría el gestor de archivos.
// En serie y compartiendo app. Cambian `MOD` y el texto del aviso según `PLATAFORMA`.
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monacoEn } from './monaco'
import {
  abrirTablaPublica,
  arrancarRejilla,
  asentar,
  celda,
  conPortapapeles,
  entradasMenu,
  FILAS_GRANDE,
  HOST_VISOR,
  LARGO_FILA_1,
  leerPortapapeles,
  opcionMenu,
  PANE,
  textoPildora,
  type EntornoRejilla
} from './rejillaAyudas'
import { borrarTemporal, MOD, PLATAFORMA } from './tessera'

test.describe.configure({ mode: 'serial' })

const VISOR = '.db-visor-modal'
const NBSP = String.fromCharCode(160)

/** El texto del Monaco del visor, cuando ya existe (nace en el primer layout con caja). */
async function textoVisor(win: Page): Promise<string> {
  let texto: string | null = null
  await expect
    .poll(
      async () => {
        texto = await monacoEn(win, HOST_VISOR, { op: 'texto' }).catch(() => null)
        return texto !== null
      },
      { message: 'el visor no llegó a tener editor' }
    )
    .toBe(true)
  return texto ?? ''
}

test.describe('rejilla del explorador: copiar como, visor, traer todas y exportar', () => {
  let e: EntornoRejilla | null = null
  let motivoSalto: string | null = null
  let dirExport = ''

  test.beforeAll(async () => {
    const r = await arrancarRejilla()
    if ('motivo' in r) {
      motivoSalto = r.motivo
      return
    }
    e = r
    dirExport = mkdtempSync(join(tmpdir(), 'tessera-e2e-export-'))
  })

  test.beforeEach(() => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
  })

  test.afterAll(async () => {
    await e?.cerrar()
    if (dirExport) await borrarTemporal(dirExport)
  })

  // (1) «COPIAR COMO» DESDE EL MENÚ, en dos pasos. La raíz trae lo de todos los días
  // (Ver valor, Copiar, Copiar con cabeceras) y las dos entradas con «…» que abren el
  // segundo paso en el mismo sitio. CSV con cabecera y CRLF; INSERT con la tabla
  // calificada que da la pestaña.
  test('(1) «Copiar como» CSV y SQL INSERT desde el menú contextual', async () => {
    const win = e!.s.win
    await abrirTablaPublica(win, 'grande')
    await expect(celda(win, 0, 0)).toHaveText('1')

    await conPortapapeles(win, async () => {
      await win.evaluate(() => window.tessera.clipboard.write('centinela-e2e'))
      await celda(win, 0, 0).click()
      await celda(win, 1, 1).click({ modifiers: ['Shift'] })
      await expect(win.locator(`${PANE} .db-celda.sel`)).toHaveCount(4)

      await celda(win, 0, 1).click({ button: 'right' })
      expect(await entradasMenu(win)).toEqual([
        'Ver valor',
        '—',
        'Copiar',
        'Copiar con cabeceras',
        'Copiar como…',
        '—',
        'Exportar a archivo…',
        'Traer todas las filas',
        // `grande` tiene PK, así que es editable y el menú suma la edición al
        // final (lo destructivo, abajo del todo).
        '—',
        'Editar celda',
        'Poner NULL',
        'Revertir selección',
        '—',
        'Añadir fila',
        'Borrar 2 filas'
      ])
      await opcionMenu(win, 'Copiar como…').click()
      // Segundo paso: el MISMO menú con otra lista, el título apagado arriba y el foco
      // en la primera opción que se puede elegir.
      expect(await entradasMenu(win)).toEqual(['Copiar como', 'CSV', 'JSON', 'SQL INSERT', 'Markdown'])
      await expect(opcionMenu(win, 'Copiar como')).toBeDisabled()
      await expect(opcionMenu(win, 'CSV')).toBeFocused()
      await opcionMenu(win, 'CSV').click()
      await expect(win.locator('.ctx-menu')).toHaveCount(0)
      await expect.poll(() => leerPortapapeles(win), { message: 'el rango en CSV' }).toBe('id,nombre\n1,fila 1\n2,fila 2')
      await expect(win.locator(`${PANE} .db-rejilla`), 'el foco vuelve a la rejilla').toBeFocused()

      await celda(win, 0, 1).click({ button: 'right' })
      await opcionMenu(win, 'Copiar como…').click()
      await opcionMenu(win, 'SQL INSERT').click()
      await expect
        .poll(() => leerPortapapeles(win), { message: 'el rango en INSERT' })
        .toMatch(/^INSERT INTO (public\.)?grande \(id, nombre\) VALUES \(1, 'fila 1'\);\nINSERT INTO (public\.)?grande \(id, nombre\) VALUES \(2, 'fila 2'\);\n$/)
    })
  })

  // (2) EL VISOR DE VALOR. Mayús+Intro sobre la celda activa lo abre; Intro a secas y
  // Mod+Intro NO (mitades negativas del atajo). El JSON sale formateado SIN redondear
  // el número de 20 cifras, «Crudo» enseña el texto tal cual, y Esc cierra y devuelve
  // el foco a la rejilla con la misma celda activa.
  // `grande` es EDITABLE y ahí Intro abre el EDITOR de la celda (como
  // en cualquier cliente de bases de datos): la mitad negativa se comprueba en cada gesto por separado, con el
  // editor cerrado con Esc entre medias, para que Mod+Intro llegue a la REJILLA y no
  // al editor, donde significa otra cosa («confirmar y enviar»).
  test('(2) Mayús+Intro abre el visor; Intro y Mod+Intro no; Esc vuelve a la celda', async () => {
    const win = e!.s.win
    await celda(win, 0, 2).click()
    await expect(win.locator(`${PANE} .db-rejilla`)).toBeFocused()

    await win.keyboard.press('Enter')
    await asentar(win)
    await expect(win.locator(VISOR), 'Intro no abre el visor').toHaveCount(0)
    await expect(win.locator(`${PANE} .db-celda-editor`), 'en una tabla editable, Intro abre el editor').toHaveCount(1)
    await win.keyboard.press('Escape')
    await expect(win.locator(`${PANE} .db-celda-editor`)).toHaveCount(0)
    await expect(win.locator(`${PANE} .db-rejilla`), 'Esc devuelve el foco a la rejilla').toBeFocused()

    await win.keyboard.press(`${MOD}+Enter`)
    await asentar(win)
    await expect(win.locator(VISOR), 'Mod+Intro no abre el visor').toHaveCount(0)
    await expect(win.locator(`${PANE} .db-celda-editor`), 'ni el editor').toHaveCount(0)

    await win.keyboard.press('Shift+Enter')
    const visor = win.locator(VISOR)
    await expect(visor).toBeVisible()
    await expect(visor.locator('.db-visor-columna')).toHaveText('datos')
    await expect(visor.locator('.db-visor-meta')).toContainText('jsonb')

    const formateado = await textoVisor(win)
    expect(formateado, 'formateado, con sangría').toContain('\n  "n": 1')
    expect(formateado, 'el número de 20 cifras, sin redondear').toContain('"grande": 12345678901234567890')
    // Monaco NACIÓ con caja: pinta líneas (a 0 px se queda en 5×5 y no pinta ninguna).
    await expect(visor.locator('.db-visor-host .view-line').first()).toBeVisible()

    await visor.getByRole('radio', { name: 'Crudo' }).click()
    await expect.poll(() => monacoEn(win, HOST_VISOR, { op: 'texto' })).toBe('{"n": 1, "grande": 12345678901234567890}')

    await win.keyboard.press('Escape')
    await expect(visor).toHaveCount(0)
    await expect(win.locator(`${PANE} .db-rejilla`), 'el foco vuelve a la rejilla').toBeFocused()
    await expect(celda(win, 0, 2)).toHaveClass(/\bfoco\b/)
  })

  // (2b) UNA CELDA RECORTADA: el main deja 64 KiB en la rejilla y el visor pide el valor
  // ENTERO por la clave primaria. La cabecera dice la longitud real desde el principio.
  test('(2b) el visor trae el valor completo de una celda recortada', async () => {
    const win = e!.s.win
    await celda(win, 0, 4).click()
    await win.keyboard.press('Shift+Enter')
    const visor = win.locator(VISOR)
    await expect(visor).toBeVisible()
    await expect(visor.locator('.db-visor-meta')).toContainText(`100${NBSP}000 caracteres`)
    await expect
      .poll(async () => (await monacoEn(win, HOST_VISOR, { op: 'texto' }).catch(() => '')).length, {
        message: 'el valor completo llega al visor',
        timeout: 30_000
      })
      .toBe(LARGO_FILA_1)
    await expect(visor.locator('.db-visor-aviso.tono-error')).toHaveCount(0)
    await expect(visor.locator('.db-visor-aviso'), 'ya no queda aviso de «parcial» ni de «cargando»').toHaveCount(0)
    await win.keyboard.press('Escape')
    await expect(visor).toHaveCount(0)
  })

  // (2c) BINARIO: volcado hex a lo `hexdump -C` (el bytea de la fila 1 es 00 00 00 01).
  test('(2c) un bytea se ve en volcado hex', async () => {
    const win = e!.s.win
    await celda(win, 0, 3).click()
    await win.keyboard.press('Shift+Enter')
    await expect(win.locator(VISOR)).toBeVisible()
    expect(await textoVisor(win)).toMatch(/^00000000 {2}00 00 00 01 {2}/)
    await win.keyboard.press('Escape')
    await expect(win.locator(VISOR)).toHaveCount(0)
  })

  // (3) «TRAER TODAS»: desde la píldora, por el lector real, hasta el final. Luego la
  // entrada del menú queda apagada (ya no hay nada que traer).
  test('(3) «Traer todas» en una tabla de más de 500 filas', async () => {
    const win = e!.s.win
    await expect(textoPildora(win)).toHaveText('500+ filas')
    await win.locator(`${PANE} .db-pildora-traer`).click()
    await expect(textoPildora(win), 'trae hasta la última').toHaveText(`${FILAS_GRANDE} filas`, { timeout: 60_000 })
    await expect(win.locator(`${PANE} .db-pildora-traer`)).toHaveCount(0)

    await celda(win, 0, 0).click({ button: 'right' })
    await expect(opcionMenu(win, 'Traer todas las filas')).toBeDisabled()
    await win.keyboard.press('Escape')
    await expect(win.locator('.ctx-menu')).toHaveCount(0)
  })

  // (4) EXPORTAR: el diálogo de guardar se sustituye en el main. El archivo lleva el
  // filtro APLICADO (id <= 10), no el que está a medio escribir (id <= 3), y el aviso
  // ofrece «Mostrar en …» del gestor de esta plataforma (no se pulsa).
  test('(4) exportar a CSV con el filtro aplicado, y la tabla entera a SQL INSERT', async () => {
    const win = e!.s.win
    const app = e!.s.app
    const pane = win.locator(PANE)
    // El WHERE libre está detrás de «SQL» (el filtro guiado es el de por
    // defecto). Lo que se exporta con el guiado y el orden sale de la MISMA función que
    // arma `abrirTabla` (`camposDeFiltroTabla`, fijada en `test-modelo-filtro.mts`).
    await pane.locator('.filtro-guiado').getByRole('button', { name: 'SQL', exact: true }).click()
    const where = pane.locator('.db-filtro-input').first()
    await where.fill('id <= 10')
    await where.press('Enter')
    await expect(textoPildora(win)).toHaveText('10 filas', { timeout: 30_000 })
    await where.fill('id <= 3')

    const rutaCsv = join(dirExport, 'grande-e2e.csv')
    await app.evaluate(({ dialog }, ruta) => {
      ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async () => ({ canceled: false, filePath: ruta })
    }, rutaCsv)
    await pane.getByRole('button', { name: 'Exportar a archivo' }).click()
    expect(await entradasMenu(win)).toEqual(['CSV…', 'TSV…', 'JSON…', 'SQL INSERT…', 'Markdown…'])
    await opcionMenu(win, 'CSV…').click()

    const aviso = win.locator('.toast', { hasText: 'grande-e2e.csv' })
    await expect(aviso.locator('.toast-title')).toHaveText('Exportadas 10 filas a grande-e2e.csv', { timeout: 30_000 })
    const gestor = PLATAFORMA === 'mac' ? 'el Finder' : PLATAFORMA === 'windows' ? 'el Explorador' : 'el gestor de archivos'
    await expect(aviso.locator('.toast-accion')).toHaveText(`Mostrar en ${gestor}`)

    const csv = readFileSync(rutaCsv, 'utf8')
    expect(csv.charCodeAt(0), 'CSV exportado con BOM (Excel)').toBe(0xfeff)
    const lineas = csv.slice(1).split('\r\n')
    expect(lineas[0]).toBe('id,nombre,datos,bin,largo')
    expect(lineas[1].startsWith('1,fila 1,')).toBe(true)
    expect(lineas.filter((l) => l !== '').length, 'cabecera + las 10 del filtro APLICADO').toBe(11)

    // La tabla entera: WHERE vacío y aplicado, y a SQL INSERT.
    await where.fill('')
    await where.press('Enter')
    await expect(textoPildora(win)).toHaveText('500+ filas', { timeout: 30_000 })
    const rutaSql = join(dirExport, 'grande-e2e.sql')
    await app.evaluate(({ dialog }, ruta) => {
      ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async () => ({ canceled: false, filePath: ruta })
    }, rutaSql)
    await pane.getByRole('button', { name: 'Exportar a archivo' }).click()
    await opcionMenu(win, 'SQL INSERT…').click()
    await expect(win.locator('.toast', { hasText: 'grande-e2e.sql' }).locator('.toast-title')).toHaveText(
      `Exportadas ${FILAS_GRANDE} filas a grande-e2e.sql`,
      { timeout: 60_000 }
    )
    const sql = readFileSync(rutaSql, 'utf8')
    expect((sql.match(/^INSERT INTO /gm) ?? []).length, 'una sentencia por fila de la tabla ENTERA').toBe(FILAS_GRANDE)
    expect(sql).toContain("VALUES (2, 'fila 2', ")
  })

  // (5) MITAD NEGATIVA DEL VISOR: una tabla SIN clave primaria no puede volver a
  // encontrar la fila, así que no pide el valor completo y lo dice.
  test('(5) sin clave primaria, el visor dice por qué no hay valor completo', async () => {
    const win = e!.s.win
    await abrirTablaPublica(win, 'sin_pk')
    await celda(win, 0, 1).click()
    await win.keyboard.press('Shift+Enter')
    const visor = win.locator(VISOR)
    await expect(visor).toBeVisible()
    await expect(visor.locator('.db-visor-aviso.tono-aviso')).toContainText('La tabla no tiene clave primaria')
    await expect(visor.locator('.db-visor-meta')).toContainText(`70${NBSP}000 caracteres`)
    await win.keyboard.press('Escape')
    await expect(visor).toHaveCount(0)
  })
})
