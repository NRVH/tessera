// =============================================================================
// Efectos de la rejilla de datos que dependen del contexto entero del render: llevar a
// la vista la celda pendiente, publicar las acciones que el dueño lanza desde su barra,
// contarle las filas seleccionadas y señalar la fila de un envío que falló.
// Hook de `DbRejilla`, llamado tras el de la selección: el orden de declaración fija el de los efectos.
// Decisiones: docs/decisiones/bd/ui-rejilla-vista.md
// =============================================================================

import { useEffect, useLayoutEffect, useRef } from 'react'
import { anadir, borrarSeleccion, mostrarCelda } from './rejillaAcciones'
import { posicionEnVista, SIN_CAMBIOS } from './cambiosRejilla'
import { rango } from './seleccionRejilla'
import type { Rejilla } from './rejillaTipos'

/** Publica en `acciones` lo que el dueño lanza, siempre con el estado de ahora. */
function useAccionesDelDueno(r: Rejilla): void {
  const { acciones } = r.props
  const { raizRef } = r
  const anadirRef = useRef(() => anadir(r))
  anadirRef.current = () => anadir(r)
  const borrarRef = useRef(() => borrarSeleccion(r))
  borrarRef.current = () => borrarSeleccion(r)
  useLayoutEffect(() => {
    const destino = acciones
    if (!destino) return
    destino.current = {
      anadirFila: () => anadirRef.current(),
      borrarSeleccion: () => borrarRef.current(),
      enfocar: () => raizRef.current?.focus({ preventScroll: true })
    }
    return () => {
      destino.current = null
    }
  }, [acciones, raizRef])
}

/** Lleva a la vista la celda pendiente, publica acciones, cuenta filas y señala errores. */
export function useEfectosEdicionRejilla(r: Rejilla): void {
  const { numFilas, numServidor, propsRef, pendienteMostrarRef, setSel } = r

  // La celda pendiente llega en el render siguiente (tras añadir fila o señalar un error).
  useLayoutEffect(() => {
    const c = r.pendienteMostrarRef.current
    if (!c || c.f >= numFilas) return
    r.pendienteMostrarRef.current = null
    mostrarCelda(r, c)
  })

  useAccionesDelDueno(r)

  const filasSel = (() => {
    const rg = rango(r.sel)
    return rg && numFilas > 0 ? Math.min(rg.f1, numFilas - 1) - rg.f0 + 1 : 0
  })()
  const onFilasSel = r.edicion?.onFilasSeleccionadas
  useEffect(() => {
    onFilasSel?.(filasSel)
  }, [onFilasSel, filasSel])

  // Un envío que falló señala su fila: se selecciona y se lleva a la vista.
  const tokenError = r.edicion?.filaError?.token ?? 0
  useEffect(() => {
    const fe = propsRef.current.edicion?.filaError
    if (!fe) return
    const d = posicionEnVista(propsRef.current.edicion?.cambios ?? SIN_CAMBIOS, fe.ref, numServidor)
    if (d === null) return
    const celda = { f: d, c: 0 }
    setSel({ ancla: { f: d, c: 0 }, foco: celda })
    pendienteMostrarRef.current = celda
    // Solo depende del token: re-señalar la misma fila tras otro fallo también la muestra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenError])
}
