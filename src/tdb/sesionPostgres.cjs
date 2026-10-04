// =============================================================================
// Sesión PostgreSQL del proceso de sesión del explorador: misma interfaz que los demás
// trabajadores (abrir, ejecutar, leer, cerrarLector, cancelar, tx, autoCommit, cerrar,
// esPerdida, normalizarError), despachada por `sesion.cjs`. Es TONTA: qué candado poner, si toca
// BEGIN o si algo es releíble lo decide el main y llega en `opciones`.
// Sus errores, formatos, lectura de resultados y salida viven en `*SesionPostgres.cjs`.
// Decisiones: docs/decisiones/bd/trabajador-postgres-sesion.md
// =============================================================================
'use strict'

const celdas = require('./celdas.cjs')
const { ahora, ms } = require('./sesionTiempo.cjs')
const { esPerdida, normalizarError } = require('./erroresSesionPostgres.cjs')
const { SQL_FORMATOS, N_FORMATOS, SQL_ABRIR, vigilarFormatos } = require('./formatosSesionPostgres.cjs')
const { interna, estadoCliente, rollbackSeguro, estadoTx, esperarCancel, enviarCancelRequest } = require('./clienteSesionPostgres.cjs')
const { escucharSalida } = require('./salidaSesionPostgres.cjs')
const {
  paginaCursorVivo,
  llenarCursorVivo,
  cerrarCursorVivo,
  ejecutarCursorVivo,
  ejecutarCursor,
  ejecutarCatalogo
} = require('./cursorSesionPostgres.cjs')

const { textoONulo } = celdas

// --- Interfaz de motor ---------------------------------------------------------------------

function nuevaSesion(op, ganchos) {
  return {
    motor: 'postgres',
    cliente: null,
    txManual: op.autoCommit === false,
    enCursoUsuario: false,
    cancelPedido: false,
    cancelEnVuelo: null,
    perdida: false,
    cerrando: false,
    cursorVivo: null,
    nombresTipo: new Map(),
    // Formatos fijados que un ParameterStatus dice apartados: se refijan tras la sentencia.
    apartados: new Set(),
    ganchos: ganchos || {}
  }
}

/**
 * Abre una sesión. `opciones`: { rol, timeoutMs, autoCommit, accion }.
 * `ganchos.alPerder(errorTrabajador)`: la sesión murió estando ociosa. `alError` va al
 * constructor del `Client` (ver `postgres.cjs`): un backend terminado con la sesión ociosa emite
 * 'error' y, sin oyente, tumbaba el proceso.
 */
async function abrir(con, secreto, ctx, opciones, ganchos) {
  const postgres = require('./postgres.cjs')
  const op = opciones || {}
  const s = nuevaSesion(op, ganchos)
  const alPerder = (err) => {
    if (s.cerrando || s.perdida) return
    s.perdida = true
    const e = normalizarError(err)
    e.clase = 'perdida'
    if (typeof s.ganchos.alPerder === 'function') s.ganchos.alPerder(e)
  }
  const accion = op.accion || op.rol || 'explorador'
  const r = await postgres.abrir(con, secreto, ctx, {
    statement_timeout: Number.isInteger(op.timeoutMs) && op.timeoutMs > 0 ? op.timeoutMs : 0,
    // NAMEDATALEN: el servidor corta en 63 bytes; mejor cortar aquí y saberlo.
    application_name: `Tessera/explorador ${accion} ${ctx.usuarioWindows}@${con.alias}`.slice(0, 63),
    keepAlive: true,
    keepAliveInitialDelayMillis: 30_000,
    alError: alPerder
  })
  s.cliente = r.conexion
  s.cliente.on('end', () => alPerder(new Error('Connection terminated unexpectedly')))
  vigilarFormatos(s)
  try {
    const info = await interna(s, SQL_ABRIR)
    const fila = info.rows[0] || []
    // Los que el servidor informó al conectar (los de la base o el rol) ya están fijados.
    s.apartados.clear()
    return {
      sesion: s,
      respuesta: {
        modo: 'nativo',
        driverId: null,
        version: String(fila[N_FORMATOS + 2] || ''),
        esquema: textoONulo(fila[N_FORMATOS]),
        usuario: textoONulo(fila[N_FORMATOS + 1]),
        pidServidor: s.cliente.processID
      }
    }
  } catch (err) {
    await cerrar(s)
    throw err
  }
}

