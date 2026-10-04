// =============================================================================
// Lo común de SQLite para `tdb` y el trabajador del explorador (`sesionSqlite.cjs`): abrir un
// archivo con su guardia, preparar UNA sentencia, el relleno entre sentencias y crear una base
// nueva. Reexporta las piezas (`archivoSqlite`, `autorizadorSqlite`, `celdasSqlite`).
// La librería es `node:sqlite`, la de Electron: sin binarios, la misma en Windows y macOS.
// Decisiones: docs/decisiones/bd/adaptador-sqlite-apertura-y-autorizador.md
// =============================================================================

'use strict'

const fs = require('node:fs')
const archivo = require('./archivoSqlite.cjs')
const autorizadorSqlite = require('./autorizadorSqlite.cjs')
const celdasSqlite = require('./celdasSqlite.cjs')

const { errorSqlite, plataformaDelProceso, pathDe } = archivo
const { codigos, autorizador } = autorizadorSqlite

/** Espera a un bloqueo (`busy_timeout`) de toda conexión, en ms. */
const TIMEOUT_MS = 3000
/** Códigos PRIMARIOS de SQLite con los que `abrirSqlite` reabre en solo lectura. */
const READONLY = 8
const CANTOPEN = 14

/** El texto de VACUUM INTO, el MISMO en escritura y en solo lectura, aquí y en `MENSAJE_VACUUM_INTO` de `shared/sql/clasificarSql.ts`. */
const MENSAJE_VACUUM_INTO = 'VACUUM INTO escribe una copia de la base fuera de ella: en Tessera está cerrado siempre.'

/** Las columnas de `EXPLAIN QUERY PLAN` y de `EXPLAIN`: lo que hace de una sentencia un EXPLAIN. */
const COLUMNAS_EQP = Object.freeze(['id', 'parent', 'notused', 'detail'])
const COLUMNAS_EXPLAIN = Object.freeze(['addr', 'opcode', 'p1', 'p2', 'p3', 'p4', 'p5', 'comment'])

// --- Abrir ---------------------------------------------------------------------------------

/** Lanza si la ruta guardada, o un hermano suyo, pasa por un enlace simbólico. */
function comprobarEnlaces(ruta, nombre, plataforma, fsImpl) {
  const problemas = archivo.verificarRuta(ruta, { plataforma, fsImpl })
  if (problemas.length === 0) return
  const p = problemas[0]
  if (p.tipo === 'enlace') {
    throw errorSqlite('ENLACE', `«${pathDe(plataforma).basename(p.ruta)}» es un enlace simbólico: Tessera no abre una base a través de un enlace.`)
  }
  // La ruta real no va en el texto (llega al renderer): va aparte, en `real`.
  throw errorSqlite('RUTA-CAMBIADA', `La ruta de «${nombre}» ya no lleva al mismo archivo: ahora pasa por un enlace. Vuelve a elegir el archivo.`, { real: p.real })
}

/**
 * Comprueba que el runtime tiene la guardia (el constructor acepta opciones inventadas sin
 * avisar) y la pone: sin ella no se abre. Cierra ATTACH dos veces: `limits.attach` y el autorizador.
 */
function ponerGuardia(db, estado, C) {
  if (typeof db.setAuthorizer !== 'function' || !db.limits || typeof db.limits !== 'object') {
    throw errorSqlite('SIN-AUTORIZADOR', 'Este runtime de SQLite no tiene autorizador ni límites: Tessera no abre una base sin su guardia.')
  }
  db.limits.attach = 0
  if (db.limits.attach !== 0) throw errorSqlite('SIN-AUTORIZADOR', 'No se pudo cerrar ATTACH (limits.attach): Tessera no abre una base sin su guardia.')
  db.setAuthorizer(autorizador(estado, C))
}

/**
 * Una carpeta sin escritura (recurso de red de solo lectura, DMG) ABRE en escritura sin
 * quejarse y la primera consulta da SQLITE_CANTOPEN: en WAL, SQLite necesita crear `-shm`.
 * Se sondea con esa primera consulta; true si hay que reabrir en solo lectura, que en una
 * WAL sin `-wal` es la inmutable. Otro error se relanza.
 */
function debeReabrirSoloLectura(db) {
  try {
    db.prepare('SELECT 1 FROM sqlite_schema LIMIT 1').get()
    return false
  } catch (e) {
    const primario = e && typeof e.errcode === 'number' ? e.errcode & 0xff : null
    if (primario !== CANTOPEN && primario !== READONLY) throw e
    return true
  }
}

