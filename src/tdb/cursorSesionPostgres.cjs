// =============================================================================
// Lectura de resultados de la sesión PostgreSQL con `pg-cursor`: toda sentencia de usuario lee
// `n+1` filas y cierra el cursor en el acto (sin portal ni snapshot abiertos), salvo el cursor
// vivo de una exportación. Depende de `celdas.cjs` y `clienteSesionPostgres.cjs`; lo usa
// `sesionPostgres.cjs`. `pg-cursor` se carga al ejecutar.
// Decisiones: docs/decisiones/bd/sesiones-exportar-con-cursor-vivo.md
// =============================================================================
'use strict'

const celdas = require('./celdas.cjs')
const { ahora, ms } = require('./sesionTiempo.cjs')
const { interna, estadoCliente, rollbackSeguro, esperarCancel } = require('./clienteSesionPostgres.cjs')

/** Etiquetas de comando que cuentan filas afectadas. */
const COMANDOS_AFECTADAS = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'SELECT', 'COPY', 'MOVE', 'FETCH'])
const COMANDOS_DML = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE'])
/** Filas por viaje al descartar con `saltarFilas`. */
const BLOQUE_SALTO = 5000

/** `cursor.read` con la forma de callback, que es la que entrega `result.fields`. */
function leerCursor(cursor, n) {
  return new Promise((resolve, reject) => {
    cursor.read(n, (err, filas, result) => (err ? reject(err) : resolve({ filas: filas || [], result })))
  })
}

/** Nombres de tipos de usuario (enums, dominios…), una vez por OID y sesión. */
async function resolverTipos(s, fields) {
  const faltan = []
  for (const f of fields) {
    if (celdas.oidDesconocidoPg(f.dataTypeID) && !s.nombresTipo.has(f.dataTypeID)) faltan.push(f.dataTypeID)
  }
  if (faltan.length === 0 || estadoCliente(s) === 'E') return
  try {
    const r = await interna(s, 'SELECT oid::int, format_type(oid, NULL) FROM pg_type WHERE oid = ANY($1::oid[])', [faltan])
    for (const [oid, nombre] of r.rows) s.nombresTipo.set(Number(oid), String(nombre))
  } catch {
    // Solo es el tooltip de la cabecera.
  }
}

function sinResultado(result, t0) {
  const comando = result && result.command ? String(result.command) : null
  if (comando && COMANDOS_AFECTADAS.has(comando)) {
    return { tipo: 'afectadas', filas: Number(result.rowCount) || 0, comando, ms: ms(t0) }
  }
  return { tipo: 'hecho', comando, ms: ms(t0) }
}

/** Convierte hasta `maxFilas` filas al formato del protocolo; `cortada` si el tope de respuesta las cortó antes. */
function acumularFilas(filas, oids, topes, maxFilas, quitarUltima) {
  const acc = new celdas.AcumuladorPagina(topes.topeRespuesta)
  const tope = Math.min(filas.length, maxFilas)
  let cortada = false
  for (let i = 0; i < tope; i++) {
    const fila = quitarUltima ? filas[i].slice(0, -1) : filas[i]
    const f = celdas.filaPg(fila, oids, topes)
    if (!acc.agregar(f.celdas, f.recortes)) {
      cortada = true
      break
    }
  }
  return { acc, cortada }
}

// --- Cursor vivo (SOLO exportar) -------------------------------------------------------------

/**
 * Un cursor que sigue abierto ENTRE lecturas. Solo lo pide exportar una consulta
 * (`mantenerCursor`): re-ejecutar por páginas sería O(n²) y cambiaría lo que se lee si la tabla
 * cambia a mitad. Su precio es un portal suspendido, el `Client` ocupado y la sesión *idle in
 * transaction* (expuesta a `idle_in_transaction_session_timeout`, 25P03), y por eso vive SOLO
 * mientras dura la exportación, con la consola ocupada: el main lo cierra siempre al acabar, al
 * cancelar o al fallar. Uno por sesión. Si la conexión es de solo lectura, el ROLLBACK del
 * envoltorio se aplaza hasta cerrarlo.
 */