/** `{ entrada: 'clob' | 'nclob' | 'nvarchar' | 'char', valor }` (cosa de Oracle) -> su valor; lo demás, tal cual. */
function valorDeBind(v) {
  if (
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    (v.entrada === 'clob' || v.entrada === 'nclob' || v.entrada === 'nvarchar' || v.entrada === 'char')
  ) {
    return v.valor === undefined ? null : v.valor
  }
  return v
}

/** Los binds son posicionales; un bind de entrada de LOB se reduce a su valor (un `text` no tiene el tope de 4000 bytes). */
function prepararBinds(binds) {
  if (binds !== undefined && binds !== null && !Array.isArray(binds)) {
    const e = new Error('PostgreSQL solo admite binds posicionales ($1, $2…).')
    e.code = 'TESSERA-BINDS'
    e.__protocolo = true
    throw e
  }
  return Array.isArray(binds) ? binds.map(valorDeBind) : binds
}

/** Vuelve a fijar los formatos de Tessera. Si falla, queda el rechazo del main: esto es la segunda capa. */
async function refijarFormatos(s) {
  try {
    await interna(s, SQL_FORMATOS)
  } catch {
    // ver arriba
  }
}

/** Una sesión de solo lectura no debería estar nunca en una tx; si lo está, no hay nada que perder y el envoltorio empieza limpio. */
async function empezarEnvoltorio(s) {
  if (estadoCliente(s) !== 'I') await rollbackSeguro(s)
  await interna(s, 'BEGIN READ ONLY')
}

/** Corre la sentencia por el camino que le toca: cursor vivo (exportar), cursor de usuario o catálogo. */
function ejecutarSegunModo(s, sql, binds, op, topes, m) {
  if (m.vivo) return ejecutarCursorVivo(s, sql, binds, op, topes, m.envolver)
  if (m.usuario) return ejecutarCursor(s, sql, binds, op, topes)
  return ejecutarCatalogo(s, sql, binds, op, topes)
}

async function leerEsquemaActual(s, resultado) {
  try {
    const r = await interna(s, 'SELECT current_schema()')
    resultado.esquema = textoONulo(r.rows[0][0])
  } catch {
    resultado.esquema = null
  }
}

/** Lo que se hace tras una ejecución buena: refijar formatos apartados, leer el esquema y el estado de la tx. */
async function terminarEjecucion(s, op, resultado) {
  // Con el portal abierto, cualquier consulta más esperaría detrás del cursor: ni formatos, ni
  // esquema, ni la sonda exacta de la transacción.
  if (s.cursorVivo) {
    resultado.tx = await estadoTx(s, false)
    return resultado
  }
  // `apartados`: la sentencia cambió un formato fijado por un camino que el main no ve
  // (`SELECT set_config(…)`, una función), y el servidor lo informó.
  if ((op.refijarFormatos || s.apartados.size > 0) && estadoCliente(s) !== 'E') await refijarFormatos(s)
  if (op.leerEsquema) {
    if (estadoCliente(s) === 'E') resultado.esquema = null
    else await leerEsquemaActual(s, resultado)
  }
  resultado.tx = await estadoTx(s, op.comprobarTx !== false)
  return resultado
}

