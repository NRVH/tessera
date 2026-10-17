// =============================================================================
// Validación de una conexión o un grupo SSH antes de guardarlos, y la forma en que se escriben.
// Puro: el registro en uso llega por parámetro. Los campos acaban en la línea de `ssh`, así que se
// rechaza lo que ssh podría leer como una opción o expandir (`-` inicial, `%`, `${`) y lo que
// rompería la línea (espacios); el secreto, lo que cortaría su respuesta; el bastión, un círculo o un hueco
// en la cadena. Mensajes para el usuario.
// Decisiones: docs/decisiones/ssh/registro-y-claves.md, docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import {
  SSH_ALIAS_MAX,
  SSH_GRUPO_MAX,
  SSH_SALTOS_MAX,
  SSH_SECRETO_MAX_BYTES,
  SSH_TUNELES_MAX,
  type SshConexionInput,
  type SshEntradaAjena,
  type SshMetodo,
  type SshTunel
} from '../../shared/ssh-ipc.ts'
import { esObjeto } from '../util/valores.ts'
import type { ConexionSshPersistida, GrupoSshPersistido } from './conservarAlEditarSsh.ts'
import { txSsh } from './textos.ts'

/** Lo que la validación necesita del registro en uso. */
export interface ContextoValidacionSsh {
  conexiones: readonly Pick<ConexionSshPersistida, 'id' | 'profileId' | 'alias' | 'saltoId'>[]
  grupos: readonly GrupoSshPersistido[]
  ajenas: readonly SshEntradaAjena[]
}

/** Lo que ve un error de host: el texto ya sin espacios en los extremos. */
export function errorHost(host: string): string | null {
  const t = txSsh().validacion
  if (host === '') return t.hostFalta
  if (/\s/.test(host)) return t.hostEspacios
  if (host.startsWith('-')) return t.hostGuion
  if (host.includes('@')) return t.hostArroba
  if (host.includes('/')) return t.hostBarra
  if (host.includes('${')) return t.hostDolar
  if (host.includes('%')) return t.hostPorciento
  if (host.includes('[') || host.includes(']')) return t.hostCorchetes
  if ((host.match(/:/g) ?? []).length === 1) return t.hostPuerto
  if (host.length > 253) return t.hostLargo
  if (!/^[A-Za-z0-9._:-]+$/.test(host)) return t.hostCaracteres
  return null
}

/** El usuario ya sin espacios en los extremos. */
export function errorUsuario(usuario: string): string | null {
  const t = txSsh().validacion
  if (usuario === '') return t.usuarioFalta
  if (/\s/.test(usuario)) return t.usuarioEspacios
  if (usuario.startsWith('-')) return t.usuarioGuion
  if (usuario.includes('${')) return t.usuarioDolar
  if (usuario.includes('%')) return t.usuarioPorciento
  // eslint-disable-next-line no-control-regex -- buscar caracteres de control es justo su trabajo
  if (/[\u0000-\u001f\u007f]/.test(usuario)) return t.usuarioControl
  if (usuario.length > 255) return t.usuarioLargo
  return null
}

/** Entero de 1 a 65535. */
export function errorPuerto(puerto: unknown): string | null {
  return typeof puerto === 'number' && Number.isInteger(puerto) && puerto >= 1 && puerto <= 65535
    ? null
    : txSsh().validacion.puerto
}

/** ¿Choca `nombre` con otro del perfil (sin distinguir mayúsculas)? Devuelve el que choca, tal como está. */
function choque(nombre: string, otros: ReadonlyArray<{ id: string; nombre: string }>, ignorar?: string): string | undefined {
  const norma = nombre.toLowerCase()
  return otros.find((o) => o.id !== ignorar && o.nombre.trim().toLowerCase() === norma)?.nombre
}

/** Nombre de la conexión: no vacío, con tope, sin «:» y único en el perfil contando las ajenas. */
function validarAlias(input: SshConexionInput, ctx: ContextoValidacionSsh, idEditada?: string): void {
  const t = txSsh().validacion
  const alias = String(input.alias ?? '').trim()
  if (!alias) throw new Error(t.aliasFalta)
  if (alias.length > SSH_ALIAS_MAX) throw new Error(t.aliasLargo(SSH_ALIAS_MAX))
  // Los agentes nombrarán la conexión delante de una ruta (`nombre:ruta`).
  if (alias.includes(':')) throw new Error(t.aliasDosPuntos)
  const otros = [
    ...ctx.conexiones.filter((c) => c.profileId === input.profileId).map((c) => ({ id: c.id, nombre: c.alias })),
    ...ctx.ajenas.filter((a) => a.tipo === 'conexion' && a.profileId === input.profileId)
  ]
  const ocupado = choque(alias, otros, idEditada)
  if (ocupado !== undefined) throw new Error(t.aliasOcupado(ocupado))
}

