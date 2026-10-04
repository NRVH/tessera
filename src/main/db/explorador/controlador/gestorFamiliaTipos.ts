// =============================================================================
// Tipos, mensajes y funciones puras del núcleo `GestorFamilia` (gestores de MongoDB y Redis): dependencias,
// configuración por familia, proceso y sesión, y la conexión que viaja al trabajador. `gestorFamilia.ts` los reexporta.
// Decisiones: docs/decisiones/bd/explorador-familias.md
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import type { DbErrorSql, DbEstadoSesion, DbFaseSesion, DbRefSesion, DbRolSesion } from '../../../../shared/db-explorador-ipc.ts'
import { descriptor, type FamiliaMotor } from '../../../../shared/motores/index.ts'
import { tlsEfectivo } from '../../opcionalesConexion.ts'
import { ColaSesion, type PrioridadCola } from '../colaSesion.ts'
import type { TrabajadorGestor } from '../GestorSesiones.ts'
import { esFalloTrabajador, type ConexionTrabajador, type CtxDrivers, type ErrorTrabajador } from '../protocoloTrabajador.ts'
import type { SoloLecturaImpuesta } from '../soloLecturaImpuesta.ts'

/** Lo que necesita un gestor de familia; el gestor lee cada dependencia al usarla. */
export interface DependenciasGestorFamilia {
  /** Crea (sin arrancar) el proceso de sesión de una conexión (`ProcesoTrabajador` en la app). */
  lanzar: (conexion: DbConnection) => TrabajadorGestor
  /** La conexión tal como está AHORA en el registro (undefined si se borró). */
  conexion: (id: string) => DbConnection | undefined
  /** Contraseña en claro, o null si no hay o no se puede descifrar. */
  secreto: (id: string) => string | null
  /** Contexto de drivers para `abrir` (estas familias no lo usan; el protocolo lo exige). */
  ctxDrivers: () => CtxDrivers
  /** `dbx:ev:sesion`: una sesión cambió de fase. */
  emitirSesion?: (estado: DbEstadoSesion) => void
  /** Una sesión se abrió contra el servidor (el main marca la conexión verificada). */
  alAbrir?: (conexionId: string) => void
  /** Plazo de inactividad de las consolas (el ajuste del usuario). Por defecto el de `limites.ts`. */
  inactividadConsolaMs?: () => number
  ahora?: () => number
  /** Registro. NUNCA recibe sentencias, documentos, claves, valores ni secretos. */
  log?: (linea: string) => void
  /**
   * La solo lectura que impone el explorador (`soloLecturaImpuesta.ts`): la que enseña el estado
   * de la sesión y la que viaja en la conexión del trabajador. Ausente, NINGUNA: la casilla
   * `readonly` es de los agentes.
   */
  soloLecturaImpuesta?: SoloLecturaImpuesta
}

/** La op del protocolo con la que habla cada familia (ver `protocoloTrabajador.ts`). */
export type OpFamilia = 'docs' | 'claves'

/** Lo que distingue a cada familia: su op, sus mensajes, su conexión y sus errores. */
export interface ConfigFamilia<C> {
  op: OpFamilia
  /** La familia que exige `asegurarAbierta` (una conexión de otra no lanza nada). */
  familia: Exclude<FamiliaMotor, 'sql'>
  /** Cómo se nombra en los mensajes y en el registro: «documentos», «claves». */
  etiqueta: string
  /** La conexión tal como la necesita el trabajador (sin secreto). */
  conexionTrabajador: (c: DbConnection) => ConexionTrabajador
  /** `ErrorTrabajador` → `DbErrorSql`, con el contexto de la operación para ubicar la sintaxis. */
  error: (et: ErrorTrabajador, ctx: C | undefined) => DbErrorSql
}

/** Opciones de una operación en la cola de su sesión. */
export interface OpcionesOperar {
  /** La clave de la cola: la que cancela (`peticionId` o `ejecucionId`). */
  clave?: string
  prioridad?: PrioridadCola
  /** Solo lecturas: una pérdida se reintenta UNA vez en una sesión nueva. */
  reintentar?: boolean
}

/** Un proceso de sesión (uno por conexión). */
export interface ProcesoFamilia {
  id: number
  conexionId: string
  trabajador: TrabajadorGestor
  arranque: Promise<void>
  salido: boolean
  /** Lo retiró el main (desconectar, forzar, expulsión, cierre): su salida no es una caída. */
  retirado: boolean
  ultimoUso: number
  bajas: Array<() => void>
}

