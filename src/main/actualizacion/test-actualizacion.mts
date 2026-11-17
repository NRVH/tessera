#!/usr/bin/env node
// =============================================================================
// Prueba de la capa PURA del auto-update (npm run test:actualizacion): `describirErrorActualizacion` (un
// `ECONNREFUSED` nunca se enseña tal cual), `initialUpdateState`, a quién matar para liberar
// la carpeta de instalación, el pre-vuelo de MAX_PATH y `descargaManual` (la URL real del
// feed, el fichero que se instala a mano y el .zip con sha512 de macOS). Sin electron ni red,
// con un resolver-hook para los imports sin extensión de los módulos de producción.
// =============================================================================

import { register } from 'node:module'

// Resolver-hook: los módulos de producción importan sin extensión ('../../shared/x').
// Node ejecutando .ts por type-stripping no resuelve extensionless: se reintenta con .ts.
const hookResolucionTs = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(hookResolucionTs))

const {
  describirErrorActualizacion,
  detalleCrudo,
  hostDeUrl,
  errorInstaladorNoIniciado,
  errorActualizacionNoAplicable,
  esErrorDeRedPasajero
} = await import('./erroresActualizacion.ts')
const { estadoActualizacionInicial: initialUpdateState } = await import('../../shared/update-ipc.ts')
const { debeMatarAuxiliar } = await import('./bloqueoCarpetaInstalacionPuro.ts')
const { crecimientoAlRenombrar, superariaLongitudMaximaRuta: superariaMaxPath, MAX_PATH, DATOS_APP_RESIDUALES } = await import('./rutasCarpetaInstalacion.ts')
const { urlDeFeed, urlDescargaManual, elegirZipDeActualizacion, nombreDeArchivoDeUrl } =
  await import('./descargaManual.ts')

const FEED = 'https://github.com/NRVH/tessera/releases/latest/download'
/** Un servidor inalcanzable (TEST-NET-1, RFC 5737): nunca resuelve a nada real. */
const SERVIDOR_CAIDO = '192.0.2.10:443'
/** Lo que solo dice el mensaje de fallo de RED; sirve para comprobar que otro caso no cayó ahí. */
const MENSAJE_DE_RED = /No se pudo contactar/

interface ResultadoComprobacion {
  name: string
  pass: boolean
  evidence: string
}
const results: ResultadoComprobacion[] = []
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
function errConCodigo(mensaje: string, codigo: string): Error {
  const e = new Error(mensaje)
  ;(e as Error & { code: string }).code = codigo
  return e
}

hr('(A) describirErrorActualizacion — todo fallo se traduce a lenguaje de usuario')

// 1..7: cada familia de fallo produce SU mensaje, no el genérico.
for (const codigo of ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'EHOSTUNREACH']) {
  const { mensaje } = describirErrorActualizacion(errConCodigo(`connect ${codigo} ${SERVIDOR_CAIDO}`, codigo), FEED)
  check(
    `(red/${codigo}) menciona el servidor y sugiere revisar la conexión`,
    mensaje.includes('github.com') && /conexión/i.test(mensaje) && !/VPN/i.test(mensaje),
    JSON.stringify(mensaje)
  )
}

{
  const { mensaje } = describirErrorActualizacion(new Error('sha512 checksum mismatch'), FEED)
  check(
    '(integridad) descarga dañada -> se descartó por seguridad, reintento solo',
    /dañada|seguridad/i.test(mensaje) && !mensaje.includes('sha512'),
    JSON.stringify(mensaje)
  )
}

{
  const { mensaje } = describirErrorActualizacion(new Error('Cannot find latest.yml in the latest release'), FEED)
  check(
    '(feed) sin versión publicada -> nombra el servidor, no el fichero yml',
    mensaje.includes('github.com') && /ninguna versión/i.test(mensaje),
    JSON.stringify(mensaje)
  )
}

