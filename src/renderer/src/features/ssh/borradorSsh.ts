// =============================================================================
// El BORRADOR del diálogo de una conexión SSH: lógica pura de `DialogoConexionSsh`. De una
// conexión a un borrador editable, de vuelta a lo que viaja al main (`SshConexionInput`), qué
// campos marcar tras un intento de guardar, si hay cambios y cómo se llaman los botones. Del archivo
// de clave solo guarda el nombre y la ficha; del secreto, lo TECLEADO: la ruta y el guardado no llegan.
// Sin React ni DOM: se fija bajo `node` (`test-borrador-ssh.mts`).
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md, docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import { SSH_ALIAS_MAX, SSH_SECRETO_MAX_BYTES, pideSecretoSsh } from '../../../../shared/ssh-ipc.ts'
import type { SshClaveElegida, SshConexion, SshConexionInput, SshMetodo } from '../../../../shared/ssh-ipc.ts'

/** El puerto con el que nace una conexión. */
export const PUERTO_SSH_POR_DEFECTO = 22
export const PUERTO_SSH_MIN = 1
export const PUERTO_SSH_MAX = 65535

/** Los métodos de autenticación que ofrece el formulario, en su orden. */
export const METODOS_OFRECIDOS: readonly SshMetodo[] = ['contrasena', 'clave', 'sistema']

/** El archivo de clave del borrador: el que ya tenía la conexión (sin ficha) o uno recién importado. */
export interface ClaveBorrador {
  nombre: string
  /** 'Ed25519', 'RSA'…, o `null` si no se sabe. */
  tipo: string | null
  /** Tiene frase: la pedirá la terminal al conectar. */
  cifrada: boolean
  /** La ficha de una clave recién elegida; `null` = la que ya tenía guardada la conexión. */
  token: string | null
}

/** Lo que edita el formulario. */
export interface BorradorSsh {
  /** Presente al editar. */
  id?: string
  profileId: string
  alias: string
  /** El grupo elegido, o `null` = «Sin grupo». */
  grupoId: string | null
  host: string
  /** Lo TECLEADO: mientras se escribe puede no ser un número. */
  puerto: string
  usuario: string
  metodo: SshMetodo
  /** El archivo de clave; se conserva aunque se elija otro método, por si se vuelve a este. */
  clave: ClaveBorrador | null
  /** «Disponible para los agentes»: marcada en un alta; al editar, la que tenía. */
  disponibleAgentes: boolean
  /** La contraseña (o la frase de la clave) TECLEADA: '' = nada nuevo. La guardada no sale nunca del main. */
  secreto: string
  /** Se pidió olvidar el secreto guardado. */
  olvidarSecreto: boolean
  /** La conexión guardada tiene secreto; solo para pintarlo, no viaja. */
  tieneSecreto: boolean
  /** …y este equipo no lo puede descifrar. */
  secretoIlegible: boolean
}

/** Los campos que puede marcar una validación, en el orden del formulario (el del foco). */
export type CampoSsh = 'alias' | 'host' | 'puerto' | 'usuario' | 'metodo' | 'clave' | 'secreto'

/** Borrador de un alta: puerto 22, contraseña y disponible para los agentes. */
export function borradorNuevo(profileId: string, grupoId: string | null = null): BorradorSsh {
  return {
    profileId,
    alias: '',
    grupoId,
    host: '',
    puerto: String(PUERTO_SSH_POR_DEFECTO),
    usuario: '',
    metodo: 'contrasena',
    clave: null,
    disponibleAgentes: true,
    secreto: '',
    olvidarSecreto: false,
    tieneSecreto: false,
    secretoIlegible: false
  }
}

/** Borrador de una edición (o de lo recién guardado). */
export function borradorDesde(c: SshConexion): BorradorSsh {
  return {
    id: c.id,
    profileId: c.profileId,
    alias: c.alias,
    grupoId: c.grupoDesconocido ? null : c.grupoId,
    host: c.host,
    puerto: String(c.puerto),
    usuario: c.usuario,
    metodo: c.metodo,
    clave: c.clave ? { nombre: c.clave.nombre, tipo: c.clave.tipo === '' ? null : c.clave.tipo, cifrada: c.clave.cifrada, token: null } : null,
    disponibleAgentes: c.disponibleAgentes,
    secreto: '',
    olvidarSecreto: false,
    tieneSecreto: c.tieneSecreto,
    secretoIlegible: c.secretoIlegible === true
  }
}

/** ¿Usa el método un secreto que se pueda guardar? La contraseña, o la frase de una clave que la tiene. */
export function usaSecreto(b: Pick<BorradorSsh, 'metodo' | 'clave'>): boolean {
  return pideSecretoSsh(b)
}

/** Lo que el usuario edita en el formulario: lo que `trasGuardar` conserva si cambió mientras se guardaba. */
const CAMPOS_EDITABLES = [
  'alias',
  'grupoId',
  'host',
  'puerto',
  'usuario',
  'metodo',
  'clave',
  'disponibleAgentes',
  'secreto',
  'olvidarSecreto'
] as const satisfies readonly (keyof BorradorSsh)[]

