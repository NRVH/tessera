// =============================================================================
// Qué promete la actualización de los agentes nativos (`planificar`), con qué banner
// vuelve cada sesión y cómo se nombran los motivos para saltarla.
// Lógica pura bajo `node`: la usan el orquestador y el popover.
// Decisiones: docs/decisiones/agentes/actualizacion-nativa.md
// =============================================================================

import type { AgentKind, CausaRechazoDetener } from '../../../../shared/agent-terminal-ipc.ts'
import type {
  EstadoAgentesNativos,
  EstadoCli,
  InstalarResultado,
  SesionNativa
} from '../../../../shared/agentes-nativos-ipc.ts'
import { ETIQUETA_AGENTE } from '../../../../shared/etiquetasAgente.ts'
import type { AvisoSesion, InstalacionPlaneada, PlanActualizacion } from './tipos.ts'

export interface OpcionesActualizacion {
  /** «Reiniciar igualmente»: todas las sesiones nativas vivas, sin instalar nada. */
  forzado?: boolean
  /** `sessionId`s con un turno terminado que nadie ha mirado (sólo avisa). */
  sinRevisar?: ReadonlySet<string>
}

/** Motivos de `ResultadoSesion`, en un solo sitio para que el test los compare. */
export const MOTIVO = {
  panelCambio: 'el panel cambió o se cerró',
  empezoATrabajar: 'empezó a trabajar',
  esperaRespuesta: 'espera tu respuesta',
  textoNuevo: 'empezaste a escribir en ella',
  noArranco: 'no volvió a arrancar',
  cerrada: 'se cerró antes de reiniciarla',
  sinResondeo: 'no se pudo volver a comprobar su versión',
  versionDesconocida: 'no se sabe con qué versión arrancó',
  alDia: 'ya corre la versión instalada'
} as const

const AGENTES: readonly AgentKind[] = ['claude-code', 'codex']

/** Por qué la parada del main rechazó una sesión, dicho para el usuario. */
const CAUSA_DETENER: Readonly<Record<CausaRechazoDetener, string>> = {
  trabajando: MOTIVO.empezoATrabajar,
  'esperando-respuesta': MOTIVO.esperaRespuesta,
  'no-nativa': 'ya no corre en modo nativo',
  'no-existe': 'se cerró',
  muerta: 'su proceso ya había salido',
  ocupada: 'estaba a mitad de otro reinicio'
}

/** El texto de una causa de rechazo; una que no conozcamos se enseña tal cual. */
export function textoCausa(causa: string): string {
  return (CAUSA_DETENER as Readonly<Record<string, string>>)[causa] ?? causa
}

/** El estado del CLI de un agente dentro de la foto del main. */
export function cliDe(estado: EstadoAgentesNativos, agente: AgentKind): EstadoCli {
  return agente === 'claude-code' ? estado.claude : estado.codex
}

function motivoManual(cli: EstadoCli): string {
  switch (cli.metodo) {
    case 'brew':
      return 'Está instalado con Homebrew: se actualiza con su orden'
    case 'gestor':
      return 'Está instalado con un gestor del sistema que Tessera no maneja'
    case 'desconocido':
      return 'No se sabe cómo se instaló: actualízalo por donde lo instalaste'
    default:
      return 'Tessera no tiene una orden automática para esta instalación en este equipo'
  }
}

function sinDuplicados(sesiones: readonly SesionNativa[]): SesionNativa[] {
  const vistas = new Set<string>()
  const out: SesionNativa[] = []
  for (const s of sesiones) {
    if (vistas.has(s.sessionId)) continue
    vistas.add(s.sessionId)
    out.push(s)
  }
  return out
}

/** El texto de una excepción cualquiera. */
export function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** ¿Impide esta sesión reiniciar ahora? Esperar tu respuesta bloquea igual que trabajar. */
function bloquea(s: SesionNativa): boolean {
  return s.trabajando || s.esperandoRespuesta
}

