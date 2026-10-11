// =============================================================================
// El Instant Client en Linux: el enlazador busca las dependencias de `libclntsh.so` SOLO en
// LD_LIBRARY_PATH, y lo lee al arrancar el proceso; con `libDir` no basta. Aquí se calcula ese
// entorno (las carpetas instaladas del catálogo y, si el sistema solo trae `libaio.so.1t64`, un
// enlace `libaio.so.1` en una carpeta de Tessera) y `tdb` se relanza una vez con él. El main lo
// usa al lanzar el proceso de sesión del explorador. Fuera de Linux no cambia nada.
// Decisiones: docs/decisiones/bd/drivers-catalogo-y-matriz-oracle.md
// =============================================================================
'use strict'

// Rutas de Linux siempre, se pruebe desde donde se pruebe.
const path = require('node:path').posix
const fs = require('node:fs')

const VARIABLE = 'LD_LIBRARY_PATH'

/** Marca de un `tdb` ya relanzado: no se relanza otra vez aunque el entorno no haya quedado como se quería. */
const MARCA_RELANZADO = 'TESSERA_TDB_BIBLIOTECAS'

/** Carpeta de Tessera para el enlace de compatibilidad de `libaio`, bajo la de drivers. */
const CARPETA_COMPAT = path.join('oracle', 'compat-linux')

/** Donde las distribuciones dejan las bibliotecas del sistema. */
const DIRS_SISTEMA = [
  '/lib/x86_64-linux-gnu',
  '/usr/lib/x86_64-linux-gnu',
  '/lib64',
  '/usr/lib64',
  '/lib',
  '/usr/lib'
]

/**
 * La carpeta de cada Instant Client instalado, la que cargaría `cargarInstantClient`: la externa
 * registrada y, si no, la descargada. `ctx` es `{ packs, externos, driversDir }` del catálogo.
 */
function carpetasInstantClient(ctx, existe = fs.existsSync) {
  const out = []
  for (const p of (ctx && ctx.packs) || []) {
    if (!p || p.motor !== 'oracle' || typeof p.centinela !== 'string') continue
    const candidatas = [
      ctx.externos && ctx.externos[p.id],
      ctx.driversDir ? path.join(ctx.driversDir, 'oracle', p.id) : null
    ]
    const ruta = candidatas.find((r) => typeof r === 'string' && r !== '' && existe(path.join(r, p.centinela)))
    if (ruta && !out.includes(ruta)) out.push(ruta)
  }
  return out
}

/**
 * La `libaio` del sistema: `'ok'` si está `libaio.so.1`, la ruta de `libaio.so.1t64` si solo está
 * esa (Ubuntu 24.04 y derivados la renombraron), o `null` si no hay ninguna.
 */
function libaioDelSistema(existe = fs.existsSync, dirs = DIRS_SISTEMA) {
  if (dirs.some((d) => existe(path.join(d, 'libaio.so.1')))) return 'ok'
  const t64 = dirs.map((d) => path.join(d, 'libaio.so.1t64')).find((r) => existe(r))
  return t64 ?? null
}

/**
 * La carpeta con el enlace `libaio.so.1 -> libaio.so.1t64`, creándolo si hace falta, o `null` si
 * el sistema ya trae `libaio.so.1`, no trae ninguna o no se pudo crear (el error al cargar lo explica).
 */
function carpetaCompatLibaio(driversDir, deps = {}) {
  const existe = deps.existe || fs.existsSync
  const sistema = libaioDelSistema(existe, deps.dirs)
  if (!driversDir || sistema === 'ok' || sistema === null) return null
  const dir = path.join(driversDir, CARPETA_COMPAT)
  const enlace = path.join(dir, 'libaio.so.1')
  try {
    let actual = null
    try {
      actual = fs.readlinkSync(enlace)
    } catch {
      actual = null
    }
    if (actual !== sistema) {
      fs.mkdirSync(dir, { recursive: true })
      fs.rmSync(enlace, { force: true })
      fs.symlinkSync(sistema, enlace)
    }
    return dir
  } catch {
    return null
  }
}

/**
 * El entorno con las carpetas delante de LD_LIBRARY_PATH (sin repetir las que ya estén), o el
 * mismo objeto si no hay ninguna que añadir. Puro.
 */
