#!/usr/bin/env node
// =============================================================================
// Prueba de la capa PURA del auto-update (npm run test:update): `describeUpdateError` (un
// `ECONNREFUSED` nunca se enseña tal cual), `initialUpdateState`, a quién matar para liberar
// la carpeta de instalación, el pre-vuelo de MAX_PATH y `descargaManual` (la URL real del
// feed, el fichero que se instala a mano y el .zip con sha512 de macOS). Sin electron ni red,
// con un resolver-hook para los imports sin extensión de los módulos de producción.
// =============================================================================

import { register } from 'node:module'

// Resolver-hook: los módulos de producción importan sin extensión ('../../shared/x').
// Node ejecutando .ts por type-stripping no resuelve extensionless: se reintenta con .ts.
const resolveTsHook = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook))

const {
  describeUpdateError,
  rawDetail,
  hostOf,
  installerNotStartedError,
  updateNotApplicableError,
  isTransientNetworkError
} = await import('./updateErrors.ts')
const { initialUpdateState } = await import('../../shared/update-ipc.ts')
const { shouldKillHelper } = await import('./installDirLockPure.ts')
const { renameGrowth, wouldExceedMaxPath, MAX_PATH, STRAY_APP_DATA } = await import('./installDirPaths.ts')
const { urlDeFeed, urlDescargaManual, elegirZipDeActualizacion, nombreDeArchivoDeUrl } =
  await import('./descargaManual.ts')

const FEED = 'https://github.com/NRVH/tessera/releases/latest/download'
/** Un servidor inalcanzable (TEST-NET-1, RFC 5737): nunca resuelve a nada real. */
const SERVIDOR_CAIDO = '192.0.2.10:443'
/** Lo que solo dice el mensaje de fallo de RED; sirve para comprobar que otro caso no cayó ahí. */
const MENSAJE_DE_RED = /No se pudo contactar/

interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}

/** Fabrica un Error con `code`, como los que emite Node. */
function errWithCode(message: string, code: string): Error {
  const e = new Error(message)
  ;(e as Error & { code: string }).code = code
  return e
}

hr('(A) describeUpdateError — todo fallo se traduce a lenguaje de usuario')

// 1..7: cada familia de fallo produce SU mensaje, no el genérico.
for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'EHOSTUNREACH']) {
  const { message } = describeUpdateError(errWithCode(`connect ${code} ${SERVIDOR_CAIDO}`, code), FEED)
  check(
    `(red/${code}) menciona el servidor y sugiere revisar la conexión`,
    message.includes('github.com') && /conexión/i.test(message) && !/VPN/i.test(message),
    JSON.stringify(message)
  )
}

{
  const { message } = describeUpdateError(new Error('sha512 checksum mismatch'), FEED)
  check(
    '(integridad) descarga dañada -> se descartó por seguridad, reintento solo',
    /dañada|seguridad/i.test(message) && !message.includes('sha512'),
    JSON.stringify(message)
  )
}

{
  const { message } = describeUpdateError(new Error('Cannot find latest.yml in the latest release'), FEED)
  check(
    '(feed) sin versión publicada -> nombra el servidor, no el fichero yml',
    message.includes('github.com') && /ninguna versión/i.test(message),
    JSON.stringify(message)
  )
}