/**
 * Abre `ruta` con la guardia. Devuelve la CONEXIÓN de Tessera:
 *   { db, ruta, nombre, modo: 'normal'|'inmutable', soloLectura, perfilBase, estado, cerrada }
 * `perfilBase` es 'lectura' en solo lectura y 'base' en escritura: el que queda puesto
 * entre operaciones. Lanza con un error de Tessera (`codigo` 'TESSERA-SQLITE-…').
 * @param {string} ruta       la ruta GUARDADA (del registro; nunca de argv)
 * @param {object} [o]
 * @param {boolean} [o.soloLectura=true]
 * @param {string} [o.plataforma]
 * @param {object} [o.sqlite]  el módulo `node:sqlite` (inyectable en los tests)
 * @param {object} [o.fsImpl]
 */
function abrirSqlite(ruta, o = {}) {
  const soloLectura = o.soloLectura !== false
  const plataforma = o.plataforma || plataformaDelProceso()
  const fsImpl = o.fsImpl || fs
  const sqlite = o.sqlite || require('node:sqlite')
  const C = codigos(sqlite)

  const nombre = pathDe(plataforma).basename(ruta)
  comprobarEnlaces(ruta, nombre, plataforma, fsImpl)
  const i = archivo.inspeccionar(ruta, { plataforma, fsImpl })
  const d = archivo.decidirApertura({ nombre: i.nombre, cabecera: i.cabecera, tamano: i.tamano, hermanos: i.hermanos, soloLectura, plataforma })
  if (!d.ok) throw errorSqlite(d.codigo.replace(/^TESSERA-SQLITE-/, ''), d.mensaje)

  const uri = archivo.uriSqlite(ruta, { inmutable: d.modo === 'inmutable', plataforma })
  const db = new sqlite.DatabaseSync(uri, {
    readOnly: soloLectura,
    timeout: TIMEOUT_MS,
    limits: { attach: 0 },
    enableDoubleQuotedStringLiterals: true
  })
  try {
    const estado = { perfil: soloLectura ? 'lectura' : 'base', motivos: [], respaldo: o.respaldo === true }
    ponerGuardia(db, estado, C)
    // Solo con WAL: una base en rollback lee sin crear nada, y sondearla haría esperar el
    // `busy_timeout` en la apertura a toda base con un bloqueo exclusivo de otro proceso.
    if (!soloLectura && d.wal && o.respaldoSoloLectura !== false && debeReabrirSoloLectura(db)) {
      db.close()
      return abrirSqlite(ruta, { ...o, soloLectura: true, respaldo: true })
    }
    return {
      db,
      ruta,
      nombre,
      modo: d.modo,
      wal: d.wal,
      soloLectura,
      perfilBase: estado.perfil,
      estado,
      cerrada: false
    }
  } catch (e) {
    try {
      db.close()
    } catch {
      // ya cerrada
    }
    throw e
  }
}

/** Cierra la conexión (idempotente). */
function cerrarSqlite(con) {
  if (!con || con.cerrada) return
  con.cerrada = true
  try {
    con.db.close()
  } catch {
    // ya cerrada
  }
}

/**
 * Ejecuta `fn` con el perfil `perfil` puesto y deja el de base al salir (también si lanza).
 * Para una operación que PREPARA y además AVANZA con otro perfil (el EXPLAIN de una consola
 * de solo lectura): un cambio de esquema a mitad hace que SQLite vuelva a preparar, y
 * entonces manda el perfil que esté puesto.
 */
function conPerfil(con, perfil, fn) {
  const antes = con.estado.perfil
  con.estado.perfil = perfil
  try {
    return fn()
  } finally {
    con.estado.perfil = antes
  }
}

// --- Preparar UNA sentencia -----------------------------------------------------------------

function nombresDeColumnas(stmt) {
  return stmt.columns().map((c) => String(c.name).toLowerCase())
}

function esExplain(columnas) {
  const j = columnas.join(',')
  return j === COLUMNAS_EQP.join(',') || j === COLUMNAS_EXPLAIN.join(',')
}

/**
 * ¿Qué VACUUM hace el programa compilado de `sql`? 'into' (con destino: la instrucción
 * `Vacuum` con P2 ≠ 0), 'simple' o null (ninguno). VACUUM no pasa por el autorizador al
 * preparar, así que se mira el programa y no el texto.
 */
function vacuumDe(con, sql) {
  const plan = con.db.prepare('EXPLAIN ' + sql)
  let tipo = null
  for (const fila of plan.iterate()) {
    if (String(fila.opcode) === 'Vacuum') tipo = Number(fila.p2) !== 0 ? 'into' : tipo === 'into' ? 'into' : 'simple'
  }
  return tipo
}

