// =============================================================================
// Los motores que saben usar `tdb` y el proceso de sesión: su etiqueta, adaptadores, forma de
// entrada en disco, credenciales y destino de `ls`, como DATOS y nunca como `motor === …`.
// Copia mínima del registro de `src/shared/motores/` (este CJS no puede importar TypeScript);
// `test-motores-tdb.mts` fija la paridad. Las rutas son relativas a esta carpeta.
// Decisiones: docs/decisiones/bd/tdb-motores-por-datos.md
// =============================================================================
'use strict'

const path = require('node:path')

/**
 * Por motor: su nombre visible (`etiqueta`), su `familia`, el adaptador del CLI (`cli`) y el
 * del proceso de sesión (`sesion`), la forma de su entrada en disco (`forma`), sus credenciales
 * (con 'ninguna', `tdb` no pide contraseña), quién impone el solo lectura y sus campos
 * `opcionales`. Cada campo es el homónimo del descriptor de shared, y el orden de las claves es
 * el del registro (el del selector del formulario).
 */
const MOTORES = Object.freeze({
  oracle: Object.freeze({
    etiqueta: 'Oracle',
    familia: 'sql',
    cli: './oracle.cjs',
    sesion: './sesionOracle.cjs',
    forma: Object.freeze(['host', 'port']),
    credenciales: 'usuarioClave',
    candadoSoloLectura: 'transaccionSoloLectura',
    opcionales: Object.freeze([])
  }),
  postgres: Object.freeze({
    etiqueta: 'PostgreSQL',
    familia: 'sql',
    cli: './postgres.cjs',
    sesion: './sesionPostgres.cjs',
    forma: Object.freeze(['host', 'port']),
    credenciales: 'usuarioClave',
    candadoSoloLectura: 'envoltorioRollback',
    opcionales: Object.freeze([])
  }),
  sqlite: Object.freeze({
    etiqueta: 'SQLite',
    familia: 'sql',
    cli: './sqlite.cjs',
    sesion: './sesionSqlite.cjs',
    forma: Object.freeze(['archivo']),
    credenciales: 'ninguna',
    candadoSoloLectura: 'autorizador',
    opcionales: Object.freeze([])
  }),
  sqlserver: Object.freeze({
    etiqueta: 'SQL Server',
    familia: 'sql',
    cli: './sqlserver.cjs',
    sesion: './sesionSqlserver.cjs',
    forma: Object.freeze(['host', 'port']),
    credenciales: 'usuarioClave',
    candadoSoloLectura: 'clasificadorYEnvoltorio',
    opcionales: Object.freeze(['database', 'instancia', 'autenticacion', 'dominio', 'tls'])
  }),
  mongodb: Object.freeze({
    etiqueta: 'MongoDB',
    familia: 'documentos',
    cli: './mongodb.cjs',
    sesion: './sesionMongodb.cjs',
    forma: Object.freeze(['host', 'port']),
    credenciales: 'usuarioClave',
    candadoSoloLectura: 'listaBlanca',
    opcionales: Object.freeze(['user', 'database', 'tls', 'srv', 'opcionesUri'])
  }),
  redis: Object.freeze({
    etiqueta: 'Redis',
    familia: 'claves',
    cli: './redis.cjs',
    sesion: './sesionRedis.cjs',
    forma: Object.freeze(['host', 'port']),
    credenciales: 'usuarioClave',
    candadoSoloLectura: 'listaBlanca',
    opcionales: Object.freeze(['user', 'database', 'tls'])
  })
})

/** Cierre de un `switch` exhaustivo (= `nunca` de `shared/nunca.ts`, que este CJS no puede importar). */
function nunca(valor, contexto) {
  throw new Error(`Caso sin contemplar en ${contexto}: ${JSON.stringify(valor)}`)
}