{
  // EACCES es el único caso cuyo REMEDIO cambia con la plataforma, no sólo el nombre:
  // en Windows suele bastar con cerrar y reabrir (NSIS peleándose con un ejecutable en
  // uso o con UAC); en macOS lo típico es que la .app corra desde el .dmg o desde una
  // carpeta ajena, y reabrir no arregla nada — hay que moverla a Aplicaciones. Por eso
  // las dos plataformas van EXPLÍCITAS: con el valor por defecto sólo se comprobaría la
  // rama de la máquina donde corra el test, y la otra dejaría de comprobarse en silencio.
  const ventana = describirErrorActualizacion(errConCodigo('open failed', 'EACCES'), FEED, 'windows').mensaje
  const mac = describirErrorActualizacion(errConCodigo('open failed', 'EACCES'), FEED, 'mac').mensaje
  check(
    '(permisos) EACCES en Windows -> permisos, y manda a cerrar y reabrir',
    /permisos/i.test(ventana) && ventana.startsWith('Windows') && /cierre tessera/i.test(ventana),
    JSON.stringify(ventana)
  )
  check(
    '(permisos) EACCES en Mac -> permisos, nombra macOS y manda a Aplicaciones',
    /permisos/i.test(mac) && mac.startsWith('macOS') && /aplicaciones/i.test(mac),
    JSON.stringify(mac)
  )
  check(
    '(permisos) y NINGUNO nombra el sistema del otro',
    !ventana.includes('macOS') && !mac.includes('Windows'),
    `win="${ventana.slice(0, 40)}…" mac="${mac.slice(0, 40)}…"`
  )
}

{
  const { mensaje } = describirErrorActualizacion(errConCodigo('no space left', 'ENOSPC'), FEED)
  check('(disco) ENOSPC -> habla de espacio en disco', /espacio en disco/i.test(mensaje), JSON.stringify(mensaje))
}

// Se clasifica por CÓDIGO, no por el texto del mensaje: así traducir la frase no
// rompe la rama (fallo real que este test cazó la primera vez que corrió).
{
  const { mensaje } = describirErrorActualizacion(errorInstaladorNoIniciado(), FEED)
  check(
    '(watchdog) el instalador no arrancó -> ofrece abrirlo a mano',
    /manualmente/i.test(mensaje),
    JSON.stringify(mensaje)
  )
}

// El pre-vuelo NO puede pedir prestado el mensaje del watchdog: ahí el instalador ni
// se intentó, así que "ábrelo a mano" manda al usuario a un botón que no funciona.
{
  const motivo = 'la actualización venía del marcador y aún no se ha revalidado contra el feed'
  const { mensaje } = describirErrorActualizacion(errorActualizacionNoAplicable(motivo), FEED)
  check(
    '(pre-vuelo) no aplicable -> dice el motivo REAL y no ofrece abrirlo a mano',
    mensaje.includes(motivo) && !/manualmente/i.test(mensaje),
    JSON.stringify(mensaje)
  )
}

// Y gana a cualquier heurística de texto: aunque el mensaje mencionase la red.
{
  const err = errorInstaladorNoIniciado()
  err.message = 'getaddrinfo cosas raras'
  const { mensaje } = describirErrorActualizacion(err, FEED)
  check(
    '(watchdog) el código propio tiene precedencia sobre el sniffing de texto',
    /manualmente/i.test(mensaje) && !MENSAJE_DE_RED.test(mensaje),
    JSON.stringify(mensaje)
  )
}

// Precedencia: un error de integridad que ADEMÁS trae un code de red se clasifica
// como integridad (lo específico gana a lo genérico).
{
  const e = errConCodigo('sha512 mismatch while downloading', 'ECONNRESET')
  const { mensaje } = describirErrorActualizacion(e, FEED)
  check(
    '(precedencia) integridad gana a red cuando el error trae ambas señales',
    /dañada/i.test(mensaje) && !MENSAJE_DE_RED.test(mensaje),
    JSON.stringify(mensaje)
  )
}

// Desconocido: NO se inventa nada, se muestra el mensaje crudo prefijado.
{
  const { mensaje } = describirErrorActualizacion(new Error('algo rarísimo'), FEED)
  check(
    '(desconocido) se muestra el mensaje crudo, sin inventar diagnóstico',
    mensaje === 'No se pudo actualizar: algo rarísimo',
    JSON.stringify(mensaje)
  )
}

