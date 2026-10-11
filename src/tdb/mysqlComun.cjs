// =============================================================================
// Lo común de MySQL y MariaDB a `tdb` y al proceso de sesión: las opciones de mysql2 (cifrado, túnel
// por un `stream` que conecta al extremo local con el nombre del servidor real), conectar, preparar
// la sesión (modo SQL sin ANSI_QUOTES ni NO_BACKSLASH_ESCAPES, versión mínima, solo lectura), los
// errores y la sustitución de los `?` fuera de cadenas y comentarios. Las celdas, en `celdasMysql.cjs`.
// Decisiones: docs/decisiones/bd/adaptador-mysql-conexion-y-celdas.md
// =============================================================================

'use strict'

const net = require('node:net')
const { causaTls, certificadosDeConfianza, mensajeCertificado, servidorDeMensaje, tlsDe, SIN_CIFRAR } = require('./tlsComun.cjs')
const celdas = require('./celdasMysql.cjs')

/** Tope de espera para conectar. */
const TIMEOUT_CONEXION_MS = 20_000
/** Versiones mayores mínimas: MySQL 8.0 y MariaDB 10.4 (las del catálogo que lee Tessera). */
const MINIMA_MYSQL = [8, 0]
const MINIMA_MARIADB = [10, 4]
/** Los modos SQL que cambian cómo se LEE el texto y que Tessera quita de la sesión. */
const MODOS_QUE_CAMBIAN_EL_LEXICO = ['ANSI_QUOTES', 'NO_BACKSLASH_ESCAPES']
/** El GROUP_CONCAT del catálogo junta listas de columnas: el tope de fábrica (1024) se queda corto. */
const GROUP_CONCAT_MAX = 1024 * 1024

/** Carga mysql2 (perezoso: `tdb ls` no lo necesita). */
function cargarMysql2() {
  return require('mysql2')
}

/** Un error con su código de Tessera, para un mensaje que ya dice qué hacer. */
function errorMysql(codigo, mensaje, causa) {
  const e = new Error(mensaje)
  e.code = `TESSERA-MYSQL-${codigo}`
  if (causa) e.cause = causa
  return e
}

/**
 * La opción `ssl` de mysql2: undefined sin cifrar; cifrando, verifica la cadena del certificado
 * con las CA del paquete y del sistema y el NOMBRE del servidor (`verifyIdentity`), o no verifica
 * nada si la conexión confía en el certificado. `cas` entra por parámetro (el test lo sustituye).
 */
function opcionesSsl(con, cas) {
  const t = tlsDe(con, SIN_CIFRAR)
  if (!t.cifrar) return undefined
  if (t.confiarCertificado) return { rejectUnauthorized: false }
  return { rejectUnauthorized: true, verifyIdentity: true, ...(cas ? { ca: cas } : {}) }
}

/**
 * Las opciones de mysql2. Por un túnel SSH (`con.hostTls`), `host` es el servidor REAL (el nombre
 * con el que se verifica el certificado y que va por SNI) y el `stream` conecta al extremo local.
 * Todo valor llega como texto (`typeCast`) y las filas como arrays (dos columnas del mismo nombre
 * no se pisan).
 */
function opcionesConexion(con, secreto, op) {
  const o = op || {}
  const porTunel = typeof con.hostTls === 'string' && con.hostTls !== ''
  const config = {
    host: porTunel ? con.hostTls : con.host,
    port: con.port,
    user: con.user,
    password: secreto === undefined ? undefined : secreto,
    database: con.database || undefined,
    charset: 'utf8mb4',
    connectTimeout: TIMEOUT_CONEXION_MS,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    // El JSON como su texto (MariaDB lo manda como LONGTEXT con formato `json`): nunca un objeto.
    jsonStrings: true,
    multipleStatements: false,
    rowsAsArray: true,
    typeCast: celdas.typeCast,
    ssl: opcionesSsl(con, tlsDe(con, SIN_CIFRAR).cifrar ? (o.cas === undefined ? certificadosDeConfianza() : o.cas) : null),
    connectAttributes: { program_name: String(o.appName || 'Tessera').slice(0, 64) }
  }
  if (porTunel) config.stream = () => net.connect(con.port, con.host)
  if (o.keepAlive) {
    config.enableKeepAlive = true
    config.keepAliveInitialDelay = 30_000
  }
  return config
}

