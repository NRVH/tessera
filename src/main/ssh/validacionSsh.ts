// =============================================================================
// Validación de una conexión o un grupo SSH antes de guardarlos, y la forma en que se escriben.
// Puro: el registro en uso llega por parámetro. Los campos acaban en la línea de `ssh`, así que se
// rechaza lo que ssh podría leer como una opción o expandir (`-` inicial, `%`, `${`) y lo que
// rompería la línea (espacios); el secreto, lo que cortaría su respuesta. Mensajes para el usuario.
// Decisiones: docs/decisiones/ssh/registro-y-claves.md, docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import {
  SSH_ALIAS_MAX,
  SSH_GRUPO_MAX,
  SSH_SECRETO_MAX_BYTES,
  type SshConexionInput,
  type SshEntradaAjena,
  type SshMetodo
} from '../../shared/ssh-ipc.ts'
import type { ConexionSshPersistida, GrupoSshPersistido } from './conservarAlEditarSsh.ts'

/** Lo que la validación necesita del registro en uso. */
export interface ContextoValidacionSsh {
  conexiones: readonly Pick<ConexionSshPersistida, 'id' | 'profileId' | 'alias'>[]
  grupos: readonly GrupoSshPersistido[]
  ajenas: readonly SshEntradaAjena[]
}

/** Lo que ve un error de host: el texto ya sin espacios en los extremos. */
export function errorHost(host: string): string | null {
  if (host === '') return 'Falta el host.'
  if (/\s/.test(host)) return 'El host no puede llevar espacios.'
  if (host.startsWith('-')) return 'El host no puede empezar por «-».'
  if (host.includes('@')) return 'Escribe el host sin el usuario: el usuario va en su propio campo.'
  if (host.includes('/')) return 'El host no puede llevar «/»: escribe solo el nombre o la dirección.'
  if (host.includes('${')) return 'El host no puede llevar «${».'
  if (host.includes('%')) return 'El host no puede llevar «%».'
  if (host.includes('[') || host.includes(']')) return 'Escribe la dirección IPv6 sin corchetes: el puerto va en su propio campo.'
  if ((host.match(/:/g) ?? []).length === 1) return 'El puerto va en su propio campo, no detrás del host.'
  if (host.length > 253) return 'El host es demasiado largo.'
  if (!/^[A-Za-z0-9._:-]+$/.test(host)) {
    return 'El host solo puede llevar letras sin tilde, números, puntos, guiones y «:» (en una dirección IPv6).'
  }
  return null
}

/** El usuario ya sin espacios en los extremos. */
export function errorUsuario(usuario: string): string | null {
  if (usuario === '') return 'Falta el usuario.'
  if (/\s/.test(usuario)) return 'El usuario no puede llevar espacios.'
  if (usuario.startsWith('-')) return 'El usuario no puede empezar por «-».'
  if (usuario.includes('${')) return 'El usuario no puede llevar «${».'
  if (usuario.includes('%')) return 'El usuario no puede llevar «%».'
  // eslint-disable-next-line no-control-regex -- buscar caracteres de control es justo su trabajo
  if (/[\u0000-\u001f\u007f]/.test(usuario)) return 'El usuario no puede llevar caracteres de control.'
  if (usuario.length > 255) return 'El usuario es demasiado largo.'
  return null
}

/** Entero de 1 a 65535. */
export function errorPuerto(puerto: unknown): string | null {
  return typeof puerto === 'number' && Number.isInteger(puerto) && puerto >= 1 && puerto <= 65535
    ? null
    : 'El puerto debe ser un entero entre 1 y 65535.'
}

/** ¿Choca `nombre` con otro del perfil (sin distinguir mayúsculas)? Devuelve el que choca, tal como está. */
function choque(nombre: string, otros: ReadonlyArray<{ id: string; nombre: string }>, ignorar?: string): string | undefined {
  const norma = nombre.toLowerCase()
  return otros.find((o) => o.id !== ignorar && o.nombre.trim().toLowerCase() === norma)?.nombre
}

/** Nombre de la conexión: no vacío, con tope, sin «:» y único en el perfil contando las ajenas. */
function validarAlias(input: SshConexionInput, ctx: ContextoValidacionSsh, idEditada?: string): void {
  const alias = String(input.alias ?? '').trim()
  if (!alias) throw new Error('La conexión necesita un nombre.')
  if (alias.length > SSH_ALIAS_MAX) throw new Error(`El nombre no puede pasar de ${SSH_ALIAS_MAX} caracteres.`)
  // Los agentes nombrarán la conexión delante de una ruta (`nombre:ruta`).
  if (alias.includes(':')) throw new Error('El nombre de la conexión no puede llevar «:».')
  const otros = [
    ...ctx.conexiones.filter((c) => c.profileId === input.profileId).map((c) => ({ id: c.id, nombre: c.alias })),
    ...ctx.ajenas.filter((a) => a.tipo === 'conexion' && a.profileId === input.profileId)
  ]
  const ocupado = choque(alias, otros, idEditada)
  if (ocupado !== undefined) throw new Error(`Este perfil ya tiene una conexión llamada "${ocupado}".`)
}