// El detalle SIEMPRE conserva lo crudo, aunque el mensaje lo oculte.
{
  const e = errConCodigo(`connect ECONNREFUSED ${SERVIDOR_CAIDO}`, 'ECONNREFUSED')
  const { detalle } = describirErrorActualizacion(e, FEED)
  check(
    '(detalle) conserva mensaje + code + stack para copiar',
    detalle.includes('ECONNREFUSED') && detalle.includes('code: ECONNREFUSED') && detalle.includes('at '),
    JSON.stringify(detalle.slice(0, 60) + '…')
  )
}

// No-Error: un throw de string no debe romper la clasificación.
{
  const { mensaje, detalle } = describirErrorActualizacion('fallo pelado', FEED)
  check(
    '(robustez) un throw que NO es Error se clasifica sin lanzar',
    mensaje.includes('fallo pelado') && detalle.includes('fallo pelado'),
    JSON.stringify(mensaje)
  )
}

// hostDeUrl tolera una URL inválida (el feed puede no estar configurado aún).
check(
  '(hostDeUrl) una URL inválida se devuelve tal cual, sin lanzar',
  hostDeUrl('el servidor de actualizaciones') === 'el servidor de actualizaciones',
  hostDeUrl('el servidor de actualizaciones')
)
check('(hostDeUrl) extrae el host de una URL válida', hostDeUrl(FEED) === 'github.com', hostDeUrl(FEED))
check(
  '(hostDeUrl) conserva el puerto si la URL lo trae',
  hostDeUrl('http://feed.example.invalid:8080/tessera') === 'feed.example.invalid:8080',
  hostDeUrl('http://feed.example.invalid:8080/tessera')
)

check(
  '(detalleCrudo) un objeto cualquiera no rompe detalleCrudo',
  typeof detalleCrudo({ a: 1 }) === 'string',
  detalleCrudo({ a: 1 })
)

hr('(A2) esErrorDeRedPasajero — qué se reintenta en silencio y qué se pinta')

// El caso REAL que lo motivó, tal cual sale en update.log tras hibernar el equipo:
// el chequeo se dispara al despertar y Chromium aún tiene la red suspendida.
{
  const suspended = new Error('Error: net::ERR_NETWORK_IO_SUSPENDED')
  check(
    '(hibernación) ERR_NETWORK_IO_SUSPENDED es pasajero -> se reintenta, no se pinta',
    esErrorDeRedPasajero(suspended) === true,
    'transitorio'
  )
  const { mensaje } = describirErrorActualizacion(suspended, FEED)
  check(
    '(hibernación) si aun así se agotan los reintentos, el mensaje explica la suspensión',
    /suspensión/i.test(mensaje) && !MENSAJE_DE_RED.test(mensaje),
    JSON.stringify(mensaje)
  )
}

for (const codigo of ['ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNRESET']) {
  check(
    `(red/${codigo}) se reintenta antes de declararlo fallo`,
    esErrorDeRedPasajero(errConCodigo(`connect ${codigo}`, codigo)) === true,
    'transitorio'
  )
}

check(
  '(integridad) sha512 NUNCA es pasajero, aunque venga con un code de red',
  esErrorDeRedPasajero(errConCodigo('sha512 mismatch while downloading', 'ECONNRESET')) === false,
  'se pinta a la primera'
)
check(
  '(permisos) EACCES no es de red: se pinta a la primera',
  esErrorDeRedPasajero(errConCodigo('access is denied', 'EACCES')) === false,
  'se pinta a la primera'
)
check(
  '(watchdog) el instalador que no arranca no se reintenta en silencio',
  esErrorDeRedPasajero(errorInstaladorNoIniciado()) === false,
  'se pinta a la primera'
)
check(
  '(robustez) un no-Error no rompe la clasificación',
  esErrorDeRedPasajero({ raro: true }) === false,
  'false'
)