/** El error de conectar traducido a lo que el usuario arregla en la conexión, o el mismo error. */
function errorAlConectar(err, con) {
  const servidor = servidorDeMensaje(con)
  const tlsMalo = causaTls(err)
  if (tlsMalo) return errorMysql('CERTIFICADO', mensajeCertificado(servidor, tlsMalo, true), err)
  const codigo = err && err.code
  if (codigo === 'HANDSHAKE_NO_SSL_SUPPORT') {
    return errorMysql('SIN-TLS', `${servidor} no admite conexiones cifradas. Desmarca «Cifrar la conexión (TLS)» en la conexión, o activa TLS en el servidor.`, err)
  }
  if (err && err.errno === 3159) {
    return errorMysql('EXIGE-TLS', `${servidor} exige una conexión cifrada. Marca «Cifrar la conexión (TLS)» en la conexión.`, err)
  }
  return err
}

/** Conecta y resuelve la conexión de mysql2 (eventos, no promesas: Detener y la pérdida se escuchan). */
function conectar(config, mysql2) {
  const m = mysql2 || cargarMysql2()
  return new Promise((resolve, reject) => {
    const c = m.createConnection(config)
    const alError = (err) => {
      c.removeListener('connect', alConectar)
      try {
        c.destroy()
      } catch {
        // ya estaba cerrada
      }
      reject(err)
    }
    const alConectar = () => {
      c.removeListener('error', alError)
      resolve(c)
    }
    c.once('error', alError)
    c.once('connect', alConectar)
  })
}

/** Una consulta interna de Tessera (texto, sin parámetros): sus filas como arrays. */
function interna(c, sql) {
  return new Promise((resolve, reject) => {
    c.query({ sql, rowsAsArray: true }, (err, filas) => (err ? reject(err) : resolve(Array.isArray(filas) ? filas : [])))
  })
}

/** ¿Es MariaDB? (su `VERSION()` lo dice). */
function esMariaDb(version) {
  return /mariadb/i.test(String(version))
}

/** La versión `[mayor, menor]` de un `VERSION()`, o null si no se entiende. */
function partesVersion(version) {
  const m = /^(\d+)\.(\d+)/.exec(String(version))
  return m ? [Number(m[1]), Number(m[2])] : null
}

/** El rechazo de un servidor por debajo de la versión mínima, o null si vale. */
function mensajeVersion(version) {
  const v = partesVersion(version)
  if (!v) return null
  const maria = esMariaDb(version)
  const min = maria ? MINIMA_MARIADB : MINIMA_MYSQL
  if (v[0] > min[0] || (v[0] === min[0] && v[1] >= min[1])) return null
  const nombre = maria ? 'MariaDB' : 'MySQL'
  return `El servidor es ${nombre} ${version}: Tessera necesita ${nombre} ${min[0]}.${min[1]} o posterior.`
}

