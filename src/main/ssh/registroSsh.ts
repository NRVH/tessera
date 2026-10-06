// =============================================================================
// El archivo del registro SSH (`ssh-connections.json`) leído y escrito sin destruir lo que esta
// versión no entiende («lo que no entiendo, no lo toco»). Puro, sin `electron` ni `fs`: dos listas,
// grupos y conexiones, con conocidas y ajenas mezcladas en su orden; un archivo que no se sabe leer
// se bloquea (`formatoAjeno`). Calca `db/registroConexiones.ts` sin compartir código con él.
// Decisiones: docs/decisiones/ssh/registro-y-claves.md
// =============================================================================

import { join } from 'node:path'
import { ID_CONEXION } from '../../shared/ajustesTerminal.ts'
import type { SshEntradaAjena, SshMetodo } from '../../shared/ssh-ipc.ts'
import { esObjeto } from '../util/valores.ts'
import {
  esClaveGobernadaConexion,
  esClaveGobernadaGrupo,
  type ConexionSshPersistida,
  type GrupoSshPersistido
} from './conservarAlEditarSsh.ts'
import {
  MENSAJE_CAMBIADO_FUERA_SSH,
  MENSAJE_FORMATO_AJENO_SSH,
  MENSAJE_RESCATADO_CORREGIDO_SSH,
  mensajeEscrituraFallidaSsh,
  mensajeRegistroIlegibleSsh,
  type CausaIlegibleSsh,
  type EstadoRespaldoSsh
} from './mensajesRegistroSsh.ts'

/** Versión del FORMATO que escribe esta versión; solo sube si cambia la forma del archivo. */
export const VERSION_REGISTRO_SSH = 1

/** Los métodos que esta versión entiende al leer (escribir 'clave' llega con su fase). */
export const METODOS_SSH: readonly SshMetodo[] = ['contrasena', 'clave', 'sistema']

/**
 * Los ids que pueden nombrar un archivo (`ssh/huellas/<id>`): sin separadores, puntos ni espacios.
 * Una entrada con otro id es ajena: no se le puede dar un archivo sin riesgo de salirse de la carpeta.
 */
export const ID_SEGURO = ID_CONEXION

/**
 * La copia de la clave importada de la conexión `id` dentro de `dirClaves` (`ssh/claves/<id>`), o `null`
 * si el id no vale para nombrar un archivo. Único sitio que la calcula: el registro y las claves importadas.
 */
export function rutaCopiaClave(dirClaves: string, id: string): string | null {
  return ID_SEGURO.test(id) ? join(dirClaves, id) : null
}

/** Una entrada que esta versión entiende: `registro` para trabajar, `resto` para el disco. */
export interface EntradaConocida<T> {
  tipo: 'conocida'
  /** Solo claves GOBERNADAS con valores ENTENDIDOS: de aquí sale el DTO. */
  registro: T
  /** Lo que no se gobierna o no se entiende, tal como vino: vuelve al disco y nunca llega al DTO. */
  resto: Record<string, unknown>
}

/** Una entrada que esta versión no entiende: se conserva entera, sin mirarla por dentro. */
export interface EntradaAjena {
  tipo: 'ajena'
  crudo: unknown
  /** Tiene forma conocida pero su id ya lo tiene una conocida anterior de la misma lista. */
  idRepetido?: true
}

export type Entrada<T> = EntradaConocida<T> | EntradaAjena
export type EntradaConexionSsh = Entrada<ConexionSshPersistida>
export type EntradaGrupoSsh = Entrada<GrupoSshPersistido>

interface RegistroBase {
  /** La que se escribirá: max(leída, `VERSION_REGISTRO_SSH`). Nunca baja. */
  version: number
  grupos: EntradaGrupoSsh[]
  conexiones: EntradaConexionSsh[]
  /** Claves de la raíz que no son `version`, `grupos` ni `conexiones`. */
  raiz: Record<string, unknown>
}

/** El archivo tal como se leyó; `formatoAjeno` es la marca de NO TOCARLO, siempre con su porqué. */
export type RegistroSsh = RegistroBase & ({ formatoAjeno: false; aviso: null } | { formatoAjeno: true; aviso: string })

/** Punto de código del BOM (U+FEFF): un editor de Windows lo añade y `JSON.parse` lo rechaza. */
const BOM = 0xfeff
const CLAVES_RAIZ = new Set(['version', 'grupos', 'conexiones'])

