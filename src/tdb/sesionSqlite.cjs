// =============================================================================
// Sesión SQLite del proceso de sesión del explorador: misma interfaz que los demás trabajadores,
// despachada por `sesion.cjs`. Es TONTA: qué candado poner, si toca BEGIN o qué sentencia es lo
// decide el main y llega en `opciones`; la guardia la pone siempre `sqliteComun.cjs`. node:sqlite
// es síncrono: el Stop de una consola es matar su proceso, no `cancelar`.
// Sus errores, binds, filas y posición del error viven en `*SesionSqlite.cjs`.
// Decisiones: docs/decisiones/bd/trabajador-sqlite-sesion.md
// =============================================================================
'use strict'

const celdas = require('./celdas.cjs')
const comun = require('./sqliteComun.cjs')
const { ahora, ms } = require('./sesionTiempo.cjs')
const { codigoSqlite, errorProtocolo, esPerdida, normalizarError } = require('./erroresSesionSqlite.cjs')
const { valorDeBind, argumentosDe } = require('./bindsSesionSqlite.cjs')
const { posicionDelError } = require('./posicionSesionSqlite.cjs')
const { leerFilas } = require('./filasSesionSqlite.cjs')

/** SQLite no fija formatos de sesión (`formatosFijados` vacío en REGLAS). */
const SQL_FORMATOS = []

// --- Transacción -------------------------------------------------------------------------------

/**
 * Un valor escalar de una consulta interna, con el perfil de lectura (no escribe nada). La
 * sentencia se prepara UNA vez por conexión (`c.internas`) y se reutiliza: son hasta cuatro por
 * sentencia del usuario. Es seguro con la guardia: si el esquema cambia, SQLite la vuelve a
 * preparar al avanzar, y avanza con el perfil de lectura puesto (`conPerfil`).
 */
function escalar(c, sql) {
  if (!c.internas) c.internas = new Map()
  let stmt = c.internas.get(sql)
  if (!stmt) {
    const p = comun.prepararUna(c, sql, { perfil: 'lectura' })
    if (!p) return null
    p.stmt.setReturnArrays(true)
    stmt = p.stmt
    c.internas.set(sql, stmt)
  }
  return comun.conPerfil(c, 'lectura', () => {
    const fila = stmt.get()
    return fila ? fila[0] : null
  })
}

function totalCambios(s) {
  const v = escalar(s.c, 'SELECT total_changes()')
  return typeof v === 'bigint' ? Number(v) : Number(v || 0)
}

function versionEsquema(s) {
  const v = escalar(s.c, 'SELECT schema_version FROM pragma_schema_version')
  return typeof v === 'bigint' ? Number(v) : Number(v || 0)
}

/** Empieza a contar la transacción que acaba de abrirse (por un BEGIN nuestro o del usuario). */
function marcarInicio(s, cambios) {
  s.cambiosAlEmpezar = cambios
  s.ddlEnTx = false
}

/**
 * `isTransaction` (gratis) y, dentro de una, Δ`total_changes()` desde que empezó más una marca de
 * DDL (un DDL no cuenta en `total_changes`; sale de comparar `schema_version` antes y después).
 * Distingue 'abierta' (un BEGIN sin cambios, que ya retiene el bloqueo SHARED en cuanto lee) de
 * 'pendiente'. SQLite no deja una transacción «fallida»: 'fallida' no sale nunca.
 */
function estadoTx(s) {
  if (s.c.cerrada || !s.c.db.isTransaction) {
    s.cambiosAlEmpezar = null
    s.ddlEnTx = false
    return 'ninguna'
  }
  if (s.ddlEnTx) return 'pendiente'
  if (s.cambiosAlEmpezar === null) return 'pendiente'
  try {
    return totalCambios(s) - s.cambiosAlEmpezar > 0 ? 'pendiente' : 'abierta'
  } catch {
    // Lo prudente es no dar la transacción por vacía.
    return 'pendiente'
  }
}

/** Una sentencia de control (BEGIN, COMMIT, ROLLBACK) con el perfil de base. */
function control(s, sql) {
  comun.conPerfil(s.c, 'base', () => s.c.db.exec(sql))
}

// --- Interfaz de motor ---------------------------------------------------------------------

/**
 * Abre la base del registro (`con.archivo`, la ruta CANÓNICA que el main guardó; nunca una
 * de argv). `opciones`: { rol, autoCommit }. Sin secreto: SQLite no tiene credenciales.
 */
