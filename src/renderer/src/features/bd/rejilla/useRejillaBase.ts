// =============================================================================
// Los dos primeros hooks de `DbRejilla`: las refs y la vista derivada de las props
// (`useBaseRejilla`) y el estado de interacción (`useEstadoRejilla`). Los llama `DbRejilla`,
// dueño del estado, y el orden de declaración fija el de los efectos y limpiezas.
// Decisiones: docs/decisiones/bd/ui-rejilla-vista.md
// =============================================================================

import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { SIN_CAMBIOS, type VistaFilas } from './cambiosRejilla'
import {
  construirVista,
  EXTRA_CABECERA,
  firmaDe,
  recortesDeVista,
  SIN_FILAS,
  SIN_RECORTES_VISTA
} from './rejillaVista'
import type { Celda, Seleccion } from './seleccionRejilla'
import type {
  BaseRejilla,
  DbRejillaEdicionProps,
  EditorAbierto,
  EstadoRejilla,
  MenuAbierto,
  PasoMenu
} from './rejillaTipos'

/** Refs de la rejilla, espejo de las props y las filas tal como se ven. */
export function useBaseRejilla(props: DbRejillaEdicionProps): BaseRejilla {
  const { columnas, datos, altoFila, clavePrimaria, edicion = null } = props
  const idBase = useId()
  const raizRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const cabRef = useRef<HTMLDivElement>(null)
  const cuerpoRef = useRef<HTMLDivElement>(null)

  // Lo que corre en rAF y en escuchas de `window` lee las props de aquí y no de su
  // cierre: un rAF encolado con la página anterior pediría otra vez la misma página.
  const propsRef = useRef(props)
  useLayoutEffect(() => {
    propsRef.current = props
  })

  const numCols = columnas.length
  const cambios = edicion?.cambios ?? SIN_CAMBIOS
  const filasServidor = datos?.filas ?? SIN_FILAS
  const numServidor = filasServidor.length
  const k = cambios.nuevas.length
  const filas = useMemo(() => construirVista(filasServidor, cambios, numCols), [filasServidor, cambios, numCols])
  const recortes = useMemo(
    () => recortesDeVista(datos?.recortes ?? SIN_RECORTES_VISTA, k),
    [datos?.recortes, k]
  )
  const pk = useMemo(() => new Set(clavePrimaria ?? []), [clavePrimaria])
  const firmaCols = useMemo(() => firmaDe(columnas), [columnas])
  return {
    props,
    propsRef,
    edicion,
    idBase,
    raizRef,
    scrollRef,
    cabRef,
    cuerpoRef,
    numCols,
    cambios,
    filasServidor,
    numServidor,
    k,
    filas,
    recortes,
    numFilas: filas.length,
    altoCab: altoFila + EXTRA_CABECERA,
    pk,
    firmaCols
  }
}

/** Selección, menú, visor, editor y asa de redimensionar, con sus refs. */
export function useEstadoRejilla(b: BaseRejilla): EstadoRejilla {
  const [menu, setMenu] = useState<MenuAbierto | null>(null)
  const [sel, setSel] = useState<Seleccion>(null)
  const [visor, setVisor] = useState<Celda | null>(null)
  const [editor, setEditor] = useState<EditorAbierto | null>(null)
  const [redimensionando, setRedimensionando] = useState<number | null>(null)
  const tokenEditorRef = useRef(0)
  const pendienteMostrarRef = useRef<Celda | null>(null)
  const vistaSelRef = useRef<VistaFilas>({ cambios: b.cambios, numServidor: b.numServidor })
  const pasoPendienteRef = useRef<PasoMenu | null>(null)
  const focoAlEditorRef = useRef(false)
  return {
    menu,
    setMenu,
    sel,
    setSel,
    visor,
    setVisor,
    editor,
    setEditor,
    redimensionando,
    setRedimensionando,
    tokenEditorRef,
    pendienteMostrarRef,
    vistaSelRef,
    pasoPendienteRef,
    focoAlEditorRef
  }
}