function paginaCursorVivo(v, maxFilas) {
  const tomar = v.pendiente.splice(0, maxFilas)
  const acc = new celdas.AcumuladorPagina(v.topes.topeRespuesta)
  let i = 0
  for (; i < tomar.length; i++) {
    const f = celdas.filaPg(tomar[i], v.oids, v.topes)
    if (!acc.agregar(f.celdas, f.recortes)) break
  }
  if (i < tomar.length) v.pendiente = tomar.slice(i).concat(v.pendiente)
  const pagina = { filasJson: acc.json(), nFilas: acc.n, hayMas: v.pendiente.length > 0 }
  if (acc.recortes.length) pagina.recortes = acc.recortes
  return pagina
}

async function llenarCursorVivo(v, maxFilas) {
  const necesito = maxFilas + 1 - v.pendiente.length
  if (necesito <= 0 || v.agotado) return null
  const r = await leerCursor(v.cursor, necesito)
  for (const f of r.filas) v.pendiente.push(f)
  if (r.filas.length < necesito) v.agotado = true
  return r.result
}

/** Cierra el cursor vivo y deshace el envoltorio de solo lectura. Nunca lanza. */
async function cerrarCursorVivo(s) {
  const v = s.cursorVivo
  if (!v) return false
  s.cursorVivo = null
  await esperarCancel(s)
  try {
    await v.cursor.close()
  } catch {
    // tras un error el cursor ya mandó su Sync: no queda portal que cerrar
  }
  if (v.envuelto && !s.perdida) {
    try {
      await rollbackSeguro(s)
    } catch {
      // el cierre de la sesión revierte igual
    }
  }
  return true
}

async function ejecutarCursorVivo(s, sql, binds, opciones, topes, envuelto) {
  const Cursor = require('pg-cursor')
  const t0 = ahora()
  const cursor = s.cliente.query(new Cursor(sql, binds || null, { rowMode: 'array', types: celdas.TIPOS_CRUDOS_PG }))
  const v = { id: opciones.lector || 'cursor', cursor, pendiente: [], agotado: false, oids: [], topes, envuelto }
  try {
    const ultimo = await llenarCursorVivo(v, opciones.maxFilas)
    const msEjecucion = ms(t0)
    const fields = (ultimo && ultimo.fields) || []
    if (fields.length === 0) {
      await cursor.close()
      return sinResultado(ultimo, t0)
    }
    v.oids = fields.map((f) => f.dataTypeID)
    const t1 = ahora()
    const pagina = paginaCursorVivo(v, opciones.maxFilas)
    // Sin `resolverTipos`: con el portal abierto, esa consulta esperaría detrás del propio
    // cursor. El nombre del tipo de usuario solo es el tooltip de la cabecera.
    const resultado = {
      tipo: 'filas',
      columnas: celdas.columnasPg(fields, s.nombresTipo),
      filasJson: pagina.filasJson,
      nFilas: pagina.nFilas,
      hayMas: pagina.hayMas,
      lector: pagina.hayMas ? v.id : null,
      comando: ultimo && ultimo.command ? String(ultimo.command) : null,
      msEjecucion,
      msLectura: ms(t1)
    }
    if (pagina.recortes) resultado.recortes = pagina.recortes
    if (pagina.hayMas) s.cursorVivo = v
    else await cursor.close()
    return resultado
  } catch (err) {
    try {
      await cursor.close()
    } catch {
      // el error original es el que importa
    }
    throw err
  }
}

// --- Cursor de una sola lectura ----------------------------------------------------------------

/** Descarta `saltar` filas del cursor (`saltarFilas`), anotando en `est` lo leído y si se agotó. */
async function saltarEnCursor(cursor, saltar, est) {
  while (est.saltadas < saltar) {
    const n = Math.min(BLOQUE_SALTO, saltar - est.saltadas)
    const r = await leerCursor(cursor, n)
    est.ultimo = r.result || est.ultimo
    est.saltadas += r.filas.length
    if (r.filas.length < n) {
      est.agotado = true
      break
    }
  }
}

