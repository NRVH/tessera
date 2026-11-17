// =============================================================================
// Campos opcionales de una conexión al guardarla (instancia, autenticación, dominio, cifrado, SRV,
// opciones de URI, túnel SSH, usuario opcional, base numérica y topología de Redis): qué se valida y qué se guarda según los
// que declara el motor. Puro; lo carga también una prueba del renderer, por eso los imports llevan extensión.
// Decisiones: docs/decisiones/bd/conexiones-campos-opcionales.md
// =============================================================================

import type { DbAutenticacion, DatosEntradaConexionBd, DbTls, DbTopologiaRedis, DbTunelSsh } from '../../shared/db-ipc.ts'
import type { CampoOpcional, DescriptorMotor } from '../../shared/motores/index.ts'
import { autenticacionDe, esAutenticacion, esDeClaves, pideDominio, tlsDeConexion, usaOpcional } from '../../shared/motores/index.ts'
import { nunca } from '../../shared/nunca.ts'
import { esTopologiaRedis, topologiaAGuardar, validarTopologiaRedis } from '../../shared/topologiaRedis.ts'
import { BASE_REDIS_MAX, validarBaseRedis, validarOpcionesUriMongo } from '../../shared/uriConexion.ts'
import { txDb } from './textosDb.ts'

/** Lo que se mira de la entrada (un `DatosEntradaConexionBd` o lo que llega por IPC sin validar). */
export type OpcionalesEntrada = Pick<
  DatosEntradaConexionBd,
  'instancia' | 'autenticacion' | 'dominio' | 'tls' | 'srv' | 'opcionesUri' | 'tunelSsh' | 'topologiaRedis'
> &
  Partial<Pick<DatosEntradaConexionBd, 'user' | 'host' | 'port' | 'database'>>

/** Lo que se guarda de los opcionales (solo las claves con valor). */
export interface OpcionalesGuardados {
  instancia?: string
  autenticacion?: DbAutenticacion
  dominio?: string
  tls?: DbTls
  srv?: boolean
  opcionesUri?: string
  tunelSsh?: DbTunelSsh
  topologiaRedis?: DbTopologiaRedis
}

/** El túnel SSH de la entrada, si tiene la forma de `DbTunelSsh`. */
export function esTunelSsh(x: unknown): x is DbTunelSsh {
  if (x === null || typeof x !== 'object') return false
  const id = (x as Record<string, unknown>).conexionId
  return typeof id === 'string' && id.trim() !== '' && id.length <= 200
}

/**
 * Lo que no cabe por un túnel de un solo puerto: el driver iría a los demás servidores por su nombre,
 * saltándose el túnel (MongoDB con SRV, con varios servidores, con `replicaSet` o sin conexión directa), o pediría el puerto
 * por UDP a SQL Browser (SQL Server con instancia). null si cabe.
 */
