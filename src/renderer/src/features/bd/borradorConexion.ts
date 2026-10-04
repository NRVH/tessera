// =============================================================================
// borradorConexion — el BORRADOR del diálogo de alta/edición de una conexión.
// Lógica PURA de `DbConexionDialogo`: de una conexión a un borrador editable, de vuelta
// a lo que viaja al main (`DbConnectionInput`), y la pregunta «¿hay cambios?» que decide
// si el botón dice «Probar» o «Guardar y probar». Se fija bajo `node`
// (`test-borrador-conexion.mts`).
// Decisiones: docs/decisiones/bd/ui-conexion-borrador.md
// =============================================================================

import { descriptorDe, limpiarParaGuardar } from './camposConexion.ts'
import { ALIAS_MAX, esEntorno } from '../../../../shared/db-ipc.ts'
import {
  autenticacionDe,
  descriptor,
  esAutenticacion,
  pideDominio,
  pideUsuarioYClave,
  tlsDeConexion,
  usaOpcional
} from '../../../../shared/motores/index.ts'
import { separarAuthSource, unirAuthSource, type CamposUri, type OrigenAuthSource } from '../../../../shared/uriConexion.ts'
import type {
  DbArchivoElegido,
  DbAutenticacion,
  DbConnection,
  DbConnectionInput,
  DbEntorno,
  DbMotor,
  DbOrigenArchivo,
  DbTls
} from '../../../../shared/db-ipc.ts'

/** El borrador que edita el diálogo de conexión. */
export interface BorradorConexion {
  /** Presente al editar (o tras el primer guardado de un alta). */
  id?: string
  profileId: string
  alias: string
  motor: DbMotor
  host: string
  port: number
  database: string
  sid: string
  user: string
  /** `undefined` = conservar la guardada (edición). */
  password: string | undefined
  readonly: boolean
  /** null = sin entorno. */
  entorno: DbEntorno | null
  notas: string
  /**
   * Motor de archivo: el NOMBRE del archivo que se pinta y que cuenta como «hay archivo»
   * para las marcas ('' o ausente = ninguno). En una edición, el de la conexión (`archivoVisible`).
   */
  archivo?: string
  /**
   * Motor de archivo: de dónde sale un archivo NUEVO elegido en este borrador. Ausente = el
   * guardado (edición) o ninguno. Viaja tal cual en `DbConnectionInput.archivo`; la ruta no
   * la ve nunca el renderer.
   */
  origenArchivo?: DbOrigenArchivo
  /** Instancia con nombre ('' = la por defecto, por el puerto). */
  instancia: string
  /** Con qué se autentica; 'sql' si la conexión no dice nada. */
  autenticacion: DbAutenticacion
  /** Dominio de la cuenta con 'ntlm'. */
  dominio: string
  /** El cifrado; el del motor (`tlsDeConexion`) si la conexión no dice nada. */
  tls: DbTls
  /** `mongodb+srv://`. */
  srv: boolean
  /** Las opciones de la URI (`clave=valor&…`); '' = ninguna. SIN el `authSource`, que va aparte. */
  opcionesUri: string
  /** La base de autenticación: el `authSource` de las opciones. */
  authSource: string
  /** De dónde salió el `authSource` (para devolverlo igual al guardar); null = nuevo o ninguno. */
  authSourceOrigen: OrigenAuthSource | null
}

/**
 * El cifrado que IMPLICAN el motor y el SRV: con SRV (en un motor que lo declara), cifrar y
 * verificar; sin él, el valor por defecto del motor (`tlsDeConexion`).
 */
export function tlsImplicito(motor: DbMotor, srv: boolean): DbTls {
  const d = descriptor(motor)
  if (srv && usaOpcional(d, 'srv')) return { cifrar: true, confiarCertificado: false }
  return tlsDeConexion(d, {})
}

const mismoTls = (a: DbTls, b: DbTls): boolean => a.cifrar === b.cifrar && a.confiarCertificado === b.confiarCertificado

/** Los opcionales con su valor de partida para un motor. */
function opcionalesDePartida(
  motor: DbMotor
): Pick<BorradorConexion, 'instancia' | 'autenticacion' | 'dominio' | 'tls' | 'srv' | 'opcionesUri' | 'authSource' | 'authSourceOrigen'> {
  return {
    instancia: '',
    autenticacion: autenticacionDe(undefined),
    dominio: '',
    tls: tlsImplicito(motor, false),
    srv: false,
    opcionesUri: '',
    authSource: '',
    authSourceOrigen: null
  }
}

/** Las opciones guardadas o pegadas, repartidas entre sus dos campos. */
function conOpciones(opciones: string): Pick<BorradorConexion, 'opcionesUri' | 'authSource' | 'authSourceOrigen'> {
  const s = separarAuthSource(opciones)
  return { opcionesUri: s.resto, authSource: s.authSource, authSourceOrigen: s.origen }
}