/**
 * «Espera: …» con lo que bloquea. Las que trabajan y las que esperan tu respuesta se
 * cuentan aparte porque el remedio es distinto; una que marque las dos cuenta como
 * trabajando.
 */
function motivoEspera(bloqueantes: readonly SesionNativa[]): string {
  const trabajando = bloqueantes.filter((s) => s.trabajando).length
  const esperando = bloqueantes.length - trabajando
  const agentes = (n: number): string => (n === 1 ? '1 agente' : `${n} agentes`)
  const esperan = (n: number): string => (n === 1 ? 'espera' : 'esperan')
  if (esperando === 0) return `Espera: ${agentes(trabajando)} trabajando`
  if (trabajando === 0) return `Espera: ${agentes(esperando)} ${esperan(esperando)} tu respuesta`
  return `Espera: ${agentes(trabajando)} trabajando y ${esperando} que ${esperan(esperando)} tu respuesta`
}

/**
 * Por qué se saltó en B una sesión SIN pega propia: la parada atómica del lote la
 * rechazó por OTRA. Sin causas conocidas, «trabajando», que es lo que significa el
 * motivo del main.
 */
export function motivoPorOtra(agente: AgentKind, rechazos: InstalarResultado['rechazos']): string {
  const causas = new Set((rechazos ?? []).map((x) => x.causa))
  const espera = causas.has('esperando-respuesta') && !causas.has('trabajando')
  return `otra sesión de ${ETIQUETA_AGENTE[agente]} ${espera ? 'espera tu respuesta' : 'estaba trabajando'}`
}

/**
 * Por qué una sesión que NO se paró en B se salta en C, o null si se puede parar.
 * `antes` es su ficha de la compuerta; `ahora`, la del re-sondeo (undefined si no lo
 * hubo o si ya no está viva: el main sólo lista vivas).
 */
export function motivoSaltoEnC(antes: SesionNativa, ahora: SesionNativa | undefined): string | null {
  if (!ahora) return null
  if (ahora.trabajando) return MOTIVO.empezoATrabajar
  if (ahora.esperandoRespuesta) return MOTIVO.esperaRespuesta
  // Sólo un borrador NUEVO: el que ya estaba se avisó y se confirmó igualmente.
  if (ahora.puedeTenerTextoSinEnviar && !antes.puedeTenerTextoSinEnviar) return MOTIVO.textoNuevo
  return null
}

type ClisPlaneados = Pick<PlanActualizacion, 'instalar' | 'manuales' | 'bloqueadores'>

/** Qué se hará con cada CLI: instalarlo, pedir que se instale a mano o esperar a quien lo bloquea. */
function clasificarClis(estado: EstadoAgentesNativos, forzado: boolean): ClisPlaneados {
  const instalar: InstalacionPlaneada[] = []
  const manuales: PlanActualizacion['manuales'] = []
  const bloqueadores: PlanActualizacion['bloqueadores'] = []
  for (const agente of AGENTES) {
    const cli = cliDe(estado, agente)
    // Sin versión de destino no hay nada que prometer, aunque diga `hayNueva`.
    if (!cli.hayNueva || cli.ultima === null) continue
    if (!cli.instalable) {
      manuales.push({ agente, orden: cli.ordenManual, motivo: motivoManual(cli) })
      continue
    }
    // «Reiniciar igualmente» no instala.
    if (forzado) continue
    if (cli.bloqueadores.length > 0) {
      bloqueadores.push({ agente, procesos: cli.bloqueadores })
      continue
    }
    instalar.push({ agente, fase: cli.requiereParar ? 'B' : 'A', de: cli.instalada, a: cli.ultima })
  }
  return { instalar, manuales, bloqueadores }
}

function avisosDe(reiniciar: readonly SesionNativa[], sinRevisar: ReadonlySet<string> | undefined): AvisoSesion[] {
  const avisos: AvisoSesion[] = []
  for (const s of reiniciar) {
    if (s.puedeTenerTextoSinEnviar) avisos.push({ sessionId: s.sessionId, tipo: 'texto-sin-enviar' })
    if (sinRevisar?.has(s.sessionId)) avisos.push({ sessionId: s.sessionId, tipo: 'sin-revisar' })
  }
  return avisos
}

