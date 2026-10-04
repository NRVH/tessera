// =============================================================================
// Los hooks de edición de la pestaña de colección: el estado de lo pendiente y de la
// selección, las filas derivadas, el descarte al cerrar (que pregunta la carcasa por
// `registroEdicion`) y los indicadores de la pestaña. Los llama `DbColeccionPane`.
// Decisiones: docs/decisiones/bd/ui-documentos-coleccion.md
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IndicadorPestana } from '../dbTabsModel'
import {
  EDICION_VACIA,
  columnasConEdicion,
  filasConEdicion,
  numCambiosDocs,
  type EdicionDocs,
  type FilaDocs
} from './coleccionDocs'
import type { ContextMenuEntry } from '../../../comun/ContextMenu'
import { registrarDatos } from '../rejilla/registroEdicion'
import type { EstadoFilaTabla } from './TablaDocumentos'
import type { EstadoConsulta, Pagina, PropsVivasColeccion } from './useConsultaColeccion'

/** Un envío que el main devolvió sin aplicar y que pide confirmar lo que dice el motivo. */
export type Confirmacion =
  | { tipo: 'produccion'; confirmadoSinTransaccion: boolean }
  | { tipo: 'sinTransaccion'; confirmado: boolean }

export interface EstadoEdicion {
  edicionRef: React.MutableRefObject<EdicionDocs>
  ponerEdicion: (e: EdicionDocs) => void
  enviando: boolean
  setEnviando: (v: boolean) => void
  confirmacion: Confirmacion | null
  setConfirmacion: (c: Confirmacion | null) => void
  /** La clave de la fila del cambio que falló al enviar. */
  filaError: string | null
  setFilaError: (c: string | null) => void
  setSeleccion: (c: string | null) => void
  editando: { clave: string; campo: string; valor: string } | null
  setEditando: (e: { clave: string; campo: string; valor: string } | null) => void
  jsonEdit: { clave: string; texto: string } | null
  setJsonEdit: React.Dispatch<React.SetStateAction<{ clave: string; texto: string } | null>>
  panelJson: boolean
  setPanelJson: React.Dispatch<React.SetStateAction<boolean>>
  menu: { x: number; y: number; items: ContextMenuEntry[] } | null
  setMenu: (m: { x: number; y: number; items: ContextMenuEntry[] } | null) => void
  filas: FilaDocs[]
  columnas: string[]
  documentosTabla: FilaDocs['documento'][]
  estadosTabla: EstadoFilaTabla[]
  indiceSel: number
  filaSel: FilaDocs | null
  pendientes: number
}

/** El estado de la edición y lo derivado de la página y de lo pendiente. */
export function useEstadoEdicion(pagina: Pagina | null): EstadoEdicion {
  const [edicion, setEdicion] = useState<EdicionDocs>(EDICION_VACIA)
  const edicionRef = useRef<EdicionDocs>(EDICION_VACIA)
  const ponerEdicion = useCallback((e: EdicionDocs): void => {
    edicionRef.current = e
    setEdicion(e)
  }, [])
  const [enviando, setEnviando] = useState(false)
  const [confirmacion, setConfirmacion] = useState<Confirmacion | null>(null)
  const [filaError, setFilaError] = useState<string | null>(null)
  const [seleccion, setSeleccion] = useState<string | null>(null)
  const [editando, setEditando] = useState<EstadoEdicion['editando']>(null)
  const [jsonEdit, setJsonEdit] = useState<{ clave: string; texto: string } | null>(null)
  const [panelJson, setPanelJson] = useState(true)
  const [menu, setMenu] = useState<EstadoEdicion['menu']>(null)

  const filas: FilaDocs[] = useMemo(() => filasConEdicion(pagina?.documentos ?? [], edicion), [pagina, edicion])
  const columnas = useMemo(() => columnasConEdicion(pagina?.columnas ?? [], filas), [pagina, filas])
  const documentosTabla = useMemo(() => filas.map((f) => f.documento), [filas])
  const estadosTabla: EstadoFilaTabla[] = useMemo(() => filas.map((f) => ({ estado: f.estado, cambiados: f.cambiados })), [filas])
  const indiceSel = seleccion === null ? -1 : filas.findIndex((f) => f.clave === seleccion)
  const filaSel = indiceSel >= 0 ? filas[indiceSel] : null
  const pendientes = numCambiosDocs(edicion)

  return {
    edicionRef, ponerEdicion, enviando, setEnviando, confirmacion, setConfirmacion, filaError, setFilaError,
    setSeleccion, editando, setEditando, jsonEdit, setJsonEdit, panelJson, setPanelJson, menu, setMenu,
    filas, columnas, documentosTabla, estadosTabla, indiceSel, filaSel, pendientes
  }
}

export interface Descarte {
  /** Los cambios que se perderían, mientras se pregunta; null si no hay pregunta. */
  descarte: { n: number } | null
  pedirDescarte: () => Promise<boolean>
  responderDescarte: (ok: boolean) => void
}

/** Descartar lo pendiente al cerrar o al revertir; se registra para que la carcasa pregunte. */
export function useDescarteColeccion(ed: EstadoEdicion, paneKey: string, conexionId: string): Descarte {
  const { edicionRef, ponerEdicion, setFilaError, setJsonEdit } = ed
  const [descarte, setDescarte] = useState<{ n: number } | null>(null)
  const descarteRef = useRef<{ promesa: Promise<boolean>; resolver: (ok: boolean) => void } | null>(null)
  const pedirDescarte = useCallback((): Promise<boolean> => {
    const n = numCambiosDocs(edicionRef.current)
    if (n === 0) return Promise.resolve(true)
    if (descarteRef.current) return descarteRef.current.promesa
    let resolver: (ok: boolean) => void = () => undefined
    const promesa = new Promise<boolean>((r) => {
      resolver = r
    })
    descarteRef.current = { promesa, resolver }
    setDescarte({ n })
    return promesa
  }, [edicionRef])
  const responderDescarte = (ok: boolean): void => {
    const d = descarteRef.current
    descarteRef.current = null
    setDescarte(null)
    if (ok) {
      ponerEdicion(EDICION_VACIA)
      setFilaError(null)
      setJsonEdit(null)
    }
    d?.resolver(ok)
  }
  useEffect(
    () =>
      registrarDatos(paneKey, {
        conexionId,
        solicitarCierre: pedirDescarte,
        cambiosPendientes: () => numCambiosDocs(edicionRef.current)
      }),
    [paneKey, conexionId, pedirDescarte, edicionRef]
  )
  return { descarte, pedirDescarte, responderDescarte }
}

/** Publica los indicadores de la pestaña: cargando, cambios sin enviar y error. */
export function useIndicadoresColeccion(e: EstadoConsulta, ed: EstadoEdicion, propsRef: React.MutableRefObject<PropsVivasColeccion>): void {
  const { cargando, cargandoMas, error, errorCampo, errorGuiado } = e
  const { enviando, pendientes } = ed
  useEffect(() => {
    const s = new Set<IndicadorPestana>()
    if (cargando || cargandoMas || enviando) s.add('cargando')
    if (pendientes > 0) s.add('sinEnviar')
    if (error || errorCampo || errorGuiado) s.add('error')
    propsRef.current.onIndicador(s)
  }, [cargando, cargandoMas, enviando, pendientes, error, errorCampo, errorGuiado, propsRef])
}
