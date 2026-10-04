// =============================================================================
// Refs del pane de la terminal del agente: el xterm y sus addons, la sesión (su dueño,
// `SesionAgente`), el candado de recuperación y los espejos de props que leen los
// callbacks asíncronos y la API publicada. Objeto y refs son los mismos durante la vida del pane.
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import { useState, type MutableRefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { SearchAddon } from '@xterm/addon-search'
import type { WebglAddon } from '@xterm/addon-webgl'
import type { FlowWriter } from '../terminales'
import type { TerminalAppearance } from '../../theme/terminalAppearance'
import type { ApiAgentePane, ResultadoRelanzar } from './tipos'
import type { PropsAgentPane } from './agentPaneTipos'
import { SesionAgente } from './sesionViva'

type Ref<T> = MutableRefObject<T>

/** Relanzar de la API publicada: va por ref para usar siempre la versión del render vigente. */
export type RelanzarApi = (o: { banner: string; error?: boolean }) => Promise<ResultadoRelanzar>

/** Todas las refs del pane, en un objeto estable durante su vida. */
export interface RefsAgentPane {
  host: Ref<HTMLDivElement | null>
  term: Ref<Terminal | null>
  fit: Ref<FitAddon | null>
  search: Ref<SearchAddon | null>
  /** Escritor con contrapresión; se reinicia junto con `term.reset()`. */
  flow: Ref<FlowWriter | null>
  webgl: Ref<WebglAddon | null>
  /** La sesión del momento y todo su estado: solo se cambia por su API. */
  sesion: SesionAgente
  resizeTimer: Ref<ReturnType<typeof setTimeout> | null>
  /** Último tamaño ENVIADO al pty, por sesión: ver `syncPtySize`. */
  ultimoTam: Ref<{ id: string; cols: number; rows: number } | null>
  /** Tamaño ANTES de que el mosaico enseñara la terminal como casilla, o null. */
  tamPrevio: Ref<{ cols: number; rows: number } | null>
  /** ¿Puede llevarse el foco AHORA? (pintado y con permiso para robarlo). */
  puedeEnfocar: Ref<boolean>
  appearance: Ref<TerminalAppearance>
  accent: Ref<string | null>
  /** Verdad síncrona de «preparado para actualizar» para las guardas fuera del render. */
  actualizando: Ref<boolean>
  hostMode: Ref<boolean>
  hibernated: Ref<boolean>
  previewId: Ref<number>
  /** Candado contra recuperaciones concurrentes (un segundo exit no solapa el bucle). */
  recovering: Ref<boolean>
  /** Montaje vigente: lo lee la apertura sin depender de él (no reabre la sesión). */
  dbMounted: Ref<string[]>
  showSelector: Ref<boolean>
  onSelectAccount: Ref<(accountId: string | null) => void>
  onVivoChange: Ref<((vivo: boolean) => void) | undefined>
  onApi: Ref<((clave: string, api: ApiAgentePane | null) => void) | undefined>
  relanzarApi: Ref<RelanzarApi>
}

function ref<T>(valor: T): Ref<T> {
  return { current: valor }
}

function crearRefsTerminal(): Pick<RefsAgentPane, 'host' | 'term' | 'fit' | 'search' | 'flow' | 'webgl' | 'resizeTimer' | 'ultimoTam' | 'tamPrevio' | 'previewId'> {
  return {
    host: ref<HTMLDivElement | null>(null),
    term: ref<Terminal | null>(null),
    fit: ref<FitAddon | null>(null),
    search: ref<SearchAddon | null>(null),
    flow: ref<FlowWriter | null>(null),
    webgl: ref<WebglAddon | null>(null),
    resizeTimer: ref<ReturnType<typeof setTimeout> | null>(null),
    ultimoTam: ref<{ id: string; cols: number; rows: number } | null>(null),
    tamPrevio: ref<{ cols: number; rows: number } | null>(null),
    previewId: ref(0)
  }
}

/** Los avisos de las props reciben la clave del target; dentro del pane van ya ligados a ella. */
function elegirCuentaDe(p: PropsAgentPane): (accountId: string | null) => void {
  return (accountId) => p.onSelectAccount(p.target.key, accountId)
}

function avisoVivoDe(p: PropsAgentPane): ((vivo: boolean) => void) | undefined {
  const { onVivoChange } = p
  return onVivoChange ? (vivo) => onVivoChange(p.target.key, vivo) : undefined
}

function crearRefs(p: PropsAgentPane, appearance: TerminalAppearance): RefsAgentPane {
  const terminal = crearRefsTerminal()
  const sesion = new SesionAgente({
    limpiarTerminal: () => {
      terminal.flow.current?.reset()
      terminal.term.current?.reset()
    },
    cerrar: (id) => window.tessera.agentTerminal.close(id)
  })
  return {
    ...terminal,
    sesion,
    puedeEnfocar: ref(p.mostradoReal && p.robaFoco),
    appearance: ref(appearance),
    accent: ref(p.accentColor),
    actualizando: ref(false),
    hostMode: ref(p.hostMode),
    hibernated: ref(p.hibernated),
    recovering: ref(false),
    dbMounted: ref(p.dbMounted),
    showSelector: ref(false),
    onSelectAccount: ref(elegirCuentaDe(p)),
    onVivoChange: ref(avisoVivoDe(p)),
    onApi: ref(p.onApi),
    relanzarApi: ref<RelanzarApi>(async () => 'saltada')
  }
}

/**
 * Crea las refs del pane UNA vez (el objeto es estable, así que puede ir en las
 * dependencias de un efecto sin re-dispararlo) y actualiza en cada render los espejos.
 */
export function useRefsAgentPane(p: PropsAgentPane, appearance: TerminalAppearance): RefsAgentPane {
  const [r] = useState(() => crearRefs(p, appearance))
  r.onSelectAccount.current = elegirCuentaDe(p)
  r.puedeEnfocar.current = p.mostradoReal && p.robaFoco
  r.appearance.current = appearance
  r.accent.current = p.accentColor
  r.hostMode.current = p.hostMode
  r.hibernated.current = p.hibernated
  r.dbMounted.current = p.dbMounted
  r.onVivoChange.current = avisoVivoDe(p)
  r.onApi.current = p.onApi
  return r
}
