// =============================================================================
// Lectura del registro de conexiones (`db-connections.json`) por `tdb`, con la misma
// regla que el main: el `.bak` si el principal no es JSON, formato ajeno e ilegible.
// Es una copia de esa regla, no un `require`: este archivo corre suelto, sin el main.
// Depende de `tdbSalida.cjs`; lo usan `tdbContexto.cjs` y las pruebas por `tdb`.
// Decisiones: docs/decisiones/bd/tdb-registro-como-el-main.md
// =============================================================================
'use strict'

const { readFileSync } = require('node:fs')
const { envolver } = require('./tdbSalida.cjs')

/** Punto de código del BOM (U+FEFF). Como constante y no literal en una regex:
 *  el carácter es INVISIBLE en un editor, y eso es justo el fallo que evita. */
const BOM = 0xfeff

/** Lee un JSON sin BOM, o devuelve `porDefecto` si no existe o no se puede leer. */
function leerJson(ruta, porDefecto) {
  try {
    // `JSON.parse` rechaza el BOM, y estos archivos pueden traer uno si se editan en Windows.
    let texto = readFileSync(ruta, 'utf-8')
    if (texto.charCodeAt(0) === BOM) texto = texto.slice(1)
    return JSON.parse(texto)
  } catch {
    return porDefecto
  }
}

/**
 * Lo que se sabe de UN archivo del registro (el principal o el `.bak`) tras intentar
 * leerlo. Copia de `leerArchivo` del main (`registroConexiones.ts`), con la lectura del
 * disco dentro porque aquí no hay nada que inyectar:
 *   - `registro` (con su `doc`), `ausente` (no existe), `vacio` (cero bytes, solo espacios
 *     o solo el BOM: no hay nada que perder), `roto` (tiene contenido y no es JSON) o
 *     `inaccesible` (existe y no se deja abrir; `codigo` es el del error).
 * Solo `ENOENT`/`ENOTDIR` cuentan como ausente, como en `ConnectionStore.read`.
 */
function leerArchivoRegistro(ruta) {
  let texto
  try {
    texto = readFileSync(ruta, 'utf-8')
  } catch (e) {
    const codigo = e && typeof e.code === 'string' ? e.code : ''
    if (codigo === 'ENOENT' || codigo === 'ENOTDIR') return { tipo: 'ausente' }
    return { tipo: 'inaccesible', codigo: codigo || 'error de lectura' }
  }
  try {
    return { tipo: 'registro', doc: JSON.parse(texto.charCodeAt(0) === BOM ? texto.slice(1) : texto) }
  } catch {
    // `trim` también quita el BOM: un archivo que solo trae eso está vacío.
    return texto.trim() === '' ? { tipo: 'vacio' } : { tipo: 'roto' }
  }
}

/**
 * El registro tal como lo lee el main (`ConnectionStore.read` y `leerRegistroConRespaldo`):
 *   - El principal si es JSON; si no (o no existe, o está vacío), el `.bak`. Un principal
 *     LEGIBLE manda aunque esté vacío: vaciarlo a mano no resucita el respaldo.
 *   - FORMATO AJENO: JSON, pero no un registro que esta versión reconozca: no se interpreta
 *     ninguna entrada.
 *   - ILEGIBLE: contenido que no se puede leer y sin `.bak` que sirva. No se ve nada y se dice
 *     por qué; un principal que falta o está vacío, sin `.bak`, sí es un registro vacío.
 *   - Un principal que NO SE DEJA ABRIR es ilegible SIEMPRE, aunque el `.bak` se lea.
 *
 * @returns `{ doc, aviso, origen }`: `aviso` es `null` si se puede usar, o el porqué de no
 *          interpretar nada (y entonces `doc` es `{ connections: [] }`). `origen` es
 *          `principal`, `respaldo` o `ninguno`.
 */