{
  // EACCES es el único caso cuyo REMEDIO cambia con la plataforma, no sólo el nombre:
  // en Windows suele bastar con cerrar y reabrir (NSIS peleándose con un ejecutable en
  // uso o con UAC); en macOS lo típico es que la .app corra desde el .dmg o desde una
  // carpeta ajena, y reabrir no arregla nada — hay que moverla a Aplicaciones. Por eso
  // las dos plataformas van EXPLÍCITAS: con el valor por defecto sólo se comprobaría la
  // rama de la máquina donde corra el test, y la otra dejaría de comprobarse en silencio.
  const win = describeUpdateError(errWithCode('open failed', 'EACCES'), FEED, 'windows').message
  const mac = describeUpdateError(errWithCode('open failed', 'EACCES'), FEED, 'mac').message
  check(
    '(permisos) EACCES en Windows -> permisos, y manda a cerrar y reabrir',
    /permisos/i.test(win) && win.startsWith('Windows') && /cierra tessera/i.test(win),
    JSON.stringify(win)
  )
  check(
    '(permisos) EACCES en Mac -> permisos, nombra macOS y manda a Aplicaciones',
    /permisos/i.test(mac) && mac.startsWith('macOS') && /aplicaciones/i.test(mac),
    JSON.stringify(mac)
  )
  check(
    '(permisos) y NINGUNO nombra el sistema del otro',
    !win.includes('macOS') && !mac.includes('Windows'),
    `win="${win.slice(0, 40)}…" mac="${mac.slice(0, 40)}…"`
  )
}

{
  const { message } = describeUpdateError(errWithCode('no space left', 'ENOSPC'), FEED)
  check('(disco) ENOSPC -> habla de espacio en disco', /espacio en disco/i.test(message), JSON.stringify(message))
}

// Se clasifica por CÓDIGO, no por el texto del mensaje: así traducir la frase no
// rompe la rama (fallo real que este test cazó la primera vez que corrió).
{
  const { message } = describeUpdateError(installerNotStartedError(), FEED)
  check(
    '(watchdog) el instalador no arrancó -> ofrece abrirlo a mano',
    /a mano/i.test(message),
    JSON.stringify(message)
  )
}

// El pre-vuelo NO puede pedir prestado el mensaje del watchdog: ahí el instalador ni
// se intentó, así que "ábrelo a mano" manda al usuario a un botón que no funciona.
{
  const motivo = 'la actualización venía del marcador y aún no se ha revalidado contra el feed'
  const { message } = describeUpdateError(updateNotApplicableError(motivo), FEED)
  check(
    '(pre-vuelo) no aplicable -> dice el motivo REAL y no ofrece abrirlo a mano',
    message.includes(motivo) && !/a mano/i.test(message),
    JSON.stringify(message)
  )
}

// Y gana a cualquier heurística de texto: aunque el mensaje mencionase la red.
{
  const err = installerNotStartedError()
  err.message = 'getaddrinfo cosas raras'
  const { message } = describeUpdateError(err, FEED)
  check(
    '(watchdog) el código propio tiene precedencia sobre el sniffing de texto',
    /a mano/i.test(message) && !MENSAJE_DE_RED.test(message),
    JSON.stringify(message)
  )
}

// Precedencia: un error de integridad que ADEMÁS trae un code de red se clasifica
// como integridad (lo específico gana a lo genérico).
{
  const e = errWithCode('sha512 mismatch while downloading', 'ECONNRESET')
  const { message } = describeUpdateError(e, FEED)
  check(
    '(precedencia) integridad gana a red cuando el error trae ambas señales',
    /dañada/i.test(message) && !MENSAJE_DE_RED.test(message),
    JSON.stringify(message)
  )
}

// Desconocido: NO se inventa nada, se muestra el mensaje crudo prefijado.
{
  const { message } = describeUpdateError(new Error('algo rarísimo'), FEED)
  check(
    '(desconocido) se muestra el mensaje crudo, sin inventar diagnóstico',
    message === 'No se pudo actualizar: algo rarísimo',
    JSON.stringify(message)
  )
}

// El detalle SIEMPRE conserva lo crudo, aunque el mensaje lo oculte.
{
  const e = errWithCode(`connect ECONNREFUSED ${SERVIDOR_CAIDO}`, 'ECONNREFUSED')
  const { detail } = describeUpdateError(e, FEED)
  check(
    '(detalle) conserva mensaje + code + stack para copiar',
    detail.includes('ECONNREFUSED') && detail.includes('code: ECONNREFUSED') && detail.includes('at '),
    JSON.stringify(detail.slice(0, 60) + '…')
  )
}

