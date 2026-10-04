// =============================================================================
// La ayuda de `tdb`: los subcomandos y las opciones, y un párrafo por familia de motores
// (SQL sin candado, documentos, claves) armado con las etiquetas del registro de motores.
// Depende de `motores.cjs` y `tdbConexiones.cjs`; lo usa `tdb.cjs`.
// =============================================================================
'use strict'

const motoresTdb = require('./motores.cjs')
const { esFamiliaClaves } = require('./tdbConexiones.cjs')

/**
 * El párrafo de los motores de CLAVES: la sintaxis de `query` (redis-cli, uno por línea), el
 * `schema` con patrón y que ahí el agente solo lee, también con una conexión de escritura.
 */
function ayudaClaves() {
  const kv = Object.keys(motoresTdb.MOTORES)
    .filter((m) => esFamiliaClaves(m))
    .map((m) => motoresTdb.MOTORES[m].etiqueta)
  if (kv.length === 0) return ''
  return `
  En ${kv.join(', ')}, query acepta comandos de redis-cli, con sus comillas; varios, uno por
  línea (se ejecutan en orden y se para en el primer error; # empieza un comentario).
  «SELECT <n>» cambia de base para las líneas siguientes.

    tdb query miredis "HGETALL usuario:1"
    tdb query miredis --stdin <<'REDIS'
    SELECT 1
    TYPE "clave con espacios"
    LRANGE cola:tareas 0 9
    REDIS

  tdb schema <alias> ["<patrón>"] lista las claves (un SCAN acotado, nunca KEYS) con su tipo
  y su TTL; no hay tablas, así que describe no aplica. Ahí tdb SOLO LEE, también en
  las conexiones de escritura: pasan los comandos de lectura (GET, HGETALL, SCAN, TYPE…);
  KEYS, CONFIG, FLUSHALL y toda escritura, nunca. Para escribir, la consola de Tessera.
`
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
  return `
  En ${docs.join(', ')}, query acepta la sintaxis de mongosh, INTERPRETADA (no se ejecuta
  JavaScript): una sentencia por comando, y «use <base>» en la primera línea para otra base.

    tdb query mimongo "db.clientes.find({ nombre: 'Ana' }).sort({ edad: -1 }).limit(5)"

  Con operadores ($gt, $group…), por --stdin: el shell expandiría el $.

    tdb query mimongo --stdin <<'JS'
    use otra
    db.pedidos.aggregate([{ $group: { _id: '$cliente', n: { $sum: 1 } } }])
    JS

  Ahí el solo lectura lo impone tdb: pasan find, aggregate sin $out ni $merge,
  countDocuments, distinct…; la garantía de verdad es un usuario con el rol read.
`
}

/** Escribe la ayuda; `limitePorDefecto` es el tope de filas de `query` que anuncia. */
function ayuda(limitePorDefecto) {
  // Los motores SQL cuyo solo lectura impone `tdb`, por su etiqueta del registro. Solo los
  // SQL: el párrafo habla de EXEC, de transacciones y de lotes GO.
  const sinCandado = Object.keys(motoresTdb.MOTORES)
    .filter((m) => motoresTdb.esFamiliaSql(m) && motoresTdb.guardiaDeTessera(m))
    .map((m) => motoresTdb.MOTORES[m].etiqueta)
    .join(', ')
  console.log(`
  tdb — consulta las bases de datos configuradas en Tessera (perfil activo)

    tdb ls                          Lista las conexiones montadas en esta sesión
    tdb doctor                      Por qué no funciona (shell, contexto, PATH)
    tdb test <alias>                Comprueba que la conexión responde
    tdb query <alias> "<SQL>"       Ejecuta una consulta (tope ${limitePorDefecto} filas)
    tdb schema <alias>              Tablas y claves foráneas de la base
    tdb describe <alias> <TABLA>    Columnas, tipos, PK y referencias
    tdb sessions <alias>            Sesiones abiertas de tu usuario
    tdb driver ls | install <id>    Clientes de base de datos

  Opciones:
    --json          Salida JSON (para consumo automático)
    --limit N       Cambia el tope de filas de 'query'
    --stdin         El SQL entra por la entrada estándar, no por la línea de comandos
    --file <ruta>   El SQL se lee de un archivo

  SQL LARGO O CON SÍMBOLOS: pásalo por --stdin. En la línea de comandos el SQL
  atraviesa el parser del shell y cada uno lo estropea a su manera (cmd expande
  %VAR%, bash expande $ y comillas). Desde bash, con el delimitador entrecomillado:

    tdb query mibase --stdin <<'SQL'
    SELECT * FROM clientes WHERE nombre LIKE '%García%'
    SQL

  Las conexiones son de SOLO LECTURA salvo que se marquen lo contrario en Tessera:
  el rechazo lo hace el servidor (en una base de archivo, la guardia de Tessera),
  no este comando. ${sinCandado} no tiene ese candado: ahí lo impone tdb, que rechaza
  toda escritura, todo EXEC y toda transacción antes de enviar, y revierte cada lote.
  En ${sinCandado}, GO en su propia línea separa lotes, como en sqlcmd.
${ayudaDocumentos()}${ayudaClaves()}`)
}

module.exports = { ayuda }
