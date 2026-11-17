// =============================================================================
// Salida de `tdb`: `fallar`, la tabla de texto, el ajuste de líneas y lo que no se enseña a un
// contenedor (las carpetas del equipo y las rutas de las bases de archivo). El modo `--json` NO es
// estado de módulo: viaja en `ctx.json` (lo fija `contexto()` desde los argumentos) y `fallar` lo
// recibe con el `ctx`. Depende de `textosTdb.cjs` y de `archivoSqlite.cjs` (la plataforma y su
// `path`); lo usan el resto de `tdb*.cjs`.
// =============================================================================
'use strict'

const os = require('node:os')
const { pathDe, plataformaDelProceso } = require('./archivoSqlite.cjs')
const { textosTdb } = require('./textosTdb.cjs')

/** Ancho máximo de una celda al pintar en texto (el valor completo sale con --json). */
const ANCHO_CELDA = 40

/** La marca del `tdb` que el host ejecuta para un contenedor. DEBE coincidir con `ENV_TDB_BUZON` de `src/shared/db-ipc.ts`. */
const ENV_BUZON_TDB = 'TESSERA_TDB_BUZON'

/** ¿Lo ejecuta el host para un contenedor? Entonces no se enseñan las rutas del equipo que se conocen. */
function paraContenedor(env = process.env) {
  return env[ENV_BUZON_TDB] === '1'
}

/**
 * Las carpetas que dicen quién es el usuario del equipo: la personal y, en Windows, la temporal,
 * que puede llegar con su nombre corto y entonces no cuelga, escrita, de la personal.
 */
function carpetasDelEquipo(plataforma = plataformaDelProceso()) {
  return plataforma === 'windows' ? [os.homedir(), os.tmpdir()] : [os.homedir()]
}

const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * `texto` con cada una de `carpetas` cambiada por `marca`: con cualquier separador, sin distinguir
 * mayúsculas y solo la carpeta entera (los drivers y los errores del sistema escriben la ruta a su
 * manera). Una letra de unidad casa también en su forma `/c/…`. Nunca la raíz ni una unidad sola.
 */
function sinCarpetasDelEquipo(texto, carpetas = carpetasDelEquipo(), marca = textosTdb().carpetaDelEquipo) {
  const patrones = carpetas
    .map((c) => String(c || '').replace(/[\\/]+$/, ''))
    .filter((c) => c.length > 2 && !/^[A-Za-z]:$/.test(c))
    .sort((a, b) => b.length - a.length)
    .map((c) =>
      c
        .split(/[\\/]+/)
        .map((s, i) => (i === 0 && /^[A-Za-z]:$/.test(s) ? `(?:${escaparRegex(s)}|[\\\\/]${s[0]})` : escaparRegex(s)))
        .join('[\\\\/]+')
    )
  let r = String(texto)
  for (const p of patrones) r = r.replace(new RegExp(`(?<![\\p{L}\\p{N}._~-])${p}(?![\\p{L}\\p{N}._~-])`, 'giu'), () => marca)
  return r
}

/**
 * `texto` con la ruta de la base de cada conexión de archivo cambiada por su nombre (el `archivoVisible`
 * de `tdb ls`): la ruta exacta del registro, con cualquier separador y, salvo en Linux, sin distinguir
 * mayúsculas. Lo que siga al nombre se queda (`base.db-wal` sigue siendo el nombre de su auxiliar).
 */
function sinRutasDeArchivo(texto, conexiones, plataforma = plataformaDelProceso()) {
  const p = pathDe(plataforma)
  const rutas = (Array.isArray(conexiones) ? conexiones : [])
    .map((c) => (c && typeof c.archivo === 'string' ? c.archivo : ''))
    .filter((r) => p.basename(r) !== '' && p.basename(r) !== r)
    .sort((a, b) => b.length - a.length)
  let r = String(texto)
  for (const ruta of rutas) {
    const patron = ruta.split(/[\\/]+/).map(escaparRegex).join('[\\\\/]+')
    r = r.replace(new RegExp(`(?<![\\p{L}\\p{N}._~-])${patron}`, plataforma === 'linux' ? 'gu' : 'giu'), () => p.basename(ruta))
  }
  return r
}

/**
 * Escribe el error (stdout en `--json`, stderr en texto) y termina con 1 sin esperar.
 * `salida` es lo que lleva el modo: el `ctx` de `contexto()` o, antes de que exista, los
 * argumentos leídos (`{ json }`); los dos tienen `json`. Para un contenedor, sin las rutas de las
 * bases de archivo del perfil (las que sabe el `ctx`) ni las carpetas del equipo: los errores de un
 * driver o del sistema de archivos las llevan.
 */
function fallar(salida, mensaje, extra) {
  const texto = paraContenedor() ? sinCarpetasDelEquipo(sinRutasDeArchivo(mensaje, salida.delPerfil)) : mensaje
  if (salida.json) {
    console.log(JSON.stringify({ ok: false, error: texto, ...(extra || {}) }))
  } else {
    console.error(`\n  ✗ ${texto}\n`)
  }
  process.exit(1)
}

function celda(v) {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().replace('T', ' ').slice(0, 19)
  if (Buffer.isBuffer(v)) return textosTdb().binario(v.length)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Tabla de texto alineada. Pensada para que un LLM la lea sin ambigüedad. */
function pintarTabla(columnas, filas) {
  if (filas.length === 0) {
    console.log(textosTdb().sinFilas)
    return
  }
  const datos = filas.map((f) =>
    columnas.map((c) => {
      const t = celda(Array.isArray(f) ? f[columnas.indexOf(c)] : f[c])
      return t.length > ANCHO_CELDA ? t.slice(0, ANCHO_CELDA - 1) + '…' : t
    })
  )
  const anchos = columnas.map((c, i) =>
    Math.max(c.length, ...datos.map((d) => d[i].length))
  )
  const linea = (celdas) => '  ' + celdas.map((t, i) => t.padEnd(anchos[i])).join('  ').trimEnd()
  console.log(linea(columnas))
  console.log('  ' + anchos.map((a) => '─'.repeat(a)).join('  '))
  for (const d of datos) console.log(linea(d))
}

/**
 * Parte un texto en líneas de hasta `ancho` caracteres, con la sangría de continuación de
 * los mensajes de `tdb` (cuatro espacios: la primera línea la sangra quien lo pinta, con
 * su `✗` o sin él). Por palabras; una palabra más larga que el ancho va sola en su línea.
 */
function envolver(texto, ancho = 84) {
  const lineas = []
  let actual = ''
  for (const palabra of texto.split(' ')) {
    if (actual !== '' && actual.length + 1 + palabra.length > ancho) {
      lineas.push(actual)
      actual = palabra
    } else {
      actual = actual === '' ? palabra : `${actual} ${palabra}`
    }
  }
  if (actual !== '') lineas.push(actual)
  return lineas.join('\n    ')
}

module.exports = { fallar, pintarTabla, envolver, paraContenedor, carpetasDelEquipo, sinCarpetasDelEquipo, sinRutasDeArchivo }
