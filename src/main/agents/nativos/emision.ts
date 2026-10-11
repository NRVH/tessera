// =============================================================================
// Estado de los agentes nativos tal como lo ve el renderer, y su emisión: la foto de
// cada CLI (instalada, última, orden, bloqueadores), las sesiones con `atrasada`, el
// rebote de los avisos de sesiones y las líneas de progreso de una instalación.
// Decisiones: docs/decisiones/agentes/nativos-actualizacion-del-host.md
// =============================================================================

import type { AgentKind } from '../../../shared/agent-terminal-ipc.ts'
import type {
  EstadoAgentesNativos,
  EstadoCli,
  ProgresoAgentesNativos,
  SesionNativa
} from '../../../shared/agentes-nativos-ipc.ts'
import { esVersionExacta, hayVersionNueva, sesionAtrasada } from '../../../shared/versionesCli.ts'
import { esReparable, ordenActualizacion, ordenReparacion, type OrdenActualizacion } from '../comandoActualizacion.ts'
import { errMsg, type InfoSesionNativa, type NucleoNativos } from './tipos.ts'

/** ¿Está el binario de la última listo para esta plataforma? Solo Codex por npm puede no estarlo. */
function binarioListo(e: NucleoNativos, agente: AgentKind): boolean {
  return agente !== 'codex' || e.info[agente].binarioPublicado
}

/**
 * ¿Está instalado pero sin responder a `--version`, con un gestor que lo reinstala sin
 * ejecutarlo? Con la última exacta: es la versión que se reinstala.
 */
export function enReparacion(e: NucleoNativos, agente: AgentKind, instalada: string | null): boolean {
  const i = e.info[agente]
  return instalada === null && i.comprobadoEn !== null && esReparable(agente, i.metodo) && esVersionExacta(i.ultima)
}

/**
 * ¿Hay algo que instalar sobre `instalada`? Una versión mayor o, si no responde y se puede
 * reparar, la última; en Codex, además, con su binario ya servido para esta plataforma.
 */
export function hayNueva(e: NucleoNativos, agente: AgentKind, instalada: string | null): boolean {
  const i = e.info[agente]
  if (!hayVersionNueva(instalada, i.ultima) && !enReparacion(e, agente, instalada)) return false
  return binarioListo(e, agente)
}

/** ¿Hay algo que instalar que espera solo a que el registro sirva el binario de esta plataforma? */
export function binarioPendiente(e: NucleoNativos, agente: AgentKind, instalada: string | null): boolean {
  const i = e.info[agente]
  if (binarioListo(e, agente)) return false
  return hayVersionNueva(instalada, i.ultima) || enReparacion(e, agente, instalada)
}

/**
 * La orden (o por qué no hay) para la última conocida, la de reparación si el CLI no
 * responde; null si aún no se comprobó.
 */
export function ordenPara(e: NucleoNativos, agente: AgentKind): OrdenActualizacion | null {
  const i = e.info[agente]
  if (i.comprobadoEn === null) return null
  const entrada = { agente, metodo: i.metodo, plataforma: e.deps.plataforma, version: i.ultima }
  return enReparacion(e, agente, e.sondas[agente].valor) ? ordenReparacion(entrada) : ordenActualizacion(entrada)
}

function estadoCli(e: NucleoNativos, agente: AgentKind): EstadoCli {
  const i = e.info[agente]
  const s = e.sondas[agente]
  const orden = ordenPara(e, agente)
  const auto = orden !== null && orden.tipo === 'auto'
  return {
    agente,
    instalada: s.valor,
    ultima: i.ultima,
    canal: i.canal,
    metodo: i.metodo,
    instalable: auto,
    requiereParar: orden !== null && orden.tipo === 'auto' && orden.requiereParar,
    ordenManual: orden !== null && orden.tipo === 'manual' ? orden.orden : i.ordenAyuda,
    hayNueva: hayNueva(e, agente, s.valor),
    reparar: enReparacion(e, agente, s.valor),
    binarioPendiente: binarioPendiente(e, agente, s.valor),
    bloqueadores: i.bloqueadores,
    error: s.error ?? i.error,
    comprobadoEn: i.comprobadoEn
  }
}

/** Foto actual, desde la caché (no lanza nada). */
export function estado(e: NucleoNativos): EstadoAgentesNativos {
  let crudas: InfoSesionNativa[] = []
  try {
    crudas = e.deps.sesiones()
  } catch (err) {
    e.deps.log(`agentes nativos: no se pudieron leer las sesiones: ${errMsg(err)}`)
  }
  const sesiones: SesionNativa[] = crudas.map((s) => ({
    ...s,
    atrasada: sesionAtrasada(s.versionLanzada, e.sondas[s.agente]?.valor ?? null)
  }))
  return {
    plataforma: e.deps.plataforma,
    claude: estadoCli(e, 'claude-code'),
    codex: estadoCli(e, 'codex'),
    sesiones,
    instalando: e.instalando
  }
}

/** Emite el estado ya, cancelando un rebote pendiente. */
export function emitirAhora(e: NucleoNativos): void {
  if (e.cancelarRebote) {
    e.cancelarRebote()
    e.cancelarRebote = null
  }
  try {
    e.deps.emitirCambio(estado(e))
  } catch (err) {
    e.deps.log(`agentes nativos: no se pudo emitir el estado: ${errMsg(err)}`)
  }
}

/**
 * Una sesión nativa cambió. La primera llamada programa UNA emisión y las siguientes se
 * suman a ella (no la reprograman: con actividad continua no emitiría nunca).
 */
export function notificarSesiones(e: NucleoNativos): void {
  if (e.cancelarRebote) return
  e.cancelarRebote = e.programar(() => {
    e.cancelarRebote = null
    emitirAhora(e)
  }, e.t.reboteSesionesMs)
}

/** Una línea de progreso de la instalación de `agente`. */
export function progreso(e: NucleoNativos, agente: AgentKind, linea: string, fase?: ProgresoAgentesNativos['fase']): void {
  try {
    e.deps.emitirProgreso(fase ? { agente, linea, fase } : { agente, linea })
  } catch (err) {
    e.deps.log(`agentes nativos: no se pudo emitir el progreso: ${errMsg(err)}`)
  }
}