/** Una conexión con el método 'clave' y sin archivo: ni uno recién elegido ni el que ya tenía. */
export const MENSAJE_FALTA_CLAVE = 'Elige el archivo de la clave privada.'

/**
 * El secreto del formulario (ausente o '' siempre valen): solo con contraseña o clave, con tope en bytes
 * y sin lo que cortaría la respuesta que ssh lee del programa de contraseñas (saltos de línea, el nulo).
 */
export function errorSecreto(secreto: unknown, metodo: SshMetodo): string | null {
  if (secreto === undefined || secreto === '') return null
  if (typeof secreto !== 'string') return 'La contraseña tiene que ser un texto.'
  if (metodo !== 'contrasena' && metodo !== 'clave') return 'Con «Claves del sistema» no se guarda ninguna contraseña.'
  const que = metodo === 'clave' ? 'La frase de la clave' : 'La contraseña'
  if (/[\n\r]/.test(secreto) || secreto.includes(String.fromCharCode(0))) return `${que} no puede llevar saltos de línea ni el carácter nulo.`
  if (Buffer.byteLength(secreto, 'utf8') > SSH_SECRETO_MAX_BYTES) return `${que} no puede pasar de ${SSH_SECRETO_MAX_BYTES} bytes.`
  return null
}

/**
 * Valida una alta o una edición. Lanza con un mensaje para el usuario. Que el método 'clave' traiga
 * su archivo lo comprueba el registro, que sabe si la conexión ya tenía uno.
 */
export function validarEntradaSsh(input: SshConexionInput, ctx: ContextoValidacionSsh, idEditada?: string): void {
  if (typeof input?.profileId !== 'string' || !input.profileId) throw new Error('Una conexión requiere un perfil.')
  validarAlias(input, ctx, idEditada)
  const error = errorHost(String(input.host ?? '').trim()) ?? errorPuerto(input.puerto) ?? errorUsuario(String(input.usuario ?? '').trim())
  if (error !== null) throw new Error(error)
  if (input.metodo !== 'contrasena' && input.metodo !== 'clave' && input.metodo !== 'sistema') {
    throw new Error(`Método de autenticación desconocido: "${String(input.metodo)}".`)
  }
  const secreto = errorSecreto(input.secreto, input.metodo)
  if (secreto !== null) throw new Error(secreto)
  if (input.grupoId !== null && !ctx.grupos.some((g) => g.id === input.grupoId && g.profileId === input.profileId)) {
    throw new Error('Ese grupo ya no existe en este perfil.')
  }
}

/**
 * Los campos que se escriben, a partir de una entrada ya validada. `disponibleAgentes` va siempre
 * explícito: en un alta vale `true` si no se dice otra cosa; en una edición sin valor, el de antes.
 */
export function camposAGuardarSsh(
  input: SshConexionInput,
  previo?: Pick<ConexionSshPersistida, 'disponibleAgentes'>
): Omit<ConexionSshPersistida, 'id' | 'secretEnc' | 'clave'> {
  const disponible =
    typeof input.disponibleAgentes === 'boolean'
      ? input.disponibleAgentes
      : previo === undefined
        ? true
        : previo.disponibleAgentes === true
  const campos: Omit<ConexionSshPersistida, 'id' | 'secretEnc' | 'clave'> = {
    profileId: input.profileId,
    alias: input.alias.trim(),
    host: input.host.trim(),
    puerto: input.puerto,
    usuario: input.usuario.trim(),
    metodo: input.metodo,
    disponibleAgentes: disponible
  }
  if (input.grupoId !== null) campos.grupoId = input.grupoId
  return campos
}

/** Nombre de grupo: no vacío, con tope y único en el perfil (sin distinguir mayúsculas, contando ajenos). */
export function validarNombreGrupo(
  nombre: unknown,
  profileId: string,
  ctx: ContextoValidacionSsh,
  idEditado?: string
): string {
  if (typeof profileId !== 'string' || !profileId) throw new Error('Un grupo requiere un perfil.')
  const limpio = String(nombre ?? '').trim()
  if (!limpio) throw new Error('El grupo necesita un nombre.')
  if (limpio.length > SSH_GRUPO_MAX) throw new Error(`El nombre del grupo no puede pasar de ${SSH_GRUPO_MAX} caracteres.`)
  const otros = [
    ...ctx.grupos.filter((g) => g.profileId === profileId).map((g) => ({ id: g.id, nombre: g.nombre })),
    ...ctx.ajenas.filter((a) => a.tipo === 'grupo' && a.profileId === profileId)
  ]
  const ocupado = choque(limpio, otros, idEditado)
  if (ocupado !== undefined) throw new Error(`Este perfil ya tiene un grupo llamado "${ocupado}".`)
  return limpio
}
