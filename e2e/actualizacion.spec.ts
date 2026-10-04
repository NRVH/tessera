// =============================================================================
// El ciclo de actualización de macOS entero: una Tessera EMPAQUETADA, delante de un feed
// real, descarga una versión nueva, la verifica, la deja preparada, se sustituye a sí misma
// y vuelve a abrirse sabiendo que se actualizó. Trabaja sobre una COPIA del `.app` en un
// temporal con la versión bajada a `0.0.1` (Info.plist y `package.json` del bundle), y el
// feed es `dist/` tal cual: así lo que se prueba es el zip y el `latest-mac.yml` que
// electron-builder genera, no uno fabricado por la prueba. Las piezas las fijan
// `test-relevo-mac.mts` y `test-update.mts`; aquí, la cadena. Solo Mac.
// =============================================================================

import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { PLATAFORMA } from './tessera'

/** La versión que se le pone a la copia vieja. Cualquier cosa menor que la de dist. */
const VERSION_VIEJA = '0.0.1'

const DIST = resolve(process.cwd(), 'dist')
const APP_DIST = join(DIST, 'mac-arm64', 'Tessera.app')

/** Carpeta de trabajo de esta prueba: la copia de la app y su userData. */
let W = ''
/** La copia que se va a sustituir. */
let copiaApp = ''
/** El `userData` temporal, compartido por la copia y por la app que el relevo relanza. */
let datos = ''
let servidor: Server | null = null
let urlFeed = ''
/** La versión que el feed anuncia (la de `dist/`). */
let versionNueva = ''

// Copiar ~250 MB, arrancar una app empaquetada, bajar ~115 MB y sustituir un bundle
// no cabe en los 120 s por defecto del proyecto.
test.describe.configure({ timeout: 600_000 })

// SÓLO macOS. Esto ejerce el relevo propio de Mac (`relevoMac.ts`) con herramientas
// de Apple (`ditto`, `codesign`, PlistBuddy). El ciclo de Windows es otro —lo aplica
// NSIS y lo lanza electron-updater— y todavía no tiene su gemela aquí.
test.skip(PLATAFORMA !== 'mac', 'el ciclo de actualización que se prueba aquí es el de macOS')

/** La versión que `app.getVersion()` leería de ese bundle. */
function versionDelBundle(app: string): string {
  const pkg = join(app, 'Contents', 'Resources', 'app', 'package.json')
  return JSON.parse(readFileSync(pkg, 'utf8')).version
}

/**
 * Escribe la versión en los DOS sitios donde vive dentro del bundle, y VUELVE A
 * FIRMAR.
 *
 * Lo de volver a firmar no es pulcritud: sin ello la copia no arranca. Medido —el
 * primer intento de esta prueba moría con "Target crashed" en 600 ms—: tocar el
 * `Info.plist` rompe el sello de la firma ad-hoc (`codesign --verify` dice "plist or
 * signature have been modified") y el kernel se niega a ejecutar el bundle. Un
 * `codesign --force --deep --sign -` cuesta ~1,5 s y lo deja como un `.app` de verdad,
 * que es justo lo que la prueba necesita: el relevo verifica firmas.
 */