hr('(B) initialUpdateState — dev vs empaquetada')

{
  const desarrollo = initialUpdateState('0.6.0', false)
  check(
    '(dev) sin empaquetar arranca en `disabled` (no hay feed ni instalador)',
    desarrollo.fase === 'disabled' && desarrollo.newVersion === null && desarrollo.mensajeError === null,
    JSON.stringify(desarrollo)
  )
  const empaquetado = initialUpdateState('0.6.0', true)
  check(
    '(prod) empaquetada arranca en `idle`, sin error y sin instalador',
    empaquetado.fase === 'idle' && empaquetado.installerPath === null && empaquetado.percent === 0,
    JSON.stringify(empaquetado)
  )
  check(
    '(ambos) la versión actual se propaga tal cual',
    desarrollo.versionActual === '0.6.0' && empaquetado.versionActual === '0.6.0',
    empaquetado.versionActual
  )
}

hr('(C) installDirLock — a QUIÉN matar para liberar la carpeta de instalación')

{
  const RAIZ_PRUEBA = 'C:\\Users\\x\\AppData\\Local\\Programs\\Tessera'
  const OPTS = { raizDeInstalacion: RAIZ_PRUEBA, pidPropio: 4242, nombreExePrincipal: 'Tessera.exe' }
  const matar = (proc: { pid: number; nombre: string; ruta: string }): boolean => debeMatarAuxiliar(proc, OPTS)

  check(
    '(sí) OpenConsole.exe bajo la carpeta de instalación -> se mata',
    matar({ pid: 10, nombre: 'OpenConsole.exe', ruta: RAIZ_PRUEBA + '\\resources\\node-pty\\OpenConsole.exe' }) === true,
    'true'
  )
  check(
    '(no) la propia app (mismo nombre que el main) NO se mata, ni sus helpers de Electron',
    matar({ pid: 11, nombre: 'Tessera.exe', ruta: RAIZ_PRUEBA + '\\Tessera.exe' }) === false,
    'false'
  )
  check(
    '(no) nuestro propio PID nunca se mata',
    matar({ pid: 4242, nombre: 'OpenConsole.exe', ruta: RAIZ_PRUEBA + '\\OpenConsole.exe' }) === false,
    'false'
  )
  check(
    '(no) el conhost.exe del sistema (fuera de la carpeta) no se toca',
    matar({ pid: 12, nombre: 'conhost.exe', ruta: 'C:\\Windows\\System32\\conhost.exe' }) === false,
    'false'
  )
  check(
    '(sí) la ruta con barras normales se normaliza y aún casa el prefijo',
    matar({ pid: 13, nombre: 'OpenConsole.exe', ruta: RAIZ_PRUEBA.replace(/\\/g, '/') + '/OpenConsole.exe' }) === true,
    'true'
  )
  check(
    '(no) un directorio HERMANO con el mismo prefijo no cuenta como "dentro"',
    matar({ pid: 14, nombre: 'OpenConsole.exe', ruta: 'C:\\Users\\x\\AppData\\Local\\Programs\\TesseraOtra\\OpenConsole.exe' }) === false,
    'false'
  )
  check('(no) sin ruta de ejecutable no se puede decidir -> no se mata', matar({ pid: 15, nombre: 'x.exe', ruta: '' }) === false, 'false')
}

// El parseo de la tabla de procesos (objeto suelto, array, vacío, basura, sin ruta)
// ya no vive aquí: es `parsearTablaProcesos` de procesosSistema.ts, probado en
// src/main/agentes/test-procesos-bloqueo.mts (2a-2e).

