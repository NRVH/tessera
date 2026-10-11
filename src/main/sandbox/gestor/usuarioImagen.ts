// =============================================================================
// Con qué uid y gid se hornea el usuario `agente` de la imagen del sandbox. En Linux Docker monta
// el proyecto sin traducir dueños, así que el agente tiene que ser el mismo uid que el usuario del
// equipo para escribir en él y dejarle archivos suyos; en Windows y macOS la capa de archivos de la
// VM ya lo resuelve y se queda el 1001 de la imagen. Puro: plataforma, uid y gid entran por parámetro.
// Decisiones: docs/decisiones/sandbox/usuario-de-la-imagen-en-linux.md
// =============================================================================
import type { Plataforma } from '../../../shared/plataforma.ts'

/** El uid y gid con los que se crea `agente` dentro de la imagen. */
export interface UsuarioImagen {
  uid: number
  gid: number
}

/** El que trae el Dockerfile si no se le pasa otro: el sello de una imagen sin argumentos. */
export const USUARIO_POR_DEFECTO: UsuarioImagen = { uid: 1001, gid: 1001 }

/**
 * El usuario a hornear en esta plataforma, o `null` para quedarse con el del Dockerfile.
 * Solo Linux lo necesita. Root (uid 0) tampoco: ya escribe en todo, y un `agente` con uid 0
 * sería root con otro nombre.
 */
export function usuarioImagenPara(plataforma: Plataforma, uid: number, gid: number): UsuarioImagen | null {
  if (plataforma !== 'linux') return null
  if (!Number.isInteger(uid) || !Number.isInteger(gid) || uid <= 0 || gid <= 0) return null
  return { uid, gid }
}

/** Los `--build-arg` del usuario; ninguno si se queda el del Dockerfile. */
export function argsBuildUsuario(u: UsuarioImagen | null): string[] {
  if (u === null) return []
  return ['--build-arg', `AGENTE_UID=${u.uid}`, '--build-arg', `AGENTE_GID=${u.gid}`]
}

/**
 * La imagen de este usuario: con uno horneado lleva su uid de etiqueta, para que dos usuarios
 * del mismo Docker no se la rehorneen el uno al otro con su uid en cada arranque.
 */
export function nombreImagen(base: string, u: UsuarioImagen | null): string {
  return u === null ? base : `${base}:u${u.uid}`
}

/** Lo que estampa el `LABEL tessera.sandbox.usuario` del Dockerfile. */
export function selloUsuario(u: UsuarioImagen | null): string {
  const efectivo = u ?? USUARIO_POR_DEFECTO
  return `${efectivo.uid}:${efectivo.gid}`
}

/**
 * ¿La imagen inspeccionada es la que se espera? `inspeccion` son las etiquetas de versión,
 * extras y usuario separadas por `|` (los extras llevan a su vez un `|` dentro). El usuario
 * solo se compara cuando se pidió uno: así una imagen anterior a esta etiqueta, sin ella, sigue
 * valiendo en Windows y macOS y no paga un rebuild que no cambiaría nada.
 */
export function imagenAlDia(
  inspeccion: string,
  esperado: { version: string; extras: string; usuario: UsuarioImagen | null }
): boolean {
  const partes = inspeccion.trim().split('|')
  if (partes.length < 4) return false
  const usuario = partes.pop() ?? ''
  const [version, ...extras] = partes
  if (version !== esperado.version || extras.join('|') !== esperado.extras) return false
  return esperado.usuario === null || usuario === selloUsuario(esperado.usuario)
}
