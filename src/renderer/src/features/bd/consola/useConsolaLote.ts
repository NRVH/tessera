// =============================================================================
// El LOTE de la consola SQL: partir -> prevuelo de solo lectura -> peligros ->
// producción, con UNA confirmación ANTES de enviar nada; después un bucle SECUENCIAL,
// una sentencia por invoke, que para en el primer error. Cada sentencia lleva su
// `ejecucionId` (lo que ■ cancela). Pieza de `useConsola`.
// Decisiones: docs/decisiones/bd/ui-consola-lote-stop-y-cierre.md
// =============================================================================

import { useCallback, useEffect } from 'react'
import type { editor } from 'monaco-editor'
import type { DbBinds, DbErrorSql, DbRespuesta } from '../../../../../shared/db-explorador-ipc'
import { sentenciasAEjecutar, type Sentencia } from '../../../../../shared/sql/divisorSql'
import {
  PISTA_SIN_SENTENCIA,
  decidirLote,
  ejecutando as hayEjecucion,
  nuevoLoteId,
  resultadoDeRespuesta
} from './estadoConsola'
import { esquemaEfectivo } from './esquemaConsola'
import { crearLote, siguiente } from './lote'
import { marcasCompilacion } from './marcasConsola'
import type { MarcasLoteMonaco } from './monacoConsola'
import { textoError } from './salidaConsola'
import type { InfoLote, OpcionesCorrer, RefsConsola } from './tiposConsola'
import type { DialogosConsola } from './useConsolaDialogos'
import type { NucleoConsola } from './useConsolaNucleo'
import { porDefectoConsola } from './utilConsola'
import { respuestaDeError, uuid } from '../documentos/consolaComun'
import { modoDesdeEditor } from './vivoConsola'

const TICK_CRONOMETRO_MS = 250

type Binds = ReadonlyArray<DbBinds | undefined>
type Piezas = Pick<NucleoConsola, 'r' | 'api' | 'perfilId' | 'consolaId' | 'despachar'>

/** Repinta las marcas del lote si son de este lote y están en el modelo. */
export function pintarMarcas(r: RefsConsola, solo?: number[]): void {
  const l = r.estadoRef.current.lote
  const info = r.infoLoteRef.current
  if (!l || !info || !info.conModelo || info.loteId !== l.id) return
  r.marcasRef.current?.pintar(l, Date.now(), solo)
}

/** El esquema del eco `ESQUEMA>`: sin sesión todavía, el que la sesión nueva va a aplicar. */
export function esquemaAhora(r: RefsConsola): string | null {
  return esquemaEfectivo(r.estadoRef.current.sesion, r.esquemaElegidoRef.current, porDefectoConsola(r.conexionRef.current))
}

/** Cómo pide el editor ejecutar: la selección, o la sentencia del cursor. */
export function modoEnEditor(e: editor.IStandaloneCodeEditor | null, m: editor.ITextModel) {
  const sel = e ? e.getSelection() : null
  const seleccion =
    sel && !sel.isEmpty() ? { desde: m.getOffsetAt(sel.getStartPosition()), hasta: m.getOffsetAt(sel.getEndPosition()) } : null
  const pos = e ? e.getPosition() : null
  return modoDesdeEditor(seleccion, pos ? m.getOffsetAt(pos) : 0)
}

/**
 * Manda la sentencia `indice` con `invocar` y la da por iniciada (su `ejecucionId`, el eco y
 * la marca «corriendo»); al volver suelta ■ si sigue siendo la suya y la espera de «Forzar».
 * Null = el hook se desmontó mientras tanto. Lo comparten el bucle y «Explicar».
 */
export async function invocarSentencia<T>(
  p: Pick<NucleoConsola, 'r' | 'despachar'>,
  loteId: number,
  indice: number,
  invocar: (ejecucionId: string) => Promise<DbRespuesta<T>>
): Promise<DbRespuesta<T> | null> {
  const { r } = p
  const ejecucionId = uuid()
  r.ejecucionRef.current = { ejecucionId, loteId, indice }
  p.despachar({ tipo: 'sentenciaIniciada', loteId, indice, ahora: Date.now(), esquema: esquemaAhora(r) })
  pintarMarcas(r, [indice])
  let res: DbRespuesta<T>
  try {
    res = await invocar(ejecucionId)
  } catch (err) {
    res = respuestaDeError<T>(err)
  }
  if (r.ejecucionRef.current && r.ejecucionRef.current.ejecucionId === ejecucionId) r.ejecucionRef.current = null
  if (r.stopRef.current !== null) {
    clearTimeout(r.stopRef.current)
    r.stopRef.current = null
  }
  return r.desmontadoRef.current ? null : res
}

/** El ✗ de una sentencia en el MODELO tras su respuesta; `subrayar` va DESPUÉS de repintar. */
export interface ErrorEnModelo {
  marcas: MarcasLoteMonaco | null
  posicionModelo: { linea: number; columna: number } | null
  subrayar: () => void
}

