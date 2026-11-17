// =============================================================================
// Estado y refs de un `TerminalPane`: el latch `activated` (la sesión se abre la primera
// vez que el pane se ve y nunca vuelve a false), el estado de la sesión y el conjunto
// estable de refs que comparten sus hooks. Son hooks del propio pane: el estado vive
// lo que vive el pane, igual que si estuviera declarado en su cuerpo.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md
// =============================================================================

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { SearchAddon } from '@xterm/addon-search'
import type { WebglAddon } from '@xterm/addon-webgl'
import type { AparienciaTerminal } from '../../theme/aparienciaTerminal'
import type { EscritorFlujo } from './controlFlujo'
import type { RefsTerminal, EstadoTerminal } from './terminalPaneTipos'

/** Estado de la sesión del pane y sus setters (estables, como todo `useState`). */
export interface EstadoSesion {
  estadoTerminal: EstadoTerminal
  setEstado: Dispatch<SetStateAction<EstadoTerminal>>
  sesionId: string | null
  setSesionId: Dispatch<SetStateAction<string | null>>
  codigoSalida: number | null
  setCodigoSalida: Dispatch<SetStateAction<number | null>>
  error: string | null
  setError: Dispatch<SetStateAction<string | null>>
  recargando: boolean
  setRecargando: Dispatch<SetStateAction<boolean>>
  /** Solo SSH: ¿ya llegó algo de la sesión? Hasta entonces se ve «Conectando a…». */
  datosRecibidos: boolean
  setDatosRecibidos: Dispatch<SetStateAction<boolean>>
  /** Solo SSH: qué pasó al terminar la sesión, para la franja de reconexión; `null` mientras vive. */
  finSsh: string | null
  setFinSsh: Dispatch<SetStateAction<string | null>>
}

/** Estado de la sesión del pane: estado, id, código de salida, error, reload en vuelo y si ya llegaron datos. */
export function useEstadoSesion(): EstadoSesion {
  const [estadoTerminal, setEstado] = useState<EstadoTerminal>('booting')
  const [sesionId, setSesionId] = useState<string | null>(null)
  const [codigoSalida, setCodigoSalida] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recargando, setRecargando] = useState(false)
  const [datosRecibidos, setDatosRecibidos] = useState(false)
  const [finSsh, setFinSsh] = useState<string | null>(null)
  return {
    estadoTerminal, setEstado, sesionId, setSesionId, codigoSalida, setCodigoSalida, error, setError,
    recargando, setRecargando, datosRecibidos, setDatosRecibidos, finSsh, setFinSsh
  }
}

/**
 * Lazy-open y keep-alive: true desde la primera vez que el pane se ve. Una vez activado
 * nunca vuelve a false: la terminal sobrevive oculta y solo muere al desmontar.
 */
export function useActivado(visible: boolean): boolean {
  const [activado, setActivado] = useState(visible)
  useEffect(() => {
    if (visible) setActivado(true)
  }, [visible])
  return activado
}

/** Crea los refs del pane una sola vez y refresca los que espejan props en cada render. */
export function useRefsTerminal(
  basesMontadas: string[] = [],
  visible: boolean,
  apariencia: AparienciaTerminal,
  colorAcento: string | null
): RefsTerminal {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const ajuste = useRef<FitAddon | null>(null)
  const busqueda = useRef<SearchAddon | null>(null)
  const webgl = useRef<WebglAddon | null>(null)
  const flujo = useRef<EscritorFlujo | null>(null)
  const sesion = useRef<string | null>(null)
  const abriendo = useRef(false)
  const basesMontadasRef = useRef(basesMontadas)
  const haAbiertoAlgunaVez = useRef(false)
  const intentado = useRef(false)
  const inicioSesion = useRef(0)
  const visibleRef = useRef(visible)
  const temporizadorRedimensionar = useRef<ReturnType<typeof setTimeout> | null>(null)
  const aparienciaRef = useRef(apariencia)
  const acento = useRef(colorAcento)
  basesMontadasRef.current = basesMontadas
  visibleRef.current = visible
  aparienciaRef.current = apariencia
  acento.current = colorAcento
  return useMemo<RefsTerminal>(
    () => ({
      host,
      term,
      fit: ajuste,
      search: busqueda,
      webgl,
      flow: flujo,
      sesion,
      abriendo,
      basesMontadas: basesMontadasRef,
      haAbiertoAlgunaVez,
      intentado,
      inicioSesion,
      visible: visibleRef,
      resizeTimer: temporizadorRedimensionar,
      appearance: aparienciaRef,
      accent: acento
    }),
    []
  )
}