/** El resultado con filas de una lectura ya cerrada: columnas, página y, con RETURNING, el total afectado. */
async function resultadoConFilas(s, d) {
  const { est, filas, fields, opciones, topes } = d
  const t1 = ahora()
  await resolverTipos(s, fields)
  let columnas = celdas.columnasPg(fields, s.nombresTipo)
  let oids = fields.map((f) => f.dataTypeID)
  const quitar = opciones.quitarUltimaColumna === true
  if (quitar) {
    columnas = columnas.slice(0, -1)
    oids = oids.slice(0, -1)
  }
  const { acc, cortada } = acumularFilas(filas, oids, topes, opciones.maxFilas, quitar)
  const ultimo = est.ultimo
  const comando = ultimo && ultimo.command ? String(ultimo.command) : null
  const resultado = {
    tipo: 'filas',
    columnas,
    filasJson: acc.json(),
    nFilas: acc.n,
    hayMas: cortada || filas.length > opciones.maxFilas,
    lector: null,
    comando,
    msEjecucion: d.msEjecucion,
    msLectura: ms(t1)
  }
  if (acc.recortes.length) resultado.recortes = acc.recortes
  if (d.saltar) resultado.saltadas = est.saltadas
  // RETURNING: el total solo se sabe si la sentencia terminó en esta página.
  if (est.agotado && comando && COMANDOS_DML.has(comando) && ultimo.rowCount !== null && ultimo.rowCount !== undefined) {
    resultado.afectadas = Number(ultimo.rowCount)
  }
  return resultado
}

async function ejecutarCursor(s, sql, binds, opciones, topes) {
  const Cursor = require('pg-cursor')
  const t0 = ahora()
  const cursor = s.cliente.query(new Cursor(sql, binds || null, { rowMode: 'array', types: celdas.TIPOS_CRUDOS_PG }))
  const est = { ultimo: null, saltadas: 0, agotado: false }
  const saltar = Number.isInteger(opciones.saltarFilas) && opciones.saltarFilas > 0 ? opciones.saltarFilas : 0
  try {
    if (saltar > 0) await saltarEnCursor(cursor, saltar, est)
    const pedir = opciones.maxFilas + 1
    let filas = []
    if (!est.agotado) {
      const r = await leerCursor(cursor, pedir)
      est.ultimo = r.result || est.ultimo
      filas = r.filas
      est.agotado = filas.length < pedir
    }
    const msEjecucion = ms(t0)
    // Cerrar YA: ni portal ni snapshot abiertos.
    await cursor.close()
    const fields = (est.ultimo && est.ultimo.fields) || []
    if (fields.length === 0) {
      const r = sinResultado(est.ultimo, t0)
      if (saltar) r.saltadas = est.saltadas
      return r
    }
    return await resultadoConFilas(s, { est, filas, fields, opciones, topes, msEjecucion, saltar })
  } catch (err) {
    try {
      await cursor.close()
    } catch {
      // el error original es el que importa
    }
    throw err
  }
}

async function ejecutarCatalogo(s, sql, binds, opciones, topes) {
  const t0 = ahora()
  const res = await interna(s, sql, binds || undefined)
  const msEjecucion = ms(t0)
  if (!res.fields || res.fields.length === 0) return sinResultado(res, t0)
  const t1 = ahora()
  const filas = res.rows || []
  const oids = res.fields.map((f) => f.dataTypeID)
  const { acc, cortada } = acumularFilas(filas, oids, topes, opciones.maxFilas, false)
  return {
    tipo: 'filas',
    columnas: celdas.columnasPg(res.fields, s.nombresTipo),
    filasJson: acc.json(),
    nFilas: acc.n,
    hayMas: cortada || filas.length > opciones.maxFilas,
    lector: null,
    comando: res.command ? String(res.command) : null,
    msEjecucion,
    msLectura: ms(t1)
  }
}

module.exports = {
  paginaCursorVivo,
  llenarCursorVivo,
  cerrarCursorVivo,
  ejecutarCursorVivo,
  ejecutarCursor,
  ejecutarCatalogo
}
