// =============================================================================
// Lo que tiene que ser cierto nada más arrancar la app empaquetada: la prueba de humo del
// arnés. Lo que cambia entre plataformas sale de `ESPERADO`, una tabla por plataforma, y
// no de `if` repartidos. El hueco de los botones de la ventana son dos pruebas porque no se
// mide igual: en Mac es el semáforo a la izquierda y su tamaño en pantalla; en Windows el
// Window Controls Overlay a la derecha y que el CSS le deje su sitio (`theme/chromeVentana.ts`).
// =============================================================================

import { expect, test } from '@playwright/test'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import type { CapacidadesPlataforma, Plataforma } from '../src/shared/plataforma.ts'
import { abrirTessera, fijarZoom, MOD, pantallaCompleta, PLATAFORMA, zoomDe, type SesionTessera } from './tessera'

interface Esperado {
  /** Trozo de la ruta del `userData` REAL, donde una prueba no puede escribir nunca. */
  carpetaDatosReal: string
  capacidades: CapacidadesPlataforma
}

const ESPERADO: Record<Exclude<Plataforma, 'otra'>, Esperado> = {
  mac: {
    carpetaDatosReal: 'Application Support/Tessera',
    // En Mac SÍ hay integración en caliente: las asociaciones de TIPO viven en el
    // `Info.plist` y las indexa Launch Services (eso no se apaga), pero el equivalente del
    // menú contextual de Windows es la acción rápida del Finder, un `.workflow` en
    // `~/Library/Services` que se instala y se borra en caliente (`main/shell/servicioFinder.ts`).
    // Y auto-instalar SÍ: Squirrel.Mac no puede sin Developer ID, pero sustituir un `.app`
    // es renombrar un directorio, y eso lo hace el relevo de `main/update/relevoMac.ts`.
    // Que ESTA copia pueda (que esté donde se puede escribir) es otra pregunta, no la capacidad.
    capacidades: { integracionShellEnCaliente: true, autoInstalarUpdate: true }
  },
  windows: {
    // `%APPDATA%\Tessera`. El temporal de las pruebas cuelga de `AppData\Local\Temp`,
    // así que no hay falso positivo por compartir el prefijo `AppData`.
    carpetaDatosReal: join('AppData', 'Roaming', 'Tessera'),
    // El menú contextual son claves de `HKCU\Software\Classes` que `reg.exe` escribe y
    // borra sin reinstalar ni UAC; la actualización la aplica NSIS.
    capacidades: { integracionShellEnCaliente: true, autoInstalarUpdate: true }
  }
}

function esperadoDe(plataforma: Plataforma): Esperado {
  if (plataforma === 'otra') throw new Error('Tessera no se empaqueta para esta plataforma')
  return ESPERADO[plataforma]
}

let s: SesionTessera

test.beforeAll(async () => {
  s = await abrirTessera()
})
test.afterAll(async () => {
  await s?.cerrar()
})

test('la app abre su ventana y el renderer sabe en qué plataforma está', async () => {
  expect(await s.win.evaluate(() => document.documentElement.dataset.plataforma)).toBe(PLATAFORMA)
  expect(await s.win.evaluate(() => typeof window.tessera)).toBe('object')
})

test('los datos van al temporal de la prueba, nunca a los perfiles reales', async () => {
  const ruta = await s.app.evaluate(({ app }) => app.getPath('userData'))
  // `realpathSync` por delante: en macOS el temporal es `/var/…`, symlink a
  // `/private/var/…`, y Electron devuelve la forma resuelta. Comparar en crudo daba
  // un falso negativo que parecía una fuga de datos y no lo era.
  expect(ruta).toBe(realpathSync(s.datos))
  // La guarda que de verdad importa: aquí viven los perfiles, las credenciales de
  // los agentes y el workspace-state del usuario. Una prueba no puede escribir ahí.
  expect(ruta).not.toContain(esperadoDe(PLATAFORMA).carpetaDatosReal)
})

test('las capacidades que la UI consulta son las de esta plataforma', async () => {
  // Lo que la UI hace con esto lo fijan otras specs; aquí sólo se comprueba que el
  // contrato llega entero al renderer.
  const caps = await s.win.evaluate(() => window.tessera.capacidades)
  expect(caps).toEqual(esperadoDe(PLATAFORMA).capacidades)
})

