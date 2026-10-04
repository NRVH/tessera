// =============================================================================
// Campos opcionales de una conexión al guardarla (instancia, autenticación, dominio, cifrado, SRV,
// opciones de URI, usuario opcional, base numérica de Redis): qué se valida y qué se guarda según los
// que declara el motor. Puro; lo carga también una prueba del renderer, por eso los imports llevan extensión.
// Decisiones: docs/decisiones/bd/conexiones-campos-opcionales.md
// =============================================================================

import type { DbAutenticacion, DbConnectionInput, DbTls } from '../../shared/db-ipc.ts'
import type { CampoOpcional, DescriptorMotor } from '../../shared/motores/index.ts'
import { autenticacionDe, esAutenticacion, esDeClaves, pideDominio, tlsDeConexion, usaOpcional } from '../../shared/motores/index.ts'
import { nunca } from '../../shared/nunca.ts'
import { BASE_REDIS_MAX, validarBaseRedis, validarOpcionesUriMongo } from '../../shared/uriConexion.ts'

/** Lo que se mira de la entrada (un `DbConnectionInput` o lo que llega por IPC sin validar). */
export type OpcionalesEntrada = Pick<DbConnectionInput, 'instancia' | 'autenticacion' | 'dominio' | 'tls' | 'srv' | 'opcionesUri'> &
  Partial<Pick<DbConnectionInput, 'user'>>

/** Lo que se guarda de los opcionales (solo las claves con valor). */
export interface OpcionalesGuardados {
  instancia?: string
  autenticacion?: DbAutenticacion
  dominio?: string
  tls?: DbTls
  srv?: boolean
  opcionesUri?: string
}

/**
 * El cifrado efectivo de una conexión: el escrito si es válido; si no, con `srv`, cifrar y verificar;
 * si no, el del motor. Lo usan el guardado y el `GestorDocumentos` (una conexión vieja sin `tls` en disco).
 */
export function tlsEfectivo(d: DescriptorMotor, c: { tls?: unknown; srv?: unknown }): DbTls {
  if (esTls(c.tls)) return { cifrar: c.tls.cifrar, confiarCertificado: c.tls.confiarCertificado }
  // `srv` solo cuenta en un motor que lo declara: un borrador que pasó de MongoDB a Redis arrastraba `srv: true`.
  if (c.srv === true && usaOpcional(d, 'srv')) return { cifrar: true, confiarCertificado: false }
  return tlsDeConexion(d, {})
}

function esTls(x: unknown): x is DbTls {
  if (x === null || typeof x !== 'object') return false
  const t = x as Record<string, unknown>
  return typeof t.cifrar === 'boolean' && typeof t.confiarCertificado === 'boolean'
}

/** La autenticación de la entrada, si es válida; si no, 'sql' (la validación ya la rechazó). */
function autenticacionEntrada(input: OpcionalesEntrada): DbAutenticacion {
  return esAutenticacion(input.autenticacion) ? input.autenticacion : autenticacionDe(undefined)
}

/** La base más alta que se acepta en un motor de claves: más allá es un error de casilla, no una configuración. */
export const MAX_BASE_CLAVES = BASE_REDIS_MAX

/**
 * La base por defecto de un motor de claves es un número (vacío = 0, o un entero de 0 a `MAX_BASE_CLAVES`
 * en cifras) guardado en el campo de texto de siempre. Con los demás motores, `null`. Usa la misma
 * función que el formulario, para que las dos puntas rechacen lo mismo con el mismo mensaje.
 */
export function validarBaseClaves(d: DescriptorMotor, database: string): string | null {
  if (!esDeClaves(d)) return null
  return validarBaseRedis(database)
}

const sinRechazo = (): string | null => null

/** El rechazo exacto de cada campo opcional de la entrada, o `null` si vale. */
const REGLAS_OPCIONALES: Record<CampoOpcional, (input: OpcionalesEntrada) => string | null> = {
  // La base la limpia y la valida el destino (`destinoAGuardar`, `validarDestino`).
  database: sinRechazo,
  instancia: (input) => {
    const v = input.instancia
    if (v === undefined || v === null) return null
    if (typeof v !== 'string') return 'La instancia no es válida.'
    if (/[\\/:]/.test(v)) return 'En la instancia va solo su nombre (p. ej. SQLEXPRESS), sin el servidor ni el puerto.'
    return null
  },
  autenticacion: (input) => {
    const v = input.autenticacion
    if (v === undefined || v === null) return null
    return esAutenticacion(v) ? null : `Autenticación desconocida: "${String(v)}".`
  },
  dominio: (input) => {
    const v = input.dominio
    if (v !== undefined && v !== null && typeof v !== 'string') return 'El dominio no es válido.'
    if (!pideDominio(autenticacionEntrada(input))) return null
    return typeof v === 'string' && v.trim() !== '' ? null : 'Falta el dominio de la cuenta.'
  },
  tls: (input) => {
    const v = input.tls
    if (v === undefined || v === null) return null
    return esTls(v) ? null : 'El cifrado de la conexión no es válido.'
  },
  // MongoDB y Redis: el usuario puede ir vacío, pero si llega tiene que ser texto.
  user: (input) => {
    const v = input.user
    if (v === undefined || v === null) return null
    return typeof v === 'string' ? null : 'El usuario no es válido.'
  },
  srv: (input) => {
    const v = input.srv
    if (v === undefined || v === null) return null
    return typeof v === 'boolean' ? null : 'El tipo de dirección (SRV) no es válido.'
  },
  opcionesUri: (input) => {
    const v = input.opcionesUri
    if (v === undefined || v === null) return null
    if (typeof v !== 'string') return 'Las opciones de la URI no son válidas.'
    return validarOpcionesUriMongo(v)
  }
}

