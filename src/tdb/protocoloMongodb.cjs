// =============================================================================
// Lo que comparten las operaciones de MongoDB del proceso de sesión: los errores del trabajador
// (`{ clase, mensaje, codigo? }` de `protocoloTrabajador.ts`), la validación de los argumentos
// del protocolo y la política que manda el main (solo lectura, producción, confirmado).
// El error en sí es el `errorDe` común del trabajador (`sesionProtocolo.cjs`), el mismo que usan
// `sesion.cjs` y los demás motores. Lo usan `sesionMongodb.cjs` y `cambiosMongodb.cjs`.
// Decisiones: docs/decisiones/bd/mongodb-sesion-lectores-y-enviar.md
// =============================================================================
'use strict'

const { errorDe } = require('./sesionProtocolo.cjs')

const CODIGO_LECTOR = 'TESSERA-LECTOR'
const CODIGO_PRODUCCION = 'TESSERA-PRODUCCION'
const CODIGO_SOLO_LECTURA = 'TESSERA-SOLO-LECTURA'
const CODIGO_SIN_TX = 'TESSERA-SIN-TX'

function protocolo(mensaje) {
  return errorDe('protocolo', mensaje, 'TESSERA-MENSAJE')
}

function textoDe(v, nombre) {
  if (typeof v !== 'string' || v === '') throw protocolo(`Falta «${nombre}».`)
  return v
}

function enteroDe(v, nombre) {
  if (!Number.isInteger(v) || v < 1) throw protocolo(`«${nombre}» tiene que ser un entero >= 1.`)
  return v
}

/** La política de la petición; un campo que no es booleano cuenta como el caso seguro. */
function politicaDe(a) {
  const p = a.politica
  if (!p || typeof p !== 'object') throw protocolo('Falta «politica».')
  return { soloLectura: p.soloLectura !== false, produccion: p.produccion !== false, confirmado: p.confirmado === true }
}

/** La guardia de una ESCRITURA (`motivo` dice qué escribe). */
function guardia(politica, motivo) {
  if (politica.soloLectura) {
    throw errorDe('soloLectura', `La conexión es de solo lectura: ${motivo}`, CODIGO_SOLO_LECTURA)
  }
  if (politica.produccion && !politica.confirmado) {
    throw errorDe('protocolo', `Es una conexión de PRODUCCIÓN: ${motivo} Hace falta confirmarlo.`, CODIGO_PRODUCCION)
  }
}

module.exports = { CODIGO_LECTOR, CODIGO_SIN_TX, protocolo, textoDe, enteroDe, politicaDe, guardia }
