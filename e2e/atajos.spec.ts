// =============================================================================
// Los atajos pulsados de verdad: ⌘ manda en Mac y Ctrl no, salvo Ctrl+` (`esCtrlLiteral`).
// `util/test-atajos.mts` fija la DECISIÓN de `esModPrincipal`; aquí se comprueba que llega
// a tomarse (que nadie se come el `keydown` antes) y la mitad negativa, que solo se puede
// comprobar pulsando. Los tooltips se leen del `title` pintado (`etiquetaModPrincipal`).
// Acordes en función de `MOD` y `MOD_AJENO`; etiquetas de `ETIQUETA_MOD`. Nada de `sleep`:
// tras una tecla se esperan dos `requestAnimationFrame` (`asentar`) para que React confirme.
// Decisiones: docs/decisiones/pruebas/que-va-en-e2e-y-que-en-test-mts.md
// =============================================================================

import { crearTemporal } from './temporales'
import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { abrirTessera, borrarTemporal, fijarZoom, MOD, zoomDe, type SesionTessera } from './tessera'

/**
 * El modificador que en esta plataforma NO manda: Ctrl en Mac, la tecla Windows en
 * Windows. Los dos son teclas del sistema con significado propio, y tragárselas es
 * el bug que `esModPrincipal` existe para evitar.
 */
const MOD_AJENO = MOD === 'Meta' ? 'Control' : 'Meta'

/** Cómo escribe la interfaz el modificador principal y el ajeno (`etiquetaModPrincipal`). */
const ETIQUETA_MOD = MOD === 'Meta' ? '⌘' : 'Ctrl'
const ETIQUETA_AJENA = MOD === 'Meta' ? 'Ctrl' : '⌘'

/** Deja que React confirme el render provocado por la tecla. Ver la cabecera. */
async function asentar(ventana: Page): Promise<void> {
  await ventana.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  )
}