function fijarVersionDelBundle(app: string, version: string): void {
  const pkg = join(app, 'Contents', 'Resources', 'app', 'package.json')
  const json = JSON.parse(readFileSync(pkg, 'utf8'))
  json.version = version
  writeFileSync(pkg, JSON.stringify(json, null, 2) + '\n')
  // El Info.plist no lo lee `app.getVersion()` (por `asar: false`), pero sí el Finder,
  // `open` y `codesign`. Dejarlo descuadrado sería fabricar un bundle que no se parece
  // a ninguno real.
  const plist = join(app, 'Contents', 'Info.plist')
  for (const clave of ['CFBundleShortVersionString', 'CFBundleVersion']) {
    const r = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Set :${clave} ${version}`, plist], {
      encoding: 'utf8'
    })
    if (r.status !== 0) throw new Error(`PlistBuddy no pudo fijar ${clave}: ${r.stderr}`)
  }
  const firma = spawnSync('codesign', ['--force', '--deep', '--sign', '-', app], { encoding: 'utf8' })
  if (firma.status !== 0) throw new Error(`no se pudo volver a firmar la copia: ${firma.stderr}`)
  const ver = spawnSync('codesign', ['--verify', '--deep', '--strict', app], { encoding: 'utf8' })
  if (ver.status !== 0) throw new Error(`la copia refirmada no verifica: ${ver.stderr}`)
}

/** sha512 en base64, la forma en que lo publica el `latest-mac.yml`. */
function sha512De(ruta: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash('sha512')
    const f = createReadStream(ruta)
    f.on('error', rej)
    f.on('data', (t) => h.update(t))
    f.on('end', () => res(h.digest('base64')))
  })
}

/** Saca el valor de una clave de primer nivel del `latest-mac.yml`. */
function claveDelYml(texto: string, clave: string): string {
  const m = new RegExp(`^${clave}\\s*:\\s*(.+)$`, 'm').exec(texto)
  if (m === null) throw new Error(`el latest-mac.yml de dist no trae la clave ${clave}`)
  return m[1].trim().replace(/^["']|["']$/g, '')
}

/** ¿Hay algún proceso vivo corriendo desde esa ruta? */
function procesosDe(ruta: string): string {
  const r = spawnSync('/bin/sh', ['-c', `pgrep -fl ${JSON.stringify(ruta)} || true`], {
    encoding: 'utf8'
  })
  return (r.stdout ?? '').trim()
}

function matarProcesosDe(ruta: string): void {
  spawnSync('/bin/sh', ['-c', `pkill -f ${JSON.stringify(ruta)} || true`])
}

test.beforeAll(async () => {
  // Sin esto, el fallo sería un ENOENT del spawn que no dice qué falta.
  const yml = join(DIST, 'latest-mac.yml')
  if (!existsSync(APP_DIST) || !existsSync(yml)) {
    throw new Error(
      `Faltan los artefactos de macOS en ${DIST}. Esta prueba usa el feed REAL que ` +
        'publica electron-builder (el .zip y su latest-mac.yml), así que necesita un ' +
        'build completo: `npm run build:mac` (a `npm run pack:mac:dir` le falta el zip).'
    )
  }
  const textoYml = readFileSync(yml, 'utf8')
  versionNueva = claveDelYml(textoYml, 'version')
  const nombreZip = claveDelYml(textoYml, 'path')
  const zip = join(DIST, nombreZip)
  if (!existsSync(zip)) throw new Error(`el latest-mac.yml apunta a ${nombreZip}, que no está en dist/`)

  // CONTROL DE CORDURA DEL PROPIO FEED. Si `dist/` quedó a medias (un yml de un build y
  // un zip de otro), la app rechazaría la descarga por hash y el síntoma sería
  // "la actualización no se prepara", que manda a depurar el sitio equivocado.
  expect(await sha512De(zip), 'el sha512 del latest-mac.yml no cuadra con el zip de dist/').toBe(
    claveDelYml(textoYml, 'sha512')
  )

  W = mkdtempSync(join(tmpdir(), 'tessera-e2e-update-'))
  datos = join(W, 'datos')
  mkdirSync(datos, { recursive: true })
  // El contenedor imita a `/Applications`: el relevo renombra DENTRO de él.
  const contenedor = join(W, 'Aplicaciones')
  mkdirSync(contenedor, { recursive: true })
  copiaApp = join(contenedor, 'Tessera.app')
  // `ditto` y no `cpSync` de Node. Medido: `cpSync` deja el `Electron
  // Framework.framework` con "unsealed contents present in the root directory of an
  // embedded framework" —resuelve los enlaces simbólicos de las versiones del
  // framework en vez de copiarlos tal cual—, y con eso el bundle ya no se puede
  // firmar. `ditto` es la herramienta de Apple para copiar bundles y los conserva.
  const copia = spawnSync('ditto', [APP_DIST, copiaApp], { encoding: 'utf8' })
  if (copia.status !== 0) throw new Error(`no se pudo copiar la app de dist/: ${copia.stderr}`)
  fijarVersionDelBundle(copiaApp, VERSION_VIEJA)

  // El feed: `dist/` servido en sólo lectura. Sin escrituras y sin listados; lo que no
  // esté, 404, que es lo que respondería un servidor de paquetes de verdad.
  servidor = createServer((req, res) => {
    const nombre = basename(decodeURIComponent((req.url ?? '/').split('?')[0]))
    const ruta = join(DIST, nombre)
    if (nombre.length === 0 || !existsSync(ruta) || !statSync(ruta).isFile()) {
      res.writeHead(404)
      res.end('no')
      return
    }
    res.writeHead(200, { 'content-length': statSync(ruta).size, 'accept-ranges': 'bytes' })
    createReadStream(ruta).pipe(res)
  })
  await new Promise<void>((r) => servidor!.listen(0, '127.0.0.1', r))
  urlFeed = `http://127.0.0.1:${(servidor!.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  // El relevo relanza la app FUERA de Playwright: si algo falló a medias, esa
  // instancia sobreviviría a la prueba.
  if (copiaApp) matarProcesosDe(copiaApp)
  await new Promise<void>((r) => (servidor ? servidor.close(() => r()) : r()))
  // ESCAPE PARA DEPURAR. Con `TESSERA_E2E_CONSERVAR=1` el temporal no se borra, y con
  // él el `logs/update.log` de la copia, que es el único sitio donde el ciclo cuenta
  // POR QUÉ acabó en `error`. Sin esto, un fallo aquí sólo dice "no llegó a preparada"
  // y hay que reproducirlo a ciegas; costó una vuelta entera averiguar que un corte de
  // la descarga se estaba declarando solo.
  if (process.env.TESSERA_E2E_CONSERVAR === '1') {
    console.log(`[e2e] se conserva el temporal de la prueba: ${W}`)
    return
  }
  // Los procesos recién matados siguen soltando descriptores un instante, y borrar
  // encima da un ENOTEMPTY que enmascara el resultado real de la prueba. Se reintenta
  // un par de veces y, si aun así queda algo, se deja: es un temporal del sistema.
  for (let i = 0; W && i < 3; i++) {
    try {
      rmSync(W, { recursive: true, force: true })
      break
    } catch {
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
})

// EL FEED DE VERDAD REDIRIGE. `releases/latest/download/<f>` de GitHub responde 302 a
// `releases/download/vX.Y.Z/<f>`, y esa a otro 302 hacia el almacén de ficheros, en OTRO
// origen. Aquí se imitan los dos saltos —el segundo, al servidor del `beforeAll`— y se exige
// que el manifiesto y el zip lleguen por ellos, con el tamaño del zip de la respuesta final.
// Va ANTES del ciclo completo: usa la misma copia vieja con otro `userData` y se mata sin
// cierre ordenado, para que el cierre no aplique nada y la copia siga siendo la vieja.
test('macOS sigue las redirecciones del feed (como GitHub Releases) hasta dejar el zip preparado', async () => {
  expect(versionDelBundle(copiaApp), 'la copia arranca en la versión vieja').toBe(VERSION_VIEJA)
  const nombreZip = claveDelYml(readFileSync(join(DIST, 'latest-mac.yml'), 'utf8'), 'path')

  const visitas: string[] = []
  const redirector = createServer((req, res) => {
    const ruta = decodeURIComponent((req.url ?? '/').split('?')[0])
    visitas.push(ruta)
    const primero = /^\/releases\/latest\/download\/([^/]+)$/.exec(ruta)
    if (primero) {
      res.writeHead(302, { location: `/releases/download/v${versionNueva}/${primero[1]}` })
      res.end()
      return
    }
    const segundo = /^\/releases\/download\/[^/]+\/([^/]+)$/.exec(ruta)
    if (segundo) {
      res.writeHead(302, { location: `${urlFeed}/${segundo[1]}` })
      res.end()
      return
    }
    res.writeHead(404)
    res.end('no')
  })
  await new Promise<void>((r) => redirector.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(redirector.address() as AddressInfo).port}/releases/latest/download`
  const datosRedir = join(W, 'datos-redireccion')
  mkdirSync(datosRedir, { recursive: true })

  const app = await electron.launch({
    executablePath: join(copiaApp, 'Contents', 'MacOS', 'Tessera'),
    args: [`--user-data-dir=${datosRedir}`],
    env: { ...process.env, TESSERA_FEED_URL: base } as Record<string, string>,
    timeout: 90_000
  })
  try {
    const win = await app.firstWindow({ timeout: 90_000 })
    await win.waitForLoadState('domcontentloaded')
    await win.waitForSelector('.titlebar', { timeout: 30_000 })

    await expect
      .poll(async () => (await win.evaluate(() => window.tessera.update.getState())).status, {
        message: 'detrás de redirecciones, el ciclo no llegó a «preparada»',
        timeout: 240_000,
        intervals: [1000]
      })
      .toBe('ready')

    const listo = await win.evaluate(() => window.tessera.update.getState())
    expect(listo.newVersion).toBe(versionNueva)
    expect(listo.aplicable, 'el zip llegado por redirección pasó el sha512').toBe(true)
    expect(listo.installerPath).not.toBeNull()
    expect(statSync(listo.installerPath!).size, 'el zip entero, con el tamaño de la respuesta final').toBe(
      statSync(join(DIST, nombreZip)).size
    )
    for (const f of ['latest-mac.yml', nombreZip]) {
      expect(visitas, `${f} se pidió al feed`).toContain(`/releases/latest/download/${f}`)
      expect(visitas, `${f} siguió el primer salto`).toContain(`/releases/download/v${versionNueva}/${f}`)
    }
  } finally {
    // SIGKILL y no `close()`: con la actualización preparada, un cierre ordenado la
    // aplicaría sobre la copia, y el ciclo completo de abajo necesita la vieja.
    app.process().kill('SIGKILL')
    matarProcesosDe(copiaApp)
    redirector.closeAllConnections()
    await new Promise<void>((r) => redirector.close(() => r()))
  }
  expect(versionDelBundle(copiaApp), 'matar la app no aplicó nada').toBe(VERSION_VIEJA)
})