function mensajeNoPermitido(perfil, motivo, respaldo = false) {
  if (perfil === 'lectura' && respaldo) {
    return `La base se abrió en solo lectura porque su carpeta no admite escritura: no se permite ${motivo}.`
  }
  if (perfil === 'lectura') return `La conexión es de solo lectura: no se permite ${motivo}.`
  return `Tessera no permite ${motivo} en SQLite.`
}

/** Lanza si `perfil` no existe o pide más de lo que da una conexión de solo lectura. */
function validarPerfil(con, perfil) {
  if (perfil !== 'lectura' && perfil !== 'base' && perfil !== 'explain') {
    throw errorSqlite('NO-PERMITIDO', `Perfil de la guardia desconocido: «${String(perfil)}».`)
  }
  // El perfil de base (escritura) solo existe en una conexión abierta para escribir.
  if (con.soloLectura && perfil === 'base') {
    throw errorSqlite('NO-PERMITIDO', 'La conexión es de solo lectura.')
  }
}

/** Prepara `texto` con el perfil puesto; lo que deniega el autorizador sale como TESSERA-SQLITE-NO-PERMITIDO. */
function prepararConGuardia(con, texto, perfil) {
  con.estado.motivos = []
  try {
    return conPerfil(con, perfil, () => con.db.prepare(texto))
  } catch (e) {
    // Lo denegó el autorizador: errcode 23 (SQLITE_AUTH), o el error que SQLite da cuando la
    // denegación es de una FUNCIÓN («not authorized to use function», errcode 1). En los dos
    // casos el autorizador apuntó su motivo.
    if (e && (e.errcode === 23 || con.estado.motivos.length > 0)) {
      const motivo = con.estado.motivos.length > 0 ? con.estado.motivos.join(', ') : 'la sentencia'
      throw errorSqlite('NO-PERMITIDO', mensajeNoPermitido(perfil, motivo, con.estado.respaldo), { motivos: con.estado.motivos.slice() })
    }
    throw e
  }
}

/** ¿Es VACUUM INTO el texto, mirando su programa con `perfil`? Un fallo al mirarlo se calla: se rechaza igual. */
function esVacuumInto(con, sql, perfil) {
  try {
    return /vacuum/i.test(sql) && conPerfil(con, perfil, () => vacuumDe(con, sql)) === 'into'
  } catch {
    return false
  }
}

/**
 * Separa la sentencia preparada del resto del texto: si `sourceSQL` no es el principio del
 * texto no se sabe dónde empieza la cola y falla cerrado (perder el resto en silencio es lo
 * que se evita).
 */
function separarCola(stmt, texto) {
  const sql = typeof stmt.sourceSQL === 'string' ? stmt.sourceSQL : ''
  if (sql === '' || !texto.startsWith(sql)) {
    throw errorSqlite('COLA', 'No se pudo separar la sentencia del resto del texto.')
  }
  return { sql, cola: texto.slice(sql.length) }
}

/** El VACUUM de una sentencia con el perfil de escritura ('into', 'simple' o null); solo mira el programa si el texto dice «vacuum». */
function vacuumDeEscritura(con, perfil, explain, sql) {
  if (perfil !== 'base' || explain || !/vacuum/i.test(sql)) return null
  return conPerfil(con, 'base', () => vacuumDe(con, sql))
}

/** Rechaza en lectura lo que no devuelve columnas; un VACUUM INTO dice lo mismo que en escritura. */
function rechazarNoConsulta(con, sql) {
  if (esVacuumInto(con, sql, 'lectura')) throw errorSqlite('NO-PERMITIDO', MENSAJE_VACUUM_INTO)
  throw errorSqlite('NO-PERMITIDO', mensajeNoPermitido('lectura', 'una sentencia que no es una consulta', con.estado.respaldo))
}

/**
 * Prepara la PRIMERA sentencia de `texto` con la guardia del perfil (el de base de la
 * conexión si no se dice: 'lectura', 'base' o 'explain'). Devuelve
 * `{ stmt, sql, cola, lector, vacuum }`, o null si `texto` no tiene nada que preparar. `sql`
 * es el texto de ESA sentencia (con sus comentarios y su `;`), `cola` lo que va detrás,
 * `lector` si devuelve columnas y `vacuum` si es un VACUUM a secas (que se ejecuta DENTRO de
 * `conVacuum`). `stmt` ya lleva `readBigInts`. Lanza TESSERA-SQLITE-NO-PERMITIDO con el
 * motivo si la guardia la rechaza. `prepare()` ignora en silencio lo que va tras el primer
 * `;`: quien ejecute un lote prepara la cola otra vez, sentencia a sentencia.
 */