test.describe('atajos globales', () => {
  let s: SesionTessera

  test.beforeAll(async () => {
    s = await abrirTessera()
  })
  test.afterAll(async () => {
    await s?.cerrar()
  })

  test('⌘/Ctrl+, abre Configuración y el modificador ajeno no', async () => {
    const modal = s.ventana.locator('.ajustes-modal')
    await expect(modal).toHaveCount(0)

    // LA MITAD QUE EL `||` ROMPÍA. Con `ctrlKey || metaKey` esta pulsación abría el
    // modal en Mac, y de paso se comía un Ctrl+, que el sistema deja libre para
    // otras cosas.
    await s.ventana.keyboard.press(`${MOD_AJENO}+,`)
    await asentar(s.ventana)
    await expect(modal).toHaveCount(0)

    await s.ventana.keyboard.press(`${MOD}+,`)
    await expect(modal).toHaveCount(1)

    // Esc cierra (el buscador del modal está vacío, así que no se lo queda él).
    await s.ventana.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
  })

  test('Ctrl+` abre la terminal en las dos plataformas, y ⌘/⊞+` no', async () => {
    // La franja está SIEMPRE montada (keep-alive: las terminales tienen que
    // sobrevivir a que dejes de mirarlas), así que lo observable no es que exista
    // sino que pierda la clase `hidden`.
    const franja = s.ventana.locator('section.terminal-panel:not(.hidden)')
    await expect(franja).toHaveCount(0)

    // ⌘+` es «ventana siguiente» del sistema en macOS, y ⊞ es la tecla del sistema en
    // Windows: Tessera no se queda ninguna de las dos, y por eso aquí no pasa nada. Es
    // `Meta` en las dos y no `MOD`, porque en Windows `MOD` es Control, que es
    // justamente la excepción que se prueba a continuación.
    await s.ventana.keyboard.press('Meta+`')
    await asentar(s.ventana)
    await expect(franja).toHaveCount(0)

    // La EXCEPCIÓN deliberada del repo (`esCtrlLiteral`): Ctrl+` abre la terminal también
    // en Mac, como en los editores de código.
    await s.ventana.keyboard.press('Control+`')
    await expect(franja).toHaveCount(1)

    // Y cierra con el mismo acorde: el atajo conmuta la terminal.
    await s.ventana.keyboard.press('Control+`')
    await expect(franja).toHaveCount(0)

    // LO QUE SE ENSEÑA ES LO QUE SE PULSA, también para la excepción: este botón
    // tiene que decir Ctrl en Mac, y es el único de la app que puede.
    const boton = s.ventana.locator('.activity-bar button[title^="Terminal"]')
    await expect(boton).toHaveAttribute('title', 'Terminal (Ctrl+`)')
  })

  test('⌘/Ctrl +/− y +0 mueven el zoom; el modificador ajeno no', async () => {
    expect(await zoomDe(s.ventana)).toBe(0)

    await s.ventana.keyboard.press(`${MOD}+=`)
    await expect.poll(() => zoomDe(s.ventana)).toBe(1)
    await s.ventana.keyboard.press(`${MOD}+=`)
    await expect.poll(() => zoomDe(s.ventana)).toBe(2)

    await s.ventana.keyboard.press(`${MOD}+-`)
    await expect.poll(() => zoomDe(s.ventana)).toBe(1)

    // Con el `||`, en Mac esto habría hecho zoom además de lo que el sistema haga
    // con Ctrl++ (ampliar la pantalla entera, si está activado en Accesibilidad).
    await s.ventana.keyboard.press(`${MOD_AJENO}+=`)
    await asentar(s.ventana)
    expect(await zoomDe(s.ventana)).toBe(1)

    await s.ventana.keyboard.press(`${MOD}+0`)
    await expect.poll(() => zoomDe(s.ventana)).toBe(0)
  })

  test('Ctrl+rueda hace zoom en las dos plataformas, y ese Ctrl es literal', async () => {
    // NO es una excepción más a `esModPrincipal`: Chromium sintetiza `ctrlKey:true`
    // en los eventos de rueda del PELLIZCO del trackpad, en Mac también. Exigir ⌘
    // aquí dejaría el gesto natural del sistema sin efecto (ver `onWheel` en
    // useAtajosGlobales.ts). Se prueba como lo que es: Control literal + rueda.
    expect(await zoomDe(s.ventana)).toBe(0)
    await s.ventana.mouse.move(400, 400)
    await s.ventana.keyboard.down('Control')
    await s.ventana.mouse.wheel(0, -120)
    await s.ventana.keyboard.up('Control')
    await expect.poll(() => zoomDe(s.ventana)).toBe(1)

    await fijarZoom(s.ventana, 0)
  })

  test('las etiquetas de la interfaz dicen el modificador de la plataforma', async () => {
    // El tooltip del engranaje: es la superficie donde `etiquetaModPrincipal` se
    // estrenó, y la que un usuario ve sin abrir nada. ⌘ en Mac, Ctrl en Windows.
    const engranaje = s.ventana.locator('.titlebar-acciones button[aria-label="Configuración"]')
    await expect(engranaje).toHaveAttribute('title', `Configuración (${ETIQUETA_MOD}+,)`)

    // Y el texto de ayuda de la fila de Zoom, que nombra los TRES gestos: el
    // modificador principal con +/−, Ctrl+rueda (Control a propósito, ver la prueba de
    // arriba) y el modificador principal con 0.
    await s.ventana.keyboard.press(`${MOD}+,`)
    const panel = s.ventana.locator('.ajustes-modal-panel')
    await expect(panel).toHaveCount(1)
    const texto = (await panel.innerText()).replace(/\s+/g, ' ')
    expect(texto).toContain(`${ETIQUETA_MOD} +/− y Ctrl+rueda`)
    expect(texto).toContain(`${ETIQUETA_MOD}+0`)
    // La forma vieja, la que enseñaba en Mac un atajo que la app se niega a
    // reconocer (y su espejo en Windows). Si reaparece, esta prueba es la que lo dice.
    expect(texto).not.toContain(`${ETIQUETA_AJENA} +/−`)
    expect(texto).not.toContain(`${ETIQUETA_AJENA}+0`)

    await s.ventana.keyboard.press('Escape')
    await expect(s.ventana.locator('.ajustes-modal')).toHaveCount(0)
  })
})