// No-Error: un throw de string no debe romper la clasificación.
{
  const { message, detail } = describeUpdateError('fallo pelado', FEED)
  check(
    '(robustez) un throw que NO es Error se clasifica sin lanzar',
    message.includes('fallo pelado') && detail.includes('fallo pelado'),
    JSON.stringify(message)
  )
}

// hostOf tolera una URL inválida (el feed puede no estar configurado aún).
check(
  '(hostOf) una URL inválida se devuelve tal cual, sin lanzar',
  hostOf('el servidor de actualizaciones') === 'el servidor de actualizaciones',
  hostOf('el servidor de actualizaciones')
)
check('(hostOf) extrae el host de una URL válida', hostOf(FEED) === 'github.com', hostOf(FEED))
check(
  '(hostOf) conserva el puerto si la URL lo trae',
  hostOf('http://feed.example.invalid:8080/tessera') === 'feed.example.invalid:8080',
  hostOf('http://feed.example.invalid:8080/tessera')
)

check(
  '(rawDetail) un objeto cualquiera no rompe rawDetail',
  typeof rawDetail({ a: 1 }) === 'string',
  rawDetail({ a: 1 })
)

hr('(A2) isTransientNetworkError — qué se reintenta en silencio y qué se pinta')

// El caso REAL que lo motivó, tal cual sale en update.log tras hibernar el equipo:
// el chequeo se dispara al despertar y Chromium aún tiene la red suspendida.
{
  const suspended = new Error('Error: net::ERR_NETWORK_IO_SUSPENDED')
  check(
    '(hibernación) ERR_NETWORK_IO_SUSPENDED es pasajero -> se reintenta, no se pinta',
    isTransientNetworkError(suspended) === true,
    'transitorio'
  )
  const { message } = describeUpdateError(suspended, FEED)
  check(
    '(hibernación) si aun así se agotan los reintentos, el mensaje explica la suspensión',
    /suspensión/i.test(message) && !MENSAJE_DE_RED.test(message),
    JSON.stringify(message)
  )
}

for (const code of ['ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNRESET']) {
  check(
    `(red/${code}) se reintenta antes de declararlo fallo`,
    isTransientNetworkError(errWithCode(`connect ${code}`, code)) === true,
    'transitorio'
  )
}

check(
  '(integridad) sha512 NUNCA es pasajero, aunque venga con un code de red',
  isTransientNetworkError(errWithCode('sha512 mismatch while downloading', 'ECONNRESET')) === false,
  'se pinta a la primera'
)
check(
  '(permisos) EACCES no es de red: se pinta a la primera',
  isTransientNetworkError(errWithCode('access is denied', 'EACCES')) === false,
  'se pinta a la primera'
)
check(
  '(watchdog) el instalador que no arranca no se reintenta en silencio',
  isTransientNetworkError(installerNotStartedError()) === false,
  'se pinta a la primera'
)
check(
  '(robustez) un no-Error no rompe la clasificación',
  isTransientNetworkError({ raro: true }) === false,
  'false'
)

hr('(B) initialUpdateState — dev vs empaquetada')

{
  const dev = initialUpdateState('0.6.0', false)
  check(
    '(dev) sin empaquetar arranca en `disabled` (no hay feed ni instalador)',
    dev.status === 'disabled' && dev.newVersion === null && dev.errorMessage === null,
    JSON.stringify(dev)
  )
  const packed = initialUpdateState('0.6.0', true)
  check(
    '(prod) empaquetada arranca en `idle`, sin error y sin instalador',
    packed.status === 'idle' && packed.installerPath === null && packed.percent === 0,
    JSON.stringify(packed)
  )
  check(
    '(ambos) la versión actual se propaga tal cual',
    dev.currentVersion === '0.6.0' && packed.currentVersion === '0.6.0',
    packed.currentVersion
  )
}

hr('(C) installDirLock — a QUIÉN matar para liberar la carpeta de instalación')