/** Una conexión con el método 'clave' y sin archivo: ni uno recién elegido ni el que ya tenía. */
export function mensajeFaltaClave(): string {
  return txSsh().validacion.faltaClave
}

/**
 * El secreto del formulario (ausente o '' siempre valen): solo con contraseña o clave, con tope en bytes
 * y sin lo que cortaría la respuesta que ssh lee del programa de contraseñas (saltos de línea, el nulo).
 */
export function errorSecreto(secreto: unknown, metodo: SshMetodo): string | null {
  if (secreto === undefined || secreto === '') return null
  const t = txSsh().validacion
  if (typeof secreto !== 'string') return t.secretoTexto
  if (metodo !== 'contrasena' && metodo !== 'clave') return t.secretoSistema
  const que = metodo === 'clave' ? t.queClave : t.quePassword
  if (/[\n\r]/.test(secreto) || secreto.includes(String.fromCharCode(0))) return t.secretoSaltos(que)
  if (Buffer.byteLength(secreto, 'utf8') > SSH_SECRETO_MAX_BYTES) return t.secretoBytes(que, SSH_SECRETO_MAX_BYTES)
  return null
}

/** Un túnel: su tipo, puertos enteros y, salvo el dinámico, un destino que valdría como host. */
export function errorTunel(t: unknown): string | null {
  const x = txSsh().validacion
  if (!esObjeto(t)) return x.tunelForma
  if (t.tipo !== 'local' && t.tipo !== 'remoto' && t.tipo !== 'dinamico') return x.tunelTipo(String(t.tipo))
  if (errorPuerto(t.puerto) !== null) return x.tunelPuerto
  if (t.tipo === 'dinamico') return t.destinoHost === undefined && t.destinoPuerto === undefined ? null : x.tunelDinamico
  const host = errorHost(typeof t.destinoHost === 'string' ? t.destinoHost.trim() : '')
  if (host !== null) return x.tunelDestino(host)
  return errorPuerto(t.destinoPuerto) === null ? null : x.tunelPuertoDestino
}

/**
 * Los túneles de una conexión: con tope y sin dos que escuchen en el mismo puerto del mismo lado (los locales
 * y los dinámicos, en este equipo; los remotos, en el servidor).
 */
export function errorTuneles(tuneles: unknown): string | null {
  const x = txSsh().validacion
  if (!Array.isArray(tuneles)) return x.tunelesLista
  if (tuneles.length > SSH_TUNELES_MAX) return x.tunelesMax(SSH_TUNELES_MAX)
  const escuchas = new Set<string>()
  for (const t of tuneles) {
    const error = errorTunel(t)
    if (error !== null) return error
    const tunel = t as SshTunel
    const escucha = `${tunel.tipo === 'remoto' ? 'servidor' : 'equipo'}:${tunel.puerto}`
    if (escuchas.has(escucha)) {
      return tunel.tipo === 'remoto' ? x.tunelRemotoRepetido(tunel.puerto) : x.tunelRepetido(tunel.puerto)
    }
    escuchas.add(escucha)
  }
  return null
}

/**
 * El bastión: otra conexión del perfil, y la cadena que empieza en él sin volver a la editada, sin huecos y
 * con tope. Un hueco (un bastión borrado) también se rechaza aquí: guardar algo que no se puede abrir no ayuda.
 */
function validarSalto(input: SshConexionInput, ctx: ContextoValidacionSsh, idEditada?: string): void {
  const saltoId = input.saltoId
  if (saltoId === undefined || saltoId === null) return
  const t = txSsh().validacion
  if (typeof saltoId !== 'string') throw new Error(t.saltoTipo)
  if (saltoId === idEditada) throw new Error(t.saltoMismo)
  const delPerfil = (id: string): ContextoValidacionSsh['conexiones'][number] | undefined =>
    ctx.conexiones.find((c) => c.id === id && c.profileId === input.profileId)
  let actual = delPerfil(saltoId)
  if (actual === undefined) throw new Error(t.saltoNoExiste)
  const vistos = new Set<string>(idEditada === undefined ? [] : [idEditada])
  for (let saltos = 1; ; saltos++) {
    if (saltos > SSH_SALTOS_MAX) throw new Error(t.saltosMax(SSH_SALTOS_MAX))
    vistos.add(actual.id)
    if (actual.saltoId === undefined) return
    if (vistos.has(actual.saltoId)) throw new Error(t.saltoCirculo(actual.alias))
    const siguiente = delPerfil(actual.saltoId)
    if (siguiente === undefined) throw new Error(t.saltoHueco(actual.alias))
    actual = siguiente
  }
}

/**
 * Valida una alta o una edición. Lanza con un mensaje para el usuario. Que el método 'clave' traiga
 * su archivo lo comprueba el registro, que sabe si la conexión ya tenía uno.
 */
