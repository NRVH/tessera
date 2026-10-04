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
import { hayVersionNueva, sesionAtrasada } from '../../../shared/versionesCli.ts'
import { ordenActualizacion, type OrdenActualizacion } from '../comandoActualizacion.ts'
import { errMsg, type InfoSesionNativa, type NucleoNativos } from './tipos.ts'

/** ¿Hay una versión mayor que `instalada`? En Codex, además, con su binario ya publicado. */
export function hayNueva(e: NucleoNativos, agente: AgentKind, instalada: string | null): boolean {
  const i = e.info[agente]
  if (!hayVersionNueva(instalada, i.ultima)) return false
  return agente !== 'codex' || i.binarioPublicado
}

/** La orden (o por qué no hay) para la última conocida; null si aún no se comprobó. */
export function ordenPara(e: NucleoNativos, agente: AgentKind): OrdenActualizacion | null {
  const i = e.info[agente]
  if (i.comprobadoEn === null) return null
  return ordenActualizacion({ agente, metodo: i.metodo, plataforma: e.deps.plataforma, version: i.ultima })
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