/** Las marcas se leen tras el await y la posición ANTES de despachar; un Stop no se subraya. */
export function errorEnModelo(
  r: RefsConsola,
  loteId: number,
  indice: number,
  conModelo: boolean,
  error: DbErrorSql | null
): ErrorEnModelo {
  const actuales = r.marcasRef.current
  const marcas = conModelo && actuales !== null && actuales.lote === loteId ? actuales : null
  let posicionModelo: { linea: number; columna: number } | null = null
  if (marcas && error && typeof error.posicion === 'number') {
    const pos = marcas.posicion(indice, error.posicion)
    if (pos) posicionModelo = { linea: pos.linea, columna: pos.columna }
  }
  const subrayar = (): void => {
    if (marcas && error && error.motivo !== 'cancelada' && typeof error.posicion === 'number') {
      marcas.ponerError(indice, error.posicion, textoError(error), error.codigo ?? null)
    }
  }
  return { marcas, posicionModelo, subrayar }
}

type RespuestaEjecutar = Parameters<typeof resultadoDeRespuesta>[0]

function terminarSentencia(p: Piezas, info: InfoLote, i: number, respuesta: RespuestaEjecutar, binds: DbBinds | undefined): void {
  const { r } = p
  const loteId = info.loteId
  const res = resultadoDeRespuesta(respuesta)
  const fin = errorEnModelo(r, loteId, i, info.conModelo, res.tipo === 'error' ? res.error : null)
  p.despachar({
    tipo: 'sentenciaTerminada',
    loteId,
    indice: i,
    resultado: res,
    esquema: esquemaAhora(r),
    ahora: Date.now(),
    posicionModelo: fin.posicionModelo,
    binds
  })
  pintarMarcas(r)
  fin.subrayar()
  // Errores y avisos de compilación de un CREATE de PL/SQL: un subrayado por entrada situada.
  if (fin.marcas && (res.tipo === 'error' || res.tipo === 'hecho') && res.compilacion && res.compilacion.length > 0) {
    fin.marcas.ponerCompilacion(i, marcasCompilacion(res.compilacion))
  }
}

async function bucleLote(p: Piezas, loteId: number): Promise<void> {
  const { r } = p
  for (;;) {
    if (r.desmontadoRef.current) return
    const lote = r.estadoRef.current.lote
    const info = r.infoLoteRef.current
    if (!lote || lote.id !== loteId || !info || info.loteId !== loteId) return
    const i = siguiente(lote)
    if (i === null) return
    const s = lote.sentencias[i].s
    if (s.clase === 'cliente') {
      p.despachar({ tipo: 'sentenciaLocal', loteId, indice: i, estado: 'cliente', motivo: '', ahora: Date.now() })
      pintarMarcas(r)
      continue
    }
    // Solo SUS binds; sin parámetros, el campo no va.
    const binds = info.binds[i]
    const res = await invocarSentencia(p, loteId, i, (ejecucionId) =>
      p.api.ejecutar({
        perfilId: p.perfilId,
        consolaId: p.consolaId,
        ejecucionId,
        sql: info.fuente.slice(s.desde, s.hastaContenido),
        maxFilas: r.filasPorPaginaRef.current,
        ...(binds ? { binds } : {}),
        // El lote se confirmó ENTERO antes de salir; el main lo exige solo a lo que escribe.
        ...(info.confirmado ? { confirmado: true } : {}),
        // La Tx con la que se pintó la barra, por si esta sentencia crea la sesión.
        txInicial: r.txInicialRef.current
      })
    )
    if (!res) return
    terminarSentencia(p, info, i, res, binds)
  }
}

type Decision = ReturnType<typeof decidirLote>
type Preguntas = Pick<DialogosConsola, 'pedirConfirmacion' | 'bindsDelLote'>

interface Lanzar {
  ss: Sentencia[]
  fuente: string
  conModelo: boolean
  version: number | null
  opciones: OpcionesCorrer
}

/** Solo lectura, peligros y producción en una decisión pura (la sesión: el DDL de Oracle). */
function decisionDelLote(r: RefsConsola, ss: Sentencia[]): Decision {
  const e0 = r.estadoRef.current
  const c0 = r.conexionRef.current
  return decidirLote(ss, {
    soloLectura: r.soloLecturaRef.current,
    dialecto: e0.dialecto,
    entorno: c0.entorno,
    alias: c0.alias,
    sesion: e0.sesion
  })
}