/** Una sesión (`meta`, `datos` o una por consola) dentro de un proceso. */
export interface SesionFamilia {
  /** Clave del mapa: conexión + id en el trabajador. */
  clave: string
  /** El id de la sesión DENTRO del trabajador: 'meta', 'datos' o `consola:<consolaId>`. */
  id: string
  conexionId: string
  rol: DbRolSesion
  ref: DbRefSesion
  cola: ColaSesion
  proceso: ProcesoFamilia | null
  abierta: boolean
  fase: DbFaseSesion
  ocupadaDesde?: number
  ultimoUso: number
  soloLectura: boolean
  version: string | null
  aviso?: DbEstadoSesion['aviso']
}

export const MENSAJE_CERRANDO = 'Tessera se está cerrando.'
export const MENSAJE_SIN_LANZAR = 'No se pudo lanzar el proceso de la conexión.'
export const MENSAJE_FORZADA = 'Se forzó el cierre de la conexión.'

/**
 * Los campos COMUNES de la conexión que viaja al trabajador de una familia no SQL: con el
 * cifrado EFECTIVO (`tlsEfectivo`) y la base solo si tiene valor. Sin secreto (va aparte, en
 * `abrir`). Cada familia añade lo suyo encima.
 */
export function conexionTrabajadorFamilia(c: DbConnection): ConexionTrabajador {
  const t: ConexionTrabajador = {
    id: c.id,
    alias: c.alias,
    motor: c.motor,
    host: c.host,
    port: c.port,
    user: c.user ?? '',
    // La solo lectura que impone el explorador la pone `asegurarAbierta` encima; nunca la casilla de los agentes.
    readonly: false,
    driverId: null,
    tls: tlsEfectivo(descriptor(c.motor), c)
  }
  if (c.database) t.database = c.database
  return t
}

/** El `ErrorTrabajador` que lleva un rechazo del trabajador, o null si es otra cosa. */
export function errorTrabajadorDe(e: unknown): ErrorTrabajador | null {
  return esFalloTrabajador(e) ? e.error : null
}

export { mensajeDe } from '../../../util/valores.ts'

/** El aviso de una sesión perdida, con el motivo si el trabajador lo dio. */
export function avisoDePerdida(et: ErrorTrabajador | null, tipo: 'perdida' | 'caida', en: number): NonNullable<DbEstadoSesion['aviso']> {
  const mensaje = et?.mensaje
    ? `Se perdió la sesión con el servidor (${et.mensaje}). Se reabre al usarla.`
    : 'Se perdió la sesión con el servidor. Se reabre al usarla.'
  return { tipo, txPerdida: false, mensaje, en }
}

/** El proceso ocioso (sin sesión con cola) que lleva más tiempo sin usarse, o undefined. */
export function procesoOciosoMasViejo(vivos: readonly ProcesoFamilia[], sesiones: readonly SesionFamilia[]): ProcesoFamilia | undefined {
  return vivos
    .filter((p) => sesiones.every((s) => s.proceso !== p || s.cola.vacia()))
    .sort((a, b) => a.ultimoUso - b.ultimoUso)[0]
}

/** Una sesión nueva, cerrada y con su cola. */
export function sesionNueva(clave: string, id: string, conexionId: string, ref: DbRefSesion, ahora: number): SesionFamilia {
  return {
    clave,
    id,
    conexionId,
    rol: ref.rol,
    ref,
    cola: new ColaSesion(),
    proceso: null,
    abierta: false,
    fase: 'cerrada',
    ultimoUso: ahora,
    soloLectura: false,
    version: null
  }
}

/** El estado de una sesión para la interfaz: estas familias no tienen transacción (`txModo: 'auto'`, `tx: 'ninguna'`). */
export function estadoDeSesion(s: SesionFamilia): DbEstadoSesion {
  const e: DbEstadoSesion = {
    ref: s.ref,
    conexionId: s.conexionId,
    fase: s.fase,
    txModo: 'auto',
    tx: 'ninguna',
    sentenciasEnTx: 0,
    esquema: null,
    soloLectura: s.soloLectura
  }
  if (s.ocupadaDesde !== undefined) e.ocupadaDesde = s.ocupadaDesde
  if (s.version !== null) e.driver = { modo: 'nativo', driverId: null, version: s.version }
  if (s.aviso) e.aviso = s.aviso
  return e
}
