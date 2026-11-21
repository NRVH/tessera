// =============================================================================
// El riel de conexiones SSH de la terminal: de dónde sale lo que se ve (el ancho, del store; el sitio,
// medido en la zona de la terminal y su agente a pantalla completa) y
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
import { crearObservadorTamano, ventanaDe } from '../../util/ventanaDe'

/** El riel de conexiones de la terminal ahora y lo que se puede hacer con él. */
export interface RielSsh {
  /** El riel se ve: a pantalla completa, con perfil y con sitio. */
  visible: boolean
  /** La ▾ del lanzador se ve: la lista no está ya a la vista en el riel. */
  flechaVisible: boolean
  ancho: number
  /** Hasta dónde se puede ensanchar con el sitio que hay. */
  anchoMax: number
  /** Lo mínimo que mide la columna plegada (su cabecera): el panel lo lleva al CSS. */
  columnaPlegadaMin: number
  /** Enseña la lista de conexiones sin elegir dónde: da el foco al filtro del riel si se ve y, si no, abre el lanzador. */
  pedirLista: () => void
  fijarAncho: (px: number) => void
}

/** Da el foco al filtro del riel, si está montado: el de la lista que se ve, no el de otro perfil. Devuelve si lo tenía. */
export function enfocarRielSsh(raiz: HTMLElement | null): boolean {
  // `:scope >`: el riel entero va en otra capa viva, y `querySelector` también cuenta antepasados de
  // fuera; sin anclar, la capa del riel haría pasar por visible el filtro de otro perfil.
  const filtro = raiz?.querySelector<HTMLInputElement>(`#${ID_RIEL_SSH} > .ssh-riel-cuerpo > .capa-viva:not(.oculta) .ssh-filtro`)
  filtro?.focus()
  return filtro != null && ventanaDe(filtro).documento.activeElement === filtro
}

/**
 * El ancho de la zona que reparten la terminal y su agente (`.shell-main`, antepasado del cuerpo) mientras
 * `activo`. No cambia al plegar o desplegar la columna, así que ninguna medida queda de otro modo. Se mide
 * antes de pintar (el riel no aparece un fotograma tarde) y se sigue con un observador. Fuera de uso no observa
 * nada, vale 0 y olvida la medida: al volver, el primer render no puede decidir con el ancho de la vez anterior.
 */
function useAnchoZona(cuerpoRef: RefObject<HTMLElement>, activo: boolean, ventana: Window | undefined): number {
  const [ancho, setAncho] = useState(0)
  useLayoutEffect(() => {
    const el = cuerpoRef.current?.closest<HTMLElement>('.shell-main') ?? null
    if (!activo || !el || (ventana && ventanaDe(el).ventana !== ventana)) return
    const medir = (): void => setAncho(el.clientWidth)
    medir()
    const observador = crearObservadorTamano(el, medir)
    observador.observe(el)
    return () => {
      observador.disconnect()
      setAncho(0)
    }
  }, [cuerpoRef, activo, ventana])
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
  columna: ColumnaRiel,
  ventana?: Window
): RielSsh {
  const ancho = useStoreSsh((s) => s.rielAncho)
  const zona = useAnchoZona(cuerpoRef, pantallaCompleta, ventana)
  const sinTerminal = columna.plegada
  const { disponible, desplegado } = sitioDelRiel(zona, columna.agenteAncho, sinTerminal)
  const resolucion = resolverRiel({ pantallaCompleta, perfilId, disponible, ancho, sinTerminal })
  const { visible } = resolucion
  const pedirLista = useCallback(() => {
    if (dondeConectar({ visible }) === 'riel') enfocarRielSsh(cuerpoRef.current)
    else accionesSsh.abrirLista(perfilId)
  }, [visible, cuerpoRef, perfilId])
  return {
    visible,
    flechaVisible: flechaLanzadorVisible(resolucion),
    ancho,
    anchoMax: anchoMaximoDe({ disponible, ancho, sinTerminal, desplegado }),
    columnaPlegadaMin: COLUMNA_PLEGADA_MIN,
    pedirLista,
    fijarAncho: accionesSsh.fijarAnchoRiel
  }
}
