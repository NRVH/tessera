// =============================================================================
// Tipos de `TerminalPane` y de las piezas en que se parte: sus props, lo que reporta
// hacia el panel, las acciones que publica y el conjunto de refs que comparten los
// hooks del pane. Solo tipos: sin React en tiempo de ejecución ni DOM.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md
// =============================================================================

import type { MutableRefObject, RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { SearchAddon } from '@xterm/addon-search'
import type { WebglAddon } from '@xterm/addon-webgl'
import type { TerminalAppearance } from '../../theme/terminalAppearance'
import type { FlowWriter } from './flowControl'

export type TerminalStatus = 'booting' | 'live' | 'exited' | 'error'

/** Un proyecto abierto (de cualquier perfil): el contenedor de una lista de terminales. */
export interface TerminalProjectTarget {
  profileId: string
  projectHostPath: string
  /** `${profileId}|${projectHostPath}` (terminalProjectKey). */
  key: string
}

/** Lo que el pane reporta hacia arriba para que el header pinte SU estado. */
export interface TerminalPaneInfo {
  status: TerminalStatus
  sessionId: string | null
  exitCode: number | null
  error: string | null
  reloading: boolean
}

/** Acciones del pane que el header (arriba) dispara sobre la terminal ACTIVA. */
export interface TerminalPaneApi {
  /**
   * Reload robusto ('reload': mismo sessionId, entorno recomputado) o reintento del
   * ARRANQUE ('open': nunca hubo sesión porque el open falló). La acción la decide
   * `botonReinicio` en el panel, para que lo pintado y lo ejecutado no discrepen.
   */
  reload: (accion: 'reload' | 'open' | 'nada') => Promise<void>
  focus: () => void
}

export interface TerminalPaneProps {
  /** Identidad de la ranura (`${projectKey}|${terminalId}`); el pane la devuelve en cada reporte. */
  paneKey: string
  /** Perfil de ESTA ranura. FIJO en vida del componente (va en la React key). */
  profileId: string
  /** Proyecto de ESTA ranura (cwd/mount de la sesión). FIJO (va en la React key). */
  projectHostPath: string
  /**
   * ¿Es la terminal que se está mirando? Solo alterna CSS (display:none): un pane
   * oculto conserva su xterm, su scrollback y su pty. NUNCA desmonta.
   */
  visible: boolean
  /**
   * Modo nativo: la terminal es un shell del host con cwd en la ruta real del proyecto,
   * en vez de un shell dentro del contenedor. FIJO (va en la React key: alternar el
   * modo REMONTA el pane, que es lo correcto — otra sesión, otro shell).
   */
  hostMode?: boolean
  /**
   * Ids de las conexiones a base de datos montadas en este proyecto (mismo ámbito que
   * su sesión de agente). Se envían al ABRIR: cambiarlas exige reabrir la terminal.
   */
  dbMounted?: string[]
  /**
   * ¿Están ya cargados los ajustes (de donde sale `dbMounted`)? En modo nativo la
   * terminal NO se abre hasta que sea true: nacería sin `tdb` en el PATH.
   */
  dbReady?: boolean
  /**
   * El proyecto está HIBERNADO: el backend ya mató esta sesión por detrás. El pane
   * limpia su sessionId muerto y la reabre cuando vuelva a ser visible.
   */
  hibernated?: boolean
  /** Color del perfil, ya en tinta (ver features/pestanas/colorPerfil). Solo tiñe el CURSOR. */
  accentColor?: string | null
  /** Reporta estado/sesión hacia arriba (el header del panel los pinta). */
  onInfo?: (paneKey: string, info: TerminalPaneInfo) => void
  /** Publica las acciones del pane hacia arriba (Recargar/foco del header). null al desmontar. */
  onApi?: (paneKey: string, api: TerminalPaneApi | null) => void
}

/**
 * Refs que comparten los hooks de un pane. El objeto es ESTABLE entre renders (lo crea
 * `useRefsTerminal` una sola vez), así que ninguno de sus campos entra en las
 * dependencias de un efecto por cambiar de identidad.
 */
export interface RefsTerminal {
  host: RefObject<HTMLDivElement>
  term: MutableRefObject<Terminal | null>
  fit: MutableRefObject<FitAddon | null>
  search: MutableRefObject<SearchAddon | null>
  webgl: MutableRefObject<WebglAddon | null>
  /** Escritor con contrapresión: `reload` lo reinicia junto con `term.reset()`. */
  flow: MutableRefObject<FlowWriter | null>
  session: MutableRefObject<string | null>
  /** Guarda contra aperturas solapadas (open() tarda: docker puede irse a ~1 min). */
  opening: MutableRefObject<boolean>
  /** Montaje de bases por ref: cambiarlo no reabre el shell; se aplica al reabrir. */
  dbMounted: MutableRefObject<string[]>
  /** ¿Ya abrió alguna vez? Solo para el banner de «relanzada» al despertar. */
  hasOpenedOnce: MutableRefObject<boolean>
  /** `visible` legible desde callbacks async (no robar foco si ya se fue a otra terminal). */
  visible: MutableRefObject<boolean>
  /** Temporizador del debounce del resize AL PTY (trailing). */
  resizeTimer: MutableRefObject<ReturnType<typeof setTimeout> | null>
  /** Apariencia y color del perfil, por ref: el xterm no se recrea al cambiarlos. */
  appearance: MutableRefObject<TerminalAppearance>
  accent: MutableRefObject<string | null>
}
