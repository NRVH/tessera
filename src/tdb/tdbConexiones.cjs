// =============================================================================
// Qué conexiones sabe usar `tdb`: forma conocida, ids repetidos, búsqueda por alias o id y
// carga del adaptador de su motor por el mapa de `motores.cjs`.
// Una entrada que no sabe usar falla con un error explícito, no cae en el adaptador de otro.
// Depende de `motores.cjs` y `tdbSalida.cjs`; lo usan los comandos de `tdb*.cjs`.
// Decisiones: docs/decisiones/bd/tdb-registro-como-el-main.md
// =============================================================================
'use strict'

const motoresTdb = require('./motores.cjs')
const { fallar } = require('./tdbSalida.cjs')

/** ¿Tiene adaptador este motor? Lo que no está en el mapa de `motores.cjs` no se intenta. */
function motorConocido(motor) {
  return motoresTdb.esMotor(motor)
}

/**
 * El nombre con que se enseña una conexión: su alias o, si no trae uno legible, su id
 * (como hace la UI con una ajena), y «(sin nombre)» si tampoco lo tiene.
 */
function nombreDe(con) {
  if (typeof con.alias === 'string' && con.alias.trim()) return con.alias
  if (typeof con.id === 'string' && con.id.trim()) return con.id
  return '(sin nombre)'
}

/** El motor tal como se enseña en un texto: el del registro o, si no es legible, «desconocido». */
function motorLegible(motor) {
  return typeof motor === 'string' && motor.trim() ? motor : 'desconocido'
}

/**
 * ¿Tiene la FORMA de una conexión que este `tdb` sabe usar? La misma forma mínima con la
 * que el main decide qué es conocido y qué es ajeno (`tieneFormaConocida`, en
 * `src/main/db/registroConexiones.ts`): motor con adaptador, id, perfil y alias de texto, y
 * la forma del motor (`tieneFormaDelMotor` de `motores.cjs`). Usarla pide además que no sea
 * la copia de otra: `entendida`.
 */
function formaConocida(con) {
  return (
    motorConocido(con.motor) &&
    typeof con.id === 'string' &&
    typeof con.profileId === 'string' &&
    typeof con.alias === 'string' &&
    motoresTdb.tieneFormaDelMotor(con)
  )
}

/**
 * Las entradas con la forma conocida cuyo id YA LO TIENE una anterior del archivo, cada una
 * con esa anterior. La misma regla que el main (`entradasDeLista`): el secreto va por id, así
 * que la copia abriría el servidor de la otra con su contraseña. La llena
 * `marcarIdsRepetidos` sobre TODAS las entradas. Un `WeakMap` y no una marca en el objeto:
 * `ls --json` saca la entrada tal cual.
 */
const ID_REPETIDO = new WeakMap()

/** Apunta en `ID_REPETIDO` las copias de `todas` (en el orden del archivo). */
function marcarIdsRepetidos(todas) {
  const primeras = new Map()
  for (const c of todas) {
    if (!formaConocida(c)) continue
    const primera = primeras.get(c.id)
    if (primera) ID_REPETIDO.set(c, primera)
    else primeras.set(c.id, c)
  }
}

/** ¿Es la copia de otra conexión con su mismo id? */
function esIdRepetido(con) {
  return ID_REPETIDO.has(con)
}

/**
 * Con quién comparte su id una copia, para decirlo: el alias de la otra si es del MISMO
 * perfil (`comparteCon`), o nada si es de otro, como la UI. `null` si no es una copia.
 */
function idRepetidoDe(con) {
  const primera = ID_REPETIDO.get(con)
  if (!primera) return null
  return primera.profileId === con.profileId ? { comparteCon: primera.alias } : {}
}

/** ¿La sabe usar este `tdb`? La forma conocida y que no sea la copia de otra. */
function entendida(con) {
  return formaConocida(con) && !ID_REPETIDO.has(con)
}

/**
 * Falla con el error explícito si la conexión no es una que este `tdb` sepa usar. El
 * `--json` lleva el mismo contrato que la marca de `ls --json`: `idRepetido`,
 * `motorDesconocido` o `formaDesconocida` como booleano y el motor en `motor`. Un motor sin
 * adaptador se da por de una versión más nueva («actualiza Tessera»); una forma que no se
 * reconoce puede ser eso o una edición a mano; en ninguno se sugiere borrarla.
 */