test('el hueco del semáforo lo publica Chromium y se recalcula con el zoom', async () => {
  test.skip(PLATAFORMA !== 'mac', 'el semáforo es de macOS; Windows tiene su propia prueba')
  // Es el arreglo que retiró el gemelo `ANCHO_SEMAFORO = 78` del renderer: el hueco
  // sale de `env(titlebar-area-x)`, que Chromium sólo publica si la ventana se creó
  // con `titleBarOverlay`. Medido en la app real, no en una sonda.
  //
  // SE ESPERA A QUE EL OVERLAY SE PUBLIQUE, igual que en la prueba gemela de Windows:
  // Chromium lo publica DESPUÉS de pintar, y con la máquina cargada —esta suite se
  // lanza a menudo justo detrás de empaquetar— la primera lectura llega antes y da un
  // rojo que sólo es un «todavía no».
  const leerWco = async (): Promise<{ visible: boolean; x: number }> =>
    s.win.evaluate(() => ({
      visible: navigator.windowControlsOverlay?.visible ?? false,
      x: navigator.windowControlsOverlay?.getTitlebarAreaRect().x ?? -1
    }))
  await expect
    .poll(async () => (await leerWco()).visible, { message: 'el overlay del semáforo no llegó a publicarse' })
    .toBe(true)
  const wco = await leerWco()
  expect(wco.x, 'en Mac la zona libre empieza DESPUÉS del semáforo').toBeGreaterThan(60)

  const padding = async (): Promise<number> =>
    s.win.evaluate(() =>
      parseFloat(getComputedStyle(document.querySelector('.titlebar')!).paddingLeft)
    )
  const factor = async (): Promise<number> => s.win.evaluate(() => window.devicePixelRatio)

  const base = await padding()
  expect(base).toBeCloseTo(wco.x, 0)

  // EL INVARIANTE QUE IMPORTA no es el número en píxeles CSS —cambia con el zoom—
  // sino que el hueco siga midiendo lo MISMO en pantalla: es donde está el semáforo,
  // que el sistema dibuja en píxeles físicos y no escala.
  const enPantalla = async (): Promise<number> => (await padding()) * ((await factor()) / 2)
  const p0 = await enPantalla()
  for (const nivel of [2, -2]) {
    await fijarZoom(s.win, nivel)
    const p = await enPantalla()
    expect(Math.abs(p - p0)).toBeLessThan(3)
  }
  await fijarZoom(s.win, 0)
  expect(await padding()).toBeCloseTo(base, 0)
})

test('los botones de Windows tienen su hueco a la derecha, a cualquier zoom', async () => {
  test.skip(PLATAFORMA !== 'windows', 'el Window Controls Overlay de la derecha es de Windows')
  // Los tres botones (─ □ ✕) los pinta el SISTEMA encima del contenido, y son los
  // nativos —no unos dibujados— porque sólo así «maximizar» ofrece Snap Layouts. El
  // renderer sólo tiene que dejarles sitio, y el sitio lo mide Chromium en
  // `env(titlebar-area-width)`. Si el CSS y Chromium discrepan, o una pestaña queda
  // debajo de un botón (hueco corto) o sobra una franja muerta (hueco largo).
  const medir = async (): Promise<{
    visible: boolean
    x: number
    hueco: number
    padding: number
    alto: number
    altoBarra: number
  }> =>
    s.win.evaluate(() => {
      const wco = navigator.windowControlsOverlay
      const r = wco?.getTitlebarAreaRect()
      const barra = document.querySelector('.titlebar')!
      return {
        visible: wco?.visible ?? false,
        x: r?.x ?? -1,
        hueco: r ? window.innerWidth - (r.x + r.width) : -1,
        padding: parseFloat(getComputedStyle(barra).paddingRight),
        alto: r?.height ?? -1,
        altoBarra: barra.getBoundingClientRect().height
      }
    })

  /** Lo que el sistema dice de la ventana: si está a la vista, con foco o minimizada. */
  const estadoVentana = async (): Promise<{ visible: boolean; foco: boolean; minimizada: boolean; visibilidad: string }> => ({
    ...(await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      return { visible: w.isVisible(), foco: w.isFocused(), minimizada: w.isMinimized() }
    })),
    visibilidad: await s.win.evaluate(() => document.visibilityState)
  })

  // LA PRIMERA MEDIDA TAMBIÉN ESPERA, por el mismo motivo que las del zoom: el overlay
  // lo publica Chromium después de pintar, y con la máquina cargada —esta suite se
  // lanza a menudo justo detrás de empaquetar— el primer `evaluate` llegaba antes y el
  // test cantaba un descuadre que era un «todavía no». Daba un falso rojo cada vez que
  // la pasada completa venía de compilar, y ninguno al correrla sola.
  // ~46 px por botón al 100 %: por debajo de 90 no caben ni «minimizar» y «cerrar».
  // Se ESPERA sólo a lo que es carrera —que el overlay exista—; lo demás sigue siendo
  // un aserto con su propio mensaje. Meterlos todos en el mismo `poll` hacía que un
  // descuadre del CSS se reportara como «el overlay no llegó a publicarse» y mandara a
  // depurar Chromium en vez de la hoja de estilos.
  await expect
    .poll(async () => (await medir()).visible, {
      message: 'sin overlay no hay botones nativos ni Snap Layouts'
    })
    .toBe(true)
  const m0 = await medir()
  expect(m0.x, 'en Windows la zona libre empieza en el borde izquierdo').toBe(0)
  expect(m0.hueco, 'el hueco no da ni para «minimizar» y «cerrar»').toBeGreaterThan(90)

  for (const nivel of [0, 2, -2]) {
    // CON EL TECLADO y no con `fijarZoom`: el alto del overlay lo reaplica el MAIN
    // (30 × 1,2^zoom con `setTitleBarOverlay`) cuando le llega el GUARDADO de ajustes,
    // y ese guardado lo hacen el teclado, la rueda y la fila de Configuración, no
    // `zoom.setLevel` (que es solo el webFrame, para restaurar al arrancar). Con
    // `fijarZoom` la prueba pasaba cuando OTRO guardado caía por casualidad dentro de
    // sus 5 s, y dejó de pasar cuando no cayó (el overlay se quedaba
    // en 30 px de dispositivo a cualquier zoom). El gesto del usuario es lo que hay que
    // probar: Ctrl+0 y luego Ctrl+= / Ctrl+− hasta el nivel.
    await s.win.keyboard.press(`${MOD}+0`)
    for (let i = 0; i < Math.abs(nivel); i++) await s.win.keyboard.press(nivel > 0 ? `${MOD}+=` : `${MOD}+-`)
    await expect.poll(() => zoomDe(s.win)).toBe(nivel)
    // `expect.poll` y no una medida directa: el guardado sale con 250 ms de debounce y
    // el overlay llega un viaje de IPC después. Medir sin esperar da un descuadre que
    // sólo es un «todavía no».
    await expect
      .poll(
        async () => {
          const m = await medir()
          // EL INVARIANTE: el padding de la barra ES el hueco, y la franja de los
          // botones mide lo mismo que la barra, a cualquier zoom.
          return {
            hueco: Math.abs(m.padding - m.hueco) < 2,
            alto: Math.abs(m.alto - m.altoBarra) < 2,
            // Las medidas y el estado de la ventana van en el resultado para que un rojo
            // diga QUÉ había: el único que se ha visto (a zoom -2, «alto» en false
            // tras 15 s) solo decía el booleano, y no se reprodujo en 20 pasadas, ni con la
            // CPU saturada ni con la ventana tapada por otra.
            medida: { ...m, zoom: await zoomDe(s.win), ...(await estadoVentana()) }
          }
        },
        { message: `hueco o alto del overlay descuadrados a zoom ${nivel}` }
      )
      .toEqual({ hueco: true, alto: true, medida: expect.anything() })
  }
  await s.win.keyboard.press(`${MOD}+0`)
  await expect.poll(() => zoomDe(s.win)).toBe(0)
})

