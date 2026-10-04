// =============================================================================
// Lo común de Redis para `tdb` (`redis.cjs`) y el trabajador del explorador (`sesionRedis.cjs`):
// una sola copia de cómo se conecta, cómo se parte un comando, qué es lectura y cómo se lee un
// valor. Fachada: reexporta `clienteRedis`, `comandosRedis`, `politicaRedis`, `ejecucionRedis`,
// `claveRedis`, `valoresRedis` y `erroresRedis`, que es donde vive cada parte. `ioredis` se carga a demanda.
// Decisiones: docs/decisiones/bd/adaptador-redis-cliente-y-marcas.md
// =============================================================================

'use strict'

const errores = require('./erroresRedis.cjs')
const valores = require('./valoresRedis.cjs')
const comandos = require('./comandosRedis.cjs')
const cliente = require('./clienteRedis.cjs')
const politica = require('./politicaRedis.cjs')
const ejecucion = require('./ejecucionRedis.cjs')
const clave = require('./claveRedis.cjs')

module.exports = {
  ErrorSintaxis: errores.ErrorSintaxis,
  cargarRedis: cliente.cargarRedis,
  opcionesCliente: cliente.opcionesCliente,
  conectar: cliente.conectar,
  reconectar: cliente.reconectar,
  desconectar: cliente.desconectar,
  baseActual: cliente.baseActual,
  seleccionar: cliente.seleccionar,
  partirComando: comandos.partirComando,
  nombreComando: comandos.nombreComando,
  marcasDe: politica.marcasDe,
  clasificar: politica.clasificar,
  aplicarPolitica: politica.aplicarPolitica,
  ejecutar: ejecucion.ejecutar,
  respuestaDe: valores.respuestaDe,
  bytes: valores.bytes,
  bases: clave.bases,
  escanear: clave.escanear,
  valor: clave.valor,
  normalizarError: errores.normalizarError,
  esPerdida: errores.esPerdida,
  esRespuestaError: errores.esRespuestaError,
  formatoCli: valores.formatoCli,
  PELIGROSOS: comandos.PELIGROSOS,
  NO_ADMITIDOS: comandos.NO_ADMITIDOS,
  CONTENEDORES: comandos.CONTENEDORES,
  LECTURA_SIN_MARCA: comandos.LECTURA_SIN_MARCA,
  BLOQUEANTES: comandos.BLOQUEANTES,
  LUA: comandos.LUA,
  BASES_POR_DEFECTO: cliente.BASES_POR_DEFECTO,
  TOPE_STRING_BYTES: clave.TOPE_STRING_BYTES,
  TOPE_JSON_CARACTERES: clave.TOPE_JSON_CARACTERES
}