/** Un registro sin entradas, escribible. */
export function registroVacioSsh(): RegistroSsh {
  return { version: VERSION_REGISTRO_SSH, grupos: [], conexiones: [], raiz: {}, formatoAjeno: false, aviso: null }
}

function bloqueado(aviso: string, raiz: Record<string, unknown> = {}, version = VERSION_REGISTRO_SSH): RegistroSsh {
  return { version, grupos: [], conexiones: [], raiz, formatoAjeno: true, aviso }
}

/** Ausente, `null` o una lista: lo demás es un formato que esta versión no sabe escribir. */
function esListaOAusente(v: unknown): boolean {
  return v === undefined || v === null || Array.isArray(v)
}

/** La versión que se escribirá (nunca baja), o `null` si la leída no es un número: un formato que no se entiende. */
function versionAEscribir(leida: unknown): number | null {
  if (leida === undefined || leida === null) return VERSION_REGISTRO_SSH
  return typeof leida === 'number' && Number.isFinite(leida) ? Math.max(leida, VERSION_REGISTRO_SSH) : null
}

/**
 * Lee el texto del archivo. `null` = no es JSON (cero bytes incluidos: el llamador recurre al `.bak`).
 * Vacío y escribible: `null`, `[]` o un objeto sin listas. Bloqueado (legible pero no se escribe): una
 * raíz que no es un objeto, una lista que no es una lista o una `version` que no es un número finito.
 */
export function leerRegistroSsh(texto: string): RegistroSsh | null {
  let doc: unknown
  try {
    doc = JSON.parse(texto.charCodeAt(0) === BOM ? texto.slice(1) : texto)
  } catch {
    return null
  }
  if (doc === null || (Array.isArray(doc) && doc.length === 0)) return registroVacioSsh()
  if (!esObjeto(doc)) return bloqueado(MENSAJE_FORMATO_AJENO_SSH)
  const raiz = Object.fromEntries(Object.entries(doc).filter(([k]) => !CLAVES_RAIZ.has(k)))
  const version = versionAEscribir(doc.version)
  if (version === null) return bloqueado(MENSAJE_FORMATO_AJENO_SSH, raiz)
  if (!esListaOAusente(doc.grupos) || !esListaOAusente(doc.conexiones)) {
    return bloqueado(MENSAJE_FORMATO_AJENO_SSH, raiz, version)
  }
  return {
    version,
    grupos: entradasDeLista(Array.isArray(doc.grupos) ? doc.grupos : [], separarGrupo),
    conexiones: entradasDeLista(Array.isArray(doc.conexiones) ? doc.conexiones : [], separarConexion),
    raiz,
    formatoAjeno: false,
    aviso: null
  }
}

/**
 * Las entradas de una lista, en su orden. Una de forma conocida cuyo id ya tiene una conocida
 * ANTERIOR pasa a ajena (`idRepetido`): todo lo que va por id resolvería a la primera. Sin
 * distinguir mayúsculas, porque el id nombra un archivo y en Windows dos cajas son el mismo.
 */
function entradasDeLista<T extends { id: string }>(
  lista: readonly unknown[],
  separar: (crudo: Record<string, unknown>) => EntradaConocida<T> | null
): Array<Entrada<T>> {
  const usados = new Set<string>()
  return lista.map((crudo): Entrada<T> => {
    const e = esObjeto(crudo) ? separar(crudo) : null
    if (!e) return { tipo: 'ajena', crudo }
    const clave = e.registro.id.toLowerCase()
    if (usados.has(clave)) return { tipo: 'ajena', crudo, idRepetido: true }
    usados.add(clave)
    return e
  })
}

function tieneFormaDeConexion(c: Record<string, unknown>): boolean {
  return (
    typeof c.id === 'string' &&
    ID_SEGURO.test(c.id) &&
    typeof c.profileId === 'string' &&
    c.profileId !== '' &&
    typeof c.alias === 'string' &&
    typeof c.host === 'string' &&
    typeof c.puerto === 'number' &&
    Number.isFinite(c.puerto) &&
    typeof c.usuario === 'string' &&
    typeof c.metodo === 'string' &&
    (METODOS_SSH as readonly string[]).includes(c.metodo)
  )
}

/** ¿El archivo de clave tiene la forma que el DTO enseña? */
function esClaveConocida(v: unknown): boolean {
  return esObjeto(v) && typeof v.nombre === 'string' && typeof v.tipo === 'string' && typeof v.cifrada === 'boolean'
}