/**
 * Lo que se hace antes de la sentencia: cerrar un cursor de exportación olvidado (bloquearía el
 * `Client`: nada corre detrás de él), esperar un cancel en vuelo y la segunda barrera de los
 * formatos. Lo normal es refijar tras la sentencia que apartó el formato, pero hay caminos que se
 * lo saltan (un cursor vivo de exportación cuyo ParameterStatus llega al cerrarlo; una sentencia
 * que el servidor completó y que falla después) y dejarían correr ESTA con el valor ajeno. En 'E'
 * no se puede ni hace falta: solo corre el ROLLBACK.
 */
async function antesDeEjecutar(s) {
  if (s.cursorVivo) await cerrarCursorVivo(s)
  await esperarCancel(s)
  s.cancelPedido = false
  if (s.apartados.size > 0 && estadoCliente(s) !== 'E') await refijarFormatos(s)
}

/** Cómo se ejecuta: de usuario o catálogo, envuelta en `BEGIN READ ONLY … ROLLBACK`, en modo manual y con o sin cursor vivo (exportar). */
function modoDe(s, op) {
  const usuario = op.proposito !== 'catalogo'
  return {
    usuario,
    envolver: op.candadoRO === true && op.fueraDeEnvoltorio !== true,
    manual: typeof op.txManual === 'boolean' ? op.txManual : s.txManual,
    vivo: usuario && op.mantenerCursor === true
  }
}

/** MODO MANUAL = `BEGIN` perezoso si el estado es 'I', salvo `sinBegin` (clase tx, VACUUM y compañía, contar, releer, sondas). */
function necesitaBegin(s, op, manual) {
  return manual && op.sinBegin !== true && estadoCliente(s) === 'I'
}

/**
 * Tras la sentencia: espera un cancel tardío (no debe caer en el ROLLBACK ni en la sonda), deshace
 * el envoltorio de solo lectura (con el cursor vivo espera a que se cierre) y devuelve el
 * resultado o lanza el fallo con la salida del servidor colgada.
 */
async function cerrarEjecucion(s, op, envolver, r) {
  await esperarCancel(s)
  let fallo = r.fallo
  if (envolver && !s.perdida && !s.cursorVivo) {
    try {
      await rollbackSeguro(s)
    } catch (err) {
      if (!fallo) fallo = err
    }
  }
  if (fallo) {
    if (r.salida && typeof fallo === 'object') fallo.__salida = r.salida
    throw fallo
  }
  if (r.salida) r.resultado.salida = r.salida
  return terminarEjecucion(s, op, r.resultado)
}

/** Ejecuta UNA sentencia (ver `OpcionesEjecucion` en protocoloTrabajador.ts). */
async function ejecutar(s, sql, binds, opciones) {
  const op = opciones || {}
  binds = prepararBinds(binds)
  await antesDeEjecutar(s)
  const topes = celdas.topesDe(op)
  const modo = modoDe(s, op)

  if (modo.envolver) await empezarEnvoltorio(s)
  else if (necesitaBegin(s, op, modo.manual)) await interna(s, 'BEGIN')

  const r = { resultado: null, fallo: null }
  const dejarDeEscuchar = op.salidaServidor === true ? escucharSalida(s) : null
  s.enCursoUsuario = modo.usuario
  try {
    r.resultado = await ejecutarSegunModo(s, sql, binds, op, topes, modo)
  } catch (err) {
    if (err && typeof err === 'object') err.__cancelPedido = s.cancelPedido
    r.fallo = err
  } finally {
    s.enCursoUsuario = false
  }
  r.salida = dejarDeEscuchar ? dejarDeEscuchar() : undefined
  return cerrarEjecucion(s, op, modo.envolver, r)
}

/**
 * «Más» en PG es re-ejecutar (lo decide el main): la única excepción es el cursor
 * vivo de una exportación (`mantenerCursor`), que se lee aquí página a página.
 */