function prepararUna(con, texto, opciones = {}) {
  if (!con || con.cerrada) throw errorSqlite('CERRADA', 'La conexión SQLite está cerrada.')
  if (typeof texto !== 'string' || texto.trim() === '') return null
  const perfil = opciones.perfil || con.perfilBase
  validarPerfil(con, perfil)
  const stmt = prepararConGuardia(con, texto, perfil)
  const { sql, cola } = separarCola(stmt, texto)
  const columnas = nombresDeColumnas(stmt)
  const lector = columnas.length > 0
  // Sin columnas solo llega aquí en lectura lo que no pasa por el autorizador: VACUUM.
  if (perfil === 'lectura' && !lector) rechazarNoConsulta(con, sql)
  const explain = esExplain(columnas)
  if (perfil === 'explain' && !explain) {
    throw errorSqlite('NO-PERMITIDO', 'Con el perfil de explicar solo se preparan EXPLAIN y EXPLAIN QUERY PLAN.')
  }
  // Un EXPLAIN no se mira: no ejecuta nada y anteponerle otro EXPLAIN es un error de sintaxis.
  const vacuum = vacuumDeEscritura(con, perfil, explain, sql)
  if (vacuum === 'into') throw errorSqlite('NO-PERMITIDO', MENSAJE_VACUUM_INTO)
  if (typeof stmt.setReadBigInts === 'function') stmt.setReadBigInts(true)
  return { stmt, sql, cola, lector, vacuum: vacuum === 'simple' }
}

// --- El relleno entre sentencias ---------------------------------------------------------

/** Los blancos de SQLite (`sqlite3Isspace`): NO los de Unicode (un NBSP es un error de sintaxis). */
function esBlancoSqlite(c) {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f'
}

/**
 * La posición del primer carácter de `texto` (desde `i`) que no es relleno —blancos,
 * `;`, `-- …` hasta el fin de línea, `/* … *\/`—, o -1 si hay un comentario de bloque SIN
 * CERRAR. Recorre de IZQUIERDA A DERECHA, como el tokenizador de SQLite: lo que abre primero
 * manda, así que en `/* a -- b *\/` el `--` es texto del bloque y en `-- a /* b` el `/*` es
 * texto de la línea.
 */
function saltarRelleno(texto, desde = 0) {
  const t = String(texto || '')
  let i = desde
  while (i < t.length) {
    const c = t[i]
    if (c === ';' || esBlancoSqlite(c)) {
      i++
    } else if (c === '-' && t[i + 1] === '-') {
      const fin = t.indexOf('\n', i + 2)
      i = fin < 0 ? t.length : fin + 1
    } else if (c === '/' && t[i + 1] === '*') {
      const fin = t.indexOf('*/', i + 2)
      // Sin cerrar: no se da por relleno (quien llama lo prepara y SQLite dirá lo suyo).
      if (fin < 0) return -1
      i = fin + 2
    } else {
      return i
    }
  }
  return t.length
}

/** ¿Solo blancos, comentarios y `;`? (La cola de `prepararUna`, el final de un lote.) */
function soloRelleno(texto) {
  const t = String(texto || '')
  return saltarRelleno(t, 0) === t.length
}

/** ¿La sentencia EMPIEZA por EXPLAIN, tras blancos, comentarios y `;`? */
function empiezaPorExplain(texto) {
  const t = String(texto || '')
  const i = saltarRelleno(t, 0)
  return i >= 0 && /^explain\b/i.test(t.slice(i, i + 8))
}

/**
 * Ejecuta `fn` (el `run()` de un VACUUM a secas que `prepararUna` marcó con `vacuum: true`)
 * con lo que VACUUM necesita y nada más: SQLite lo hace con un ATTACH INTERNO de una base
 * temporal SIN archivo (`ATTACH '' AS vacuum_…`). Durante `fn`: el perfil 'vacuum' (deja
 * pasar ESE ATTACH, con nombre de archivo vacío, y nada más) y `limits.attach = 1`; al salir,
 * los de siempre, también si lanza. Solo en una conexión de escritura. Un VACUUM INTO nunca
 * llega aquí: su ATTACH lleva el destino y el autorizador lo deniega igual.
 */