// VA LA ÚLTIMA DEL ARCHIVO A PROPÓSITO: recarga el renderer, y nada después debe
// depender del estado de la página.
//
// La pantalla completa de Mac esconde el semáforo, y la barra deja de reservarle hueco
// (`seguirSemaforo`, theme/chromeVentana.ts). La primera versión del arreglo sólo
// escuchaba el `geometrychange` del overlay, y un documento que NACE en pantalla
// completa no recibe ninguno: nace con `visible: false` y así se queda. Medido con
// Electron 43. Ese documento existe en la app —el main recarga el renderer si se cae,
// y el ErrorBoundary tiene «Recargar»—, y con él volvían los 80 px vacíos. Ninguna
// otra prueba lo cubría; ésta es la que lo fija.
test('en pantalla completa de macOS no hay hueco del semáforo, ni siquiera tras recargar', async () => {
  test.skip(
    PLATAFORMA !== 'mac',
    'el arreglo es sólo de macOS; qué hace el overlay de Windows con F11 está sin medir'
  )
  const estado = (): Promise<{ marca: string | null; relleno: number }> =>
    s.win.evaluate(() => ({
      marca: document.documentElement.dataset.semaforo ?? null,
      relleno: parseFloat(getComputedStyle(document.querySelector('.titlebar')!).paddingLeft)
    }))

  const enVentana = await estado()
  expect(enVentana.marca, 'en ventana: sin marca').toBeNull()
  expect(enVentana.relleno, 'y con el hueco del semáforo').toBeGreaterThan(60)

  try {
    expect(await pantallaCompleta(s.app, true)).toBe(true)
    await expect.poll(estado, { message: 'al entrar: marca y sin hueco' }).toEqual({ marca: 'oculto', relleno: 0 })

    await s.win.reload()
    await s.win.waitForSelector('.titlebar')
    // Sin `poll` a propósito: este documento no va a recibir ningún evento que lo
    // arregle más tarde. Lo que tenga ahora es lo que se queda.
    expect(await estado(), 'recargado en pantalla completa: marca y sin hueco').toEqual({
      marca: 'oculto',
      relleno: 0
    })
  } finally {
    await pantallaCompleta(s.app, false)
  }

  await expect
    .poll(async () => (await estado()).marca, { message: 'al salir se retira la marca' })
    .toBeNull()
  expect((await estado()).relleno, 'y vuelve el hueco del semáforo').toBeGreaterThan(60)
})
