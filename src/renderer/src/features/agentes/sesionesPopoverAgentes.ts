// =============================================================================
// Cómo nombra, ordena y resume el popover de los agentes nativos cada sesión y cada
// evento de la actualización. Sin React: lo usan el popover y el bloque de progreso.
// Decisiones: docs/decisiones/agentes/boton-agentes-nativos.md
// =============================================================================

import type { AgentKind } from '../../../../shared/agent-terminal-ipc.ts'
import type { InstalarResultado } from '../../../../shared/agentes-nativos-ipc.ts'
import { ETIQUETA_AGENTE } from '../../../../shared/etiquetasAgente.ts'
import type { EventoActualizacion, ResultadoSesion } from './tipos.ts'

/** El target de una sesión: perfil, proyecto y agente. */
export type IdentidadSesion = { profileId: string; projectHostPath: string; agente: AgentKind }

/** Lo que el popover necesita para nombrar una sesión y ordenarla como el mosaico. */
export interface InfoSesionesAgentes {
  /** Nombre y tinta de cada perfil. */
  perfiles: ReadonlyMap<string, { nombre: string; color: string | null }>
  /** Nombre de cada proyecto abierto, por `${profileId}|${projectHostPath}`. */
  nombresProyecto: Readonly<Record<string, string>>
  /**
   * Posición canónica (la del mosaico: perfil, proyecto, agente) de cada target, YA resuelta por
   * el llamador con su clave: así este módulo no importa `agentTargetKey` (valor) de otra feature.
   */
  posicion: (s: IdentidadSesion) => number | undefined
}

/** Una línea del progreso o del resumen, con su tono. */
export interface PasoTexto {
  texto: string
  tono: 'ok' | 'error' | null
}

type Sesion = IdentidadSesion

function ultimo(ruta: string): string {
  const partes = ruta.split(/[\\/]/).filter(Boolean)
  return partes[partes.length - 1] ?? ruta
}

/** Cómo se nombra una sesión en el popover: «perfil · proyecto · agente». */
export function nombreSesion(s: Sesion, info: InfoSesionesAgentes): string {
  const perfil = info.perfiles.get(s.profileId)?.nombre ?? s.profileId
  const proyecto = info.nombresProyecto[`${s.profileId}|${s.projectHostPath}`] ?? ultimo(s.projectHostPath)
  return `${perfil} · ${proyecto} · ${ETIQUETA_AGENTE[s.agente]}`
}

function ordenSesion(s: Sesion, info: InfoSesionesAgentes): number {
  return info.posicion(s) ?? Number.MAX_SAFE_INTEGER
}

/** Las sesiones en el orden del mosaico. */
export function ordenar<T extends Sesion>(lista: readonly T[], info: InfoSesionesAgentes): T[] {
  return [...lista].sort((a, b) => ordenSesion(a, info) - ordenSesion(b, info))
}

function textoFase(ev: Extract<EventoActualizacion, { tipo: 'fase' }>): PasoTexto | null {
  const etq = ev.agente ? ETIQUETA_AGENTE[ev.agente] : null
  if (ev.fase === 'comprobando') return { texto: 'Comprobando versiones…', tono: null }
  if (ev.fase === 'deteniendo') return { texto: `Deteniendo las sesiones de ${etq ?? 'los agentes'}…`, tono: null }
  if (ev.fase === 'instalando') return { texto: `Instalando ${etq ?? 'la versión nueva'}…`, tono: null }
  if (ev.fase === 'relanzando') return { texto: 'Reiniciando las sesiones…', tono: null }
  return null
}

function textoInstalacion(r: InstalarResultado): PasoTexto {
  const etq = ETIQUETA_AGENTE[r.agente]
  if (r.ok) {
    return {
      texto: r.antes && r.despues && r.antes !== r.despues ? `${etq} ${r.antes} → ${r.despues}` : `${etq} instalado${r.despues ? ` (${r.despues})` : ''}`,
      tono: 'ok'
    }
  }
  return { texto: `${etq}: no se pudo actualizar${r.detalle ? ` — ${r.detalle}` : ''}`, tono: 'error' }
}

/** La línea de progreso de un evento de la actualización; null si no se enseña. */
export function textoEvento(ev: EventoActualizacion, info: InfoSesionesAgentes): PasoTexto | null {
  switch (ev.tipo) {
    case 'fase':
      return textoFase(ev)
    case 'instalacion':
      return textoInstalacion(ev.resultado)
    case 'sesion':
      return textoSesion(ev.sesion, info)
    case 'aviso':
      return { texto: ev.texto, tono: 'error' }
  }
}

/** Cómo terminó una sesión, dicho con su nombre. */
export function textoSesion(s: ResultadoSesion, info: InfoSesionesAgentes): PasoTexto {
  const nombre = nombreSesion(s, info)
  if (s.resultado === 'relanzada') return { texto: `${nombre}: reiniciada`, tono: 'ok' }
  if (s.resultado === 'fallo') return { texto: `${nombre}: ${s.motivo ?? 'no volvió a arrancar'}`, tono: 'error' }
  return { texto: `${nombre}: sin reiniciar${s.motivo ? ` (${s.motivo})` : ''}`, tono: null }
}
