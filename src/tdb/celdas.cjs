// =============================================================================
// Celdas del proceso de sesión del explorador: convierte lo que devuelven los drivers en
// `DbCelda` y arma la página como `filasJson` (un string opaco que el main y el preload pasan
// sin mirar). Fachada: reexporta `celdasComun`, `celdasOracle`, `celdasPostgres` y
// `fechasOracle`, que es donde vive cada parte. Sin E/S ni `require` de drivers al cargar.
// Decisiones: docs/decisiones/bd/celdas-valores-exactos-y-topes.md
// =============================================================================

'use strict'

const comun = require('./celdasComun.cjs')
const oracle = require('./celdasOracle.cjs')
const postgres = require('./celdasPostgres.cjs')
const fechas = require('./fechasOracle.cjs')

module.exports = {
  TOPE_CELDA: comun.TOPE_CELDA,
  TOPE_RESPUESTA: comun.TOPE_RESPUESTA,
  TOPE_RESPUESTA_CATALOGO: comun.TOPE_RESPUESTA_CATALOGO,
  BYTES_FECHA: fechas.BYTES_FECHA,
  topesDe: comun.topesDe,
  textoONulo: comun.textoONulo,
  recortarTexto: comun.recortarTexto,
  hexCorto: comun.hexCorto,
  byteaPgAHex: postgres.byteaPgAHex,
  numeroOracleATexto: oracle.numeroOracleATexto,
  textoFechaDeBytes: fechas.textoFechaDeBytes,
  textoFechaOracle: fechas.textoFechaOracle,
  parchearFechasThin: fechas.parchearFechasThin,
  textoIntervalo: fechas.textoIntervalo,
  textoObjeto: oracle.textoObjeto,
  tipoLogicoOracle: oracle.tipoLogicoOracle,
  tipoMotorOracle: oracle.tipoMotorOracle,
  columnasOracle: oracle.columnasOracle,
  manejadorFetchOracle: oracle.manejadorFetchOracle,
  esLob: oracle.esLob,
  soltarFilas: oracle.soltarFilas,
  leerLob: oracle.leerLob,
  celdaOracle: oracle.celdaOracle,
  celdaNativa: comun.celdaNativa,
  TIPOS_CRUDOS_PG: postgres.TIPOS_CRUDOS_PG,
  tipoLogicoPg: postgres.tipoLogicoPg,
  oidDesconocidoPg: postgres.oidDesconocidoPg,
  nombreTipoPg: postgres.nombreTipoPg,
  columnasPg: postgres.columnasPg,
  celdaPg: postgres.celdaPg,
  AcumuladorPagina: comun.AcumuladorPagina,
  AcumuladorSalida: comun.AcumuladorSalida,
  TOPE_SALIDA_LINEAS: comun.TOPE_SALIDA_LINEAS,
  TOPE_SALIDA_CARACTERES: comun.TOPE_SALIDA_CARACTERES,
  filaOracle: oracle.filaOracle,
  filaPg: postgres.filaPg
}
