// =============================================================================
// Carga perezosa de lo que MongoDB necesita de fuera: el driver `mongodb`, el parser de literales
// del shell y `acorn`. Cada uno se carga en su primer uso y se guarda aquí, en un único dueño:
// `tdb ls` no paga el driver, y `test-mongo-comun` comprueba que cargar los adaptadores no lo carga.
// Decisiones: docs/decisiones/bd/mongodb-conexion-y-tipos.md
// =============================================================================
'use strict'

let mongo = null
/** El módulo `mongodb` (el driver, JS puro). */
function cargarMongo() {
  if (!mongo) mongo = require('mongodb')
  return mongo
}

/** EJSON: el driver 7 lo exporta dentro de `BSON`, no suelto. */
function ejson() {
  return cargarMongo().BSON.EJSON
}

let parser = null
function cargarParser() {
  if (!parser) parser = require('@mongodb-js/shell-bson-parser')
  return parser
}

let acorn = null
function cargarAcorn() {
  if (!acorn) acorn = require('acorn')
  return acorn
}

module.exports = { cargarMongo, ejson, cargarParser, cargarAcorn }
