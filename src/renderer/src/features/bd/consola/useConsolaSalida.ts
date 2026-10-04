// =============================================================================
// Las acciones de la Salida de la consola SQL («Volver a ejecutar», «Ejecutar las N
// restantes», «Forzar», ir a la posición) y los atajos del editor. «Restantes» exige el
// mismo texto del lote y reutiliza sus binds sin volver a preguntar. Pieza de `useConsola`.
// =============================================================================

import { useCallback, useEffect, useRef } from 'react'
import type { editor } from 'monaco-editor'
import { dividirSentencias } from '../../../../../shared/sql/divisorSql'
import { ejecutando as hayEjecucion } from './estadoConsola'
import { registrarAccionesConsola } from './monacoConsola'
import type { AccionSalida, IrAPosicion } from './salidaConsola'
import type { RefsConsola } from './tiposConsola'
import type { Correr } from './useConsolaLote'
import type { NucleoConsola } from './useConsolaNucleo'

function restantes(r: RefsConsola, correr: Correr, avisar: (texto: string) => void, loteId: number, desde: number): void {
  const l = r.estadoRef.current.lote
  const info = r.infoLoteRef.current
  if (!l || l.id !== loteId || !info || info.loteId !== loteId || hayEjecucion(r.estadoRef.current)) return
  if (info.conModelo) {
    const m = r.modeloRef.current
    if (!m || m.isDisposed() || m.getAlternativeVersionId() !== info.version) {
      avisar('El texto cambió desde ese lote: vuelve a ejecutar')
      return
    }
  }
  // Con los binds que se decidieron para ese lote (no se vuelve a preguntar).
  const quedan = l.sentencias.map((x, i) => ({ x, i })).filter(({ x, i }) => i >= desde && x.estado === 'omitida')
  const ss = quedan.map(({ x }) => x.s)
  const binds = quedan.map(({ i }) => info.binds[i])
  void correr(ss, info.fuente, info.conModelo, info.version, { binds })
}

/** `exacta`: la posición la dio el servidor en la propia línea; si no, decide la sentencia. */
function irAPosicion(r: RefsConsola, ir: IrAPosicion): void {
  const marcas = r.marcasRef.current
  const e = r.edRef.current
  const m = r.modeloRef.current
  if (!marcas || !e || !m || marcas.lote !== ir.loteId) return
  const l = r.estadoRef.current.lote
  const x = l && l.id === ir.loteId ? l.sentencias[ir.sentencia] : undefined
  if (ir.exacta === true || (x && x.posicion !== null)) {
    const p = marcas.posicion(ir.sentencia, ir.desplazamiento)
    if (!p) return
    e.setSelection({ startLineNumber: p.linea, startColumn: p.columna, endLineNumber: p.linea, endColumn: p.columna })
    e.revealLineInCenter(p.linea)
  } else {
    const rango = marcas.rangoVivo(ir.sentencia)
    if (!rango) return
    const a = m.getPositionAt(rango.desde)
    const b = m.getPositionAt(rango.hasta)
    e.setSelection({ startLineNumber: a.lineNumber, startColumn: a.column, endLineNumber: b.lineNumber, endColumn: b.column })
    e.revealLineInCenter(a.lineNumber)
  }
  e.focus()
}

/** Acciones de la Salida. */
export function useSalidaConsola(n: NucleoConsola, correr: Correr, forzar: () => Promise<void>) {
  const { r, despachar } = n
  // El SQL guardado es el que se envió: se parte como texto suelto (sin marcas) y con SUS binds.
  const volverAEjecutar = useCallback(
    (id: string): void => {
      const res = r.estadoRef.current.resultados.resultados[id]
      if (!res) return
      void correr(dividirSentencias(res.sql, r.estadoRef.current.dialecto), res.sql, false, null, { fijos: res.binds })
    },
    [correr, r]
  )
  const ejecutarRestantes = useCallback(
    (loteId: number, desde: number): void =>
      restantes(r, correr, (texto) => despachar({ tipo: 'pista', texto }), loteId, desde),
    [despachar, correr, r]
  )
  const irA = useCallback((ir: IrAPosicion): void => irAPosicion(r, ir), [r])
  const accionSalida = useCallback(
    (a: AccionSalida): void => {
      if (a.tipo === 'ejecutarRestantes') ejecutarRestantes(a.loteId, a.desde)
      else void forzar()
    },
    [ejecutarRestantes, forzar]
  )
  const limpiarSalida = useCallback(() => despachar({ tipo: 'limpiarSalida' }), [despachar])
  return { volverAEjecutar, irA, accionSalida, limpiarSalida }
}

/** Lo que los atajos del editor disparan (siempre la versión de ESTE render). */
export interface AccionesAtajos {
  ejecutar: () => void
  ejecutarTodo: () => void
  detener: () => void
  commit: () => void
  rollback: () => void
  explicar: () => Promise<void>
  formatear: () => Promise<void>
  alternarHistorial: () => void
}

/** Atajos, guardado al perder el foco, la pista que se va al mover el cursor y solo lectura al cargar. */
export function useAtajosConsola(
  n: NucleoConsola,
  ed: editor.IStandaloneCodeEditor | null,
  acciones: AccionesAtajos,
  guardar: () => Promise<void>
): void {
  const { r, despachar, cargado } = n
  const accionesRef = useRef(acciones)
  accionesRef.current = acciones
  useEffect(() => {
    if (!ed) return
    const ds = registrarAccionesConsola(ed, window.tessera.plataforma, {
      ejecutar: () => accionesRef.current.ejecutar(),
      ejecutarTodo: () => accionesRef.current.ejecutarTodo(),
      detener: () => accionesRef.current.detener(),
      commit: () => accionesRef.current.commit(),
      rollback: () => accionesRef.current.rollback(),
      explicar: () => void accionesRef.current.explicar(),
      historial: () => accionesRef.current.alternarHistorial(),
      formatear: () => void accionesRef.current.formatear()
    })
    const blur = ed.onDidBlurEditorText(() => void guardar())
    const cursor = ed.onDidChangeCursorPosition(() => {
      if (r.estadoRef.current.pista !== null) despachar({ tipo: 'pista', texto: null })
    })
    return () => {
      for (const d of ds) d.dispose()
      blur.dispose()
      cursor.dispose()
    }
  }, [ed, guardar, despachar, r])
  useEffect(() => {
    if (ed) ed.updateOptions({ readOnly: !cargado })
  }, [ed, cargado])
}