/** Borrador vacío para el alta: puerto del motor, «Solo lectura» marcada y sin entorno. */
export function borradorNuevo(profileId: string, motor: DbMotor = 'oracle'): BorradorConexion {
  return {
    profileId,
    alias: '',
    motor,
    host: '',
    // Un motor sin puerto guarda 0: ni se pinta ni se valida.
    port: descriptorDe(motor).puertoPorDefecto ?? 0,
    database: '',
    sid: '',
    user: '',
    password: '',
    readonly: true,
    entorno: null,
    notas: '',
    ...opcionalesDePartida(motor)
  }
}

/** Borrador de una edición: todo menos la contraseña, que nunca llega al renderer. */
export function borradorDesde(c: DbConnection): BorradorConexion {
  return {
    id: c.id,
    profileId: c.profileId,
    alias: c.alias,
    motor: c.motor,
    host: c.host,
    port: c.port,
    database: c.database ?? '',
    sid: c.sid ?? '',
    user: c.user,
    password: undefined,
    readonly: c.readonly,
    entorno: esEntorno(c.entorno) ? c.entorno : null,
    notas: c.notas ?? '',
    ...(c.archivoVisible !== undefined ? { archivo: c.archivoVisible } : {}),
    // Lo que llega del disco se valida: una autenticación que no se reconoce es la de
    // partida (el main tampoco la aceptaría al guardar).
    instancia: c.instancia ?? '',
    autenticacion: esAutenticacion(c.autenticacion) ? c.autenticacion : autenticacionDe(undefined),
    dominio: c.dominio ?? '',
    // Sin cifrado en disco, el que aplica el main (`tlsDeConexion`: el del motor).
    tls: c.tls
      ? { cifrar: c.tls.cifrar === true, confiarCertificado: c.tls.confiarCertificado === true }
      : tlsDeConexion(descriptor(c.motor), {}),
    srv: c.srv === true,
    ...conOpciones(c.opcionesUri ?? '')
  }
}

/**
 * Cambia el motor y resetea el puerto al suyo. El cifrado pasa al del motor nuevo si el que
 * había era el implícito del anterior.
 */
export function cambiarMotor(b: BorradorConexion, motor: DbMotor): BorradorConexion {
  if (b.motor === motor) return b
  const tls = mismoTls(b.tls, tlsImplicito(b.motor, b.srv)) ? tlsImplicito(motor, b.srv) : b.tls
  return { ...b, motor, port: descriptorDe(motor).puertoPorDefecto ?? 0, tls }
}

/** ¿Es un puerto que el main acepta? (La cota de `sinValor` de `camposConexion`.) */
const puertoValido = (p: number): boolean => Number.isInteger(p) && p >= 1 && p <= 65535

/** El puerto que se queda con SRV (apagado): el que hubiera si vale, o el del motor. */
function puertoConSrv(b: BorradorConexion): number {
  return puertoValido(b.port) ? b.port : (descriptorDe(b.motor).puertoPorDefecto ?? 0)
}

/**
 * Marca o desmarca el SRV. El cifrado sigue al SRV si nadie lo cambió, y con SRV un puerto
 * inválido vuelve al del motor (el campo queda apagado).
 */
export function conSrv(b: BorradorConexion, srv: boolean): BorradorConexion {
  if (b.srv === srv) return b
  const tls = mismoTls(b.tls, tlsImplicito(b.motor, b.srv)) ? tlsImplicito(b.motor, srv) : b.tls
  return { ...b, srv, tls, port: srv ? puertoConSrv(b) : b.port }
}

/**
 * El borrador rellenado con lo que dice una URI pegada: todo lo de la URI, y la contraseña
 * solo si la trae (en un alta, sin ella queda vacía). Lo propio de un motor que su URI no
 * trae (el SRV y las opciones) se queda como estaba.
 */
export function conUri(b: BorradorConexion, u: CamposUri): BorradorConexion {
  const conDestino: BorradorConexion = {
    ...b,
    host: u.host,
    user: u.user,
    database: u.database,
    srv: u.srv ?? b.srv,
    tls: { cifrar: u.tls.cifrar, confiarCertificado: u.tls.confiarCertificado },
    ...(u.opcionesUri !== undefined ? conOpciones(u.opcionesUri) : {}),
    password: u.password !== '' ? u.password : b.id === undefined ? '' : b.password
  }
  return { ...conDestino, port: u.port ?? puertoConSrv(conDestino) }
}

/** ¿Lleva el borrador una contraseña NUEVA que haya que mandar? */
function passwordNueva(b: BorradorConexion): boolean {
  return b.password !== undefined && b.password !== ''
}

/**
 * ¿Hay algo sin guardar? Un alta siempre (no hay nada guardado todavía). Una
 * edición, si algún campo que VIAJA difiere del original o se escribió una
 * contraseña.
 */
export function hayCambios(b: BorradorConexion, original: BorradorConexion | null): boolean {
  if (b.id === undefined || original === null) return true
  if (passwordNueva(b)) return true
  // Un archivo elegido de nuevo es un cambio aunque se llame igual que el guardado (otra
  // carpeta, otra base): lo que viaja es su ficha, no el nombre.
  if (b.origenArchivo !== undefined && descriptorDe(b.motor).deArchivo) return true
  return difierenLosQueViajan(limpiarParaGuardar(b), limpiarParaGuardar(original))
}