/**
 * El borrador tras un guardado: lo guardado (`guardado`) pero conservando lo que se tecleó MIENTRAS
 * volvía la respuesta, o `setBorrador(borradorDesde(c))` lo pisaría. Un campo cuenta como tocado si
 * `actual` ya no es el que se mandó (`enviado`); lo demás (id, si tiene secreto…) es del main.
 */
export function trasGuardar(actual: BorradorSsh, enviado: BorradorSsh, guardado: BorradorSsh): BorradorSsh {
  const out: BorradorSsh = { ...guardado }
  for (const campo of CAMPOS_EDITABLES) {
    if (actual[campo] !== enviado[campo]) Object.assign(out, { [campo]: actual[campo] })
  }
  return out
}

/**
 * Aplica un cambio del formulario. Cambiar de método vacía lo tecleado en el secreto: una contraseña
 * escrita con un método no puede viajar como la frase de una clave.
 */
export function conCambio(b: BorradorSsh, parcial: Partial<BorradorSsh>): BorradorSsh {
  const otroMetodo = parcial.metodo !== undefined && parcial.metodo !== b.metodo
  return otroMetodo ? { ...b, ...parcial, secreto: '', olvidarSecreto: false } : { ...b, ...parcial }
}

/** Bytes UTF-8 de un texto (el tope del secreto es en bytes: lo que ssh lee del programa de contraseñas). */
function bytesUtf8(texto: string): number {
  return new TextEncoder().encode(texto).length
}

/** La clave recién importada, como clave del borrador (con su ficha). */
export function claveElegida(e: SshClaveElegida): ClaveBorrador {
  return { nombre: e.nombre, tipo: e.tipo, cifrada: e.cifrada, token: e.token }
}

/** ¿Es un puerto válido lo tecleado? Solo dígitos y de 1 a 65535. */
export function puertoValido(texto: string): boolean {
  const t = texto.trim()
  if (!/^\d{1,5}$/.test(t)) return false
  const n = Number(t)
  return n >= PUERTO_SSH_MIN && n <= PUERTO_SSH_MAX
}

/** Los campos que el main rechazaría, en el orden del formulario. */
export function camposAMarcar(b: BorradorSsh): CampoSsh[] {
  const alias = b.alias.trim()
  const marcas: CampoSsh[] = []
  if (alias === '' || alias.length > SSH_ALIAS_MAX) marcas.push('alias')
  if (b.host.trim() === '') marcas.push('host')
  if (!puertoValido(b.puerto)) marcas.push('puerto')
  if (b.usuario.trim() === '') marcas.push('usuario')
  if (!METODOS_OFRECIDOS.includes(b.metodo)) marcas.push('metodo')
  // Al editar, sin clave nueva vale la guardada; sin ninguna (un alta, o al pasar a este método), falta.
  if (b.metodo === 'clave' && b.clave === null) marcas.push('clave')
  if (usaSecreto(b) && bytesUtf8(b.secreto) > SSH_SECRETO_MAX_BYTES) marcas.push('secreto')
  return marcas
}

/** Las marcas que se PINTAN: ninguna hasta el primer intento de guardar. */
export function marcasVisibles(b: BorradorSsh, intentoGuardar: boolean): CampoSsh[] {
  return intentoGuardar ? camposAMarcar(b) : []
}

/**
 * Lo que viaja al main. Solo vale con un borrador sin marcas: el puerto se convierte en número. La
 * clave viaja solo si es nueva y el método la usa: sin ella, el main conserva la importada. El secreto,
 * solo si el método lo usa: lo tecleado lo sustituye, '' lo olvida y ausente lo conserva.
 */
export function entradaDe(b: BorradorSsh): SshConexionInput {
  const entrada: SshConexionInput = {
    profileId: b.profileId,
    alias: b.alias.trim(),
    grupoId: b.grupoId,
    host: b.host.trim(),
    puerto: Number(b.puerto.trim()),
    usuario: b.usuario.trim(),
    metodo: b.metodo,
    disponibleAgentes: b.disponibleAgentes
  }
  if (b.metodo === 'clave' && b.clave !== null && b.clave.token !== null) entrada.clave = { tipo: 'elegida', token: b.clave.token }
  if (usaSecreto(b) && b.secreto !== '') entrada.secreto = b.secreto
  else if (usaSecreto(b) && b.olvidarSecreto) entrada.secreto = ''
  return entrada
}

/** ¿Hay algo distinto de lo guardado (o de lo que trae un alta)? Decide si el velo puede cerrar el diálogo. */
export function hayCambios(b: BorradorSsh, original: BorradorSsh): boolean {
  return (
    b.alias.trim() !== original.alias.trim() ||
    b.grupoId !== original.grupoId ||
    b.host.trim() !== original.host.trim() ||
    b.puerto.trim() !== original.puerto.trim() ||
    b.usuario.trim() !== original.usuario.trim() ||
    b.metodo !== original.metodo ||
    b.disponibleAgentes !== original.disponibleAgentes ||
    (b.clave?.token ?? null) !== (original.clave?.token ?? null) ||
    b.secreto !== '' ||
    b.olvidarSecreto
  )
}

/** «Probar» prueba siempre lo GUARDADO: con cambios (o en un alta aún sin guardar), primero guarda. */
export function etiquetaProbar(b: BorradorSsh, cambios: boolean): string {
  return b.id === undefined || cambios ? 'Guardar y probar' : 'Probar'
}