function motivoNoEjecutar(
  estado: EstadoAgentesNativos,
  hayTrabajo: boolean,
  bloqueantes: readonly SesionNativa[]
): string | null {
  if (estado.instalando !== null) return 'Ya hay una actualización en curso'
  if (!hayTrabajo) return 'No hay nada que actualizar ni reiniciar'
  if (bloqueantes.length > 0) return motivoEspera(bloqueantes)
  return null
}

/**
 * Qué promete la vista previa. Puro y síncrono: lo llama el popover en cada render
 * y `ejecutar` con la foto fresca de su compuerta.
 */
export function planificar(estado: EstadoAgentesNativos, opts: OpcionesActualizacion = {}): PlanActualizacion {
  const forzado = opts.forzado === true
  const { instalar, manuales, bloqueadores } = clasificarClis(estado, forzado)
  const sesiones = sinDuplicados(estado.sesiones)
  const seInstala = new Set(instalar.map((i) => i.agente))
  const reiniciar = forzado ? sesiones : sesiones.filter((s) => seInstala.has(s.agente) || s.atrasada)
  const bloqueantes = reiniciar.filter(bloquea)
  const motivo = motivoNoEjecutar(estado, instalar.length > 0 || reiniciar.length > 0, bloqueantes)
  return {
    instalar,
    reiniciar,
    bloqueantes,
    avisos: avisosDe(reiniciar, opts.sinRevisar),
    manuales,
    bloqueadores,
    puedeEjecutar: motivo === null,
    motivoNoEjecutar: motivo,
    todoAlDia: !forzado && instalar.length === 0 && !sesiones.some((s) => s.atrasada),
    forzado
  }
}

interface Banner {
  banner: string
  error: boolean
}

/** Banner de una sesión cuyo agente se intentó instalar en esta pasada. */
function bannerTrasInstalar(s: SesionNativa, inst: InstalarResultado, instaladaAhora: string | null): Banner {
  const etq = ETIQUETA_AGENTE[s.agente]
  if (!inst.ok) {
    const sigue = instaladaAhora ?? inst.despues ?? inst.antes
    return {
      banner: sigue ? `── ${etq} sigue en ${sigue}: no se pudo actualizar ──` : `── ${etq}: no se pudo actualizar ──`,
      error: true
    }
  }
  const nueva = instaladaAhora ?? inst.despues
  if (nueva === null) return { banner: `── ${etq} no responde tras actualizar ──`, error: true }
  const de = s.versionLanzada ?? inst.antes
  if (de !== null && de !== nueva) return { banner: `── ${etq} ${de} → ${nueva} ──`, error: false }
  return { banner: `── ${etq} reiniciado en ${nueva} ──`, error: false }
}

/**
 * El banner con el que vuelve cada sesión. `instaladaAhora` es la del re-sondeo
 * (null si no respondió o no se pudo re-sondear); `inst`, la instalación de su agente
 * si se intentó.
 */
export function bannerPara(
  s: SesionNativa,
  inst: InstalarResultado | undefined,
  instaladaAhora: string | null,
  forzado: boolean
): Banner {
  const etq = ETIQUETA_AGENTE[s.agente]
  if (forzado) return { banner: `── ${etq} reiniciado ──`, error: false }
  // `trabajando` = el main no tocó nada: para esta sesión no hubo instalación.
  if (inst && inst.motivo !== 'trabajando') return bannerTrasInstalar(s, inst, instaladaAhora)
  // Sólo atrasada: el binario nuevo ya estaba en disco.
  const de = s.versionLanzada
  if (de !== null && instaladaAhora !== null && de !== instaladaAhora) {
    return { banner: `── ${etq} ${de} → ${instaladaAhora} ──`, error: false }
  }
  return { banner: `── ${etq} reiniciado ──`, error: false }
}