/** Una clave gobernada con un valor que no se entiende sale del registro y se conserva en el resto. */
function apartar(
  registro: Record<string, unknown>,
  resto: Record<string, unknown>,
  clave: string,
  entiende: (v: unknown) => boolean
): void {
  if (!(clave in registro) || entiende(registro[clave])) return
  resto[clave] = registro[clave]
  delete registro[clave]
}

/** Separa una conexión cruda en lo gobernado y entendido y lo demás; `null` si no tiene la forma conocida. */
export function separarConexion(crudo: Record<string, unknown>): EntradaConocida<ConexionSshPersistida> | null {
  if (!tieneFormaDeConexion(crudo)) return null
  const pares = Object.entries(crudo).filter(([, v]) => v !== undefined)
  const registro: Record<string, unknown> = Object.fromEntries(pares.filter(([k]) => esClaveGobernadaConexion(k)))
  const resto: Record<string, unknown> = Object.fromEntries(pares.filter(([k]) => !esClaveGobernadaConexion(k)))
  // `grupoId: null` dice lo mismo que no tenerlo.
  if (registro.grupoId === null) delete registro.grupoId
  apartar(registro, resto, 'grupoId', (v) => typeof v === 'string')
  apartar(registro, resto, 'disponibleAgentes', (v) => typeof v === 'boolean')
  apartar(registro, resto, 'secretEnc', (v) => typeof v === 'string')
  apartar(registro, resto, 'clave', esClaveConocida)
  return { tipo: 'conocida', registro: registro as unknown as ConexionSshPersistida, resto }
}

/** Lo mismo para un grupo: id seguro, perfil y nombre de texto. */
export function separarGrupo(crudo: Record<string, unknown>): EntradaConocida<GrupoSshPersistido> | null {
  const { id, profileId, nombre } = crudo
  if (typeof id !== 'string' || !ID_SEGURO.test(id) || typeof profileId !== 'string' || profileId === '') return null
  if (typeof nombre !== 'string') return null
  const pares = Object.entries(crudo).filter(([, v]) => v !== undefined)
  const registro = Object.fromEntries(pares.filter(([k]) => esClaveGobernadaGrupo(k)))
  const resto = Object.fromEntries(pares.filter(([k]) => !esClaveGobernadaGrupo(k)))
  return { tipo: 'conocida', registro: registro as unknown as GrupoSshPersistido, resto }
}

/** La entrada conocida tal como va al disco: el registro y, detrás, lo del resto que el registro no tenga. */
export function crudoDe<T extends object>(e: EntradaConocida<T>): Record<string, unknown> {
  const propias = Object.entries(e.registro).filter(([, v]) => v !== undefined)
  const claves = new Set(propias.map(([k]) => k))
  return Object.fromEntries([...propias, ...Object.entries(e.resto).filter(([k]) => !claves.has(k))])
}

/** Un valor no entendido deja de conservarse en cuanto hay uno entendido para esa clave. */
function consolidar<T extends object>(e: EntradaConocida<T>): void {
  for (const [k, v] of Object.entries(e.registro)) {
    if (v !== undefined && Object.prototype.hasOwnProperty.call(e.resto, k)) delete e.resto[k]
  }
}

function aDisco<T extends object>(e: Entrada<T>): unknown {
  if (e.tipo === 'ajena') return e.crudo
  consolidar(e)
  return crudoDe(e)
}

/** El texto del archivo. Lanza con su aviso si el registro está bloqueado: escribirlo sería destruirlo. */
export function serializarRegistroSsh(reg: RegistroSsh): string {
  if (reg.formatoAjeno) throw new Error(reg.aviso)
  const doc = { version: reg.version, grupos: reg.grupos.map(aDisco), conexiones: reg.conexiones.map(aDisco), ...reg.raiz }
  return JSON.stringify(doc, null, 2) + '\n'
}

/** Las conexiones conocidas, en el orden del archivo (MISMOS objetos: mutarlos es mutar el registro). */
export function conexionesConocidas(reg: RegistroSsh): ConexionSshPersistida[] {
  return reg.conexiones.flatMap((e) => (e.tipo === 'conocida' ? [e.registro] : []))
}

/** Los grupos conocidos, en el orden del archivo. */
export function gruposConocidos(reg: RegistroSsh): GrupoSshPersistido[] {
  return reg.grupos.flatMap((e) => (e.tipo === 'conocida' ? [e.registro] : []))
}