function exigirConocida(ctx, con) {
  if (entendida(con)) return
  const repetido = idRepetidoDe(con)
  if (repetido) {
    const otra = repetido.comparteCon !== undefined ? `"${repetido.comparteCon}"` : 'una conexión de otro perfil'
    fallar(
      ctx,
      `"${nombreDe(con)}" comparte su identificador con ${otra}: este tdb no puede distinguirlas\n` +
        '    y usa la primera del registro. Tessera la conserva tal cual; elimínala desde\n' +
        '    Tessera si sobra.',
      { idRepetido: true, motor: con.motor, ...repetido }
    )
  }
  if (!motorConocido(con.motor)) {
    fallar(ctx, `"${nombreDe(con)}" es de un motor (${motorLegible(con.motor)}) que este tdb no conoce: actualiza Tessera`, {
      motorDesconocido: true,
      motor: con.motor
    })
  }
  fallar(
    ctx,
    `"${nombreDe(con)}" está guardada de una forma que este tdb no reconoce.\n` +
      '    Puede venir de una versión más nueva de Tessera (actualiza para usarla) o de una\n' +
      '    edición a mano del archivo; Tessera la conserva tal cual.',
    { formaDesconocida: true, motor: con.motor }
  )
}

/** Busca por alias (sin caja ni espacios sobrantes) o por id; falla si no hay ninguna usable. */
function buscarConexion(ctx, alias) {
  const objetivo = String(alias).trim().toLowerCase()
  const con =
    ctx.conexiones.find((c) => typeof c.alias === 'string' && c.alias.trim().toLowerCase() === objetivo) ||
    ctx.conexiones.find((c) => typeof c.id === 'string' && c.id.toLowerCase() === objetivo)
  if (!con) {
    // Con un formato que no se reconoce no hay ninguna que buscar, y «Disponibles:
    // (ninguna)» a secas se leería como un registro vacío.
    if (ctx.formatoAjeno) fallar(ctx, ctx.avisoRegistro, { formatoAjeno: true })
    // «Disponibles» son las que se pueden USAR, con el mismo nombre que les da `ls`.
    const usables = ctx.conexiones.filter(entendida)
    const disponibles = usables.map((c) => `"${nombreDe(c)}"`).join(', ') || '(ninguna)'
    const otras = ctx.conexiones.length - usables.length
    fallar(
      ctx,
      `No hay ninguna conexión llamada "${alias}" en este perfil.\n    Disponibles: ${disponibles}` +
        (otras > 0 ? `\n    (y ${otras} que este tdb no sabe usar: tdb ls)` : '')
    )
  }
  // Aquí y no al conectar: antes que la guardia de solo lectura y que la contraseña, cuyos
  // mensajes darían un consejo equivocado para una conexión que este `tdb` no sabe usar.
  exigirConocida(ctx, con)
  return con
}

/** El adaptador de CLI del motor de la conexión (`MOTORES[motor].cli`, relativo a esta carpeta). */
function adaptador(ctx, con) {
  // Segunda capa: un camino que llegara sin pasar por `buscarConexion` no debe caer en el
  // adaptador de otro motor.
  exigirConocida(ctx, con)
  return require(motoresTdb.MOTORES[con.motor].cli)
}

/** ¿Es de la familia de CLAVES? Un `switch` con cierre: una familia nueva tiene que decidir aquí. */
function esFamiliaClaves(motor) {
  const f = motoresTdb.MOTORES[motor].familia
  switch (f) {
    case 'claves':
      return true
    case 'sql':
    case 'documentos':
      return false
    default:
      throw new Error(`Caso sin contemplar en esFamiliaClaves: ${JSON.stringify(f)}`)
  }
}

module.exports = {
  motorConocido,
  nombreDe,
  motorLegible,
  formaConocida,
  marcarIdsRepetidos,
  esIdRepetido,
  idRepetidoDe,
  entendida,
  buscarConexion,
  adaptador,
  esFamiliaClaves
}