{
  const ROOT = 'C:\\Users\\x\\AppData\\Local\\Programs\\Tessera'
  const OPTS = { installRoot: ROOT, ownPid: 4242, mainExeName: 'Tessera.exe' }
  const kill = (proc: { pid: number; name: string; path: string }): boolean => shouldKillHelper(proc, OPTS)

  check(
    '(sí) OpenConsole.exe bajo la carpeta de instalación -> se mata',
    kill({ pid: 10, name: 'OpenConsole.exe', path: ROOT + '\\resources\\node-pty\\OpenConsole.exe' }) === true,
    'true'
  )
  check(
    '(no) la propia app (mismo nombre que el main) NO se mata, ni sus helpers de Electron',
    kill({ pid: 11, name: 'Tessera.exe', path: ROOT + '\\Tessera.exe' }) === false,
    'false'
  )
  check(
    '(no) nuestro propio PID nunca se mata',
    kill({ pid: 4242, name: 'OpenConsole.exe', path: ROOT + '\\OpenConsole.exe' }) === false,
    'false'
  )
  check(
    '(no) el conhost.exe del sistema (fuera de la carpeta) no se toca',
    kill({ pid: 12, name: 'conhost.exe', path: 'C:\\Windows\\System32\\conhost.exe' }) === false,
    'false'
  )
  check(
    '(sí) la ruta con barras normales se normaliza y aún casa el prefijo',
    kill({ pid: 13, name: 'OpenConsole.exe', path: ROOT.replace(/\\/g, '/') + '/OpenConsole.exe' }) === true,
    'true'
  )
  check(
    '(no) un directorio HERMANO con el mismo prefijo no cuenta como "dentro"',
    kill({ pid: 14, name: 'OpenConsole.exe', path: 'C:\\Users\\x\\AppData\\Local\\Programs\\TesseraOtra\\OpenConsole.exe' }) === false,
    'false'
  )
  check('(no) sin ruta de ejecutable no se puede decidir -> no se mata', kill({ pid: 15, name: 'x.exe', path: '' }) === false, 'false')
}

// El parseo de la tabla de procesos (objeto suelto, array, vacío, basura, sin ruta)
// ya no vive aquí: es `parsearTablaProcesos` de procesosSistema.ts, probado en
// src/main/agents/test-procesos-bloqueo.mts (2a-2e). El `parseProcessJson` que se
// probaba aquí se retiró por no tener ningún uso de producción.

