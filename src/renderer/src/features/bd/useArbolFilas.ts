// =============================================================================
// Las filas que pinta el lateral de BD y lo derivado de ellas en cada render: el orden
// optimista tras un arrastre, las filas del árbol (`useArbolBd`) con las ajenas detrás,
// la selección y los porqués de la cabecera. Lo llama `DbArbol`, tras su estado.
// Decisiones: docs/decisiones/bd/ui-arbol-componente.md
// =============================================================================

import { useMemo } from 'react'
import { useArbolBd } from './useArbolBd'
import { conexionDeClave } from './arbolBd'
import { aplicarOrden, componerFilasArbol, motivoSinConsola, motivosCabeceraArbol } from './filasArbolBd'
import type { DatosArbol, EstadoUiArbol, PropsArbol } from './DbArbolTipos'

/** Filas, selección y porqués de la cabecera del lateral de BD. */
export function useArbolFilas(p: PropsArbol, e: Pick<EstadoUiArbol, 'ordenLocal' | 'busqueda'>): DatosArbol {
  const { conexiones, consolas, expandidos, seleccion, ajenas } = p
  const { ordenLocal, busqueda } = e
  // Orden optimista tras un arrastre: vale mientras `useConexionesBd` siga dando la MISMA lista;
  // en cuanto llega la recargada (por `db:changed`), manda ella.
  const conexionesVista = useMemo(
    () => (ordenLocal && ordenLocal.base === conexiones ? aplicarOrden(conexiones, ordenLocal.ids) : conexiones),
    [ordenLocal, conexiones]
  )
  const porId = useMemo(() => new Map(conexiones.map((c) => [c.id, c])), [conexiones])

  const { filas: filasBd, reintentar } = useArbolBd({
    conexiones: conexionesVista,
    consolas,
    expandidos,
    filtro: busqueda ?? ''
  })
  // Las del árbol en sus mismos índices y, detrás, las ajenas: `filasBd[i] === filas[i]`
  // mientras `i < filasBd.length`, así que `indicePadre` sigue trabajando sobre `filasBd`.
  const filas = useMemo(() => componerFilasArbol(filasBd, ajenas, busqueda ?? ''), [filasBd, ajenas, busqueda])

  const idxSel = useMemo(() => (seleccion === null ? -1 : filas.findIndex((f) => f.key === seleccion)), [filas, seleccion])
  const conexionSel = useMemo(() => {
    if (seleccion === null) return null
    const id = conexionDeClave(seleccion)
    return id !== null && porId.has(id) ? id : null
  }, [seleccion, porId])
  const filaSel = idxSel >= 0 ? filas[idxSel] : null
  return { conexionesVista, porId, filasBd, reintentar, filas, idxSel, filaSel, conexionSel, ...motivosDe(p, porId, conexionSel) }
}

function motivosDe(
  p: PropsArbol,
  porId: DatosArbol['porId'],
  conexionSel: string | null
): Pick<DatosArbol, 'motivos' | 'motivoNuevaConsola'> {
  const motivos = motivosCabeceraArbol({
    perfilId: p.perfilId,
    conexiones: p.conexiones.length,
    ajenas: p.ajenas.length,
    avisoFormato: p.avisoFormato
  })
  return { motivos, motivoNuevaConsola: motivos.nuevaConsola ?? motivoSinConsola(conexionSel ? porId.get(conexionSel) : null) }
}