function rechazoPorTunel(entrada: OpcionalesEntrada): string | null {
  const t = txDb().opcionales
  if (entrada.srv === true) return t.srvPorTunel
  if (entrada.topologiaRedis !== undefined && entrada.topologiaRedis !== null) {
    return t.redisPorTunel
  }
  if (typeof entrada.host === 'string' && entrada.host.includes(',')) return t.variosServidoresPorTunel
  if (typeof entrada.opcionesUri === 'string' && /(^|&)(replicaSet=|directConnection=false)/i.test(entrada.opcionesUri)) {
    return t.replicaSetPorTunel
  }
  if (typeof entrada.instancia === 'string' && entrada.instancia.trim() !== '') {
    return t.instanciaPorTunel
  }
  return null
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
function autenticacionEntrada(entrada: OpcionalesEntrada): DbAutenticacion {
  return esAutenticacion(entrada.autenticacion) ? entrada.autenticacion : autenticacionDe(undefined)
}

/** La base más alta que se acepta en un motor de claves: más allá es un error de casilla, no una configuración. */
export const MAX_BASE_CLAVES = BASE_REDIS_MAX

/**
 * La base por defecto de un motor de claves es un número (vacío = 0, o un entero de 0 a `MAX_BASE_CLAVES`
 * en cifras) guardado en el campo de texto de siempre. Con los demás motores, `null`. Usa la misma
 * función que el formulario, para que las dos puntas rechacen lo mismo con el mismo mensaje.
 */
export function validarBaseClaves(d: DescriptorMotor, base: string): string | null {
  if (!esDeClaves(d)) return null
  return validarBaseRedis(base)
}

const sinRechazo = (): string | null => null

/** El rechazo exacto de cada campo opcional de la entrada, o `null` si vale. */
const REGLAS_OPCIONALES: Record<CampoOpcional, (entrada: OpcionalesEntrada) => string | null> = {
  // La base la limpia y la valida el destino (`destinoAGuardar`, `validarDestino`).
  database: sinRechazo,
  instancia: (entrada) => {
    const v = entrada.instancia
    if (v === undefined || v === null) return null
    if (typeof v !== 'string') return txDb().opcionales.instanciaInvalida
    if (/[\\/:]/.test(v)) return txDb().opcionales.instanciaSoloNombre
    return null
  },
  autenticacion: (entrada) => {
    const v = entrada.autenticacion
    if (v === undefined || v === null) return null
    return esAutenticacion(v) ? null : txDb().opcionales.autenticacionDesconocida(String(v))
  },
  dominio: (entrada) => {
    const v = entrada.dominio
    if (v !== undefined && v !== null && typeof v !== 'string') return txDb().opcionales.dominioInvalido
    if (!pideDominio(autenticacionEntrada(entrada))) return null
    return typeof v === 'string' && v.trim() !== '' ? null : txDb().opcionales.faltaDominio
  },
  tls: (entrada) => {
    const v = entrada.tls
    if (v === undefined || v === null) return null
    return esTls(v) ? null : txDb().opcionales.cifradoInvalido
  },
  // MongoDB y Redis: el usuario puede ir vacío, pero si llega tiene que ser texto.
  user: (entrada) => {
    const v = entrada.user
    if (v === undefined || v === null) return null
    return typeof v === 'string' ? null : txDb().opcionales.usuarioInvalido
  },
  srv: (entrada) => {
    const v = entrada.srv
    if (v === undefined || v === null) return null
    return typeof v === 'boolean' ? null : txDb().opcionales.srvInvalido
  },
  opcionesUri: (entrada) => {
    const v = entrada.opcionesUri
    if (v === undefined || v === null) return null
    if (typeof v !== 'string') return txDb().opcionales.opcionesUriInvalidas
    return validarOpcionesUriMongo(v)
  },
  tunelSsh: (entrada) => {
    const v = entrada.tunelSsh
    if (v === undefined || v === null) return null
    return esTunelSsh(v) ? rechazoPorTunel(entrada) : txDb().opcionales.tunelInvalido
  },
  // Corre también sin topología: una lista de servidores sin Sentinel ni Cluster se rechaza.
  topologiaRedis: (entrada) =>
    validarTopologiaRedis(entrada.topologiaRedis, {
      host: typeof entrada.host === 'string' ? entrada.host : '',
      port: typeof entrada.port === 'number' ? entrada.port : 0,
      database: typeof entrada.database === 'string' ? entrada.database : '',
      tunel: esTunelSsh(entrada.tunelSsh)
    })
}

/** El rechazo exacto de un campo opcional de la entrada, o `null` si vale; se llama solo para los del motor. */
export function validarOpcional(campo: CampoOpcional, entrada: OpcionalesEntrada): string | null {
  const regla = REGLAS_OPCIONALES[campo] ?? nunca(campo as never, 'validarOpcional')
  return regla(entrada)
}

/**
 * El usuario que se guarda para el motor `d`: el de siempre si lo exige, el escrito (recortado, puede
 * quedar vacío) si lo declara opcional, y '' si no lo usa.
 */
export function usuarioAGuardar(d: DescriptorMotor, entrada: Pick<DatosEntradaConexionBd, 'user'>): string {
  if (d.conexion.obligatorios.includes('user')) return entrada.user.trim()
  if (usaOpcional(d, 'user') && typeof entrada.user === 'string') return entrada.user.trim()
  return ''
}

/** Un texto opcional recortado, o nada si falta o queda vacío. */
function textoRecortado(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : undefined
}

/** Instancia, si el motor la declara y viene con valor. */
function instanciaAGuardar(d: DescriptorMotor, entrada: OpcionalesEntrada): OpcionalesGuardados {
  const instancia = usaOpcional(d, 'instancia') ? textoRecortado(entrada.instancia) : undefined
  return instancia === undefined ? {} : { instancia }
}

/** Autenticación, tal como llegó (también 'sql'), si el motor la declara. */
function autenticacionAGuardar(d: DescriptorMotor, entrada: OpcionalesEntrada): OpcionalesGuardados {
  return usaOpcional(d, 'autenticacion') && esAutenticacion(entrada.autenticacion) ? { autenticacion: entrada.autenticacion } : {}
}

/** Dominio, solo con una autenticación que lo pide: con 'sql' no significa nada y cambiaría la huella. */
function dominioAGuardar(d: DescriptorMotor, entrada: OpcionalesEntrada): OpcionalesGuardados {
  const dominio = usaOpcional(d, 'dominio') && pideDominio(autenticacionEntrada(entrada)) ? textoRecortado(entrada.dominio) : undefined
  return dominio === undefined ? {} : { dominio }
}

/**
 * Cifrado como objeto nuevo con sus dos claves en orden fijo (la huella se calcula sobre el JSON). Con
 * `tlsSoloCifrando` (PG, Oracle), solo si cifra; con `tlsPorDefecto` propio (MongoDB, Redis) siempre el
 * efectivo; sin él (SQL Server), solo el escrito.
 */
function tlsAGuardar(d: DescriptorMotor, entrada: OpcionalesEntrada): OpcionalesGuardados {
  if (!usaOpcional(d, 'tls')) return {}
  // Un motor que no cifra sin verificar (Oracle) no guarda «confiar»: llegaría de otro motor al cambiarlo en el formulario.
  const admisible = (t: DbTls): DbTls =>
    d.conexion.admiteConfiarCertificado === false ? { cifrar: t.cifrar, confiarCertificado: false } : t
  if (d.conexion.tlsSoloCifrando) {
    const t = tlsEfectivo(d, entrada)
    return t.cifrar ? { tls: admisible(t) } : {}
  }
  if (d.conexion.tlsPorDefecto) return { tls: admisible(tlsEfectivo(d, entrada)) }
  return esTls(entrada.tls) ? { tls: admisible({ cifrar: entrada.tls.cifrar, confiarCertificado: entrada.tls.confiarCertificado }) } : {}
}

/** `srv` y opciones de URI, si el motor los declara y vienen con valor. */
function uriAGuardar(d: DescriptorMotor, entrada: OpcionalesEntrada): OpcionalesGuardados {
  const salida: OpcionalesGuardados = {}
  if (usaOpcional(d, 'srv') && entrada.srv === true) salida.srv = true
  const opcionesUri = usaOpcional(d, 'opcionesUri') ? textoRecortado(entrada.opcionesUri) : undefined
  if (opcionesUri !== undefined) salida.opcionesUri = opcionesUri
  return salida
}

/** El túnel SSH como objeto nuevo con solo su id, si el motor lo declara y viene. */
function tunelAGuardar(d: DescriptorMotor, entrada: OpcionalesEntrada): OpcionalesGuardados {
  return usaOpcional(d, 'tunelSsh') && esTunelSsh(entrada.tunelSsh) ? { tunelSsh: { conexionId: entrada.tunelSsh.conexionId } } : {}
}

/** La topología de Redis como objeto nuevo, si el motor la declara y viene. */
function topologiaAGuardarDe(d: DescriptorMotor, entrada: OpcionalesEntrada): OpcionalesGuardados {
  return usaOpcional(d, 'topologiaRedis') && esTopologiaRedis(entrada.topologiaRedis) ? { topologiaRedis: topologiaAGuardar(entrada.topologiaRedis) } : {}
}

/**
 * Lo que se guarda de los opcionales para el motor `d`: solo los que declara y tienen valor. Con un
 * motor que no declara ninguno, `{}`: su registro no cambia. El orden de las claves es el de siempre.
 */
export function opcionalesAGuardar(d: DescriptorMotor, entrada: OpcionalesEntrada): OpcionalesGuardados {
  return Object.assign(
    {},
    instanciaAGuardar(d, entrada),
    autenticacionAGuardar(d, entrada),
    dominioAGuardar(d, entrada),
    tlsAGuardar(d, entrada),
    uriAGuardar(d, entrada),
    tunelAGuardar(d, entrada),
    topologiaAGuardarDe(d, entrada)
  )
}