// ---------------------------------------------------------------------------
// MAX_PATH: el verdadero "…: 2" del instalador (ver installDirPaths.ts). Se fija
// con el caso REAL que lo destapó: una carpeta `.tessera` que una versión antigua
// dejó dentro de la app, con el marketplace de plugins de Claude Code anidado.
// ---------------------------------------------------------------------------
{
  const ROOT_INST = 'C:\\Users\\maria\\AppData\\Local\\Programs\\Tessera'
  const TMP = 'C:\\Users\\maria\\AppData\\Local\\Temp'
  const growth = renameGrowth(ROOT_INST, TMP)
  check(
    '(maxpath) el renombrado al temporal ALARGA la ruta (por eso rompe lo que antes cabía)',
    growth === 12,
    `crecimiento = ${growth} caracteres`
  )

  // El culpable real: 260 caracteres ya en origen.
  const culpable =
    ROOT_INST +
    '\\resources\\app\\.tessera\\global\\claude\\ba53cf18-9d10-499f-b678-4f5748920966' +
    '\\plugins\\marketplaces\\claude-plugins-official\\plugins\\claude-code-setup\\skills' +
    '\\claude-automation-recommender\\references\\subagent-templates.md'
  check(
    '(maxpath) la ruta que abortaba el update se detecta como condenada',
    culpable.length === 260 && wouldExceedMaxPath(culpable, growth),
    `${culpable.length} chars -> ${culpable.length + growth} al renombrar (límite ${MAX_PATH})`
  )

  // Una ruta profunda pero legítima debe pasar sin ruido. El literal es de cuando
  // monaco-editor viajaba en el paquete y era lo más hondo que había; ya NO viaja
  // (pasó a devDependency: Vite lo bundlea, ver la cabecera de electron.vite.config.ts),
  // así que hoy el paquete es MENOS profundo que esto. Se conserva tal cual a
  // propósito: lo que el caso fija es la longitud, y una cota más holgada que la
  // realidad sigue siendo una cota válida.
  const normal =
    ROOT_INST +
    '\\resources\\app\\node_modules\\monaco-editor\\esm\\vs\\editor\\browser\\widget' +
    '\\diffEditor\\components\\diffEditorViewZones\\inlineDiffDeletedCodeMargin.js'
  check(
    '(maxpath) una ruta profunda pero legítima del paquete NO se marca (nada de falsos positivos)',
    !wouldExceedMaxPath(normal, growth),
    `${normal.length} chars -> ${normal.length + growth}`
  )

  const de = (len: number): string => 'C:\\' + 'x'.repeat(len - 3) // ruta de longitud exacta
  check(
    '(maxpath) el límite es >= 260 (MAX_PATH cuenta el NUL final): 260 exactos ya sobra',
    de(260).length === 260 &&
      wouldExceedMaxPath(de(260), 0) &&
      !wouldExceedMaxPath(de(259), 0),
    '260 -> condenada; 259 -> pasa'
  )

  check(
    '(maxpath) `.tessera` está en la lista de restos a borrar de la carpeta de la app',
    STRAY_APP_DATA.includes('.tessera'),
    STRAY_APP_DATA.join(', ')
  )
}

hr('(D) descargaManual — la URL real del feed y la del fichero que se instala a mano')

// (D1) urlDeFeed: el `app-update.yml` REAL que electron-builder deja en
// `process.resourcesPath` (copiado de dist/mac-arm64/Tessera.app/Contents/Resources).
{
  const real =
    'provider: generic\n' +
    'url: https://github.com/NRVH/tessera/releases/latest/download\n' +
    'channel: latest\n' +
    'useMultipleRangeRequest: false\n' +
    'updaterCacheDirName: tessera-updater\n'
  check('(feed) saca la URL del app-update.yml real de electron-builder', urlDeFeed(real) === FEED, String(urlDeFeed(real)))

  const crlf = real.replace(/\n/g, '\r\n')
  check('(feed) tolera finales de línea CRLF', urlDeFeed(crlf) === FEED, String(urlDeFeed(crlf)))

  check(
    '(feed) tolera comillas dobles y espacios alrededor del valor',
    urlDeFeed(`provider: generic\nurl:   "${FEED}"  \n`) === FEED,
    String(urlDeFeed(`url:   "${FEED}"  `))
  )
  check(
    '(feed) tolera comillas simples',
    urlDeFeed(`url: '${FEED}'\nchannel: latest`) === FEED,
    String(urlDeFeed(`url: '${FEED}'`))
  )
  check('(feed) sin línea url -> null, no cadena vacía', urlDeFeed('provider: generic\nchannel: latest\n') === null, 'null')
  check('(feed) url vacía -> null', urlDeFeed('url:\nchannel: latest\n') === null, 'null')
  check('(feed) url con sólo comillas -> null', urlDeFeed('url: ""\n') === null, 'null')

  // Un `latest-mac.yml` tiene `- url:` INDENTADOS dentro de `files:`; eso no es el
  // feed y confundirlo abriría en el navegador el nombre pelado de un zip.
  const latestMac =
    'version: 0.49.2\n' +
    'files:\n' +
    '  - url: Tessera-0.49.2-arm64.zip\n' +
    '    sha512: abc\n' +
    'path: Tessera-0.49.2-arm64.zip\n'
  check('(feed) un `- url:` indentado (latest-mac.yml) NO cuenta como feed', urlDeFeed(latestMac) === null, 'null')
}

