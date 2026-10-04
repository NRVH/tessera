// =============================================================================
// Dependencias, tiempos y estado compartido del servicio de los agentes nativos.
// `NucleoNativos` es el ÚNICO estado (sondas, información de cada CLI, candados,
// cadencia): lo crea la fachada `AgentesNativos` y lo reciben las piezas de `nativos/`.
// Decisiones: docs/decisiones/agentes/nativos-actualizacion-del-host.md
// =============================================================================

import { realpath } from 'node:fs/promises'
import type { AgentDetenerVariasResult, AgentKind } from '../../../shared/agent-terminal-ipc.ts'
import type {
  EstadoAgentesNativos,
  MetodoInstalacion,
  ProcesoBloqueador,
  ProgresoAgentesNativos,
  SesionNativa
} from '../../../shared/agentes-nativos-ipc.ts'
import type { Plataforma } from '../../../shared/plataforma.ts'
import type { ProcesoSistema } from '../../update/procesosSistema.ts'
import type { OpcionesEjecucion, ResultadoEjecucion } from '../ejecutorShell.ts'
import { esperar } from '../../util/esperas.ts'

/** Topes y periodos del servicio (las pruebas los acortan). */
export interface TiemposAgentesNativos {
  /** Tope de una sonda (`--version`, `Get-Command`, `npm prefix -g`). */
  topeSondaMs: number
  /** Tope de la orden de instalación; al vencer se mata el árbol. */
  topeOrdenMs: number
  /** Tope de cada consulta de red. */
  topeRedMs: number
  /** Cuánto se espera a que mueran los procesos bajo la raíz tras parar. */
  presupuestoBloqueoMs: number
  intervaloBloqueoMs: number
  /** Retraso de cortesía de la primera comprobación. */
  primerChequeoMs: number
  /** Periodo de la comprobación en segundo plano. */
  periodoMs: number
  /** Al recuperar el foco se comprueba si la última tiene más de esto. */
  umbralRefocoMs: number
  /** Rebote de los avisos de cambio de sesiones. */
  reboteSesionesMs: number
}

/** Valores de producción de `TiemposAgentesNativos`. */
export const TIEMPOS_AGENTES_NATIVOS: Readonly<TiemposAgentesNativos> = {
  topeSondaMs: 15_000,
  topeOrdenMs: 5 * 60_000,
  topeRedMs: 10_000,
  presupuestoBloqueoMs: 8_000,
  intervaloBloqueoMs: 300,
  primerChequeoMs: 20_000,
  periodoMs: 4 * 60 * 60_000,
  umbralRefocoMs: 30 * 60_000,
  reboteSesionesMs: 250
}

/** Lo que el controlador sabe de cada sesión nativa viva (`atrasada` la pone el servicio). */
export type InfoSesionNativa = Omit<SesionNativa, 'atrasada'>

/** Dependencias inyectadas del servicio: todo lo que toca el sistema, la red o el reloj. */
export interface DepsAgentesNativos {
  plataforma: Plataforma
  /** `process.arch` (`x64`, `arm64`): elige el binario de Codex publicado. */
  arch: string
  /** `ejecutarEnShellNativa`. */
  ejecutar: (cmd: string, opciones: OpcionesEjecucion) => Promise<ResultadoEjecucion>
  /** GET de texto con tope; RECHAZA ante error de red o HTTP no 2xx. */
  fetchTexto: (url: string, timeoutMs: number) => Promise<string>
  ahora: () => number
  /** Tabla completa de procesos (Windows); rechaza si no se pudo obtener. */
  listarProcesos: () => Promise<ProcesoSistema[]>
  /** Lee un fichero de texto; rechaza si no existe. */
  leerTexto: (ruta: string) => Promise<string>
  env: Record<string, string | undefined>
  homedir: string
  /** Sesiones NATIVAS vivas, del controlador. */
  sesiones: () => InfoSesionNativa[]
  /** Parada atómica del controlador. */
  detenerVarias: (ids: string[]) => Promise<AgentDetenerVariasResult>
  /** Pids de los ptys nativos vivos de ESE agente (vista previa de bloqueadores). */
  pidsTessera: (agente: AgentKind) => number[]
  emitirCambio: (estado: EstadoAgentesNativos) => void
  emitirProgreso: (p: ProgresoAgentesNativos) => void
  log: (msg: string) => void
  /** `realpath`; rechaza si no existe. Por defecto el de `node:fs/promises`. */
  resolverRuta?: (ruta: string) => Promise<string>
  /** Espera (pruebas: reloj falso). */
  esperar?: (ms: number) => Promise<void>
  /** Temporizador cancelable (pruebas: manual). */
  programar?: (fn: () => void, ms: number) => () => void
  tiempos?: Partial<TiemposAgentesNativos>
}