/** Crea el lote aceptado y sus marcas; null = el prevuelo lo rechazó y no se envía nada. */
function crearLoteAceptado(
  p: Piezas,
  setLoteMarcado: (l: number | null) => void,
  a: Lanzar,
  decision: Decision,
  aceptado: { binds: Binds; confirmado: boolean }
): number | null {
  const { r } = p
  const loteId = nuevoLoteId(r.estadoRef.current)
  const lote = crearLote(loteId, a.ss)
  r.infoLoteRef.current = { loteId, fuente: a.fuente, conModelo: a.conModelo, version: a.version, ...aceptado }
  p.despachar({ tipo: 'loteCreado', lote })
  const marcas = r.marcasRef.current
  if (marcas) {
    if (a.conModelo) marcas.iniciar(lote, Date.now())
    else marcas.limpiar()
    setLoteMarcado(a.conModelo ? loteId : null)
  }
  if (decision.tipo === 'rechazado') {
    p.despachar({ tipo: 'prevueloRechazado', loteId, bloqueadas: decision.bloqueadas, ahora: Date.now() })
    pintarMarcas(r)
    return null
  }
  return loteId
}

// Los `await` viven AQUÍ y no en una función `async` intermedia: cada nivel más sería un
// turno de microtarea entre los parámetros y `loteCreado` que el lote no tenía.
async function correrLote(p: Piezas, d: Preguntas, setLoteMarcado: (l: number | null) => void, a: Lanzar): Promise<void> {
  const { r } = p
  if (a.ss.length === 0 || hayEjecucion(r.estadoRef.current) || r.desmontadoRef.current) return
  const decision = decisionDelLote(r, a.ss)
  let aceptado: { binds: Binds; confirmado: boolean } = { binds: a.ss.map(() => undefined), confirmado: false }
  if (decision.tipo !== 'rechazado') {
    let confirmado = false
    if (decision.tipo === 'confirmar') {
      const ok = await d.pedirConfirmacion({ ...decision.textos, peligro: true })
      if (!ok || hayEjecucion(r.estadoRef.current) || r.desmontadoRef.current) return
      confirmado = decision.produccion
    }
    // Los parámetros DESPUÉS del prevuelo y los peligros, y ANTES de crear el lote.
    const binds = await d.bindsDelLote(a.ss, a.fuente, 'ejecutar', a.opciones)
    if (!binds || hayEjecucion(r.estadoRef.current) || r.desmontadoRef.current) return
    aceptado = { binds, confirmado }
  }
  const loteId = crearLoteAceptado(p, setLoteMarcado, a, decision, aceptado)
  if (loteId === null) return
  await bucleLote(p, loteId)
}

/** Lanza un lote con las sentencias dadas (las del modelo, o un SQL a re-ejecutar). */
export type Correr = (
  ss: Sentencia[],
  fuente: string,
  conModelo: boolean,
  version: number | null,
  opciones?: OpcionesCorrer
) => Promise<void>

/** El lote de la consola: cronómetro, `correr`, Ejecutar y Ejecutar todo. */
export function useLoteConsola(n: NucleoConsola, dialogos: DialogosConsola, hayLoteEnCurso: boolean) {
  const { r, api, perfilId, consolaId, despachar, setLoteMarcado } = n
  // Cronómetro de la sentencia que corre: solo repinta esa.
  useEffect(() => {
    if (!hayLoteEnCurso) return
    const t = setInterval(() => {
      const l = r.estadoRef.current.lote
      if (!l) return
      const i = l.sentencias.findIndex((x) => x.estado === 'corriendo')
      if (i >= 0) pintarMarcas(r, [i])
    }, TICK_CRONOMETRO_MS)
    return () => clearInterval(t)
  }, [hayLoteEnCurso, r])

  const { pedirConfirmacion, bindsDelLote } = dialogos
  const correr = useCallback<Correr>(
    (ss, fuente, conModelo, version, opciones = {}) =>
      correrLote(
        { r, api, perfilId, consolaId, despachar },
        { pedirConfirmacion, bindsDelLote },
        setLoteMarcado,
        { ss, fuente, conModelo, version, opciones }
      ),
    [api, perfilId, consolaId, despachar, pedirConfirmacion, bindsDelLote, r, setLoteMarcado]
  )

  const ejecutarModo = useCallback(
    (todo: boolean): void => {
      const m = r.modeloRef.current
      if (!m || m.isDisposed() || !r.cargadoRef.current) return
      if (hayEjecucion(r.estadoRef.current)) return
      const texto = m.getValue()
      const d = r.estadoRef.current.dialecto
      const ss = sentenciasAEjecutar(texto, d, todo ? { tipo: 'todo' } : modoEnEditor(r.edRef.current, m))
      if (ss.length === 0) {
        despachar({ tipo: 'pista', texto: todo ? 'La consola no tiene ninguna sentencia' : PISTA_SIN_SENTENCIA })
        return
      }
      void correr(ss, texto, true, m.getAlternativeVersionId())
    },
    [despachar, correr, r]
  )
  const ejecutar = useCallback(() => ejecutarModo(false), [ejecutarModo])
  const ejecutarTodo = useCallback(() => ejecutarModo(true), [ejecutarModo])
  return { correr, ejecutar, ejecutarTodo }
}
