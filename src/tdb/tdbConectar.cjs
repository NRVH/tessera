// =============================================================================
// Cómo `tdb` abre una conexión: el secreto solo llega al DESTINO para el que Tessera lo
// emitió (huella), sin él se dice qué falta antes de tocar el servidor, y una conexión con
// túnel SSH va al extremo local que abre Tessera (`db.tunel`).
// Depende de `motores.cjs`, `tdbConexiones.cjs`, `tdbPuente.cjs`, `tdbSalida.cjs` y `textosTdb.cjs`;
// lo usan los comandos.
// Decisiones: docs/decisiones/bd/puente-huella-del-destino.md, docs/decisiones/bd/conexiones-tunel-ssh.md
// =============================================================================
'use strict'

const motoresTdb = require('./motores.cjs')
const { adaptador } = require('./tdbConexiones.cjs')
const { fallar } = require('./tdbSalida.cjs')
const { pedirTunel } = require('./tdbPuente.cjs')
const { textosTdb } = require('./textosTdb.cjs')

/**
 * Nombre de la variable de entorno con el secreto de una conexión, derivado de su
 * **id** (no del alias: ese es un nombre libre del usuario y puede llevar espacios
 * o acentos). DEBE coincidir con `envVarSecreto` de `src/shared/db-ipc.ts`.
 */