test('macOS se descarga, prepara y APLICA la actualización sola, y luego lo cuenta', async () => {
  expect(versionDelBundle(copiaApp), 'la copia arranca en la versión vieja').toBe(VERSION_VIEJA)

  // -------------------------------------------------------------------------
  // 1. La copia vieja, delante del feed real.
  // -------------------------------------------------------------------------
  let app: ElectronApplication | null = await electron.launch({
    executablePath: join(copiaApp, 'Contents', 'MacOS', 'Tessera'),
    args: [`--user-data-dir=${datos}`],
    env: { ...process.env, TESSERA_FEED_URL: urlFeed } as Record<string, string>,
    timeout: 90_000
  })
  const win = await app.firstWindow({ timeout: 90_000 })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForSelector('.titlebar', { timeout: 30_000 })

  expect(await app.evaluate(({ app: a }) => a.getVersion())).toBe(VERSION_VIEJA)

  // -------------------------------------------------------------------------
  // 2. Llega a «preparada» ella sola: nadie pulsa nada para que se descargue.
  // -------------------------------------------------------------------------
  const estado = (): Promise<{
    status: string
    newVersion: string | null
    aplicable: boolean
    installerPath: string | null
    seAplicaAlCerrar: boolean
  }> => win.evaluate(() => window.tessera.update.getState())

  await expect
    .poll(async () => (await estado()).status, {
      message: 'el ciclo no llegó a «preparada»',
      timeout: 240_000,
      intervals: [1000]
    })
    .toBe('ready')

  const listo = await estado()
  expect(listo.newVersion, 'la versión preparada es la que anuncia el feed').toBe(versionNueva)
  // `aplicable` es el espejo de "hay un archivo que ESTA sesión ha verificado contra
  // el feed". Sin él, `ready` sería una promesa que el cierre no puede cumplir.
  expect(listo.aplicable, 'la actualización está verificada y se puede aplicar').toBe(true)
  expect(listo.seAplicaAlCerrar, 'y se aplicaría sola al cerrar').toBe(true)

  // El zip está donde decimos que está —dentro del userData de la prueba, nunca en el
  // del usuario— y con el tamaño del que publica el feed.
  expect(listo.installerPath).not.toBeNull()
  expect(listo.installerPath!.startsWith(datos) || listo.installerPath!.includes('tessera-updater')).toBe(true)
  expect(existsSync(listo.installerPath!)).toBe(true)
  expect(statSync(listo.installerPath!).size).toBe(
    statSync(join(DIST, claveDelYml(readFileSync(join(DIST, 'latest-mac.yml'), 'utf8'), 'path'))).size
  )

  // -------------------------------------------------------------------------
  // 3. Y LA INTERFAZ LO DICE. Es la mitad que el estado no prueba: el botón de la
  //    barra tiene que ofrecer «Actualizar ahora», que es por donde entra el usuario.
  // -------------------------------------------------------------------------
  const boton = win.locator('.boton-actualizacion')
  await expect(boton).toHaveClass(/tono-acento/)
  await expect(boton).toHaveAttribute('aria-label', new RegExp(`Tessera ${versionNueva} está preparada`))
  await expect(boton.locator('.boton-reinicio-etiqueta')).toHaveText('Actualizar ahora')

  // -------------------------------------------------------------------------
  // 4. Se dispara la instalación POR DONDE LA DISPARA EL USUARIO. La app se cierra
  //    sola: a partir de aquí el que trabaja es el relevo, y ya no existimos para él.
  // -------------------------------------------------------------------------
  const cerrada = app.waitForEvent('close', { timeout: 120_000 })
  await boton.click()
  await cerrada
  app = null

  // -------------------------------------------------------------------------
  // 5. EL BUNDLE QUEDA SUSTITUIDO. Es la afirmación central de todo el encargo.
  // -------------------------------------------------------------------------
  await expect
    .poll(() => (existsSync(copiaApp) ? versionDelBundle(copiaApp) : '(no existe)'), {
      message: 'el relevo no llegó a sustituir el bundle',
      timeout: 180_000,
      intervals: [1000]
    })
    .toBe(versionNueva)

  // Y lo deja ENTERO: la firma del bundle instalado sigue siendo válida, que es lo que
  // el propio relevo verifica antes de ponerlo y lo que macOS exige para ejecutarlo.
  expect(
    spawnSync('codesign', ['--verify', '--deep', '--strict', copiaApp]).status,
    'el .app instalado no pasa la verificación de firma'
  ).toBe(0)
  // Sin restos: ni la versión apartada ni la carpeta de trabajo del relevo.
  expect(existsSync(`${copiaApp}.anterior`)).toBe(false)
  expect(existsSync(join(W, 'Aplicaciones', '.tessera-relevo'))).toBe(false)

  // -------------------------------------------------------------------------
  // 6. Y VUELVE A ABRIRSE. El botón «Actualizar ahora» promete relanzar, a diferencia
  //    del camino de aplicar-al-cerrar; el relevo lo hace con `open -n`.
  // -------------------------------------------------------------------------
  await expect
    .poll(() => procesosDe(copiaApp).length > 0, {
      message: 'el relevo no relanzó la app',
      timeout: 120_000,
      intervals: [1000]
    })
    .toBe(true)

  // -------------------------------------------------------------------------
  // 7. Y ESA APP, LA QUE EL RELEVO ABRIÓ, CUENTA QUÉ PASÓ. Se lee del REGISTRO y no de la
  // interfaz: a esa instancia no la lanzó Playwright y no hay forma de hablar con ella. La
  // línea la escribe `sembrarDesdeMarcador` en su rama de éxito, el mismo camino que pone
  // `avisoAplicada` y enciende el punto verde: si la línea está, el aviso se sembró. El
  // `desde` demuestra que el MARCADOR sobrevivió al cambio de binario: la versión vieja ya
  // no existe en ningún otro sitio del disco.
  // -------------------------------------------------------------------------
  const registro = join(datos, 'logs', 'update.log')
  await expect
    .poll(() => (existsSync(registro) ? readFileSync(registro, 'utf8') : ''), {
      message: 'la app relanzada no registró el desenlace de la actualización',
      timeout: 120_000,
      intervals: [1000]
    })
    .toContain(`actualización aplicada: ${VERSION_VIEJA} -> ${versionNueva}`)

  // Se retira esa instancia: la prueba quiere abrir ella la siguiente para poder
  // hablar con ella.
  matarProcesosDe(copiaApp)
  await expect.poll(() => procesosDe(copiaApp) === '', { timeout: 30_000 }).toBe(true)

  // -------------------------------------------------------------------------
  // 8. EL BUNDLE SUSTITUIDO ARRANCA DE VERDAD Y ES LA VERSIÓN NUEVA. Que el
  //    `package.json` de dentro diga X no prueba que el `.app` siga siendo ejecutable
  //    después de que otro proceso lo haya renombrado por debajo; esto sí.
  //
  //    Y el aviso ya NO está, que es lo correcto y merece quedar fijado: «Tessera se
  //    actualizó» es una noticia de UN SOLO USO. La instancia anterior la leyó y
  //    borró el marcador, y `shared/update-ipc.ts` explica por qué perder la noticia
  //    si nadie la mira es mejor que repetirla en todos los arranques siguientes.
  // -------------------------------------------------------------------------
  const app2 = await electron.launch({
    executablePath: join(copiaApp, 'Contents', 'MacOS', 'Tessera'),
    args: [`--user-data-dir=${datos}`],
    env: { ...process.env, TESSERA_FEED_URL: urlFeed } as Record<string, string>,
    timeout: 90_000
  })
  try {
    const win2 = await app2.firstWindow({ timeout: 90_000 })
    await win2.waitForLoadState('domcontentloaded')
    await win2.waitForSelector('.titlebar', { timeout: 30_000 })

    expect(await app2.evaluate(({ app: a }) => a.getVersion())).toBe(versionNueva)
    const estado2 = await win2.evaluate(() => window.tessera.update.getState())
    expect(estado2.currentVersion).toBe(versionNueva)
    expect(estado2.avisoAplicada).toBeNull()
    expect(estado2.avisoFallo, 'nada quedó marcado como fallido').toBeNull()
    // Y no queda marcador en disco: el ciclo se cerró del todo.
    expect(existsSync(join(datos, 'pending_update.json'))).toBe(false)
  } finally {
    await app2.close().catch(() => {})
  }
})
