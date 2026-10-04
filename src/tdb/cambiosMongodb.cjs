// =============================================================================
// «Enviar» de MongoDB: los cambios de la tabla de una colección (insertar, reemplazar, actualizar
// campos de primer nivel, borrar) se interpretan todos antes de tocar el servidor y se aplican en una
// transacción (todo o nada) o, sin ellas, uno a uno parando en el primero que falla.
// Depende de `mongoComun.cjs` y `protocoloMongodb.cjs`; lo usa `sesionMongodb.cjs`.
// Decisiones: docs/decisiones/bd/mongodb-sesion-lectores-y-enviar.md
// =============================================================================
'use strict'

const comun = require('./mongoComun.cjs')
const { CODIGO_SIN_TX, protocolo, textoDe, politicaDe, guardia } = require('./protocoloMongodb.cjs')
const { errorDe } = require('./sesionProtocolo.cjs')

const CAMPO_VALIDO = /^[^$.][^.]*$/

function campoDe(k) {
  if (typeof k !== 'string' || !CAMPO_VALIDO.test(k) || k.includes('\u0000')) {
    const e = new Error(`«${String(k)}» no es un campo de primer nivel editable (vacío, empieza por $ o lleva un punto).`)
    e.code = 'TESSERA-CAMPO'
    throw e
  }
  return k
}

function prepararActualizar(c) {
  if (!c.poner || typeof c.poner !== 'object' || !Array.isArray(c.quitar)) throw protocolo('«actualizar» pide «poner» y «quitar».')
  const poner = {}
  for (const k of Object.keys(c.poner)) {
    if (typeof c.poner[k] !== 'string') throw protocolo('Los valores de «poner» van en texto.')
    poner[campoDe(k)] = comun.interpretarValor(c.poner[k])
  }
  const quitar = c.quitar.map(campoDe)
  return { tipo: 'actualizar', id: comun.idDesdeEjson(c.idEjson), poner, quitar }
}

/** Interpreta un cambio (sin tocar el servidor). La forma mala es de protocolo; el texto malo, un fallo del cambio. */
function prepararCambio(c) {
  if (!c || typeof c !== 'object') throw protocolo('Cambio sin forma.')
  switch (c.tipo) {
    case 'insertar':
      return { tipo: 'insertar', documento: comun.desdeTexto(c.documento) }
    case 'reemplazar':
      return { tipo: 'reemplazar', id: comun.idDesdeEjson(c.idEjson), documento: comun.desdeTexto(c.documento) }
    case 'actualizar':
      return prepararActualizar(c)
    case 'borrar':
      return { tipo: 'borrar', id: comun.idDesdeEjson(c.idEjson) }
    default:
      throw protocolo(`Tipo de cambio desconocido: ${String(c.tipo)}`)
  }
}

function noEncontrado(id) {
  const e = new Error(`El documento con _id ${comun.texto(id, true)} ya no existe: este cambio no se aplicó.`)
  e.code = 'TESSERA-NO-ENCONTRADO'
  return e
}

async function aplicarCambio(col, p, opc) {
  switch (p.tipo) {
    case 'insertar':
      await col.insertOne(p.documento, opc)
      return
    case 'reemplazar': {
      const r = await col.replaceOne({ _id: p.id }, p.documento, opc)
      if (r.matchedCount === 0) throw noEncontrado(p.id)
      return
    }
    case 'actualizar': {
      const cambio = {}
      if (Object.keys(p.poner).length > 0) cambio.$set = p.poner
      if (p.quitar.length > 0) cambio.$unset = Object.fromEntries(p.quitar.map((k) => [k, '']))
      if (!cambio.$set && !cambio.$unset) return
      const r = await col.updateOne({ _id: p.id }, cambio, opc)
      if (r.matchedCount === 0) throw noEncontrado(p.id)
      return
    }
    case 'borrar': {
      const r = await col.deleteOne({ _id: p.id }, opc)
      if (r.deletedCount === 0) throw noEncontrado(p.id)
      return
    }
  }
}

function falloDe(indice, err) {
  const n = comun.normalizarError(err)
  const f = { indice, mensaje: n.mensaje }
  if (n.codigo) f.codigo = n.codigo
  return f
}

/** Interpreta todos los cambios antes de enviar ninguno: `{ preparados }` o, si un texto no se entiende, `{ respuesta }`. */
function prepararTodos(cambios, tx) {
  const preparados = []
  for (let i = 0; i < cambios.length; i++) {
    try {
      preparados.push(prepararCambio(cambios[i]))
    } catch (err) {
      if (err && err.trabajador) throw err
      return { respuesta: { transaccion: tx, aplicados: 0, fallo: falloDe(i, err) } }
    }
  }
  return { preparados }
}

async function enviarEnTransaccion(s, col, preparados, o) {
  const sesion = s.cliente.startSession()
  let indice = 0
  try {
    await sesion.withTransaction(async () => {
      for (let i = 0; i < preparados.length; i++) {
        indice = i
        await aplicarCambio(col, preparados[i], { session: sesion, comment: o.comment })
      }
    })
    return { transaccion: true, aplicados: preparados.length }
  } catch (err) {
    // Con la red caída a mitad (o en el commit) no se sabe qué quedó: eso es la pérdida,
    // no un «no se aplicó nada».
    if (s.cancelado || comun.esPerdida(err)) throw err
    return { transaccion: true, aplicados: 0, fallo: falloDe(indice, err) }
  } finally {
    try {
      await sesion.endSession()
    } catch {
      // nada que hacer
    }
  }
}

async function enviarUnoAUno(col, preparados, o) {
  let aplicados = 0
  for (let i = 0; i < preparados.length; i++) {
    try {
      await aplicarCambio(col, preparados[i], { comment: o.comment })
      aplicados++
    } catch (err) {
      // Sin transacción SIEMPRE se dice cuántos entraron, también si cayó la red: la
      // siguiente operación ya descubrirá la pérdida.
      return { transaccion: false, aplicados, fallo: falloDe(i, err) }
    }
  }
  return { transaccion: false, aplicados }
}

/** La suboperación `enviar` de `docs`: aplica los cambios de una colección; ver el ADR para la política. */
async function enviar(s, a, o) {
  const politica = politicaDe(a)
  const coleccion = textoDe(a.coleccion, 'coleccion')
  const base = textoDe(a.base, 'base')
  if (!Array.isArray(a.cambios)) throw protocolo('Falta «cambios».')
  const n = a.cambios.length
  const tx = s.topologia.transacciones === true
  if (n === 0) return { transaccion: tx, aplicados: 0 }
  guardia(politica, n === 1 ? 'enviar el cambio escribe en la base.' : `enviar los ${n} cambios escribe en la base.`)
  if (!tx && n > 1 && a.confirmadoSinTransaccion !== true) {
    throw errorDe(
      'protocolo',
      'Este servidor no admite transacciones: si falla un cambio, los anteriores quedan aplicados. Hace falta confirmarlo.',
      CODIGO_SIN_TX
    )
  }
  // Todo interpretado antes de enviar nada.
  const { preparados, respuesta } = prepararTodos(a.cambios, tx)
  if (respuesta) return respuesta
  const col = s.cliente.db(base).collection(coleccion)
  return tx ? enviarEnTransaccion(s, col, preparados, o) : enviarUnoAUno(col, preparados, o)
}

module.exports = { enviar }