/** Los campos comunes a todos los motores que se comparan para saber si hay cambios. */
const CAMPOS_COMPARADOS = ['alias', 'motor', 'host', 'port', 'database', 'sid', 'user', 'readonly', 'entorno', 'notas'] as const

/** ¿Difieren dos borradores ya limpios en algo que viaja? Los opcionales, solo los de este motor. */
function difierenLosQueViajan(a: BorradorConexion, o: BorradorConexion): boolean {
  return (
    CAMPOS_COMPARADOS.some((c) => a[c] !== o[c]) ||
    JSON.stringify(opcionalesQueViajan(a)) !== JSON.stringify(opcionalesQueViajan(o))
  )
}

type OpcionalesEntrada = Pick<DbConnectionInput, 'instancia' | 'autenticacion' | 'dominio' | 'tls' | 'srv' | 'opcionesUri'>

/**
 * Los opcionales que viajan con el motor del borrador: solo los que declara
 * (`usaOpcional`), y el dominio solo con una autenticación que lo pide. `{}` con los
 * motores que no declara ninguno. Las claves, en orden fijo (se comparan por JSON).
 */
function opcionalesQueViajan(b: BorradorConexion): OpcionalesEntrada {
  const d = descriptor(b.motor)
  const r: OpcionalesEntrada = {}
  if (usaOpcional(d, 'instancia')) r.instancia = b.instancia.trim()
  if (usaOpcional(d, 'autenticacion')) r.autenticacion = b.autenticacion
  if (usaOpcional(d, 'dominio') && pideDominio(autenticacionDe(b.autenticacion))) r.dominio = b.dominio.trim()
  if (usaOpcional(d, 'tls')) r.tls = { cifrar: b.tls.cifrar, confiarCertificado: b.tls.confiarCertificado }
  if (usaOpcional(d, 'srv')) r.srv = b.srv
  // Con la base de autenticación de vuelta en su sitio (`unirAuthSource`).
  if (usaOpcional(d, 'opcionesUri')) r.opcionesUri = unirAuthSource(b.opcionesUri, b.authSource, b.authSourceOrigen)
  return r
}

/** Lo que viaja al main al guardar: sin lo que el motor descarta, y la contraseña solo si toca. */
export function entradaDe(borrador: BorradorConexion): DbConnectionInput {
  const b = limpiarParaGuardar(borrador)
  const entrada: DbConnectionInput = {
    profileId: b.profileId,
    alias: b.alias,
    motor: b.motor,
    host: b.host,
    port: b.port,
    database: b.database,
    sid: b.sid,
    user: b.user,
    readonly: b.readonly,
    notas: b.notas
  }
  // Sin entorno, el campo NO va: ausente es «sin entorno».
  if (b.entorno !== null) entrada.entorno = b.entorno
  Object.assign(entrada, opcionalesQueViajan(b))
  // Motor de archivo: solo si se eligió uno NUEVO (ausente = el guardado). En un motor de red no va nunca.
  if (b.origenArchivo !== undefined && descriptorDe(b.motor).deArchivo) entrada.archivo = b.origenArchivo
  // Un motor sin credenciales no manda contraseña: el main rechaza una no vacía, y una
  // tecleada con otro motor antes de cambiar sigue en el borrador.
  if (!pideCredenciales(b.motor)) return entrada
  if (b.id === undefined) entrada.password = b.password ?? ''
  else if (passwordNueva(b)) entrada.password = b.password
  return entrada
}

/** ¿Pide el motor usuario y contraseña? (`credenciales` de su descriptor.) */
function pideCredenciales(motor: DbMotor): boolean {
  return pideUsuarioYClave(descriptor(motor))
}

/**
 * El borrador con un archivo recién ELEGIDO, CREADO o SOLTADO: su nombre para pintarlo y su
 * ficha para que viaje. Sin nombre de conexión todavía, el del archivo sin extensión. La
 * casilla de los agentes se queda como venga, también en una base recién creada.
 */
export function conArchivoElegido(b: BorradorConexion, elegido: DbArchivoElegido): BorradorConexion {
  const punto = elegido.nombre.lastIndexOf('.')
  const sinExtension = punto > 0 ? elegido.nombre.slice(0, punto) : elegido.nombre
  return {
    ...b,
    archivo: elegido.nombre,
    origenArchivo: { tipo: 'elegido', token: elegido.token },
    alias: b.alias.trim() === '' ? sinExtension.slice(0, ALIAS_MAX) : b.alias
  }
}

/**
 * El borrador tras guardarlo: pasa a ser una edición de lo guardado, con la contraseña otra
 * vez «sin cambios». Si se conservara la tecleada, el siguiente «Guardar» la volvería a mandar
 * y el main retiraría la marca de verificada de una conexión que no cambió.
 */
export function borradorGuardado(c: DbConnection): BorradorConexion {
  return borradorDesde(c)
}
