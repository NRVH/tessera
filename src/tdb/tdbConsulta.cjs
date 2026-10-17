// =============================================================================
// `tdb test` y la ejecución de `tdb query`: abre la sesión, pide el resultado al adaptador y
// lo pinta (tabla, conjuntos, bloques de documentos o de valor) o lo emite en `--json`.
// La guardia de solo lectura se decide ANTES de conectar, en `tdb.cjs`.
// Depende de `tdbConectar`, `tdbConexiones`, `tdbSalida` y `textosTdb`; lo usa `tdb.cjs`.
// =============================================================================
'use strict'

const { conectar } = require('./tdbConectar.cjs')
const { adaptador, buscarConexion } = require('./tdbConexiones.cjs')
const { pintarTabla } = require('./tdbSalida.cjs')
const { textosTdb } = require('./textosTdb.cjs')

async function cmdTest(ctx, alias) {
  const con = buscarConexion(ctx, alias)
  ctx.accion = 'test'
  const t0 = Date.now()
  const sesion = await conectar(ctx, con)
  try {
    const info = await adaptador(ctx, con).banner(sesion.conexion)
    const ms = Date.now() - t0
    // `aviso` solo existe si el adaptador lo da: el JSON de siempre no cambia en los demás casos.
    const aviso = typeof sesion.aviso === 'string' && sesion.aviso ? sesion.aviso : null
    if (ctx.json) {
      console.log(
        JSON.stringify({
          ok: true,
          servidor: info,
          ms,
          modo: sesion.modo,
          driverId: sesion.driverId,
          ...(aviso ? { aviso } : {})
        })
      )
    } else {
      const t = textosTdb()
      console.log(t.responde(alias, ms, sesion.modo))
      console.log(`    ${info}\n`)
      if (aviso) console.log(t.avisoTest(aviso))
    }
  } finally {
    await sesion.cerrar()
  }
}

/**
 * Los campos del resultado que solo mandan algunos adaptadores, con su forma ya decidida:
 * `avisos` (varias sentencias, una transacción que quedó abierta), `conjuntos` (todos, si
 * hay más de uno) y `salida` (el PRINT del servidor), `documentos` con `hayMas`, `valor` (un
 * resultado que no son documentos, en notación del shell o de redis-cli) y `respuestas`
 * (la estructurada, solo en `--json`). Donde no existen, la salida no cambia ni un carácter.
 */
function camposDelResultado(r) {
  return {
    avisos: r.avisos,
    hayAvisos: Array.isArray(r.avisos) && r.avisos.length > 0,
    conjuntos: r.conjuntos,
    hayConjuntos: Array.isArray(r.conjuntos) && r.conjuntos.length > 1,
    salida: r.salida,
    haySalida: Array.isArray(r.salida) && r.salida.length > 0,
    documentos: r.documentos,
    hayDocumentos: Array.isArray(r.documentos),
    hayMas: r.hayMas,
    valor: r.valor,
    hayValor: typeof r.valor === 'string',
    respuestas: r.respuestas
  }
}

function resultadoJson(r, c) {
  console.log(
    JSON.stringify({
      ok: true,
      columnas: r.columnas,
      filas: r.filas,
      ...(c.hayDocumentos ? { documentos: c.documentos, hayMas: c.hayMas === true } : {}),
      ...(c.hayValor ? { valor: c.valor } : {}),
      ...(Array.isArray(c.respuestas) ? { respuestas: c.respuestas } : {}),
      ...(c.hayConjuntos ? { conjuntos: c.conjuntos } : {}),
      ...(c.haySalida ? { salida: c.salida } : {}),
      ...(c.hayAvisos ? { avisos: c.avisos } : {})
    })
  )
}

function pintarAvisos(c) {
  if (!c.hayAvisos) return
  for (const aviso of c.avisos) console.log(`  ${aviso}`)
  console.log('')
}

/** Un documento por bloque, en vez de la tabla: una celda de 40 caracteres cortaría el subdocumento. */
function pintarDocumentos(c) {
  const t = textosTdb()
  if (c.documentos.length === 0) console.log(t.sinDocumentos)
  c.documentos.forEach((d, i) => {
    console.log(`  [${i + 1}]`)
    for (const linea of String(d).split('\n')) console.log(`  ${linea}`)
    console.log('')
  })
  // El recorte se dice siempre, como con las filas: callarlo haría creer que se vio todo.
  console.log(t.documentos(c.documentos.length, c.hayMas === true))
}

function pintarConjunto(cols, fs, limite) {
  pintarTabla(cols, fs)
  // Avisar del recorte es obligatorio: callarlo haría creer que se vio todo.
  console.log(textosTdb().filas(fs.length, fs.length >= limite))
}

function pintarFilas(r, c, limite) {
  console.log('')
  if (c.hayConjuntos) {
    c.conjuntos.forEach((x, i) => {
      console.log(textosTdb().conjunto(i + 1, c.conjuntos.length))
      pintarConjunto(x.columnas, x.filas, limite)
    })
  } else {
    pintarConjunto(r.columnas, r.filas, limite)
  }
  if (c.haySalida) {
    console.log(textosTdb().salidaServidor)
    for (const linea of c.salida) console.log(`    ${linea}`)
    console.log('')
  }
  pintarAvisos(c)
}

function pintarResultado(ctx, r, limite) {
  const c = camposDelResultado(r)
  if (ctx.json) {
    resultadoJson(r, c)
  } else if (c.hayDocumentos || c.hayValor) {
    console.log('')
    if (c.hayValor) {
      for (const linea of c.valor.split('\n')) console.log(`  ${linea}`)
      console.log('')
    } else {
      pintarDocumentos(c)
    }
    pintarAvisos(c)
  } else {
    pintarFilas(r, c, limite)
  }
}

/** Ejecuta `sql` en la conexión ya validada (la guardia de solo lectura ya pasó) y pinta el resultado. */
async function ejecutarConsulta(ctx, con, sql, limite) {
  const sesion = await conectar(ctx, con)
  try {
    pintarResultado(ctx, await adaptador(ctx, con).consultar(sesion.conexion, sql, limite), limite)
  } finally {
    await sesion.cerrar()
  }
}

module.exports = { cmdTest, ejecutarConsulta }
