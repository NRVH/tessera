// =============================================================================
// El autorizador de SQLite: las listas de lo cerrado y de los PRAGMA de lectura, y el
// callback con sus perfiles ('base', 'vacuum', 'explain', 'lectura'). Pieza de
// `sqliteComun.cjs`, que reexporta las listas: `test-sqlite-comun` las cruza con las del main.
// Decisiones: docs/decisiones/bd/adaptador-sqlite-apertura-y-autorizador.md
// =============================================================================

'use strict'

const { errorSqlite } = require('./archivoSqlite.cjs')

/**
 * Los PRAGMA que solo LEEN: COPIA de `REGLAS.sqlite.pragmas` (`shared/sql/dialectosSql.ts`),
 * que es la que usa el clasificador del main. `test-sqlite-comun` las cruza: tienen que ser
 * las MISMAS, o el main y el autorizador dirían cosas distintas de la misma sentencia.
 */
const PRAGMAS_LECTURA = Object.freeze({
  soloSinValor: Object.freeze([
    'application_id',
    'auto_vacuum',
    'busy_timeout',
    'cache_size',
    'collation_list',
    'compile_options',
    'data_version',
    'database_list',
    'encoding',
    'foreign_key_check',
    'foreign_keys',
    'freelist_count',
    'function_list',
    'integrity_check',
    'journal_mode',
    'max_page_count',
    'mmap_size',
    'module_list',
    'page_count',
    'page_size',
    'pragma_list',
    'query_only',
    'quick_check',
    'recursive_triggers',
    'schema_version',
    'synchronous',
    'table_list',
    'temp_store',
    'user_version',
    'wal_autocheckpoint'
  ]),
  conArgumento: Object.freeze([
    'foreign_key_check',
    'foreign_key_list',
    'index_info',
    'index_list',
    'index_xinfo',
    'integrity_check',
    'quick_check',
    'table_info',
    'table_list',
    'table_xinfo'
  ])
})

/**
 * Funciones cerradas SIEMPRE (todos los perfiles): cargar código nativo (`load_extension`,
 * que además node:sqlite trae desactivada) y las que leen o escriben archivos o registran
 * código (las de la shell de SQLite; no vienen en este build, pero cerrarlas no cuesta).
 */
const FUNCIONES_PROHIBIDAS = Object.freeze(['load_extension', 'fts3_tokenizer', 'readfile', 'writefile', 'edit', 'sqlar_compress', 'sqlar_uncompress'])

/**
 * PRAGMA cerrados SIEMPRE: escriben fuera de la base (los directorios temporales) o le
 * quitan la protección al esquema (`writable_schema`).
 */
const PRAGMAS_PROHIBIDOS = Object.freeze(['temp_store_directory', 'data_store_directory', 'writable_schema'])

/** Los códigos de acción del autorizador que se usan (de `node:sqlite` `constants`). */
function codigos(sqlite) {
  const C = sqlite.constants || {}
  const nombres = ['SQLITE_OK', 'SQLITE_DENY', 'SQLITE_SELECT', 'SQLITE_READ', 'SQLITE_RECURSIVE', 'SQLITE_FUNCTION', 'SQLITE_PRAGMA', 'SQLITE_ATTACH', 'SQLITE_DETACH']
  for (const n of nombres) {
    if (typeof C[n] !== 'number') throw errorSqlite('SIN-AUTORIZADOR', `Este runtime de SQLite no expone ${n}: no se abre sin su guardia.`)
  }
  return C
}

/**
 * El callback del autorizador. Lee el perfil de `estado.perfil` EN CADA LLAMADA (se cambia
 * por operación con `conPerfil`) y apunta en `estado.motivos` lo que denegó, para el mensaje.
 * No toca la conexión desde el callback (en Node 26.8 lanza).
 */
function autorizador(estado, C) {
  const prohibidas = new Set(FUNCIONES_PROHIBIDAS)
  const pragmasProhibidos = new Set(PRAGMAS_PROHIBIDOS)
  const sinValor = new Set(PRAGMAS_LECTURA.soloSinValor)
  const conArg = new Set(PRAGMAS_LECTURA.conArgumento)
  const denegar = (motivo) => {
    estado.motivos.push(motivo)
    return C.SQLITE_DENY
  }

  // Lo cerrado en TODOS los perfiles; `undefined` si nada lo cierra. La única excepción: el
  // ATTACH INTERNO de un VACUUM a secas (una base temporal sin archivo, `a1 === ''`), y solo
  // con el perfil 'vacuum' que pone `conVacuum` para una sentencia ya comprobada.
  const cerradoEnTodos = (accion, a1, a2, pragma) => {
    if (accion === C.SQLITE_ATTACH) return estado.perfil === 'vacuum' && a1 === '' ? C.SQLITE_OK : denegar('ATTACH')
    if (accion === C.SQLITE_DETACH) return denegar('DETACH')
    if (accion === C.SQLITE_FUNCTION && prohibidas.has(String(a2).toLowerCase())) return denegar(`la función ${a2}`)
    if (pragma !== null && pragmasProhibidos.has(pragma)) return denegar(`PRAGMA ${pragma}`)
    return undefined
  }

  const enExplain = (pragma, a2) => {
    if (pragma !== null && a2 !== null && !conArg.has(pragma)) return denegar(`PRAGMA ${pragma} = ${a2}`)
    return C.SQLITE_OK
  }

  const enLectura = (accion, pragma, a2) => {
    if (accion === C.SQLITE_SELECT || accion === C.SQLITE_READ || accion === C.SQLITE_RECURSIVE || accion === C.SQLITE_FUNCTION) {
      return C.SQLITE_OK
    }
    if (pragma === null) return denegar('una escritura')
    if (a2 === null && sinValor.has(pragma)) return C.SQLITE_OK
    if (a2 !== null && conArg.has(pragma)) return C.SQLITE_OK
    return denegar(a2 === null ? `PRAGMA ${pragma}` : `PRAGMA ${pragma} = ${a2}`)
  }

  return (accion, a1, a2) => {
    const pragma = accion === C.SQLITE_PRAGMA ? String(a1).toLowerCase() : null
    const cerrado = cerradoEnTodos(accion, a1, a2, pragma)
    if (cerrado !== undefined) return cerrado
    switch (estado.perfil) {
      case 'base':
      case 'vacuum':
        return C.SQLITE_OK
      case 'explain':
        return enExplain(pragma, a2)
      case 'lectura':
        return enLectura(accion, pragma, a2)
      default:
        // Un perfil que no se conoce: cerrado.
        return denegar(`el perfil «${String(estado.perfil)}»`)
    }
  }
}

module.exports = { PRAGMAS_LECTURA, FUNCIONES_PROHIBIDAS, PRAGMAS_PROHIBIDOS, codigos, autorizador }