// ---------------------------------------------------------------------------
// MAX_PATH: el verdadero "…: 2" del instalador (ver rutasCarpetaInstalacion.ts). Se fija
// con el caso REAL que lo destapó: una carpeta `.tessera` que una versión antigua
// dejó dentro de la app, con el marketplace de plugins de Claude Code anidado.
// ---------------------------------------------------------------------------
{
  const RAIZ_INSTALACION = 'C:\\Users\\maria\\AppData\\Local\\Programs\\Tessera'
  const TMP = 'C:\\Users\\maria\\AppData\\Local\\Temp'
  const crecimiento = crecimientoAlRenombrar(RAIZ_INSTALACION, TMP)
  check(
    '(maxpath) el renombrado al temporal ALARGA la ruta (por eso rompe lo que antes cabía)',
    crecimiento === 12,
    `crecimiento = ${crecimiento} caracteres`
  )

  // El culpable real: 260 caracteres ya en origen.
  const culpable =
    RAIZ_INSTALACION +
    '\\resources\\app\\.tessera\\global\\claude\\ba53cf18-9d10-499f-b678-4f5748920966' +
    '\\plugins\\marketplaces\\claude-plugins-official\\plugins\\claude-code-setup\\skills' +
    '\\claude-automation-recommender\\references\\subagent-templates.md'
  check(
    '(maxpath) la ruta que abortaba el update se detecta como condenada',
    culpable.length === 260 && superariaMaxPath(culpable, crecimiento),
    `${culpable.length} chars -> ${culpable.length + crecimiento} al renombrar (límite ${MAX_PATH})`
  )

  // Una ruta profunda pero legítima debe pasar sin ruido. El literal es de cuando
  // monaco-editor viajaba en el paquete y era lo más hondo que había; ya NO viaja
  // (pasó a devDependency: Vite lo bundlea, ver la cabecera de electron.vite.config.ts),
  // así que hoy el paquete es MENOS profundo que esto. Se conserva tal cual a
  // propósito: lo que el caso fija es la longitud, y una cota más holgada que la
  // realidad sigue siendo una cota válida.
  const normal =
    RAIZ_INSTALACION +
    '\\resources\\app\\node_modules\\monaco-editor\\esm\\vs\\editor\\browser\\widget' +
    '\\diffEditor\\components\\diffEditorViewZones\\inlineDiffDeletedCodeMargin.js'
  check(
    '(maxpath) una ruta profunda pero legítima del paquete NO se marca (nada de falsos positivos)',
    !superariaMaxPath(normal, crecimiento),
    `${normal.length} chars -> ${normal.length + crecimiento}`
  )

  const de = (len: number): string => 'C:\\' + 'x'.repeat(len - 3) // ruta de longitud exacta
  check(
    '(maxpath) el límite es >= 260 (MAX_PATH cuenta el NUL final): 260 exactos ya sobra',
    de(260).length === 260 &&
      superariaMaxPath(de(260), 0) &&
      !superariaMaxPath(de(259), 0),
    '260 -> condenada; 259 -> pasa'
  )

  check(
    '(maxpath) `.tessera` está en la lista de restos a borrar de la carpeta de la app',
    DATOS_APP_RESIDUALES.includes('.tessera'),
    DATOS_APP_RESIDUALES.join(', ')
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
  const feedMac =
    'version: 0.49.2\n' +
    'files:\n' +
    '  - url: Tessera-0.49.2-arm64.zip\n' +
    '    sha512: abc\n' +
    'path: Tessera-0.49.2-arm64.zip\n'
  check('(feed) un `- url:` indentado (latest-mac.yml) NO cuenta como feed', urlDeFeed(feedMac) === null, 'null')
}

// (D2) urlDescargaManual: el `info.files` REAL del latest-mac.yml de esta máquina,
// en su orden real (el zip va PRIMERO y aun así tiene que ganar el dmg).
{
  const archivos = [{ url: 'Tessera-0.49.2-arm64.zip' }, { url: 'Tessera-0.49.2-arm64.dmg' }]
  const esperado = FEED + '/Tessera-0.49.2-arm64.dmg'
  check(
    '(descarga) prefiere el .dmg aunque el .zip esté antes en la lista',
    urlDescargaManual(FEED, archivos) === esperado,
    String(urlDescargaManual(FEED, archivos))
  )
  check(
    '(descarga) base CON barra final -> misma URL, sin doble barra',
    urlDescargaManual(FEED + '/', archivos) === esperado,
    String(urlDescargaManual(FEED + '/', archivos))
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