/** La última versión medida de un CLI (sin fecha: no hay caché de tiempo) y la sonda en vuelo. */
export interface SondaCli {
  valor: string | null
  error: string | null
  enVuelo: Promise<string | null> | null
}

/** Lo que se sabe de un CLI tras la última comprobación. */
export interface InfoCli {
  ultima: string | null
  canal: string | null
  metodo: MetodoInstalacion
  /** Windows: carpetas que la reinstalación sustituye. Vacía = no se mira la tabla de procesos. */
  raicesBloqueo: string[]
  /** Contar también por línea de comandos (Claude por npm). */
  bloqueoPorLineaComando: boolean
  /** Codex: ¿el binario de esta plataforma ya está publicado para `ultima`? */
  binarioPublicado: boolean
  bloqueadores: ProcesoBloqueador[]
  error: string | null
  /** Orden a mano que dejó la última instalación fallida. */
  ordenAyuda: string | null
  comprobadoEn: number | null
}

/** Estado y dependencias resueltas que comparten las piezas del servicio. */
export interface NucleoNativos {
  readonly deps: DepsAgentesNativos
  readonly t: TiemposAgentesNativos
  readonly resolverRuta: (ruta: string) => Promise<string>
  readonly esperar: (ms: number) => Promise<void>
  readonly programar: (fn: () => void, ms: number) => () => void
  readonly sondas: Record<AgentKind, SondaCli>
  readonly info: Record<AgentKind, InfoCli>
  readonly candados: Map<AgentKind, { promesa: Promise<void>; soltar: () => void }>
  instalando: AgentKind | null
  comprobacionEnVuelo: Promise<EstadoAgentesNativos> | null
  ultimoChequeoMs: number | null
  arrancado: boolean
  cancelarCadencia: (() => void) | null
  cancelarRebote: (() => void) | null
}

function infoVacia(): InfoCli {
  return {
    ultima: null,
    canal: null,
    metodo: 'desconocido',
    raicesBloqueo: [],
    bloqueoPorLineaComando: false,
    binarioPublicado: false,
    bloqueadores: [],
    error: null,
    ordenAyuda: null,
    comprobadoEn: null
  }
}

function programarReal(fn: () => void, ms: number): () => void {
  const t = setTimeout(fn, ms)
  t.unref?.()
  return () => clearTimeout(t)
}

/** Crea el estado del servicio con los valores por defecto de cada dependencia opcional. */
export function crearNucleoNativos(deps: DepsAgentesNativos): NucleoNativos {
  return {
    deps,
    t: { ...TIEMPOS_AGENTES_NATIVOS, ...(deps.tiempos ?? {}) },
    resolverRuta: deps.resolverRuta ?? ((r) => realpath(r)),
    esperar: deps.esperar ?? esperar,
    programar: deps.programar ?? programarReal,
    sondas: {
      'claude-code': { valor: null, error: null, enVuelo: null },
      codex: { valor: null, error: null, enVuelo: null }
    },
    info: { 'claude-code': infoVacia(), codex: infoVacia() },
    candados: new Map(),
    instalando: null,
    comprobacionEnVuelo: null,
    ultimoChequeoMs: null,
    arrancado: false,
    cancelarCadencia: null,
    cancelarRebote: null
  }
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