/** El modo SQL sin los modos que cambian el léxico, o null si no lleva ninguno. */
function modoSinLexico(modo) {
  const partes = String(modo || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  const quedan = partes.filter((x) => MODOS_QUE_CAMBIAN_EL_LEXICO.indexOf(x.toUpperCase()) < 0)
  return quedan.length === partes.length ? null : quedan.join(',')
}

/** El literal de un texto en SQL de MySQL (barra y comilla escapadas). */
function literal(s) {
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").split('\u0000').join('\\0') + "'"
}

/**
 * Prepara la sesión recién abierta en un viaje por sentencia: lee versión, base, usuario, id y modo
 * SQL; rechaza un servidor demasiado viejo; quita ANSI_QUOTES y NO_BACKSLASH_ESCAPES del modo (el
 * léxico de Tessera lee `"x"` como cadena y la barra como escape); sube el tope de GROUP_CONCAT y,
 * en solo lectura, pone TODAS las transacciones de la sesión en READ ONLY.
 */
async function prepararSesion(c, soloLectura) {
  const [f] = await interna(c, 'SELECT VERSION(), DATABASE(), CURRENT_USER(), CONNECTION_ID(), @@SESSION.sql_mode')
  const info = { version: String(f[0] ?? ''), base: f[1] ?? null, usuario: f[2] ?? null, id: Number(f[3]) || undefined }
  const rechazo = mensajeVersion(info.version)
  if (rechazo) throw errorMysql('VERSION', rechazo)
  const sets = [`group_concat_max_len = ${GROUP_CONCAT_MAX}`]
  const modo = modoSinLexico(f[4])
  if (modo !== null) sets.push(`sql_mode = ${literal(modo)}`)
  await interna(c, `SET SESSION ${sets.join(', ')}`)
  if (soloLectura) await interna(c, 'SET SESSION TRANSACTION READ ONLY')
  return info
}

/** Vuelve a quitar los modos que cambian el léxico si una sentencia los puso (un procedimiento puede). */
async function refijarModo(c) {
  const [f] = await interna(c, 'SELECT @@SESSION.sql_mode')
  const modo = modoSinLexico(f && f[0])
  if (modo !== null) await interna(c, `SET SESSION sql_mode = ${literal(modo)}`)
}

// --- Marcadores ---------------------------------------------------------------------------------

/** Dónde acaba la cadena o el nombre citado con `q` que empieza en `i` (la barra escapa en las cadenas). */
function finCitado(sql, i, q) {
  let j = i + 1
  while (j < sql.length) {
    const ch = sql[j]
    if (ch === '\\' && q !== '`') {
      j += 2
      continue
    }
    if (ch === q) {
      if (sql[j + 1] === q) {
        j += 2
        continue
      }
      return j + 1
    }
    j++
  }
  return sql.length
}

/** Dónde acaba el comentario que empieza en `i`, o -1 si en `i` no empieza uno. */
function finComentario(sql, i) {
  const c = sql[i]
  const c1 = sql[i + 1]
  if (c === '#' || (c === '-' && c1 === '-' && (i + 2 >= sql.length || /\s/.test(sql[i + 2])))) {
    const k = sql.indexOf('\n', i)
    return k < 0 ? sql.length : k
  }
  if (c === '/' && c1 === '*') {
    const k = sql.indexOf('*/', i + 2)
    return k < 0 ? sql.length : k + 2
  }
  return -1
}

/**
 * El SQL con cada `?` (fuera de cadenas, nombres citados y comentarios) cambiado por el literal de
 * su valor, en orden: así se ejecuta por el protocolo de TEXTO, que da los valores exactos. Un
 * número va tal cual (los `LIMIT ? OFFSET ?` de la rejilla); un texto, entre comillas; null, NULL.
 * Lanza si el número de valores no casa con el de marcadores.
 */
function sustituirMarcadores(sql, valores) {
  return sustituirConMapa(sql, valores).texto
}

/**
 * Como `sustituirMarcadores`, y con dónde quedó cada sustitución (`cambios`: su posición en el
 * texto enviado, su largo y la del `?` en el original) para devolver una posición del servidor
 * al texto del usuario (`indiceEnOriginal`).
 */
function sustituirConMapa(sql, valores) {
  const vs = Array.isArray(valores) ? valores : []
  const cambios = []
  let salida = ''
  let k = 0
  let i = 0
  let desde = 0
  while (i < sql.length) {
    const ch = sql[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      i = finCitado(sql, i, ch)
      continue
    }
    const fc = finComentario(sql, i)
    if (fc >= 0) {
      i = fc
      continue
    }
    if (ch === '?') {
      if (k >= vs.length) throw errorMysql('BINDS', `La sentencia tiene más marcadores ? que valores (${vs.length}).`)
      const v = vs[k++]
      const lit = v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : literal(v)
      salida += sql.slice(desde, i)
      cambios.push({ enTexto: salida.length, largo: lit.length, enOriginal: i })
      salida += lit
      desde = i + 1
    }
    i++
  }
  if (k !== vs.length) throw errorMysql('BINDS', `La sentencia tiene ${k} marcador(es) ? y llegaron ${vs.length} valor(es).`)
  return { texto: salida + sql.slice(desde), cambios }
}

/** Un índice (UTF-16) del texto enviado, en el original: dentro de una sustitución, el de su `?`. */
function indiceEnOriginal(cambios, k) {
  let delta = 0
  for (const c of cambios || []) {
    if (k < c.enTexto) break
    if (k < c.enTexto + c.largo) return c.enOriginal
    delta += c.largo - 1
  }
  return k - delta
}

// --- Errores ------------------------------------------------------------------------------------

/** Los errores que significan que la conexión ya no existe. */
const CODIGOS_PERDIDA = new Set(['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'PROTOCOL_SEQUENCE_TIMEOUT'])
/** 2006: el servidor se fue; 2013: se perdió durante la consulta; 1927 (MariaDB): conexión matada. */
const ERRNOS_PERDIDA = new Set([2006, 2013, 1927])

function esPerdida(err) {
  if (!err) return false
  if (err.fatal === true) return true
  if (typeof err.code === 'string' && CODIGOS_PERDIDA.has(err.code)) return true
  return typeof err.errno === 'number' && ERRNOS_PERDIDA.has(err.errno)
}

/**
 * El índice (UTF-16) de un error de sintaxis (1064) en el texto ENVIADO: el servidor dice la línea y
 * el texto desde el error (`near '…' at line N`), que se busca desde el principio de esa línea. -1
 * si no se encuentra.
 */
function indiceDeSintaxis(mensaje, texto) {
  const m = /near '([\s\S]*)' at line (\d+)\s*$/.exec(String(mensaje))
  if (!m) return -1
  let inicio = 0
  for (let l = 1; l < Number(m[2]); l++) {
    const k = texto.indexOf('\n', inicio)
    if (k < 0) return -1
    inicio = k + 1
  }
  return m[1] === '' ? texto.length : texto.indexOf(m[1], inicio)
}

/**
 * El índice (UTF-16) de la columna de un 1054 (`Unknown column 'x' in 'where clause'`) en el texto
 * ENVIADO: su primera aparición (citada o no) tras el WHERE u ORDER BY que dice el mensaje. -1 si no.
 */
function indiceDeColumna(mensaje, texto) {
  const m = /Unknown column '([^']+)' in '([^']+)'/.exec(String(mensaje))
  if (!m) return -1
  const nombre = m[1].split('.').pop()
  const clausula = m[2].toLowerCase()
  const mayus = texto.toUpperCase()
  let desde = 0
  if (clausula.startsWith('order')) desde = Math.max(0, mayus.lastIndexOf('ORDER BY'))
  else if (clausula.startsWith('where')) desde = Math.max(0, mayus.indexOf('WHERE'))
  const citado = texto.indexOf('`' + nombre + '`', desde)
  return citado >= 0 ? citado : texto.indexOf(nombre, desde)
}

/**
 * La posición de un error en PUNTOS DE CÓDIGO del texto del usuario (`sql`), o undefined. `envio`
 * (opcional) es lo que de verdad viajó, con los `?` sustituidos: el índice se busca allí y se
 * devuelve al original con sus `cambios`.
 */
function offsetDeError(err, sql, envio) {
  if (typeof sql !== 'string') return undefined
  const texto = envio && typeof envio.texto === 'string' ? envio.texto : sql
  const mensaje = String((err && (err.sqlMessage || err.message)) || '')
  const n = err && err.errno
  const k = n === 1064 ? indiceDeSintaxis(mensaje, texto) : n === 1054 ? indiceDeColumna(mensaje, texto) : -1
  if (k < 0) return undefined
  const enOriginal = envio ? indiceEnOriginal(envio.cambios, k) : k
  return Array.from(sql.slice(0, Math.min(enOriginal, sql.length))).length
}

/** Compatibilidad de las pruebas: la posición de un 1064 en `sql` enviado tal cual. */
function offsetDeSintaxis(mensaje, sql) {
  return offsetDeError({ errno: 1064, message: mensaje }, sql)
}

/** La clase de un error: pérdida, cancelada, timeout, solo lectura o servidor. */
function claseDe(err) {
  if (esPerdida(err)) return 'perdida'
  const n = err && err.errno
  // 1317: la consulta se interrumpió (KILL QUERY); 3024 / 1969: tope de tiempo de la sentencia.
  if (n === 1317) return err.__cancelPedido ? 'cancelada' : 'timeout'
  if (n === 3024 || n === 1969) return 'timeout'
  if (n === 1792) return 'soloLectura'
  return 'servidor'
}

/**
 * Error de mysql2 -> `ErrorTrabajador`, con su número como código y la posición de un 1064 o un
 * 1054 en el texto del usuario (`envio`: lo que viajó con los `?` sustituidos, ver `offsetDeError`).
 */
function normalizarError(err, sql, envio) {
  const mensaje = String((err && (err.sqlMessage || err.message)) || err || 'Error desconocido')
  const e = { mensaje, clase: claseDe(err) }
  if (err && typeof err.errno === 'number') e.codigo = String(err.errno)
  else if (err && typeof err.code === 'string') e.codigo = err.code
  const o = offsetDeError(err, sql, envio)
  if (o !== undefined) e.offsetCp = o
  return e
}

/** Cierra la conexión sin lanzar: `end` con plazo y, si no contesta, `destroy`. */
function cerrar(c, plazoMs) {
  return new Promise((resolve) => {
    if (!c) return resolve()
    const reloj = setTimeout(() => {
      try {
        c.destroy()
      } catch {
        // nada
      }
      resolve()
    }, plazoMs || 3000)
    try {
      c.end(() => {
        clearTimeout(reloj)
        resolve()
      })
    } catch {
      clearTimeout(reloj)
      resolve()
    }
  })
}

/**
 * Un destino de PRUEBA del entorno (`usuario/clave@host:puerto[/base]`, el que pone
 * `scripts/pruebas/mysql.sh correr`), o null.
 */
function destinoDePrueba(texto) {
  if (typeof texto !== 'string' || texto === '') return null
  const m = /^([^/@]+)\/([^@]*)@([^:/]+):(\d+)(?:\/(.*))?$/.exec(texto)
  if (!m) return null
  return { user: m[1], secreto: m[2], host: m[3], port: Number(m[4]), database: m[5] || undefined }
}

module.exports = {
  TIMEOUT_CONEXION_MS,
  MODOS_QUE_CAMBIAN_EL_LEXICO,
  cargarMysql2,
  errorMysql,
  opcionesSsl,
  opcionesConexion,
  errorAlConectar,
  conectar,
  interna,
  esMariaDb,
  mensajeVersion,
  modoSinLexico,
  literal,
  prepararSesion,
  refijarModo,
  sustituirMarcadores,
  sustituirConMapa,
  indiceEnOriginal,
  esPerdida,
  normalizarError,
  offsetDeSintaxis,
  offsetDeError,
  cerrar,
  destinoDePrueba,
  celdas
}
