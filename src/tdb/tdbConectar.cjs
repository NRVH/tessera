// =============================================================================
// Cómo `tdb` abre una conexión: el secreto solo llega al DESTINO para el que Tessera lo
// emitió (huella), y sin él se dice qué falta antes de tocar el servidor.
// Depende de `motores.cjs`, `tdbConexiones.cjs` y `tdbSalida.cjs`; lo usan los comandos.
// Decisiones: docs/decisiones/bd/puente-huella-del-destino.md
// =============================================================================
'use strict'

const motoresTdb = require('./motores.cjs')
const { adaptador } = require('./tdbConexiones.cjs')
const { fallar } = require('./tdbSalida.cjs')

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
 * como UN valor más, una lista, solo si trae alguno: la huella de un motor de red no cambia.
 */
function huellaDestino(con) {
  const valores = [con.motor, con.host, con.port, con.database, con.sid, con.user]
  if (con.archivo !== undefined) valores.push(con.archivo)
  if (con.instancia !== undefined || con.autenticacion !== undefined || con.dominio !== undefined || con.tls !== undefined) {
    valores.push([con.instancia, con.autenticacion, con.dominio, con.tls].map((v) => (v === undefined ? null : v)))
  }
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
  if (cambio === 'entorno') {
    // Sin puente la contraseña se fijó al abrir la terminal; si el archivo se editó a mano
    // con Tessera abierta, recargar la terminal no basta: de ahí el «si sigue igual».
    fallar(
      ctx,
      `La conexión "${con.alias}" cambió desde que se abrió esta terminal (su servidor, puerto,\n` +
        '    base o usuario ya no son los de entonces), así que tdb no le manda la contraseña de\n' +
        '    entonces. Recarga la terminal (o "Reiniciar" en la cabecera del agente) para usarla;\n' +
        '    si sigue igual (db-connections.json se editó a mano con Tessera abierta), reinicia Tessera.',
      { destinoCambiado: true }
    )
  }
  // Con puente lo servido es de la memoria de Tessera y lo leído es del disco.
  fallar(
    ctx,
    `La conexión "${con.alias}" del registro no es la que tiene cargada Tessera (cambió mientras\n` +
      '    tdb la leía, o se editó db-connections.json a mano con Tessera abierta), así que tdb no\n' +
      '    le manda su contraseña. Vuelve a intentarlo; si sigue igual, reinicia Tessera.',
    { destinoCambiado: true }
  )
}

/**
 * Sin secreto en la sesión. Con la contraseña OPCIONAL no es un error (se abre sin ella y,
 * si el servidor la pide, lo dirá él), salvo con el puente caído —no se sabe si la tiene— o
 * sin puente con una guardada que no llegó. Con contraseña obligatoria se dice el motivo
 * exacto, porque «no la has guardado» y «el puente no contestó» se arreglan distinto.
 * Devuelve la sesión si se abre sin contraseña.
 */
function abrirSinSecreto(ctx, con) {
  if (motoresTdb.secretoOpcional(con.motor)) {
    if (ctx.puente === 'no responde') {
      fallar(
        ctx,
        `El puente de Tessera no responde, así que tdb no sabe si "${con.alias}" tiene contraseña.\n` +
          `    Recarga la terminal; si sigue igual, reinicia Tessera.  (tdb doctor)`
      )
    }
    if (ctx.puente !== 'vivo' && tieneSecretoGuardado(con)) {
      fallar(
        ctx,
        `"${con.alias}" tiene contraseña guardada, pero no llegó a esta terminal (se guardó después\n` +
          '    de abrirla). Recarga la terminal (o "Reiniciar" en la cabecera del agente) para usarla.'
      )
    }
    return adaptador(ctx, con).abrir(con, undefined, ctx)
  }
  if (ctx.puente === 'no responde') {
    fallar(
      ctx,
      `El puente de Tessera no responde, así que no hay credenciales para "${con.alias}".\n` +
        `    La contraseña SÍ está guardada; lo que falla es la conexión con Tessera.\n` +
        `    Recarga la terminal; si sigue igual, reinicia Tessera.  (tdb doctor)`
    )
  }
  fallar(
    ctx,
    `No hay contraseña para "${con.alias}" en esta sesión.\n` +
      `    Guárdala con "Editar conexión…" en la vista Bases de datos de Tessera y reabre la terminal.`
  )
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
  if (secreto === undefined) return abrirSinSecreto(ctx, con)
  return adaptador(ctx, con).abrir(con, secreto, ctx)
}

module.exports = { secretoDe, conectar }