// (D2) urlDescargaManual: el `info.files` REAL del latest-mac.yml de esta máquina,
// en su orden real (el zip va PRIMERO y aun así tiene que ganar el dmg).
{
  const files = [{ url: 'Tessera-0.49.2-arm64.zip' }, { url: 'Tessera-0.49.2-arm64.dmg' }]
  const esperado = FEED + '/Tessera-0.49.2-arm64.dmg'
  check(
    '(descarga) prefiere el .dmg aunque el .zip esté antes en la lista',
    urlDescargaManual(FEED, files) === esperado,
    String(urlDescargaManual(FEED, files))
  )
  check(
    '(descarga) base CON barra final -> misma URL, sin doble barra',
    urlDescargaManual(FEED + '/', files) === esperado,
    String(urlDescargaManual(FEED + '/', files))
  )
  check(
    '(descarga) relativa con barra inicial -> misma URL, sin doble barra',
    urlDescargaManual(FEED, [{ url: '/Tessera-0.49.2-arm64.dmg' }]) === esperado,
    String(urlDescargaManual(FEED, [{ url: '/Tessera-0.49.2-arm64.dmg' }]))
  )
  check(
    '(descarga) sólo zip -> el zip (algo es mejor que nada)',
    urlDescargaManual(FEED, [{ url: 'Tessera-0.49.2-arm64.zip' }]) === FEED + '/Tessera-0.49.2-arm64.zip',
    String(urlDescargaManual(FEED, [{ url: 'Tessera-0.49.2-arm64.zip' }]))
  )
  check(
    '(descarga) la extensión se compara sin distinguir mayúsculas ni query',
    urlDescargaManual(FEED, [{ url: 'a.zip' }, { url: 'Tessera.DMG?x=1' }]) === FEED + '/Tessera.DMG?x=1',
    String(urlDescargaManual(FEED, [{ url: 'a.zip' }, { url: 'Tessera.DMG?x=1' }]))
  )
  const absoluta = 'https://otro.host/descargas/Tessera-0.49.2-arm64.dmg'
  check(
    '(descarga) una URL absoluta en files[] se respeta tal cual',
    urlDescargaManual(FEED, [{ url: 'x.zip' }, { url: absoluta }]) === absoluta,
    String(urlDescargaManual(FEED, [{ url: absoluta }]))
  )
  check(
    '(descarga) sin dmg ni zip -> el primero de la lista',
    urlDescargaManual(FEED, [{ url: 'Tessera.pkg' }]) === FEED + '/Tessera.pkg',
    String(urlDescargaManual(FEED, [{ url: 'Tessera.pkg' }]))
  )
  check('(descarga) sin archivos -> null', urlDescargaManual(FEED, []) === null, 'null')
  check('(descarga) archivos con url vacía -> null', urlDescargaManual(FEED, [{ url: '  ' }]) === null, 'null')
}