export function validarEntradaSsh(input: SshConexionInput, ctx: ContextoValidacionSsh, idEditada?: string): void {
  const t = txSsh().validacion
  if (typeof input?.profileId !== 'string' || !input.profileId) throw new Error(t.sinPerfil)
  validarAlias(input, ctx, idEditada)
  const error = errorHost(String(input.host ?? '').trim()) ?? errorPuerto(input.puerto) ?? errorUsuario(String(input.usuario ?? '').trim())
  if (error !== null) throw new Error(error)
  if (input.metodo !== 'contrasena' && input.metodo !== 'clave' && input.metodo !== 'sistema') {
    throw new Error(t.metodoDesconocido(String(input.metodo)))
  }
  const secreto = errorSecreto(input.secreto, input.metodo)
  if (secreto !== null) throw new Error(secreto)
  if (input.grupoId !== null && !ctx.grupos.some((g) => g.id === input.grupoId && g.profileId === input.profileId)) {
    throw new Error(t.grupoNoExiste)
  }
  validarSaltoYTuneles(input, ctx, idEditada)
}

/** El bastión y los túneles, si la entrada los trae (ausentes, se conservan los de antes). */
function validarSaltoYTuneles(input: SshConexionInput, ctx: ContextoValidacionSsh, idEditada?: string): void {
  validarSalto(input, ctx, idEditada)
  const tuneles = input.tuneles === undefined ? null : errorTuneles(input.tuneles)
  if (tuneles !== null) throw new Error(tuneles)
}

/**
 * Los campos que se escriben, a partir de una entrada ya validada. `disponibleAgentes` va siempre
 * explícito: en un alta vale `true` si no se dice otra cosa; en una edición sin valor, el de antes.
 */
export function camposAGuardarSsh(
  input: SshConexionInput,
  previo?: Pick<ConexionSshPersistida, 'disponibleAgentes' | 'saltoId' | 'tuneles'>
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
  const saltoId = input.saltoId === undefined ? previo?.saltoId : input.saltoId
  if (typeof saltoId === 'string') campos.saltoId = saltoId
  const tuneles = input.tuneles === undefined ? (previo?.tuneles ?? []) : input.tuneles.map(tunelAGuardar)
  if (tuneles.length > 0) campos.tuneles = tuneles
  return campos
}

/** Un túnel ya validado tal como se escribe: solo sus campos, y el destino sin espacios en los extremos. */
function tunelAGuardar(t: SshTunel): SshTunel {
  if (t.tipo === 'dinamico') return { tipo: t.tipo, puerto: t.puerto }
  return { tipo: t.tipo, puerto: t.puerto, destinoHost: (t.destinoHost ?? '').trim(), destinoPuerto: t.destinoPuerto }
}

/**
 * El nombre de la copia de una conexión: «Alias (1)», o el primer «Alias (N)» libre (sin distinguir mayúsculas),
 * recortando el original para que quepa en el tope. El número de una copia no se acumula: duplicar «Alias (1)»
 * da «Alias (2)», no «Alias (1) (1)».
 */
export function aliasDeCopia(alias: string, ocupados: readonly string[]): string {
  const usados = new Set(ocupados.map((o) => o.trim().toLowerCase()))
  const base = alias.trim().replace(/\s*\(\d+\)$/, '') || alias.trim()
  for (let n = 1; ; n++) {
    const sufijo = ` (${n})`
    const nombre = `${base.slice(0, SSH_ALIAS_MAX - sufijo.length).trimEnd()}${sufijo}`
    if (!usados.has(nombre.toLowerCase())) return nombre
  }
}

/** Nombre de grupo: no vacío, con tope y único en el perfil (sin distinguir mayúsculas, contando ajenos). */
export function validarNombreGrupo(
  nombre: unknown,
  profileId: string,
  ctx: ContextoValidacionSsh,
  idEditado?: string
): string {
  const t = txSsh().validacion
  if (typeof profileId !== 'string' || !profileId) throw new Error(t.grupoSinPerfil)
  const limpio = String(nombre ?? '').trim()
  if (!limpio) throw new Error(t.grupoSinNombre)
  if (limpio.length > SSH_GRUPO_MAX) throw new Error(t.grupoLargo(SSH_GRUPO_MAX))
  const otros = [
    ...ctx.grupos.filter((g) => g.profileId === profileId).map((g) => ({ id: g.id, nombre: g.nombre })),
    ...ctx.ajenas.filter((a) => a.tipo === 'grupo' && a.profileId === profileId)
  ]
  const ocupado = choque(limpio, otros, idEditado)
  if (ocupado !== undefined) throw new Error(t.grupoOcupado(ocupado))
  return limpio
}
