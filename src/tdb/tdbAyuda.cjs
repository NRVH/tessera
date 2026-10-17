// =============================================================================
// La ayuda de `tdb`: los subcomandos y las opciones, y un párrafo por familia de motores
// (SQL sin candado, documentos, claves) armado con las etiquetas del registro de motores.
// Depende de `motores.cjs`, `tdbConexiones.cjs` y `textosTdb.cjs`; lo usa `tdb.cjs`.
// =============================================================================
'use strict'

const motoresTdb = require('./motores.cjs')
const { esFamiliaClaves } = require('./tdbConexiones.cjs')
const { textosTdb } = require('./textosTdb.cjs')

/**
 * El párrafo de los motores de CLAVES: la sintaxis de `query` (redis-cli, uno por línea), el
 * `schema` con patrón y que ahí el agente solo lee, también con una conexión de escritura.
 */
function ayudaClaves() {
  const kv = Object.keys(motoresTdb.MOTORES)
    .filter((m) => esFamiliaClaves(m))
    .map((m) => motoresTdb.MOTORES[m].etiqueta)
  if (kv.length === 0) return ''
  return textosTdb().ayudaClaves(kv.join(', '))
}

/**
 * El párrafo de los motores de DOCUMENTOS: la sintaxis que acepta `query` y quién impone el
 * solo lectura. Aparte de la de los SQL, que habla de GO y de EXEC.
 */
function ayudaDocumentos() {
  const docs = Object.keys(motoresTdb.MOTORES)
    .filter((m) => motoresTdb.esFamiliaDocumentos(m))
    .map((m) => motoresTdb.MOTORES[m].etiqueta)
  if (docs.length === 0) return ''
  return textosTdb().ayudaDocumentos(docs.join(', '))
}

/** Escribe la ayuda; `limitePorDefecto` es el tope de filas de `query` que anuncia. */
function ayuda(limitePorDefecto) {
  // Los motores SQL cuyo solo lectura impone `tdb`, por su etiqueta del registro. Solo los
  // SQL: el párrafo habla de EXEC, de transacciones y de lotes GO.
  const sinCandado = Object.keys(motoresTdb.MOTORES)
    .filter((m) => motoresTdb.esFamiliaSql(m) && motoresTdb.guardiaDeTessera(m))
    .map((m) => motoresTdb.MOTORES[m].etiqueta)
    .join(', ')
  console.log(textosTdb().ayuda(limitePorDefecto, sinCandado, ayudaDocumentos(), ayudaClaves()))
}

module.exports = { ayuda }