// (D3) elegirZipDeActualizacion: el fichero que la APP se aplica sola en macOS. Es la
// otra mitad de este módulo y tiene la regla que de verdad importa — sin sha512 no hay
// actualización— porque ese hash es lo ÚNICO que separa "actualizar" de "ejecutar lo
// que sea que haya en la red".
{
  const ZIP = 'Tessera-0.49.3-arm64.zip'
  const HASH = 'QrnJE0esKz0RdDaflOx6uo1Spr2G6QgA4mt1dPF6y4uFLBIUIcZLlpEvYEsNUDB7raA2jfvb8dL1gi8ZlPtiZg=='
  // Lo que trae un `latest-mac.yml` de verdad, en el orden en que lo trae.
  const feedReal = [
    { url: ZIP, sha512: HASH, size: 115552678 },
    { url: 'Tessera-0.49.3-arm64.dmg', sha512: 'rjLJMIgHtPQO', size: 114241047 }
  ]
  {
    const z = elegirZipDeActualizacion(FEED, feedReal)
    check(
      '(zip) elige el .zip y NO el .dmg: `ditto` no monta imágenes de disco',
      z !== null && z.url === `${FEED}/${ZIP}` && z.sha512 === HASH && z.size === 115552678,
      z === null ? 'null' : `${z.url} (${z.size} bytes)`
    )
  }
  check(
    '(zip) es el ESPEJO de la descarga manual: sobre el mismo feed, una da zip y la otra dmg',
    elegirZipDeActualizacion(FEED, feedReal)?.url === `${FEED}/${ZIP}` &&
      urlDescargaManual(FEED, feedReal) === `${FEED}/Tessera-0.49.3-arm64.dmg`,
    'zip para la app, dmg para la persona'
  )
  check(
    '(zip) SIN sha512 no hay actualización, aunque el zip esté ahí',
    elegirZipDeActualizacion(FEED, [{ url: ZIP, size: 1 }]) === null &&
      elegirZipDeActualizacion(FEED, [{ url: ZIP, sha512: '   ', size: 1 }]) === null,
    'null (se cae al respaldo `available`, que sí es honesto)'
  )
  check(
    '(zip) un feed sólo con .dmg -> null: no hay nada que la app sepa aplicar',
    elegirZipDeActualizacion(FEED, [{ url: 'Tessera.dmg', sha512: HASH, size: 1 }]) === null,
    'null'
  )
  check(
    '(zip) sin `size` sigue valiendo: el progreso se saca del content-length',
    elegirZipDeActualizacion(FEED, [{ url: ZIP, sha512: HASH }])?.size === 0,
    '0'
  )
  check(
    '(zip) una URL absoluta en files[] se respeta tal cual',
    elegirZipDeActualizacion(FEED, [{ url: 'https://otro.host/T.zip', sha512: HASH }])?.url ===
      'https://otro.host/T.zip',
    'https://otro.host/T.zip'
  )

  // El nombre con el que se guarda la descarga. Se UNE a una carpeta nuestra, así que
  // lo que venga del feed no puede llevarnos fuera de ella.
  check(
    '(nombre) sale el nombre del fichero de la URL',
    nombreDeArchivoDeUrl(`${FEED}/${ZIP}`) === ZIP,
    nombreDeArchivoDeUrl(`${FEED}/${ZIP}`)
  )
  check(
    '(nombre) la query y el fragmento no forman parte del nombre',
    nombreDeArchivoDeUrl(`${FEED}/${ZIP}?token=abc#x`) === ZIP,
    nombreDeArchivoDeUrl(`${FEED}/${ZIP}?token=abc#x`)
  )
  check(
    '(nombre) un `..` escapado en el feed no se convierte en una escritura fuera de la carpeta',
    !nombreDeArchivoDeUrl(`${FEED}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`).includes('/') &&
      !nombreDeArchivoDeUrl(`${FEED}/..`).includes('..') &&
      !nombreDeArchivoDeUrl('http://x/a%5Cb.zip').includes(String.fromCharCode(92)),
    `${nombreDeArchivoDeUrl(`${FEED}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`)} / ${nombreDeArchivoDeUrl(`${FEED}/..`)}`
  )
  check(
    '(nombre) un `%` suelto no lanza: se usa la forma cruda',
    nombreDeArchivoDeUrl('http://x/T%zz.zip') === 'T%zz.zip',
    nombreDeArchivoDeUrl('http://x/T%zz.zip')
  )
  check(
    '(nombre) una URL sin nombre de fichero cae en un nombre fijo, no en cadena vacía',
    nombreDeArchivoDeUrl('http://x/') === 'actualizacion.zip',
    nombreDeArchivoDeUrl('http://x/')
  )
}

hr('RESULTADO (PASS/FAIL)')
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
const passed = results.filter((r) => r.pass).length
const total = results.length
hr(`VEREDICTO: ${passed}/${total} PASS — ${passed === total ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(passed === total ? 0 : 1)
