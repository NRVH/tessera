// =============================================================================
// Lo común de MongoDB para `tdb` (`mongodb.cjs`) y el proceso de sesión (`sesionMongodb.cjs`): una
// sola copia de cómo se conecta, cómo se interpreta el shell, qué es lectura y cómo se escribe un
// valor, para que el agente y el explorador no diverjan. Reexporta las piezas (`conexionMongodb`,
// `literalesMongodb`, `sentenciaMongodb`, `ejecutarMongodb`, `textoMongodb`, `tiposMongodb`,
// `erroresMongodb`, `cargaMongodb`); el driver se carga perezoso, en su primer uso.
// Decisiones: docs/decisiones/bd/mongodb-interprete-del-shell.md, docs/decisiones/bd/mongodb-conexion-y-tipos.md
// =============================================================================
'use strict'

const { cargarMongo } = require('./cargaMongodb.cjs')
const { ErrorSintaxis, esPerdida, normalizarError } = require('./erroresMongodb.cjs')
const { opcionesCliente, conectar } = require('./conexionMongodb.cjs')
const { interpretarLiteral, interpretarValor, desdeTexto, idDesdeEjson } = require('./literalesMongodb.cjs')
const { LECTURA_COLECCION, ESCRITURA_COLECCION, METODOS_DB, interpretarSentencia, clasificar } = require('./sentenciaMongodb.cjs')
const { cerrarCursor, siguientes, ejecutar } = require('./ejecutarMongodb.cjs')
const { texto } = require('./textoMongodb.cjs')
const { tipoDe, celda, documento, columnasDe, muestrear, muestraCampos } = require('./tiposMongodb.cjs')

module.exports = {
  ErrorSintaxis,
  cargarMongo,
  opcionesCliente,
  conectar,
  interpretarLiteral,
  interpretarValor,
  interpretarSentencia,
  clasificar,
  ejecutar,
  siguientes,
  texto,
  tipoDe,
  celda,
  documento,
  columnasDe,
  muestraCampos,
  muestrear,
  desdeTexto,
  idDesdeEjson,
  normalizarError,
  esPerdida,
  // Para los tests y los adaptadores.
  LECTURA_COLECCION,
  ESCRITURA_COLECCION,
  METODOS_DB,
  cerrarCursor
}