function envVarSecreto(connectionId) {
  return `TESSERA_DB_SECRET_${String(connectionId).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

/**
 * La variable con la HUELLA del destino para el que se emitió ese secreto. DEBE coincidir
 * con `envVarDestino` de `src/shared/db-ipc.ts`.
 */
function envVarDestino(connectionId) {
  return `TESSERA_DB_DESTINO_${String(connectionId).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

/**
 * La huella del destino de una entrada del registro: a qué servidor, por qué protocolo y
 * como quién se manda su contraseña. COPIA de `huellaDestino` de
 * `src/main/db/huellaDestino.ts` (el porqué, allí); `test-shim` fija que las dos dan lo
 * mismo. Los valores van tal cual salen del JSON. El `archivo` va como séptimo valor SOLO
 * si la entrada lo trae, y los de SQL Server (instancia, autenticación, dominio, cifrado)
 * como UN valor más, una lista, solo si trae alguno, y los de MongoDB (`srv`, `opcionesUri`) como
 * otra, igual, el túnel SSH como `['ssh', conexionId]` solo si lo trae y la topología de Redis como
 * `['redis', topologia]`, igual: la huella de un motor de red no cambia.
 */
function huellaDestino(con) {
  const valores = [con.motor, con.host, con.port, con.database, con.sid, con.user]
  if (con.archivo !== undefined) valores.push(con.archivo)
  if (con.instancia !== undefined || con.autenticacion !== undefined || con.dominio !== undefined || con.tls !== undefined) {
    valores.push([con.instancia, con.autenticacion, con.dominio, con.tls].map((v) => (v === undefined ? null : v)))
  }
  if (con.srv !== undefined || con.opcionesUri !== undefined) {
    valores.push([con.srv, con.opcionesUri].map((v) => (v === undefined ? null : v)))
  }
  if (con.tunelSsh !== undefined) {
    const id = con.tunelSsh && con.tunelSsh.conexionId
    valores.push(['ssh', id === undefined ? null : id])
  }
  if (con.topologiaRedis !== undefined) valores.push(['redis', con.topologiaRedis])
  const campos = valores.map((v) => (v === undefined ? null : v))
  return require('node:crypto').createHash('sha256').update(JSON.stringify(campos), 'utf8').digest('hex').slice(0, 32)
}

/**
 * Secreto de una conexión: primero lo que sirvió el PUENTE (fresco, acotado a lo que está
 * montado ahora), y si no hay puente, la variable de entorno del pty. Solo para el destino
 * para el que se emitió: si la huella de `con` (leída del DISCO) no es la que vino con el
 * secreto, la entrada de ese id ya no es aquella y mandarle la contraseña sería mandársela
 * a otro servidor. Un secreto sin huella tampoco se usa.
 *
 * @returns `{ secreto }`; `{ cambio: 'entorno' | 'puente' }` si hay secreto pero es de otro
 *          destino (el origen decide el remedio); o `{}` si no hay ninguno.
 */
function secretoDe(ctx, con) {
  const id = con.id
  const huella = huellaDestino(con)
  if (ctx.secretos && Object.prototype.hasOwnProperty.call(ctx.secretos, id)) {
    const casa = ctx.huellas !== null && ctx.huellas !== undefined && ctx.huellas[id] === huella
    return casa ? { secreto: ctx.secretos[id] } : { cambio: 'puente' }
  }
  const secreto = process.env[envVarSecreto(id)]
  if (secreto === undefined) return {}
  return process.env[envVarDestino(id)] === huella ? { secreto } : { cambio: 'entorno' }
}

/**
 * ¿Dice el registro que la conexión tiene contraseña guardada? Es el `secretEnc` que escribe
 * el main (cifrado: aquí solo se mira que exista). Solo decide el MENSAJE de una contraseña
 * opcional que no llegó.
 */
function tieneSecretoGuardado(con) {
  return typeof con.secretEnc === 'string' && con.secretEnc !== ''
}

/** El destino de la conexión cambió desde que se emitió el secreto: el remedio depende del origen. */
function fallarDestinoCambiado(ctx, con, cambio) {
  const t = textosTdb()
  // Sin puente la contraseña se fijó al abrir la terminal; si el archivo se editó a mano
  // con Tessera abierta, recargar la terminal no basta: de ahí el «si sigue igual».
  if (cambio === 'entorno') fallar(ctx, t.destinoCambiadoEntorno(con.alias), { destinoCambiado: true })
  // Con puente lo servido es de la memoria de Tessera y lo leído es del disco.
  fallar(ctx, t.destinoCambiadoPuente(con.alias), { destinoCambiado: true })
}

/**
 * Sin secreto en la sesión. Con la contraseña OPCIONAL no es un error (se abre sin ella y,
 * si el servidor la pide, lo dirá él), salvo con el puente caído —no se sabe si la tiene— o
 * sin puente con una guardada que no llegó. Con contraseña obligatoria se dice el motivo
 * exacto, porque «no la has guardado» y «el puente no contestó» se arreglan distinto.
 * Devuelve la sesión si se abre sin contraseña.
 */
function abrirSinSecreto(ctx, con) {
  const t = textosTdb()
  if (motoresTdb.secretoOpcional(con.motor)) {
    if (ctx.puente === 'no responde') fallar(ctx, t.puenteNoRespondeOpcional(con.alias))
    if (ctx.puente !== 'vivo' && tieneSecretoGuardado(con)) fallar(ctx, t.secretoNoLlego(con.alias))
    return adaptador(ctx, con).abrir(con, undefined, ctx)
  }
  if (ctx.puente === 'no responde') fallar(ctx, t.puenteNoRespondeObligatorio(con.alias))
  fallar(ctx, t.sinContrasena(con.alias))
}

/** Abre la sesión de la conexión con su adaptador y el secreto que le corresponda. */
async function conectar(ctx, con) {
  // Un motor SIN credenciales (una base de archivo) no tiene secreto que buscar ni huella
  // que casar: no hay destino al que mandar una contraseña.
  if (motoresTdb.esMotor(con.motor) && !motoresTdb.pideSecreto(con.motor)) {
    return adaptador(ctx, con).abrir(con, undefined, ctx)
  }
  const { secreto, cambio } = secretoDe(ctx, con)
  if (cambio !== undefined) fallarDestinoCambiado(ctx, con, cambio)
  // La huella se comprobó contra la entrada del disco; el driver va al extremo del túnel.
  const destino = await porTunel(ctx, con)
  if (secreto === undefined) return abrirSinSecreto(ctx, destino)
  return adaptador(ctx, destino).abrir(destino, secreto, ctx)
}

/**
 * La conexión tal como la abre el driver: sin túnel, la misma; con túnel SSH, al extremo local que
 * abre Tessera (`db.tunel`), verificando el certificado contra el host real (`hostTls`). El túnel
 * solo lo abre Tessera: sin puente, se dice y no se intenta la conexión directa.
 */
async function porTunel(ctx, con) {
  if (con.tunelSsh === undefined || con.tunelSsh === null) return con
  const pipe = process.env.TESSERA_DB_PIPE
  const token = ctx.fichaTunel || process.env.TESSERA_DB_SESSION
  const t = textosTdb()
  if (ctx.puente !== 'vivo' || !pipe || !token) fallar(ctx, t.tunelSinPuente(con.alias))
  const r = await pedirTunel(pipe, token, con.id)
  if (!r || !r.ok) fallar(ctx, t.tunelFallo(con.alias, r ? r.error : t.tunelSinRespuesta))
  return { ...con, host: r.host, port: r.port, hostTls: con.host }
}

module.exports = { secretoDe, conectar }