/** El rechazo exacto de un campo opcional de la entrada, o `null` si vale; se llama solo para los del motor. */
export function validarOpcional(campo: CampoOpcional, input: OpcionalesEntrada): string | null {
  const regla = REGLAS_OPCIONALES[campo] ?? nunca(campo as never, 'validarOpcional')
  return regla(input)
}

/**
 * El usuario que se guarda para el motor `d`: el de siempre si lo exige, el escrito (recortado, puede
 * quedar vacío) si lo declara opcional, y '' si no lo usa.
 */
export function usuarioAGuardar(d: DescriptorMotor, input: Pick<DbConnectionInput, 'user'>): string {
  if (d.conexion.obligatorios.includes('user')) return input.user.trim()
  if (usaOpcional(d, 'user') && typeof input.user === 'string') return input.user.trim()
  return ''
}

/** Un texto opcional recortado, o nada si falta o queda vacío. */
function textoRecortado(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : undefined
}

/** Instancia, si el motor la declara y viene con valor. */
function instanciaAGuardar(d: DescriptorMotor, input: OpcionalesEntrada): OpcionalesGuardados {
  const instancia = usaOpcional(d, 'instancia') ? textoRecortado(input.instancia) : undefined
  return instancia === undefined ? {} : { instancia }
}

/** Autenticación, tal como llegó (también 'sql'), si el motor la declara. */
function autenticacionAGuardar(d: DescriptorMotor, input: OpcionalesEntrada): OpcionalesGuardados {
  return usaOpcional(d, 'autenticacion') && esAutenticacion(input.autenticacion) ? { autenticacion: input.autenticacion } : {}
}

/** Dominio, solo con una autenticación que lo pide: con 'sql' no significa nada y cambiaría la huella. */
function dominioAGuardar(d: DescriptorMotor, input: OpcionalesEntrada): OpcionalesGuardados {
  const dominio = usaOpcional(d, 'dominio') && pideDominio(autenticacionEntrada(input)) ? textoRecortado(input.dominio) : undefined
  return dominio === undefined ? {} : { dominio }
}

/**
 * Cifrado como objeto nuevo con sus dos claves en orden fijo (la huella se calcula sobre el JSON). Con
 * `tlsPorDefecto` propio (MongoDB) siempre el efectivo; sin él (SQL Server), solo el escrito.
 */
function tlsAGuardar(d: DescriptorMotor, input: OpcionalesEntrada): OpcionalesGuardados {
  if (!usaOpcional(d, 'tls')) return {}
  if (d.conexion.tlsPorDefecto) return { tls: tlsEfectivo(d, input) }
  return esTls(input.tls) ? { tls: { cifrar: input.tls.cifrar, confiarCertificado: input.tls.confiarCertificado } } : {}
}

/** `srv` y opciones de URI, si el motor los declara y vienen con valor. */
function uriAGuardar(d: DescriptorMotor, input: OpcionalesEntrada): OpcionalesGuardados {
  const salida: OpcionalesGuardados = {}
  if (usaOpcional(d, 'srv') && input.srv === true) salida.srv = true
  const opcionesUri = usaOpcional(d, 'opcionesUri') ? textoRecortado(input.opcionesUri) : undefined
  if (opcionesUri !== undefined) salida.opcionesUri = opcionesUri
  return salida
}

/**
 * Lo que se guarda de los opcionales para el motor `d`: solo los que declara y tienen valor. Con un
 * motor que no declara ninguno, `{}`: su registro no cambia. El orden de las claves es el de siempre.
 */
export function opcionalesAGuardar(d: DescriptorMotor, input: OpcionalesEntrada): OpcionalesGuardados {
  return Object.assign(
    {},
    instanciaAGuardar(d, input),
    autenticacionAGuardar(d, input),
    dominioAGuardar(d, input),
    tlsAGuardar(d, input),
    uriAGuardar(d, input)
  )
}