function entornoConCarpetas(env, carpetas) {
  const actual = typeof env[VARIABLE] === 'string' ? env[VARIABLE] : ''
  const presentes = new Set(actual.split(':').filter(Boolean))
  const nuevas = carpetas.filter((c) => !presentes.has(c))
  if (nuevas.length === 0) return env
  return { ...env, [VARIABLE]: actual === '' ? nuevas.join(':') : `${nuevas.join(':')}:${actual}` }
}

/** El entorno de un proceso que puede cargar el Instant Client; fuera de Linux, el mismo. */
function entornoOracle(env, ctx, plataforma = process.platform, deps = {}) {
  if (plataforma !== 'linux') return env
  const carpetas = carpetasInstantClient(ctx, deps.existe)
  if (carpetas.length === 0) return env
  const compat = carpetaCompatLibaio(ctx.driversDir, deps)
  return entornoConCarpetas(env, compat === null ? carpetas : [...carpetas, compat])
}

/** El catálogo publicado por el main (`<drivers>/catalogo.json`), o uno vacío. */
function ctxDelCatalogo(driversDir) {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(driversDir, 'catalogo.json'), 'utf8'))
    return { packs: Array.isArray(doc.packs) ? doc.packs : [], externos: doc.externos || {}, driversDir }
  } catch {
    return { packs: [], externos: {}, driversDir }
  }
}

/** Las señales con las que se para un `tdb`: el tope de quien lo lanzó, Ctrl+C, cerrar la terminal. */
const SENALES_REENVIADAS = ['SIGTERM', 'SIGINT', 'SIGHUP']

/**
 * Si a este `tdb` le faltan las carpetas en LD_LIBRARY_PATH, se relanza con ellas, le reenvía las
 * señales que reciba (si no, el tope de quien lo lanzó mataría a este y dejaría al relanzado vivo
 * con la conexión abierta) y sale con su código: devuelve `true` y quien llama no sigue. Si no hace
 * falta, `false`. Una vez como mucho (`MARCA_RELANZADO`). Si no se puede lanzar, `false` y sigue
 * sin él: el error al cargar el cliente dirá qué falta.
 */
function relanzarSiFaltan(driversDir, deps = {}) {
  const plataforma = deps.plataforma || process.platform
  const env = deps.env || process.env
  if (plataforma !== 'linux' || !driversDir || env[MARCA_RELANZADO] === '1') return false
  const nuevo = entornoOracle(env, deps.ctx || ctxDelCatalogo(driversDir), plataforma, deps)
  if (nuevo === env) return false
  const lanzar = deps.spawn || require('node:child_process').spawn
  const proceso = deps.proceso || process
  let hijo
  try {
    hijo = lanzar(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
      stdio: 'inherit',
      env: { ...nuevo, [MARCA_RELANZADO]: '1' }
    })
  } catch {
    return false
  }
  for (const s of SENALES_REENVIADAS) proceso.on(s, () => hijo.kill(s))
  hijo.on('error', (err) => {
    process.stderr.write(`tdb: no se pudo relanzar con el cliente Oracle (${err && err.message})\n`)
    proceso.exit(1)
  })
  hijo.on('exit', (codigo) => proceso.exit(typeof codigo === 'number' ? codigo : 1))
  return true
}

/** El remedio cuando el cliente no carga por la `libaio` del sistema; `null` si no es eso. */
function remedioLibaio(mensaje, plataforma = process.platform) {
  if (plataforma !== 'linux' || !/libaio/.test(String(mensaje))) return null
  return (
    'Falta la biblioteca libaio del sistema, que pide el cliente Oracle. Instálala con el gestor ' +
    'de paquetes: en Ubuntu 24.04 y posteriores, sudo apt install libaio1t64; en versiones ' +
    'anteriores y en Debian, sudo apt install libaio1; en Fedora, sudo dnf install libaio.'
  )
}

module.exports = {
  MARCA_RELANZADO,
  CARPETA_COMPAT,
  carpetasInstantClient,
  libaioDelSistema,
  carpetaCompatLibaio,
  entornoConCarpetas,
  entornoOracle,
  ctxDelCatalogo,
  relanzarSiFaltan,
  remedioLibaio
}
