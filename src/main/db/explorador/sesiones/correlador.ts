// =============================================================================
// Correlador del protocolo con el proceso de sesión: id -> promesa, con un vigilante por
// operación y reloj inyectado; y la clasificación de lo que llega por el canal. Puro: lo
// reexporta `protocoloTrabajador.ts` (de donde lo importan todos) y lo prueba `test-protocolo`.
// Decisiones: docs/decisiones/bd/sesiones-protocolo-del-trabajador.md
// =============================================================================

import type { DbRolSesion } from '../../../../shared/db-explorador-ipc.ts'
import { esObjeto } from '../../../util/valores.ts'
import type {
  ErrorTrabajador,
  EventoTrabajador,
  OpTrabajador,
  PeticionDe,
  PeticionSinId,
  PeticionSinIdDe,
  RespuestasPorOp,
  RespuestaTrabajador
} from '../protocoloTrabajador.ts'

// --- Plazos --------------------------------------------------------------------------------

export interface PlazosTrabajador {
  iniciar: number
  abrir: number
  /** Cualquier operación de la sesión `meta` (árbol, autocompletado). */
  meta: number
  cancelar: number
  cerrar: number
  salir: number
}

/**
 * Plazos del vigilante. `meta` es 75 s: el timeout de sentencia de esa sesión es de
 * 60 s en el servidor, y el vigilante tiene que llegar DESPUÉS del error del
 * servidor, no antes. `abrir` es 90 s porque incluye la escalada a thick (cargar el
 * Instant Client y reconectar) sobre una VPN lenta.
 */
export const PLAZOS_TRABAJADOR_MS: PlazosTrabajador = {
  iniciar: 15_000,
  abrir: 90_000,
  meta: 75_000,
  cancelar: 10_000,
  cerrar: 10_000,
  salir: 3_000
}

/**
 * Plazo del vigilante de una petición, o null si no lleva. `rol` es el de la sesión
 * a la que va dirigida (el correlador lo aprende de las peticiones `abrir`).
 */
export function plazoDePeticion(
  p: PeticionSinId,
  rol: DbRolSesion | undefined,
  plazos: PlazosTrabajador = PLAZOS_TRABAJADOR_MS
): number | null {
  switch (p.op) {
    case 'iniciar':
      return plazos.iniciar
    case 'abrir':
      return plazos.abrir
    case 'cancelar':
      return plazos.cancelar
    case 'cerrar':
    case 'cerrarLector':
      return plazos.cerrar
    case 'salir':
      return plazos.salir
    case 'autoCommit':
      // Puede costar un viaje (el estado de la tx), nunca una sentencia de usuario.
      return plazos.meta
    case 'ejecutar':
    case 'leer':
    case 'tx':
    case 'docs':
    case 'claves':
      // El árbol lleva vigilante; una consulta, una sentencia de consola o un ROLLBACK largos
      // son legítimos y tienen Stop.
      return rol === 'meta' ? plazos.meta : null
  }
}

// --- Rechazo del lado del main ------------------------------------------------------------

/** Error con el que se rechaza una petición: lleva el `ErrorTrabajador` dentro. */
export class FalloTrabajador extends Error {
  error: ErrorTrabajador
  op: OpTrabajador | null

  constructor(error: ErrorTrabajador, op: OpTrabajador | null) {
    super(error.mensaje)
    this.name = 'FalloTrabajador'
    this.error = error
    this.op = op
  }
}

export function esFalloTrabajador(e: unknown): e is FalloTrabajador {
  return e instanceof FalloTrabajador
}

// --- Clasificación de mensajes entrantes -----------------------------------------------------

export type MensajeClasificado =
  | { tipo: 'respuesta'; respuesta: RespuestaTrabajador }
  | { tipo: 'evento'; evento: EventoTrabajador }
  | { tipo: 'ruido' }

function esErrorTrabajador(v: unknown): v is ErrorTrabajador {
  return esObjeto(v) && typeof v.mensaje === 'string' && typeof v.clase === 'string'
}

/**
 * Valida la FORMA de un mensaje del trabajador. Lo que no encaja es ruido: se
 * registra y se ignora, nunca revienta el main.
 */
export function clasificarMensaje(m: unknown): MensajeClasificado {
  if (!esObjeto(m)) return { tipo: 'ruido' }
  if (typeof m.id === 'number' && typeof m.ok === 'boolean') {
    if (m.ok) return { tipo: 'respuesta', respuesta: { id: m.id, ok: true, r: m.r } }
    if (esErrorTrabajador(m.error)) return { tipo: 'respuesta', respuesta: { id: m.id, ok: false, error: m.error } }
    return { tipo: 'ruido' }
  }
  if (m.ev === 'perdida' && typeof m.sesion === 'string' && esErrorTrabajador(m.error)) {
    return { tipo: 'evento', evento: { ev: 'perdida', sesion: m.sesion, error: m.error } }
  }
  if (m.ev === 'fatal' && typeof m.mensaje === 'string') {
    return { tipo: 'evento', evento: { ev: 'fatal', mensaje: m.mensaje } }
  }
  return { tipo: 'ruido' }
}

// --- Correlador -------------------------------------------------------------------------------

/** Reloj inyectable: el test avanza el tiempo a mano. */
export interface Reloj {
  programar(fn: () => void, ms: number): unknown
  cancelar(asa: unknown): void
}

export const RELOJ_REAL: Reloj = {
  programar: (fn, ms) => setTimeout(fn, ms),
  cancelar: (asa) => clearTimeout(asa as ReturnType<typeof setTimeout>)
}

