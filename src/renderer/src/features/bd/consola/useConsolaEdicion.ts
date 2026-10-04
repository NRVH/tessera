// =============================================================================
// Acciones de edición de la consola SQL: «Explicar» (un lote de UNA sentencia marcado
// `plan`, que hereda ■, «Forzar», el cronómetro y el ✗), formatear (lo decide
// `formateoSql`) e insertar un SQL del historial. Pieza de `useConsola`.
// Decisiones: docs/decisiones/bd/motores-explicar.md
// =============================================================================

import { useCallback } from 'react'
import type { DbBinds } from '../../../../../shared/db-explorador-ipc'
import { sentenciasAEjecutar, type Sentencia } from '../../../../../shared/sql/divisorSql'
import { ejecutando as hayEjecucion, explicarPideValores, nuevoLoteId } from './estadoConsola'
import { formatearEnEditor } from './formateoSql'
import { insercionHistorial } from './historialConsola'
import { crearLote } from './lote'
import type { RefsConsola } from './tiposConsola'
import type { DialogosConsola } from './useConsolaDialogos'
import { errorEnModelo, esquemaAhora, invocarSentencia, modoEnEditor, pintarMarcas } from './useConsolaLote'
import type { NucleoConsola } from './useConsolaNucleo'
import { mensajeDe } from '../documentos/consolaComun'
import { PISTA_YA_FORMATEADO, sentenciaExplicable } from './vivoConsola'

type Piezas = Pick<NucleoConsola, 'r' | 'api' | 'perfilId' | 'consolaId' | 'despachar' | 'setLoteMarcado'>

interface Plan {
  texto: string
  s: Sentencia
  version: number
}

/**
 * La sentencia del cursor o de la selección, si se puede explicar. Nunca con una pregunta
 * abierta: el lote de plan ocuparía la consola y la ejecución confirmada se retiraría.
 */
function sentenciaDelPlan(p: Piezas): Plan | null {
  const { r } = p
  const m = r.modeloRef.current
  if (!m || m.isDisposed() || !r.cargadoRef.current || r.desmontadoRef.current) return null
  if (hayEjecucion(r.estadoRef.current) || r.dialogoRef.current) return null
  const texto = m.getValue()
  const ss = sentenciasAEjecutar(texto, r.estadoRef.current.dialecto, modoEnEditor(r.edRef.current, m))
  const decision = sentenciaExplicable(ss)
  if (!decision.ok) {
    p.despachar({ tipo: 'pista', texto: decision.pista })
    return null
  }
  return { texto, s: decision.sentencia, version: m.getAlternativeVersionId() }
}

function crearLotePlan(p: Piezas, plan: Plan, binds: DbBinds | undefined): number {
  const { r } = p
  const loteId = nuevoLoteId(r.estadoRef.current)
  r.infoLoteRef.current = { loteId, fuente: plan.texto, conModelo: true, version: plan.version, binds: [binds] }
  p.despachar({ tipo: 'loteCreado', lote: crearLote(loteId, [plan.s], { plan: true }) })
  const marcas = r.marcasRef.current
  if (marcas) {
    const l = r.estadoRef.current.lote
    if (l) marcas.iniciar(l, Date.now())
    p.setLoteMarcado(loteId)
  }
  return loteId
}

/** No pasa por el prevuelo ni los peligros: EXPLAIN no ejecuta (el main es la autoridad). */
async function explicarPlan(p: Piezas, bindsDelLote: DialogosConsola['bindsDelLote']): Promise<void> {
  const { r } = p
  const plan = sentenciaDelPlan(p)
  if (!plan) return
  // Los valores de los parámetros, solo donde el plan los usa (`explicarPideValores`).
  let binds: DbBinds | undefined
  if (explicarPideValores(r.estadoRef.current.dialecto)) {
    const b = await bindsDelLote([plan.s], plan.texto, 'explicar', {})
    if (!b || hayEjecucion(r.estadoRef.current) || r.desmontadoRef.current) return
    binds = b[0]
  }
  const loteId = crearLotePlan(p, plan, binds)
  const res = await invocarSentencia(p, loteId, 0, (ejecucionId) =>
    p.api.explicar({
      perfilId: p.perfilId,
      consolaId: p.consolaId,
      ejecucionId,
      sql: plan.texto.slice(plan.s.desde, plan.s.hastaContenido),
      ...(binds ? { binds } : {}),
      txInicial: r.txInicialRef.current
    })
  )
  if (!res) return
  const fin = errorEnModelo(r, loteId, 0, true, res.ok ? null : res.error)
  p.despachar({
    tipo: 'planTerminado',
    loteId,
    indice: 0,
    respuesta: res,
    esquema: esquemaAhora(r),
    ahora: Date.now(),
    posicionModelo: fin.posicionModelo,
    binds
  })
  pintarMarcas(r)
  fin.subrayar()
}

/** En el cursor, en línea nueva si hace falta, con el EOL del modelo y UNA parada de deshacer. */
function insertarEnEditor(r: RefsConsola, sql: string): void {
  const e = r.edRef.current
  const m = r.modeloRef.current
  if (!e || !m || m.isDisposed() || !r.cargadoRef.current) return
  const sel = e.getSelection()
  if (!sel) return
  const ini = sel.getStartPosition()
  const fin = sel.getEndPosition()
  const ins = insercionHistorial(
    sql,
    r.estadoRef.current.dialecto,
    {
      antes: m.getLineContent(ini.lineNumber).slice(0, ini.column - 1),
      despues: m.getLineContent(fin.lineNumber).slice(fin.column - 1)
    },
    m.getEOL() === '\r\n' ? '\r\n' : '\n'
  )
  const desde = m.getOffsetAt(ini)
  e.pushUndoStop()
  e.executeEdits('tessera.historial', [{ range: sel, text: ins.texto, forceMoveMarkers: true }])
  e.pushUndoStop()
  const pos = m.getPositionAt(desde + ins.cursor)
  e.setPosition(pos)
  e.revealPositionInCenterIfOutsideViewport(pos)
  e.focus()
}

/** «Explicar», formatear e insertar desde el historial. */
export function useEdicionConsola(n: NucleoConsola, bindsDelLote: DialogosConsola['bindsDelLote']) {
  const { r, api, perfilId, consolaId, despachar, setLoteMarcado } = n
  const explicar = useCallback(
    (): Promise<void> => explicarPlan({ r, api, perfilId, consolaId, despachar, setLoteMarcado }, bindsDelLote),
    [api, perfilId, consolaId, despachar, bindsDelLote, r, setLoteMarcado]
  )
  // Solo CUÁNDO: con el texto cargado y el editor escribible.
  const formatear = useCallback(async (): Promise<void> => {
    const e = r.edRef.current
    if (!e || !r.cargadoRef.current || r.desmontadoRef.current) return
    try {
      const cambio = await formatearEnEditor(e, r.conexionRef.current.motor)
      if (!cambio) despachar({ tipo: 'pista', texto: PISTA_YA_FORMATEADO })
    } catch (err) {
      despachar({ tipo: 'pista', texto: `No se pudo formatear: ${mensajeDe(err)}` })
    }
    if (!r.desmontadoRef.current) e.focus()
  }, [despachar, r])
  const insertarSql = useCallback((sql: string): void => insertarEnEditor(r, sql), [r])
  return { explicar, formatear, insertarSql }
}