function conVacuum(con, fn) {
  if (con.soloLectura) throw errorSqlite('NO-PERMITIDO', 'La conexión es de solo lectura.')
  const antes = con.estado.perfil
  con.estado.perfil = 'vacuum'
  con.db.limits.attach = 1
  try {
    return fn()
  } finally {
    con.db.limits.attach = 0
    con.estado.perfil = antes
  }
}

// --- Crear una base nueva ---------------------------------------------------------------------

/**
 * Crea una base SQLite NUEVA y VACÍA en `ruta`: nunca encima de un archivo que exista (`wx`,
 * atómico), con la cabecera escrita (un `PRAGMA user_version = 0` sobre la base recién
 * creada) y el autorizador puesto también en esta conexión. Deja el archivo en modo rollback,
 * sin hermanos. Lanza TESSERA-SQLITE-YA-EXISTE o el error de E/S. Si falla DESPUÉS de crear el
 * archivo lo BORRA (un `.db` de 0 bytes es lo que la apertura rechaza como «vacío»): solo el
 * `.db`, que es lo único que se sabe creado aquí; un `-journal` de al lado puede ser de otro.
 */
function crearBaseNueva(ruta, o = {}) {
  const fsImpl = o.fsImpl || fs
  const sqlite = o.sqlite || require('node:sqlite')
  const plataforma = o.plataforma || plataformaDelProceso()
  const C = codigos(sqlite)
  let fd
  try {
    fd = fsImpl.openSync(ruta, 'wx')
  } catch (e) {
    if (e && e.code === 'EEXIST') throw errorSqlite('YA-EXISTE', `Ya existe «${pathDe(plataforma).basename(ruta)}»: Tessera no crea una base encima de otro archivo.`)
    if (e && (e.code === 'EPERM' || e.code === 'EACCES')) throw errorSqlite('PERMISO', archivo.mensajePermiso(pathDe(plataforma).basename(ruta), plataforma))
    throw e
  }
  fsImpl.closeSync(fd)
  try {
    const db = new sqlite.DatabaseSync(ruta, { timeout: TIMEOUT_MS, limits: { attach: 0 } })
    try {
      if (typeof db.setAuthorizer !== 'function') throw errorSqlite('SIN-AUTORIZADOR', 'Este runtime de SQLite no tiene autorizador.')
      db.setAuthorizer(autorizador({ perfil: 'base', motivos: [] }, C))
      // La cabecera se escribe con una transacción que no deja nada (el `user_version` a 0
      // escribe la página 1).
      db.exec('PRAGMA user_version = 0')
    } finally {
      db.close()
    }
  } catch (e) {
    try {
      fsImpl.unlinkSync(ruta)
    } catch {
      // Se dice el error de verdad, no el de limpiar.
    }
    throw e
  }
}

module.exports = {
  MAGIA_SQLITE: archivo.MAGIA_SQLITE,
  LARGO_CABECERA: archivo.LARGO_CABECERA,
  TIMEOUT_MS,
  SUFIJOS_AUXILIARES: archivo.SUFIJOS_AUXILIARES,
  PRAGMAS_LECTURA: autorizadorSqlite.PRAGMAS_LECTURA,
  FUNCIONES_PROHIBIDAS: autorizadorSqlite.FUNCIONES_PROHIBIDAS,
  PRAGMAS_PROHIBIDOS: autorizadorSqlite.PRAGMAS_PROHIBIDOS,
  MENSAJE_VACUUM_INTO,
  errorSqlite,
  plataformaDelProceso,
  baseDeAuxiliar: archivo.baseDeAuxiliar,
  esUnc: archivo.esUnc,
  raizDeVolumen: archivo.raizDeVolumen,
  volumenDesconectado: archivo.volumenDesconectado,
  mensajeDesconectado: archivo.mensajeDesconectado,
  saltarRelleno,
  soloRelleno,
  empiezaPorExplain,
  uriSqlite: archivo.uriSqlite,
  analizarCabecera: archivo.analizarCabecera,
  decidirApertura: archivo.decidirApertura,
  mensajeNoSqlite: archivo.mensajeNoSqlite,
  mensajePermiso: archivo.mensajePermiso,
  inspeccionar: archivo.inspeccionar,
  verificarRuta: archivo.verificarRuta,
  autorizador,
  abrirSqlite,
  cerrarSqlite,
  conPerfil,
  conVacuum,
  prepararUna,
  textoReal: celdasSqlite.textoReal,
  celdaSqlite: celdasSqlite.celdaSqlite,
  filaSqlite: celdasSqlite.filaSqlite,
  tipoLogicoSqlite: celdasSqlite.tipoLogicoSqlite,
  columnasSqlite: celdasSqlite.columnasSqlite,
  crearBaseNueva
}