/** Id de una entrada, o `null` si no trae uno legible. */
export function idDeEntrada<T extends { id: string }>(e: Entrada<T>): string | null {
  if (e.tipo === 'conocida') return e.registro.id
  return esObjeto(e.crudo) && typeof e.crudo.id === 'string' && e.crudo.id !== '' ? e.crudo.id : null
}

/** Perfil de una entrada, o `null` si no trae uno legible (no es de nadie que se sepa). */
export function perfilDeEntrada<T extends { profileId: string }>(e: Entrada<T>): string | null {
  if (e.tipo === 'conocida') return e.registro.profileId
  return esObjeto(e.crudo) && typeof e.crudo.profileId === 'string' ? e.crudo.profileId : null
}

/** Lo que se enseña de una ajena; `null` si no tiene id y perfil legibles (se conserva sin listarla). */
function describirAjena(e: EntradaAjena, tipo: SshEntradaAjena['tipo']): SshEntradaAjena | null {
  if (!esObjeto(e.crudo)) return null
  const { id, profileId } = e.crudo
  if (typeof id !== 'string' || id === '' || typeof profileId !== 'string') return null
  const legible = tipo === 'conexion' ? e.crudo.alias : e.crudo.nombre
  const nombre = typeof legible === 'string' && legible.trim() !== '' ? legible : id
  return e.idRepetido ? { tipo, id, profileId, nombre, idRepetido: true } : { tipo, id, profileId, nombre }
}

/** Las ajenas de todos los perfiles: primero los grupos y después las conexiones, en el orden del archivo. */
export function ajenasSsh(reg: RegistroSsh): SshEntradaAjena[] {
  const grupos = reg.grupos.flatMap((e) => (e.tipo === 'ajena' ? [describirAjena(e, 'grupo')] : []))
  const conexiones = reg.conexiones.flatMap((e) => (e.tipo === 'ajena' ? [describirAjena(e, 'conexion')] : []))
  return [...grupos, ...conexiones].filter((a): a is SshEntradaAjena => a !== null)
}

/** Los ids (en minúscula) que cita alguna conexión, conocida o ajena: sus archivos no se pueden borrar. */
export function idsConArchivos(reg: RegistroSsh): Set<string> {
  const ids = new Set<string>()
  for (const e of reg.conexiones) {
    const id = idDeEntrada(e)
    if (id !== null) ids.add(id.toLowerCase())
  }
  return ids
}

/**
 * Las entradas de perfiles que siguen existiendo, en las dos listas. Las ajenas se podan igual; las
 * que no traen un perfil legible se CONSERVAN: no se sabe de quién son.
 */
export function podarPerfilesSsh(
  reg: RegistroSsh,
  idsVivos: ReadonlySet<string>
): { grupos: EntradaGrupoSsh[]; conexiones: EntradaConexionSsh[] } {
  const vive = (perfil: string | null): boolean => perfil === null || idsVivos.has(perfil)
  return {
    grupos: reg.grupos.filter((e) => vive(perfilDeEntrada(e))),
    conexiones: reg.conexiones.filter((e) => vive(perfilDeEntrada(e)))
  }
}

/** Lo que se sabe de UN archivo (el principal o el `.bak`) tras intentar leerlo. */
type LecturaArchivo = { tipo: 'registro'; reg: RegistroSsh } | { tipo: 'ausente' } | { tipo: 'vacio' } | CausaIlegibleSsh

/** El código de un error de E/S (`EACCES`, `EBUSY`…), o una etiqueta si no trae ninguno. */
export function codigoDeError(e: unknown, siNoHay = 'error de E/S'): string {
  const codigo = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined
  return typeof codigo === 'string' && codigo !== '' ? codigo : siNoHay
}

function leerArchivo(leerTexto: (ruta: string) => string | null, ruta: string): LecturaArchivo {
  let texto: string | null
  try {
    texto = leerTexto(ruta)
  } catch (e) {
    return { tipo: 'inaccesible', codigo: codigoDeError(e, 'error de lectura') }
  }
  if (texto === null) return { tipo: 'ausente' }
  const reg = leerRegistroSsh(texto)
  if (reg !== null) return { tipo: 'registro', reg }
  // `trim` también quita el BOM: un archivo que solo trae eso está vacío.
  return texto.trim() === '' ? { tipo: 'vacio' } : { tipo: 'roto' }
}