async function abrir(con, _secreto, _ctx, opciones) {
  const op = opciones || {}
  if (!con || typeof con.archivo !== 'string' || !con.archivo) {
    throw errorProtocolo('Falta el archivo de la base SQLite.', 'TESSERA-SQLITE-ARCHIVO')
  }
  const c = comun.abrirSqlite(con.archivo, { soloLectura: con.readonly !== false })
  const s = {
    motor: 'sqlite',
    c,
    txManual: op.autoCommit === false,
    cambiosAlEmpezar: null,
    ddlEnTx: false,
    cerrando: false
  }
  try {
    const version = escalar(c, 'SELECT sqlite_version()')
    return {
      sesion: s,
      respuesta: {
        modo: 'nativo',
        driverId: null,
        version: String(version || ''),
        esquema: 'main',
        usuario: null
      }
    }
  } catch (err) {
    comun.cerrarSqlite(c)
    throw err
  }
}

/**
 * El perfil de la guardia: 'explain' (no ejecuta nada, también en solo lectura), 'lectura'
 * (catálogo, candado de solo lectura, o conexión de solo lectura) o 'base' (escritura). Un EXPLAIN
 * escrito por el usuario en una consola de solo lectura se prepara con 'explain', como en `tdb`:
 * con 'lectura', el `EXPLAIN QUERY PLAN DELETE …` que el main deja pasar se rechazaría como una
 * escritura. El catálogo no escribe EXPLAIN: sigue en 'lectura'.
 */
function perfilDe(c, op, sql) {
  const catalogo = op.proposito === 'catalogo'
  const soloLeer = catalogo || op.candadoRO === true || c.soloLectura
  if (op.soloExplicar === true || (soloLeer && !catalogo && comun.empiezaPorExplain(sql))) return 'explain'
  return soloLeer ? 'lectura' : 'base'
}

/** Prepara la sentencia; si falla por sintaxis o nombres, anota en el error la posición (`__offsetCp`). */
function prepararConPosicion(c, sql, perfil) {
  try {
    return comun.prepararUna(c, sql, { perfil })
  } catch (err) {
    if (err && typeof err.errcode === 'number' && (err.errcode & 0xff) === 1) {
      try {
        const pos = posicionDelError(c, sql, String(err.message || ''))
        if (pos !== null) err.__offsetCp = pos
      } catch {
        // la posición es una ayuda
      }
    }
    throw err
  }
}

/**
 * Corre la sentencia preparada: lee filas o hace `run()`, cuyos `changes` solo son de ESTA sentencia
 * si es un DML (tras un DDL, `sqlite3_changes` sigue diciendo lo del último DML): por eso las
 * afectadas solo se informan con `esDml`, la pista del main.
 */
function correrSentencia(s, p, binds, op, d) {
  const c = s.c
  try {
    const args = argumentosDe(p.stmt, binds)
    if (p.lector) return leerFilas(s, p, args, op, d.topes, d.perfil)
    const correr = () => comun.conPerfil(c, d.perfil, () => p.stmt.run(...args))
    const r = p.vacuum ? comun.conVacuum(c, () => p.stmt.run(...args)) : correr()
    return op.esDml === true
      ? { tipo: 'afectadas', filas: Number(r.changes) || 0, comando: null, ms: ms(d.t0) }
      : { tipo: 'hecho', comando: null, ms: ms(d.t0) }
  } catch (err) {
    // La transacción que había (o la que abrió el BEGIN perezoso) desapareció con el error:
    // `INSERT OR ROLLBACK`, `RAISE(ROLLBACK)`…; el error lo dice en su detalle.
    if (err && typeof err === 'object' && d.enTxAlEmpezar && !c.cerrada && !c.db.isTransaction) err.__revertida = true
    throw err
  }
}

/** Sigue la transacción tras la sentencia: la que empezó AHORA cuenta desde aquí, y un DDL dentro de una es un cambio pendiente. */
function seguirTransaccion(s, perfil, d) {
  const c = s.c
  if (!d.enTxAlEmpezar && c.db.isTransaction) marcarInicio(s, d.cambiosAntes)
  if (perfil === 'base' && c.db.isTransaction) {
    try {
      if (versionEsquema(s) !== d.esquemaAntes) s.ddlEnTx = true
    } catch {
      s.ddlEnTx = true
    }
  }
}

/**
 * Lo que se lee antes de la sentencia para seguir la transacción (cambios y versión del esquema) y el
 * BEGIN perezoso del modo manual: `BEGIN DEFERRED` (no bloquea el archivo hasta que se lee o escribe
 * de verdad) antes de una sentencia del usuario si no hay transacción, salvo `sinBegin` (clase tx,
 * VACUUM, sondas).
 */
