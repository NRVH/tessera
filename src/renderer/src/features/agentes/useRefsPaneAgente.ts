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
import type { EscritorFlujo } from '../terminales'
import type { AparienciaTerminal } from '../../theme/aparienciaTerminal'
import type { ApiPaneAgente, ResultadoRelanzar } from './tipos'
import type { PropsPaneAgente } from './tiposPaneAgente'
import { SesionAgente } from './sesionViva'

type Ref<T> = MutableRefObject<T>

/** Relanzar de la API publicada: va por ref para usar siempre la versión del render vigente. */
export type RelanzarApi = (o: { banner: string; error?: boolean }) => Promise<ResultadoRelanzar>

/** Todas las refs del pane, en un objeto estable durante su vida. */
export interface RefsPaneAgente {
  host: Ref<HTMLDivElement | null>
  term: Ref<Terminal | null>
  fit: Ref<FitAddon | null>
  search: Ref<SearchAddon | null>
  /** Escritor con contrapresión; se reinicia junto con `term.reset()`. */
  flow: Ref<EscritorFlujo | null>
  webgl: Ref<WebglAddon | null>
  /** La sesión del momento y todo su estado: solo se cambia por su API. */
  sesion: SesionAgente
  resizeTimer: Ref<ReturnType<typeof setTimeout> | null>
  /** Último tamaño ENVIADO al pty, por sesión: ver `sincronizarTamanoPty`. */
  ultimoTam: Ref<{ id: string; cols: number; rows: number } | null>
  /** Tamaño ANTES de que el mosaico enseñara la terminal como casilla, o null. */
  tamPrevio: Ref<{ cols: number; rows: number } | null>
  /** ¿Puede llevarse el foco AHORA? (pintado y con permiso para robarlo). */
  puedeEnfocar: Ref<boolean>
  appearance: Ref<AparienciaTerminal>
  accent: Ref<string | null>
  /** Verdad síncrona de «preparado para actualizar» para las guardas fuera del render. */
  actualizando: Ref<boolean>
  modoNativo: Ref<boolean>
  hibernado: Ref<boolean>
  previaId: Ref<number>
  /** Candado contra recuperaciones concurrentes (un segundo exit no solapa el bucle). */
  recovering: Ref<boolean>
  /** Montaje vigente: lo lee la apertura sin depender de él (no reabre la sesión). */
  basesMontadas: Ref<string[]>
  onSeleccionarCuenta: Ref<(cuentaId: string | null) => void>
  onCambioVivo: Ref<((vivo: boolean) => void) | undefined>
  onApi: Ref<((clave: string, api: ApiPaneAgente | null) => void) | undefined>
  relanzarApi: Ref<RelanzarApi>
}

function ref<T>(valor: T): Ref<T> {
  return { current: valor }
}

function crearRefsTerminal(): Pick<RefsPaneAgente, 'host' | 'term' | 'fit' | 'search' | 'flow' | 'webgl' | 'resizeTimer' | 'ultimoTam' | 'tamPrevio' | 'previaId'> {
  return {
    host: ref<HTMLDivElement | null>(null),
    term: ref<Terminal | null>(null),
    fit: ref<FitAddon | null>(null),
    search: ref<SearchAddon | null>(null),
    flow: ref<EscritorFlujo | null>(null),
    webgl: ref<WebglAddon | null>(null),
    resizeTimer: ref<ReturnType<typeof setTimeout> | null>(null),
    ultimoTam: ref<{ id: string; cols: number; rows: number } | null>(null),
    tamPrevio: ref<{ cols: number; rows: number } | null>(null),
    previaId: ref(0)
  }
}

/** Los avisos de las props reciben la clave del target; dentro del pane van ya ligados a ella. */
function elegirCuentaDe(p: PropsPaneAgente): (cuentaId: string | null) => void {
  return (cuentaId) => p.onSeleccionarCuenta(p.target.key, cuentaId)
}

function avisoVivoDe(p: PropsPaneAgente): ((vivo: boolean) => void) | undefined {
  const { onCambioVivo } = p
  return onCambioVivo ? (vivo) => onCambioVivo(p.target.key, vivo) : undefined
}

function crearRefs(p: PropsPaneAgente, apariencia: AparienciaTerminal): RefsPaneAgente {
  const terminal = crearRefsTerminal()
  const sesion = new SesionAgente({
    limpiarTerminal: () => {
      terminal.flow.current?.reset()
      terminal.term.current?.reset()
    },
    cerrar: (id) => window.tessera.terminalAgente.cerrar(id)
  })
  // La ventana de agente es como abrir una terminal y escribir el CLI: empieza con un chat nuevo. Una
  // conversación pedida después (la restauración tras actualizar) gana a esto.
  if (p.lugar === 'ventana') sesion.pedirNueva()
  return {
    ...terminal,
    sesion,
    puedeEnfocar: ref(p.mostradoReal && p.robaFoco),
    appearance: ref(apariencia),
    accent: ref(p.colorAcento),
    actualizando: ref(false),
    modoNativo: ref(p.modoNativo),
    hibernado: ref(p.hibernado),
    recovering: ref(false),
    basesMontadas: ref(p.basesMontadas),
    onSeleccionarCuenta: ref(elegirCuentaDe(p)),
    onCambioVivo: ref(avisoVivoDe(p)),
    onApi: ref(p.onApi),
    relanzarApi: ref<RelanzarApi>(async () => 'saltada')
  }
}

/**
 * Crea las refs del pane UNA vez (el objeto es estable, así que puede ir en las
 * dependencias de un efecto sin re-dispararlo) y actualiza en cada render los espejos.
 */
export function useRefsPaneAgente(p: PropsPaneAgente, apariencia: AparienciaTerminal): RefsPaneAgente {
  const [r] = useState(() => crearRefs(p, apariencia))
  r.onSeleccionarCuenta.current = elegirCuentaDe(p)
  r.puedeEnfocar.current = p.mostradoReal && p.robaFoco
  r.appearance.current = apariencia
  r.accent.current = p.colorAcento
  r.modoNativo.current = p.modoNativo
  r.hibernado.current = p.hibernado
  r.basesMontadas.current = p.basesMontadas
  r.onCambioVivo.current = avisoVivoDe(p)
  r.onApi.current = p.onApi
  return r
}
