// =============================================================================
// Selección de la rejilla de datos ante un resultado nuevo, un cambio de forma de la
// vista (filas nuevas que aparecen o se van), menos filas, pestaña oculta o edición
// retirada. Hook de `DbRejilla`: el orden de declaración fija el de los efectos.
// Decisiones: docs/decisiones/bd/ui-rejilla-vista.md
// =============================================================================

import { useEffect, useLayoutEffect, useRef } from 'react'
import { mismaFormaVista, reubicarCelda, reubicarSeleccion, type VistaFilas } from './cambiosRejilla'
import { acotarSeleccion } from './seleccionRejilla'
import type { BaseRejilla, EstadoRejilla, ScrollRejilla } from './rejillaTipos'

/**
 * Un resultado NUEVO (otras columnas, u otra primera fila DEL SERVIDOR) vuelve arriba y
 * suelta la selección; anexar una página, añadir una fila nueva o la relectura tras
 * «Enviar» (`conservarPosicionDe`) no cuentan como resultado nuevo.
 */
function useResultadoNuevo(b: BaseRejilla, e: EstadoRejilla, s: ScrollRejilla): void {
  const { datos, conservarPosicionDe = null } = b.props
  const { firmaCols, scrollRef } = b
  const { setMenu, setVisor, setEditor, setSel } = e
  const { posRef } = s
  const primera = b.numServidor > 0 ? b.filasServidor[0] : null
  const claveResultadoRef = useRef({ firmaCols, primera })
  useLayoutEffect(() => {
    const prev = claveResultadoRef.current
    const cambioCols = prev.firmaCols !== firmaCols
    if (!cambioCols && prev.primera === primera) return
    claveResultadoRef.current = { firmaCols, primera }
    setMenu(null)
    setVisor(null)
    setEditor(null)
    if (!cambioCols && conservarPosicionDe !== null && conservarPosicionDe === datos) return
    posRef.current = { top: 0, left: cambioCols ? 0 : posRef.current.left }
    const el = scrollRef.current
    if (el) {
      el.scrollTop = 0
      if (cambioCols) el.scrollLeft = 0
    }
    setSel(null)
  }, [firmaCols, primera, conservarPosicionDe, datos, posRef, scrollRef, setMenu, setVisor, setEditor, setSel])
}

/** Efectos de la selección, el menú, el visor y el editor; el orden de declaración fija el de ejecución y limpieza. */
export function useSeleccionRejilla(b: BaseRejilla, e: EstadoRejilla, s: ScrollRejilla): void {
  const { visible } = b.props
  const { cambios, numServidor, numFilas, numCols, edicion } = b
  const { setMenu, setVisor, setEditor, setSel, vistaSelRef } = e
  useResultadoNuevo(b, e, s)

  // Selección y visor son POSICIONES de la vista: si quitar filas nuevas sube las del
  // servidor, se reubican por la identidad de sus filas (`reubicarSeleccion`). En layout
  // para no pintar un fotograma sobre las filas equivocadas.
  useLayoutEffect(() => {
    const antes = vistaSelRef.current
    const despues: VistaFilas = { cambios, numServidor }
    vistaSelRef.current = despues
    if (mismaFormaVista(antes.cambios, cambios)) return
    setSel((sl) => reubicarSeleccion(sl, antes, despues))
    setVisor((v) => reubicarCelda(v, antes, despues))
  }, [cambios, numServidor, vistaSelRef, setSel, setVisor])

  useEffect(() => {
    setSel((sl) => acotarSeleccion(sl, { filas: numFilas, columnas: numCols }))
  }, [numFilas, numCols, setSel])

  // Oculta, el menú y el visor ya no apuntan a nada que se vea (y puede soltar filas).
  useEffect(() => {
    if (visible) return
    setMenu(null)
    setVisor(null)
  }, [visible, setMenu, setVisor])

  // Sin edición, el editor abierto se cierra sin confirmar nada.
  useEffect(() => {
    if (!edicion) setEditor(null)
  }, [edicion, setEditor])
}
