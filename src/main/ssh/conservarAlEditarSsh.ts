// =============================================================================
// Forma persistida de las conexiones y los grupos SSH, qué claves gobierna esta versión y qué
// sobrevive a editar una conexión desde el formulario (puro, no muta sus argumentos). Lo que esta
// versión no gobierna sobrevive mientras no cambie a qué máquina se llega (host y puerto); una
// contraseña guardada, mientras no cambie tampoco el usuario, y la frase, mientras no cambie la clave.
// Calca `db/conservarAlEditar.ts` sin compartir código con él.
// Decisiones: docs/decisiones/ssh/registro-y-claves.md
// =============================================================================

import type { SshMetodo } from '../../shared/ssh-ipc.ts'

/** El archivo de clave tal como se guarda; lo que traiga dentro y no se conozca viaja con él. */
export interface ClaveSshPersistida {
  nombre: string
  tipo: string
  cifrada: boolean
  [otra: string]: unknown
}

/** Una conexión tal como vive en `ssh-connections.json`. */
export interface ConexionSshPersistida {
  id: string
  profileId: string
  alias: string
  /** Ausente = «Sin grupo». */
  grupoId?: string
  host: string
  puerto: number
  usuario: string
  metodo: SshMetodo
  /** Solo `true` cuenta como disponible; se escribe siempre explícito. */
  disponibleAgentes?: boolean
  /** Contraseña (o frase de la clave) cifrada, en base64. Nunca sale del main. */
  secretEnc?: string
  clave?: ClaveSshPersistida
}

/** Un grupo tal como vive en `ssh-connections.json`. */
export interface GrupoSshPersistido {
  id: string
  profileId: string
  nombre: string
}

/**
 * Qué claves de una conexión gobierna esta versión (`true`); las demás son de otra versión y se
 * conservan tal cual. `Record` completo a propósito: un campo nuevo sin decidir aquí no compila.
 */
export const CLAVES_GOBERNADAS_CONEXION: Readonly<Record<keyof ConexionSshPersistida, boolean>> = {
  id: true,
  profileId: true,
  alias: true,
  grupoId: true,
  host: true,
  puerto: true,
  usuario: true,
  metodo: true,
  clave: true,
  secretEnc: true,
  disponibleAgentes: true
}

/** Lo mismo para los grupos. */
export const CLAVES_GOBERNADAS_GRUPO: Readonly<Record<keyof GrupoSshPersistido, boolean>> = {
  id: true,
  profileId: true,
  nombre: true
}

/** ¿La gobierna esta versión en una conexión? */
export function esClaveGobernadaConexion(clave: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(CLAVES_GOBERNADAS_CONEXION, clave) &&
    CLAVES_GOBERNADAS_CONEXION[clave as keyof ConexionSshPersistida]
  )
}

/** ¿La gobierna esta versión en un grupo? */
export function esClaveGobernadaGrupo(clave: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(CLAVES_GOBERNADAS_GRUPO, clave) &&
    CLAVES_GOBERNADAS_GRUPO[clave as keyof GrupoSshPersistido]
  )
}

/**
 * El secreto y la clave guardados, en `editado`: son del método, así que con otro no valen (una
 * contraseña no es la frase de una clave); con el mismo, siguen salvo que el formulario traiga otros.
 * `secreto === ''` es el usuario borrándolo; la frase es de SU clave: con una clave nueva no vale.
 */
function conservarDelMetodo(
  previoCrudo: Record<string, unknown>,
  nuevo: ConexionSshPersistida,
  mismaMaquina: boolean,
  editado: Record<string, unknown>,
  secreto: string | undefined
): void {
  if (previoCrudo.metodo !== nuevo.metodo) return
  // Una contraseña viaja al servidor: con otro destino (una errata en el host basta) se descarta, como
  // si la hubiera borrado el usuario. La frase de una clave se usa aquí y no viaja: se queda.
  const contrasenaAOtroDestino = nuevo.metodo === 'contrasena' && !(mismaMaquina && previoCrudo.usuario === nuevo.usuario)
  const fraseDeOtraClave = nuevo.metodo === 'clave' && nuevo.clave !== undefined
  if (previoCrudo.secretEnc !== undefined && nuevo.secretEnc === undefined && secreto !== '' && !contrasenaAOtroDestino && !fraseDeOtraClave) {
    editado.secretEnc = previoCrudo.secretEnc
  }
  if (previoCrudo.clave !== undefined && nuevo.clave === undefined) editado.clave = previoCrudo.clave
}

/**
 * La conexión tras editarla.
 *
 * @param previoCrudo  la entrada guardada COMPLETA (lo gobernado y lo que no), tal como va a disco.
 * @param nuevo        lo reconstruido del formulario, ya validado; con `secretEnc` o `clave` si llegan nuevos
 *                     (una `clave` aquí es SIEMPRE una recién elegida: la guardada la rescata esta función).
 * @param grupoConocido si un id es de un grupo conocido del perfil: un `grupoId` que no lo es no lo
 *                     pudo quitar el formulario, que ni lo enseña, y sobrevive hasta elegir otro.
 * @param secreto      el del formulario: ausente conserva, '' borra y un texto ya viene cifrado en `nuevo`.
 */
export function conservarAlEditarSsh(
  previoCrudo: Record<string, unknown>,
  nuevo: ConexionSshPersistida,
  grupoConocido: (id: string) => boolean,
  secreto?: string
): Record<string, unknown> {
  const mismaMaquina = previoCrudo.host === nuevo.host && previoCrudo.puerto === nuevo.puerto
  // `Object.fromEntries` y no una asignación: crea propiedades propias incluso para un `__proto__`.
  const noGobernadas = mismaMaquina
    ? Object.fromEntries(Object.entries(previoCrudo).filter(([k, v]) => !esClaveGobernadaConexion(k) && v !== undefined))
    : {}
  const editado: Record<string, unknown> = { ...noGobernadas, ...nuevo }
  conservarDelMetodo(previoCrudo, nuevo, mismaMaquina, editado, secreto)
  const grupoPrevio = previoCrudo.grupoId
  const previoDesconocido =
    grupoPrevio !== undefined && grupoPrevio !== null && !(typeof grupoPrevio === 'string' && grupoConocido(grupoPrevio))
  if (nuevo.grupoId === undefined && previoDesconocido) editado.grupoId = grupoPrevio
  return editado
}
