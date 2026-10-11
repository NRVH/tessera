// =============================================================================
// El riel de conexiones SSH de la terminal: de dónde sale lo que se ve (la preferencia del perfil y el
// ancho, del store; el sitio, medido en la zona de la terminal y su agente a pantalla completa) y
// qué se hace con ello, también si la ▾ del lanzador se ve. Lo decide `rielSsh` (puro); aquí solo se mide
// y se enlaza. Depende del store de SSH.
// Decisiones: docs/decisiones/terminales/riel-de-conexiones.md
// =============================================================================

import { useCallback, useLayoutEffect, useState, type RefObject } from 'react'
import {
  anchoMaximoDe,
  COLUMNA_PLEGADA_MIN,
  dondeConectar,
  flechaLanzadorVisible,
  ID_RIEL_SSH,
  resolverRiel,
  sitioDelRiel
} from './rielSsh'
import { accionesSsh, useStoreSsh } from './store'

/** El riel de conexiones de la terminal ahora y lo que se puede hacer con él. */
export interface RielSsh {
  /** La terminal está a pantalla completa. */
  pantallaCompleta: boolean
  /** Hay un riel que gobernar: a pantalla completa, con perfil y con sitio. Si no, su conmutador no puede hacer nada. */
  enRiel: boolean
  /** Hay un perfil: sin él no hay conexiones que enseñar, y la falta de sitio no es el motivo. */
  conPerfil: boolean
  /** El riel se ve: está en modo riel y el perfil no lo ocultó. */
  visible: boolean
  /** La ▾ del lanzador se ve: la lista no está ya a la vista en el riel. */
  flechaVisible: boolean
  ancho: number
  /** Hasta dónde se puede ensanchar con el sitio que hay. */
  anchoMax: number
  /** Lo mínimo que mide la columna plegada (su cabecera): el panel lo lleva al CSS. */
  columnaPlegadaMin: number
  /** Alterna la preferencia del perfil. */
  alternar: () => void
  /** Enseña la lista de conexiones sin elegir dónde: da el foco al filtro del riel si se ve y, si no, abre el lanzador. */
  pedirLista: () => void
  /** Lo oculta (la preferencia del perfil). */
  ocultar: () => void
  fijarAncho: (px: number) => void
}

/** Da el foco al filtro del riel, si está montado. Devuelve si lo tenía. */
export function enfocarRielSsh(): boolean {
  const filtro = document.getElementById(ID_RIEL_SSH)?.querySelector<HTMLInputElement>('.ssh-filtro')
  filtro?.focus()
  return filtro !== null && filtro !== undefined && document.activeElement === filtro
}

/**
 * El ancho de la zona que reparten la terminal y su agente (`.shell-main`, antepasado del cuerpo) mientras
 * `activo`. No cambia al plegar o desplegar la columna, así que ninguna medida queda de otro modo. Se mide
 * antes de pintar (el riel no aparece un fotograma tarde) y se sigue con un observador. Fuera de uso no observa
 * nada, vale 0 y olvida la medida: al volver, el primer render no puede decidir con el ancho de la vez anterior.
 */
function useAnchoZona(cuerpoRef: RefObject<HTMLElement>, activo: boolean): number {
  const [ancho, setAncho] = useState(0)
  useLayoutEffect(() => {
    const el = cuerpoRef.current?.closest<HTMLElement>('.shell-main') ?? null
    if (!activo || !el) return
    const medir = (): void => setAncho(el.clientWidth)
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(el)
    return () => {
      observador.disconnect()
      setAncho(0)
    }
  }, [cuerpoRef, activo])
  return activo ? ancho : 0
}

/** La columna de la terminal: si está plegada y el ancho del agente que tiene al lado (null si no lo tiene). */
export interface ColumnaRiel {
  plegada: boolean
  agenteAncho: number | null
}

/**
 * El riel del perfil `perfilId`. El sitio sale de la zona que reparten la terminal y su agente, menos el
 * agente si está al lado (`sitioDelRiel`); no depende del riel, así que medirlo no puede retroalimentarse.
 */
export function useRielSsh(
  cuerpoRef: RefObject<HTMLElement>,
  pantallaCompleta: boolean,
  perfilId: string,
  columna: ColumnaRiel
): RielSsh {
  const ancho = useStoreSsh((s) => s.rielAncho)
  const oculto = useStoreSsh((s) => s.rielVisiblePorPerfil[perfilId] === false)
  const zona = useAnchoZona(cuerpoRef, pantallaCompleta)
  const sinTerminal = columna.plegada
  const { disponible, desplegado } = sitioDelRiel(zona, columna.agenteAncho, sinTerminal)
  const { enRiel, visible } = resolverRiel({ pantallaCompleta, perfilId, oculto, disponible, ancho, sinTerminal })
  const alternar = useCallback(() => accionesSsh.alternarRiel(perfilId), [perfilId])
  const ocultar = useCallback(() => accionesSsh.fijarRielVisible(perfilId, false), [perfilId])
  const pedirLista = useCallback(() => {
    if (dondeConectar({ enRiel, visible }) === 'riel') enfocarRielSsh()
    else accionesSsh.abrirLista()
  }, [enRiel, visible])
  return {
    pantallaCompleta,
    enRiel,
    conPerfil: perfilId !== '',
    visible,
    flechaVisible: flechaLanzadorVisible({ enRiel, visible }),
    ancho,
    anchoMax: anchoMaximoDe({ disponible, ancho, sinTerminal, desplegado }),
    columnaPlegadaMin: COLUMNA_PLEGADA_MIN,
    alternar,
    pedirLista,
    ocultar,
    fijarAncho: accionesSsh.fijarAnchoRiel
  }
}