/** ¿Hay que mandarle una contraseña? (= `pideUsuarioYClave` de shared). */
function pideSecreto(motor) {
  const c = MOTORES[motor].credenciales
  switch (c) {
    case 'usuarioClave':
      return true
    case 'ninguna':
      return false
    default:
      return nunca(c, 'pideSecreto')
  }
}

/**
 * ¿Pone `tdb` su guardia por PREFIJO delante de una conexión de solo lectura? Solo donde el
 * muro es del servidor; donde lo es el autorizador (una base de archivo), la guardia es él, que
 * ve lo que la sentencia hace: un `PRAGMA table_info` es lectura y un `ATTACH` no.
 */
function guardiaPorPrefijo(motor) {
  const c = MOTORES[motor].candadoSoloLectura
  switch (c) {
    case 'transaccionSoloLectura':
    case 'envoltorioRollback':
      return true
    case 'autorizador':
      return false
    // SQL Server: el servidor no tiene candado y el prefijo no basta (`SELECT 1\nDELETE …` sin
    // `;` se ejecuta entero). `true` solo dice «hay guardia delante»: la de verdad es la del
    // adaptador (`guardiaDeTessera`), que aplica el prefijo POR LOTE con los inicios de T-SQL,
    // no el `esSoloLectura` de `tdb.cjs`.
    case 'clasificadorYEnvoltorio':
      return true
    // Sin SQL no hay prefijo que mirar: la guardia es la lista blanca del adaptador.
    case 'listaBlanca':
      return false
    default:
      return nunca(c, 'guardiaPorPrefijo')
  }
}

/**
 * ¿Impone `tdb` el solo lectura POR SU CUENTA, porque el servidor no lo hace? Con
 * 'clasificadorYEnvoltorio' (SQL Server) clasifica la sentencia ENTERA y la ejecuta dentro de
 * `BEGIN TRAN; … ROLLBACK`; con 'listaBlanca' (MongoDB, Redis) interpreta la operación y solo
 * deja pasar las de lectura. En los demás, el muro es del servidor o del autorizador.
 */
function guardiaDeTessera(motor) {
  const c = MOTORES[motor].candadoSoloLectura
  switch (c) {
    case 'transaccionSoloLectura':
    case 'envoltorioRollback':
    case 'autorizador':
      return false
    case 'clasificadorYEnvoltorio':
    case 'listaBlanca':
      return true
    default:
      return nunca(c, 'guardiaDeTessera')
  }
}

/**
 * ¿Es un motor de la familia SQL? Para lo que solo tiene sentido con SQL (la ayuda que habla
 * de lotes GO y de EXEC). Un `switch` con `nunca` sobre la familia, no un `=== 'sql'` suelto
 * (= `esMotorSql` de shared): una familia nueva tiene que decidir aquí.
 */
function esFamiliaSql(motor) {
  const f = MOTORES[motor].familia
  switch (f) {
    case 'sql':
      return true
    case 'documentos':
    case 'claves':
      return false
    default:
      return nunca(f, 'esFamiliaSql')
  }
}

/** ¿Es de la familia de DOCUMENTOS? (la ayuda de `query` de MongoDB). */
function esFamiliaDocumentos(motor) {
  const f = MOTORES[motor].familia
  switch (f) {
    case 'documentos':
      return true
    case 'sql':
    case 'claves':
      return false
    default:
      return nunca(f, 'esFamiliaDocumentos')
  }
}

/**
 * ¿Puede faltar la contraseña sin que sea un error? Cuando el motor la admite (`pideSecreto`)
 * pero el usuario es OPCIONAL (MongoDB sin autenticar, Redis con la clave sola o sin ninguna).
 * Con los demás, `false`: sin ella, `tdb` dice «No hay contraseña».
 */
function secretoOpcional(motor) {
  return esMotor(motor) && pideSecreto(motor) && usaOpcional(motor, 'user')
}

/** El tipo JSON de cada campo de la forma (= `TIPO_CAMPO_FORMA` de `shared/motores/definir.ts`). */
const TIPO_CAMPO_FORMA = Object.freeze({ host: 'string', port: 'number', archivo: 'string' })