function empezarTransaccion(s, op, usuario, perfil) {
  const c = s.c
  const manual = typeof op.txManual === 'boolean' ? op.txManual : s.txManual
  const antesTx = c.db.isTransaction
  const cambiosAntes = usuario ? totalCambios(s) : 0
  const esquemaAntes = usuario && perfil === 'base' ? versionEsquema(s) : 0
  if (usuario && perfil === 'base' && manual && op.sinBegin !== true && !antesTx) {
    control(s, 'BEGIN DEFERRED')
    marcarInicio(s, cambiosAntes)
  }
  return { cambiosAntes, esquemaAntes, enTxAlEmpezar: c.db.isTransaction }
}

/** Ejecuta UNA sentencia (ver `OpcionesEjecucion` en protocoloTrabajador.ts). */
async function ejecutar(s, sql, binds, opciones) {
  const op = opciones || {}
  const c = s.c
  if (c.cerrada) throw comun.errorSqlite('CERRADA', 'La conexión SQLite está cerrada.')
  const topes = celdas.topesDe(op)
  const usuario = op.proposito !== 'catalogo'
  const perfil = perfilDe(c, op, sql)
  const seguimiento = empezarTransaccion(s, op, usuario, perfil)

  const t0 = ahora()
  const p = prepararConPosicion(c, sql, perfil)
  if (p === null) {
    return { tipo: 'hecho', comando: null, ms: ms(t0), tx: op.comprobarTx === false ? 'ninguna' : estadoTx(s) }
  }
  // ¿Solo comentarios, blancos y `;` detrás? La MISMA función que el lote de `tdb`.
  if (!comun.soloRelleno(p.cola)) {
    throw errorProtocolo('El trabajador de SQLite recibe una sola sentencia por petición.', 'TESSERA-VARIAS')
  }

  const resultado = correrSentencia(s, p, binds, op, { topes, perfil, t0, enTxAlEmpezar: seguimiento.enTxAlEmpezar })
  if (usuario) seguirTransaccion(s, perfil, seguimiento)
  if (op.leerEsquema) resultado.esquema = 'main'
  resultado.tx = op.comprobarTx === false && !c.db.isTransaction ? 'ninguna' : estadoTx(s)
  return resultado
}

/** SQLite no deja lectores abiertos: «más» es re-ejecutar con `saltarFilas` (lo decide el main). */
async function leer() {
  throw errorProtocolo('SQLite no mantiene lectores abiertos: vuelve a ejecutar con saltarFilas.', 'TESSERA-LECTOR')
}

async function cerrarLector() {
  return { cerrado: false }
}

/**
 * node:sqlite no se interrumpe: el Stop de SQLite lo hace el main MATANDO el proceso de esa
 * consola. Si esto llega, el proceso estaba libre: nada que parar.
 */
async function cancelar() {
  return { cancelada: false }
}

async function tx(s, accion) {
  const c = s.c
  if (c.cerrada) throw comun.errorSqlite('CERRADA', 'La conexión SQLite está cerrada.')
  if (accion === 'estado') return { tx: estadoTx(s) }
  if (c.db.isTransaction) {
    // En una conexión de solo lectura no hay transacción que resolver (el perfil de lectura
    // deniega BEGIN); si la hubiera, ROLLBACK es lo único que cabe.
    control(s, accion === 'commit' && !c.soloLectura ? 'COMMIT' : 'ROLLBACK')
  }
  return { tx: estadoTx(s) }
}

async function autoCommit(s, valor) {
  s.txManual = !valor
  return { autoCommit: Boolean(valor), tx: estadoTx(s) }
}

/** ROLLBACK + close. Nunca lanza: cerrar es la última línea de defensa. */
async function cerrar(s) {
  if (!s || !s.c || s.cerrando) return
  s.cerrando = true
  try {
    if (!s.c.cerrada && s.c.db.isTransaction) control(s, 'ROLLBACK')
  } catch {
    // se cierra igual: SQLite revierte al cerrar la conexión
  }
  comun.cerrarSqlite(s.c)
}

module.exports = {
  abrir,
  ejecutar,
  leer,
  cerrarLector,
  cancelar,
  tx,
  autoCommit,
  cerrar,
  esPerdida,
  normalizarError,
  valorDeBind,
  SQL_FORMATOS,
  // Para el test del adaptador.
  codigoSqlite,
  posicionDelError,
  argumentosDe
}