async function leer(s, id, maxFilas) {
  const v = s.cursorVivo
  if (!v || v.id !== id) {
    const e = new Error('PostgreSQL no mantiene lectores abiertos: vuelve a ejecutar con saltarFilas.')
    e.code = 'TESSERA-LECTOR'
    e.__protocolo = true
    throw e
  }
  const t0 = ahora()
  s.cancelPedido = false
  s.enCursoUsuario = true
  let pagina
  try {
    await llenarCursorVivo(v, maxFilas)
    pagina = paginaCursorVivo(v, maxFilas)
  } catch (err) {
    if (err && typeof err === 'object') err.__cancelPedido = s.cancelPedido
    s.enCursoUsuario = false
    await cerrarCursorVivo(s)
    throw err
  } finally {
    s.enCursoUsuario = false
  }
  if (!pagina.hayMas) await cerrarCursorVivo(s)
  const r = {
    filasJson: pagina.filasJson,
    nFilas: pagina.nFilas,
    hayMas: pagina.hayMas,
    lector: pagina.hayMas ? id : null,
    ms: ms(t0)
  }
  if (pagina.recortes) r.recortes = pagina.recortes
  return r
}

async function cerrarLector(s, id) {
  if (!s.cursorVivo || s.cursorVivo.id !== id) return { cerrado: false }
  return { cerrado: await cerrarCursorVivo(s) }
}

/**
 * Stop = CancelRequest del protocolo, sin credenciales ni sesión extra. Un cancel que llega tarde
 * puede caer en la sentencia SIGUIENTE: por eso se espera a que el servidor cierre la conexión
 * del cancel antes de mandar nada más, y el ROLLBACK del envoltorio se reintenta una vez si da 57014.
 */
async function cancelar(s) {
  if (!s.enCursoUsuario || !s.cliente || s.perdida) return { cancelada: false }
  s.cancelPedido = true
  s.cancelEnVuelo = enviarCancelRequest(s.cliente.host, s.cliente.port, s.cliente.processID, s.cliente.secretKey)
  const ok = await s.cancelEnVuelo
  s.cancelEnVuelo = null
  return { cancelada: ok }
}

async function tx(s, accion) {
  if (s.cursorVivo) await cerrarCursorVivo(s)
  if (accion === 'estado') return { tx: await estadoTx(s, true) }
  await esperarCancel(s)
  const antes = estadoCliente(s)
  const avisos = []
  if (accion === 'commit') {
    const r = await interna(s, 'COMMIT')
    if (antes === 'E' || (r && r.command === 'ROLLBACK')) {
      avisos.push('La transacción había fallado: COMMIT se convirtió en ROLLBACK.')
    }
  } else {
    await rollbackSeguro(s)
  }
  const resultado = { tx: await estadoTx(s, true) }
  if (avisos.length) resultado.avisos = avisos
  return resultado
}

async function autoCommit(s, valor) {
  s.txManual = !valor
  return { autoCommit: Boolean(valor), tx: await estadoTx(s, true) }
}

/** Rollback + end. Nunca lanza: cerrar es la última línea de defensa. */
async function cerrar(s) {
  if (!s || !s.cliente || s.cerrando) return
  s.cerrando = true
  const cliente = s.cliente
  if (s.cursorVivo && !s.perdida) {
    // Antes que el ROLLBACK, que esperaría detrás del portal abierto. Con plazo: si la
    // conexión ya no contesta, el `end()` de abajo la corta igual.
    const v = s.cursorVivo
    s.cursorVivo = null
    await Promise.race([v.cursor.close().catch(() => {}), new Promise((r) => setTimeout(r, 2000))])
  }
  if (!s.perdida && estadoCliente(s) && estadoCliente(s) !== 'I') {
    try {
      await rollbackSeguro(s)
    } catch {
      // se cierra igual: el servidor revierte al perder la sesión
    }
  }
  await new Promise((resolve) => {
    const reloj = setTimeout(resolve, 3000)
    cliente
      .end()
      .catch(() => {})
      .finally(() => {
        clearTimeout(reloj)
        resolve()
      })
  })
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
  SQL_FORMATOS
}