/** ¿Es el id de un motor que este `tdb` sabe usar? `hasOwnProperty` y no `in`: «constructor» o «__proto__» no lo son. */
function esMotor(motor) {
  return typeof motor === 'string' && Object.prototype.hasOwnProperty.call(MOTORES, motor)
}

/**
 * ¿Tiene la entrada CRUDA la forma que su motor exige en disco? (= `tieneFormaDelMotor` de
 * shared). El motor tiene que ser uno de aquí y cada campo de su `forma`, de su tipo.
 */
function tieneFormaDelMotor(con) {
  if (!con || !esMotor(con.motor)) return false
  return MOTORES[con.motor].forma.every((campo) => typeof con[campo] === TIPO_CAMPO_FORMA[campo])
}

/** ¿Es de un motor de ARCHIVO? (su forma lleva 'archivo'; = `conexion.deArchivo` de shared). */
function deArchivo(motor) {
  return esMotor(motor) && MOTORES[motor].forma.indexOf('archivo') >= 0
}

/**
 * La columna DESTINO de `tdb ls` (= `destinoLegible(c, 'ls')` de shared, con el
 * `archivoVisible` que calcula el main con el `basename` de esta misma plataforma).
 */
function destinoLs(c) {
  // Los que no son SQL escriben `host:puerto/base` con la base posiblemente vacía y sin SID
  // (= `destinoDeRedUsuarioOpcional` de shared). Un motor desconocido sigue por el camino de
  // red de siempre, como en shared.
  if (esMotor(c.motor) && !esFamiliaSql(c.motor)) return `${c.host}:${c.port}/${c.database || ''}`
  if (deArchivo(c.motor)) return typeof c.archivo === 'string' ? path.basename(c.archivo) : ''
  // Un motor con instancia (SQL Server) escribe `host\INSTANCIA` sin puerto y sin SID
  // (= `destinoSqlServer` de shared).
  if (usaOpcional(c.motor, 'instancia')) {
    const servidor = c.instancia ? `${c.host}\\${c.instancia}` : `${c.host}:${c.port}`
    return `${servidor}/${c.database || ''}`
  }
  return `${c.host}:${c.port}/${c.database || c.sid || ''}`
}

/** ¿Usa el motor este campo sin exigirlo? (= `usaOpcional` de shared: `conexion.opcionales`). */
function usaOpcional(motor, campo) {
  return esMotor(motor) && MOTORES[motor].opcionales.indexOf(campo) >= 0
}

/**
 * La columna USUARIO de `tdb ls`: `DOMINIO\usuario` con una cuenta de dominio, como lo escribe
 * SQL Server (= `usuarioDe` de `shared/motores/sqlserver.ts`); un motor sin dominio da el
 * usuario de siempre. Con el usuario OPCIONAL y sin él, '' (la celda vacía), nunca `undefined`.
 */
function usuarioLs(c) {
  if (usaOpcional(c.motor, 'user')) return typeof c.user === 'string' ? c.user : ''
  if (!usaOpcional(c.motor, 'dominio')) return c.user
  // Perezoso y solo aquí: `sqlserverComun` no carga tedious al requerirse, pero un `ls` sin
  // ninguna SQL Server no tiene por qué leerlo.
  const aut = require('./sqlserverComun.cjs')
  const a = aut.esAutenticacion(c.autenticacion) ? c.autenticacion : 'sql'
  return aut.pideDominio(a) && c.dominio ? `${c.dominio}\\${c.user}` : c.user
}

module.exports = {
  MOTORES,
  TIPO_CAMPO_FORMA,
  esMotor,
  tieneFormaDelMotor,
  deArchivo,
  destinoLs,
  usaOpcional,
  usuarioLs,
  pideSecreto,
  guardiaPorPrefijo,
  guardiaDeTessera,
  esFamiliaSql,
  esFamiliaDocumentos,
  secretoOpcional
}
