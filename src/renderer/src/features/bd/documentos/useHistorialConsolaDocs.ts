// =============================================================================
// El historial de la consola de MongoDB: el popover abierto o no, dónde cuelga y qué hace elegir
// una orden (la INSERTA en el cursor, terminada, con una sola parada de deshacer). El popover es el
// de la consola SQL (`HistorialConsultas`), que lista solo las órdenes del shell.
// Decisiones: docs/decisiones/bd/ui-consola-historial.md
// =============================================================================

import { useCallback, useRef } from 'react'
import type { editor } from 'monaco-editor'
import type { AnclaDerecha } from '../../../comun/popoverFlotante'
import { useAnclaHistorial, useHistorialAbierto } from '../consola/useAnclaHistorial'
import type { ContextoCursor, Insercion } from '../consola/historialConsola'
import { insercionHistorialShell } from './consolaDocs'
import type { EstadoConsolaDocs } from './useEstadoConsolaDocs'

export interface HistorialConsolaDocs {
  historialAbierto: boolean
  alternarHistorial: () => void
  cerrarHistorial: () => void
  anclaHistorial: AnclaDerecha | null
  insertar: (texto: string) => void
  /** El ref de la sección, que además mide el reparto (`colReparto`). */
  colRef: (node: HTMLElement | null) => void
}

/** Cómo se compone lo que inserta el historial: el texto, el contexto del cursor y el fin de línea del modelo. */
export type ConstructorInsercion = (texto: string, ctx: ContextoCursor, eol: '\n' | '\r\n') => Insercion

/** Lo que el historial necesita del estado de una consola (la de MongoDB y la de Redis lo cumplen). */
export type EstadoParaHistorial = Pick<EstadoConsolaDocs, 'visible' | 'modeloRef' | 'cargadoRef'>

/** En el cursor, en línea nueva si hace falta, con el EOL del modelo y UNA parada de deshacer. */
function insertarEnEditor(
  ed: editor.IStandaloneCodeEditor | null,
  m: editor.ITextModel | null,
  cargado: boolean,
  texto: string,
  construir: ConstructorInsercion
): void {
  if (!ed || !m || m.isDisposed() || !cargado) return
  const sel = ed.getSelection()
  if (!sel) return
  const ini = sel.getStartPosition()
  const fin = sel.getEndPosition()
  const ins = construir(
    texto,
    {
      antes: m.getLineContent(ini.lineNumber).slice(0, ini.column - 1),
      despues: m.getLineContent(fin.lineNumber).slice(fin.column - 1)
    },
    m.getEOL() === '\r\n' ? '\r\n' : '\n'
  )
  const desde = m.getOffsetAt(ini)
  ed.pushUndoStop()
  ed.executeEdits('tessera.historial', [{ range: sel, text: ins.texto, forceMoveMarkers: true }])
  ed.pushUndoStop()
  const pos = m.getPositionAt(desde + ins.cursor)
  ed.setPosition(pos)
  ed.revealPositionInCenterIfOutsideViewport(pos)
  ed.focus()
}

/**
 * El popover del historial de una consola de órdenes (MongoDB por omisión; la de Redis pasa su
 * `construir`) y la inserción de lo elegido.
 */
export function useHistorialConsolaDocs(
  e: EstadoParaHistorial,
  edRef: React.RefObject<editor.IStandaloneCodeEditor>,
  colReparto: (node: HTMLElement | null) => void,
  construir: ConstructorInsercion = insercionHistorialShell
): HistorialConsolaDocs {
  const { historialAbierto, alternarHistorial, cerrarHistorial } = useHistorialAbierto()
  const seccionRef = useRef<HTMLElement | null>(null)
  const colRef = useCallback(
    (node: HTMLElement | null): void => {
      seccionRef.current = node
      colReparto(node)
    },
    [colReparto]
  )
  const anclaHistorial = useAnclaHistorial(seccionRef, historialAbierto, e.visible, cerrarHistorial)
  const { modeloRef, cargadoRef } = e
  const insertar = useCallback(
    (texto: string): void => insertarEnEditor(edRef.current, modeloRef.current, cargadoRef.current, texto, construir),
    [edRef, modeloRef, cargadoRef, construir]
  )
  return { historialAbierto, alternarHistorial, cerrarHistorial, anclaHistorial, insertar, colRef }
}