function leerRegistroConexiones(ruta) {
  const principal = leerArchivoRegistro(ruta)
  const respaldo = principal.tipo === 'registro' ? null : leerArchivoRegistro(`${ruta}.bak`)
  if (principal.tipo === 'inaccesible') {
    const estado = respaldo.tipo === 'registro' ? 'legible' : respaldo.tipo === 'ausente' ? 'ausente' : 'inservible'
    return { doc: { connections: [] }, aviso: mensajeRegistroIlegible(principal, estado), origen: 'ninguno' }
  }
  const legible = respaldo === null ? principal : respaldo
  const origen = respaldo === null ? 'principal' : 'respaldo'
  if (legible.tipo === 'registro') {
    return formatoRegistroAjeno(legible.doc)
      ? { doc: { connections: [] }, aviso: MENSAJE_FORMATO_AJENO, origen }
      : { doc: legible.doc, aviso: null, origen }
  }
  if (principal.tipo === 'roto') {
    const estado = legible.tipo === 'ausente' ? 'ausente' : 'inservible'
    return { doc: { connections: [] }, aviso: mensajeRegistroIlegible(principal, estado), origen: 'ninguno' }
  }
  return { doc: { connections: [] }, aviso: null, origen: 'ninguno' }
}

/**
 * ¿Es JSON pero no un registro que esta versión reconozca? Vacío es solo lo que no tiene
 * nada que perder (`null`, `[]`, un objeto sin `connections` o con `connections: null`);
 * ajeno, una raíz que no es un objeto y no está vacía, una `version` presente que no es un
 * número finito, o un `connections` presente que no es una lista.
 */
function formatoRegistroAjeno(doc) {
  if (doc === null || (Array.isArray(doc) && doc.length === 0)) return false
  if (typeof doc !== 'object' || Array.isArray(doc)) return true
  const version = doc.version
  if (version !== undefined && version !== null && !(typeof version === 'number' && Number.isFinite(version))) {
    return true
  }
  const lista = doc.connections
  return lista !== undefined && lista !== null && !Array.isArray(lista)
}

/**
 * Lo que se dice cuando el registro tiene un formato que no se reconoce: sin conexiones
 * que listar y sin mandar a añadir, montar ni editar, que es lo que la app no deja hacer.
 */
const MENSAJE_FORMATO_AJENO =
  'Este tdb no reconoce el formato del registro de conexiones (db-connections.json),\n' +
  '    así que no ve ninguna. Puede venir de una versión más nueva de Tessera (actualiza\n' +
  '    para usarlas) o de una edición a mano del archivo; Tessera no lo toca.'

/**
 * Lo que se dice cuando el registro NO SE PUEDE LEER y no hay `.bak` que lo supla. Sin los
 * dos orígenes del formato ajeno (ninguna versión escribe un JSON roto), con el remedio de
 * cada causa y con el estado del `.bak`. Su texto varía, así que lo parte `envolver`.
 *
 * @param causa `{ tipo: 'roto' }` o `{ tipo: 'inaccesible', codigo }`.
 * @param respaldo `'ausente'`, `'inservible'` o `'legible'`.
 */
function mensajeRegistroIlegible(causa, respaldo) {
  const que = causa.tipo === 'roto' ? 'no es JSON válido' : `no se pudo abrir (${causa.codigo})`
  const copia =
    respaldo === 'inservible'
      ? ', y su copia de respaldo (db-connections.json.bak) tampoco sirve'
      : respaldo === 'legible'
        ? ', y su copia de respaldo (db-connections.json.bak), aunque se lee, no se usa: la próxima ' +
          'escritura sustituiría el registro sin haber podido guardarlo aparte'
        : ''
  const remedio =
    causa.tipo === 'roto'
      ? 'corrígelo (suele ser una edición a mano: una coma de más, una comilla sin cerrar)'
      : 'revisa sus permisos, o si otro programa lo tiene abierto en exclusiva,'
  return envolver(
    `Este tdb no puede leer el registro de conexiones (db-connections.json): ${que}${copia}, ` +
      'así que no ve ninguna. Tessera no lo toca para no perder lo que tiene dentro: ' +
      `${remedio} y reinicia Tessera, que lo lee al arrancar.`
  )
}

module.exports = { leerJson, leerRegistroConexiones }