export interface OpcionesCorrelador {
  reloj?: Reloj
  plazos?: Partial<PlazosTrabajador>
  /** Se llama cuando un vigilante vence (el llamador decide si mata el proceso). */
  alVencer?: (op: OpTrabajador, id: number) => void
}

interface Pendiente {
  op: OpTrabajador
  resolver: (v: unknown) => void
  rechazar: (e: FalloTrabajador) => void
  vigilante: unknown
}

export type RecepcionCorrelador =
  | { tipo: 'respuesta'; encontrada: boolean; id: number }
  | { tipo: 'evento'; evento: EventoTrabajador }
  | { tipo: 'ruido' }

/**
 * id -> {resolver, rechazar, vigilante}. No conoce el canal: `preparar` devuelve el
 * mensaje con su id y la promesa; quien lo envía llama a `recibir` con lo que llega
 * y a `rechazarTodo` cuando el proceso sale.
 */
export class Correlador {
  private siguiente = 1
  private readonly pendientesPorId = new Map<number, Pendiente>()
  private readonly roles = new Map<string, DbRolSesion>()
  private readonly reloj: Reloj
  private readonly plazos: PlazosTrabajador
  private readonly alVencer: ((op: OpTrabajador, id: number) => void) | undefined

  constructor(opciones: OpcionesCorrelador = {}) {
    this.reloj = opciones.reloj ?? RELOJ_REAL
    this.plazos = { ...PLAZOS_TRABAJADOR_MS, ...(opciones.plazos ?? {}) }
    this.alVencer = opciones.alVencer
  }

  /** Peticiones en vuelo. */
  get pendientes(): number {
    return this.pendientesPorId.size
  }

  /** Rol de una sesión, aprendido de su `abrir`. */
  rolDe(sesion: string): DbRolSesion | undefined {
    return this.roles.get(sesion)
  }

  /**
   * Asigna id, arma el vigilante y devuelve el mensaje listo para enviar junto con
   * la promesa de su respuesta. `plazoMs` sustituye al de la tabla (null = sin él).
   */
  preparar<O extends OpTrabajador>(
    peticion: PeticionSinIdDe<O>,
    plazoMs?: number | null
  ): { mensaje: PeticionDe<O>; promesa: Promise<RespuestasPorOp[O]> } {
    const id = this.siguiente++
    const mensaje = { ...peticion, id } as unknown as PeticionDe<O>
    const p = peticion as PeticionSinId
    if (p.op === 'abrir') this.roles.set(p.sesion, p.rol)
    const rol = 'sesion' in p ? this.roles.get(p.sesion) : undefined
    if (p.op === 'cerrar') this.roles.delete(p.sesion)
    const plazo = plazoMs === undefined ? plazoDePeticion(p, rol, this.plazos) : plazoMs

    const promesa = new Promise<RespuestasPorOp[O]>((resolver, rechazar) => {
      let vigilante: unknown = null
      if (plazo !== null && plazo > 0) {
        vigilante = this.reloj.programar(() => {
          if (!this.pendientesPorId.delete(id)) return
          rechazar(
            new FalloTrabajador(
              {
                clase: 'timeout',
                codigo: 'TESSERA-PLAZO',
                mensaje: `El proceso de la conexión no respondió a «${p.op}» en ${Math.round(plazo / 1000)} s.`
              },
              p.op
            )
          )
          this.alVencer?.(p.op, id)
        }, plazo)
      }
      this.pendientesPorId.set(id, {
        op: p.op,
        resolver: resolver as (v: unknown) => void,
        rechazar,
        vigilante
      })
    })
    return { mensaje, promesa }
  }

  /** Procesa un mensaje entrante. Una respuesta tardía (vigilante vencido) se ignora. */
  recibir(m: unknown): RecepcionCorrelador {
    const c = clasificarMensaje(m)
    if (c.tipo === 'ruido') return c
    if (c.tipo === 'evento') return c
    const r = c.respuesta
    const pendiente = this.pendientesPorId.get(r.id)
    if (!pendiente) return { tipo: 'respuesta', encontrada: false, id: r.id }
    this.pendientesPorId.delete(r.id)
    if (pendiente.vigilante !== null) this.reloj.cancelar(pendiente.vigilante)
    if (r.ok) pendiente.resolver(r.r)
    else pendiente.rechazar(new FalloTrabajador(r.error, pendiente.op))
    return { tipo: 'respuesta', encontrada: true, id: r.id }
  }

  /** Rechaza UNA petición (p. ej. el envío falló). Devuelve si estaba pendiente. */
  fallar(id: number, error: ErrorTrabajador): boolean {
    const pendiente = this.pendientesPorId.get(id)
    if (!pendiente) return false
    this.pendientesPorId.delete(id)
    if (pendiente.vigilante !== null) this.reloj.cancelar(pendiente.vigilante)
    pendiente.rechazar(new FalloTrabajador(error, pendiente.op))
    return true
  }

  /** Rechaza TODO lo pendiente (el proceso salió). Devuelve cuántas rechazó. */
  rechazarTodo(error: ErrorTrabajador): number {
    const todas = [...this.pendientesPorId.entries()]
    this.pendientesPorId.clear()
    this.roles.clear()
    for (const [, pendiente] of todas) {
      if (pendiente.vigilante !== null) this.reloj.cancelar(pendiente.vigilante)
      pendiente.rechazar(new FalloTrabajador(error, pendiente.op))
    }
    return todas.length
  }
}