/** El registro y de dónde salió; `rescateDeRoto` = principal no JSON suplido con un `.bak` escribible. */
export interface LecturaSsh {
  reg: RegistroSsh
  origen: 'principal' | 'respaldo' | 'ninguno'
  rescateDeRoto: boolean
}

/**
 * La regla de lectura con respaldo: el principal si es legible (aunque esté vacío); si falta, está
 * vacío o no es JSON, el `.bak`. Con contenido roto y sin `.bak` legible, bloqueado. Un principal que
 * no se deja abrir se bloquea SIEMPRE: la primera escritura lo sustituiría sin haberlo podido guardar.
 *
 * @param leerTexto el contenido de una ruta; `null` si NO EXISTE; y si existe y no se deja leer, que LANCE.
 */
export function lecturaConRespaldoSsh(leerTexto: (ruta: string) => string | null, ruta: string): LecturaSsh {
  const principal = leerArchivo(leerTexto, ruta)
  if (principal.tipo === 'registro') return { reg: principal.reg, origen: 'principal', rescateDeRoto: false }
  const respaldo = leerArchivo(leerTexto, `${ruta}.bak`)
  const estado: EstadoRespaldoSsh =
    respaldo.tipo === 'registro' ? 'legible' : respaldo.tipo === 'ausente' ? 'ausente' : 'inservible'
  if (principal.tipo === 'inaccesible') {
    return { reg: bloqueado(mensajeRegistroIlegibleSsh(principal, estado)), origen: 'ninguno', rescateDeRoto: false }
  }
  if (respaldo.tipo === 'registro') {
    return { reg: respaldo.reg, origen: 'respaldo', rescateDeRoto: principal.tipo === 'roto' && !respaldo.reg.formatoAjeno }
  }
  if (principal.tipo === 'roto') {
    return { reg: bloqueado(mensajeRegistroIlegibleSsh(principal, estado)), origen: 'ninguno', rescateDeRoto: false }
  }
  return { reg: registroVacioSsh(), origen: 'ninguno', rescateDeRoto: false }
}

/** ¿Contenido que no se puede leer (no es JSON y no está vacío)? Es lo único que se pierde al sustituirlo. */
export function esContenidoIlegibleSsh(texto: string): boolean {
  return leerRegistroSsh(texto) === null && texto.trim() !== ''
}

/**
 * ¿Se puede sustituir lo que hay AHORA en el principal? `null` = sí; si no, el aviso. Se escribe si
 * no cambió desde que este proceso lo leyó o escribió, si está borrado o vacío, o si cambió solo el
 * formato del texto. Se niega con contenido ilegible, con un formato ajeno, con el roto rescatado que
 * se corrigió a mano y con cualquier otro cambio válido hecho por fuera con Tessera abierta.
 *
 * @param conocido el texto que este proceso leyó o escribió: `null` si no existía, `undefined` si no se pudo leer.
 */
export function avisoAlSobrescribirSsh(actual: string | null, conocido: string | null | undefined): string | null {
  if (actual === null || actual === conocido) return null
  if (esContenidoIlegibleSsh(actual)) return mensajeRegistroIlegibleSsh({ tipo: 'roto' }, 'ausente')
  const reg = leerRegistroSsh(actual)
  if (reg === null) return null
  if (reg.formatoAjeno) return reg.aviso
  if (typeof conocido === 'string' && esContenidoIlegibleSsh(conocido)) return MENSAJE_RESCATADO_CORREGIDO_SSH
  if (reg.grupos.length === 0 && reg.conexiones.length === 0) return null
  const previo = typeof conocido === 'string' ? leerRegistroSsh(conocido) : null
  if (previo !== null && !previo.formatoAjeno && serializarRegistroSsh(previo) === serializarRegistroSsh(reg)) return null
  return MENSAJE_CAMBIADO_FUERA_SSH
}

/** ¿Un error del sistema en crudo (los de `fs`, con `syscall`)? Su `message` lleva rutas del host. */
function esErrorDelSistema(e: unknown): boolean {
  return typeof e === 'object' && e !== null && typeof (e as { syscall?: unknown }).syscall === 'string'
}

/** El texto de un fallo para el renderer: el de siempre, salvo un error de `fs` en crudo, que se cambia. */
export function mensajeDeFalloSsh(e: unknown): string {
  if (esErrorDelSistema(e)) return mensajeEscrituraFallidaSsh(codigoDeError(e))
  return e instanceof Error ? e.message : String(e)
}