// -----------------------------------------------------------------------------
// ⌘+F: el buscador de la vista RENDERIZADA (`features/editor/useBusquedaDom.ts`). Vive aparte,
// con su propia app, porque es la única que necesita un proyecto abierto y un archivo
// cargado, y eso cambia el layout entero; compartir sesión haría del orden de ejecución
// parte del contrato, que es lo que vuelve intermitentes a las pruebas de teclado. El
// diálogo nativo de carpeta se sustituye en el main (`app.evaluate`): `showOpenDialog` es
// una ventana del sistema que Playwright no conduce, y la ruta sigue llegando OPACA desde
// el main, como exige `modeloPestanas`. Sus agentes corren nativos (sin elegir Docker): sin contenedor.
// -----------------------------------------------------------------------------
test.describe('⌘+F en la vista renderizada de un Markdown', () => {
  let s: SesionTessera
  let proyecto: string
  const NOMBRE_MD = 'LEEME.md'
  const PALABRA = 'zarzaparrilla'

  test.beforeAll(async () => {
    proyecto = crearTemporal(join(tmpdir(), 'tessera-e2e-proy-'))
    // Dos apariciones a propósito: el contador del buscador («1 / 2») es lo que
    // demuestra que el atajo no sólo abrió una caja, sino que buscó de verdad.
    writeFileSync(
      join(proyecto, NOMBRE_MD),
      `# Título\n\nUna ${PALABRA} en el párrafo.\n\nY otra ${PALABRA} más abajo.\n`,
      'utf8'
    )
    s = await abrirTessera()
    await s.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async (): Promise<Electron.OpenDialogReturnValue> => ({
        canceled: false,
        filePaths: [dir]
      })
    }, proyecto)
    await s.ventana.locator('.project-tabs-empty-link').click()
    await s.ventana.locator('.tree-row:visible').filter({ hasText: NOMBRE_MD }).first().click()
    // Un .md abre en vista renderizada, que es donde `useBusquedaDom` se arma; en
    // «Código» manda el buscador de Monaco, que es otra superficie.
    await expect(s.ventana.locator('.markdown-preview')).toHaveCount(1)
  })
  test.afterAll(async () => {
    await s?.cerrar()
    if (proyecto) await borrarTemporal(proyecto)
  })

  test('⌘/Ctrl+F abre el buscador del documento y el modificador ajeno no', async () => {
    const buscador = s.ventana.locator('.search-box.en-documento')
    await expect(buscador).toHaveCount(0)

    // EL FOCO, EN EL DOCUMENTO. Al abrir el proyecto arranca la sesión del agente, y su
    // terminal se queda el foco al montarse; si eso llega antes que estas teclas, el
    // Ctrl+F lo atiende xterm con SU buscador —que es lo correcto: en una terminal,
    // buscar es buscar en la terminal— y la prueba falla por algo que no es lo que mide.
    // Visto en Windows, de forma intermitente. Un clic en la vista deja el foco en el
    // documento, que es donde se prueba el atajo.
    await s.ventana.locator('.markdown-preview').click()

    // El atajo se escucha en `window`, así que aquí el `||` era MÁS caro que en un
    // campo: en Mac se tragaba con `preventDefault` un Ctrl+F que no es de Tessera.
    await s.ventana.keyboard.press(`${MOD_AJENO}+f`)
    await asentar(s.ventana)
    await expect(buscador).toHaveCount(0)

    await s.ventana.keyboard.press(`${MOD}+f`)
    await expect(buscador).toHaveCount(1)
    // Abrirlo sin darle el foco sería abrir una caja para nada.
    const campo = buscador.locator('input[aria-label="Buscar en el documento"]')
    await expect(campo).toBeFocused()

    await campo.fill(PALABRA)
    await expect(buscador.locator('.search-box-count')).toHaveText('1 / 2')

    await s.ventana.keyboard.press('Escape')
    await expect(buscador).toHaveCount(0)
  })
})
