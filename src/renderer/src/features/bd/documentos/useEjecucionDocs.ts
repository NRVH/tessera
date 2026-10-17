// =============================================================================
// Ejecutar, detener y «Cargar más» en la consola de MongoDB. El texto se parte en sentencias
// (`consolaDocs.ts`) y cada una viaja TAL CUAL al main, una por petición, en orden y
// parando en el primer fallo. Stop cancela por el `peticionId` de la sentencia y, pasado
// `ESPERA_STOP_MS` sin respuesta, la Salida ofrece «Forzar». Solo callbacks: ningún efecto.
// Decisiones: docs/decisiones/bd/ui-documentos-consola.md
// =============================================================================

import { useCallback } from 'react'
import type { editor } from 'monaco-editor'
import type { DbRespuesta } from '../../../../../shared/db-explorador-ipc'
import type { DbDocResultado } from '../../../../../shared/db-documentos-ipc'
import { pistaSinSentencia } from '../consola/estadoConsola'
import { textoSinRespuestaStop, textoError, type AccionSalida, type IrAPosicion } from '../consola/salidaConsola'
import { ESPERA_STOP_MS } from '../consola/vivoConsola'
import { baseTrasResultado, sentenciasShellAEjecutar, unirColumnas, type ModoEjecucionShell, type SentenciaShell } from './consolaDocs'
import { respuestaDeError, uuid } from './consolaComun'
import type { EstadoConsolaDocs } from './useEstadoConsolaDocs'
import { anadirResultadoDocs, irASalidaDocs, resultadoDeRespuesta } from './resultadosConsolaDocs'
import { actualizarResultado, empezarLote, ID_SALIDA, sinLectores } from '../resultados/pestanasResultado'
import { modoDelCursor } from './useEditorConsola'
import { cancelarDesde, ejecutarSentencia, type DepsLote } from './loteDocs'
import { txConsolaDocs } from './textosConsolaDocs'

type Enviar = (s: SentenciaShell, peticionId: string, confirmado: boolean) => Promise<DbRespuesta<DbDocResultado>>

/** Una sentencia al main, con su `peticionId` (el que para Stop). */
function useEnviar(e: EstadoConsolaDocs): Enviar {
  const { docs, perfilId, consolaId, conexionRef, baseRef, filasPorPaginaRef } = e
  return useCallback(
    async (s, peticionId, confirmado) => {
      try {
        return await docs.ejecutarConsola({
          perfilId,
          consolaId,
          conexionId: conexionRef.current.id,
          base: baseRef.current,
          texto: s.texto,
          desplazamiento: s.desde,
          ...(confirmado ? { confirmado: true } : {}),
          peticionId,
          maxDocumentos: filasPorPaginaRef.current
        })
      } catch (err) {
        return respuestaDeError<DbDocResultado>(err)
      }
    },
    [docs, perfilId, consolaId, conexionRef, baseRef, filasPorPaginaRef]
  )
}

/** Una sentencia con algo que enseñar abre su pestaña: las de un mismo lote se suman. */
function useAplicarResultado(e: EstadoConsolaDocs): (r: DbDocResultado, lote: number, sentencia: string) => void {
  const { cambiarBase, baseRef, cambiarResultados } = e
  return useCallback(
    (r: DbDocResultado, lote: number, sentencia: string): void => {
      cambiarBase(baseTrasResultado(baseRef.current, r))
      const nuevo = resultadoDeRespuesta(r, sentencia)
      if (nuevo) cambiarResultados((est) => anadirResultadoDocs(est, nuevo, lote))
    },
    [cambiarBase, baseRef, cambiarResultados]
  )
}

function useCorrer(e: EstadoConsolaDocs, enviar: Enviar, aplicarResultado: DepsLote['aplicarResultado']): (m: ModoEjecucionShell) => Promise<void> {
  const { anotar, pedirConfirmacion, cambiarEnCurso, cambiarResultados, baseRef, conexionRef, desmontadoRef, detenidoRef } = e
  const { modeloRef, marcasRef, cargadoRef, enCursoRef, dialogoRef, siguienteIdRef, stopRef } = e
  const { setPista, setConError, setLoteMarcado } = e
  return useCallback(
    async (modo: ModoEjecucionShell): Promise<void> => {
      const m = modeloRef.current
      const marcas = marcasRef.current
      if (!m || m.isDisposed() || !marcas || !cargadoRef.current || enCursoRef.current || dialogoRef.current) return
      const sentencias = sentenciasShellAEjecutar(m.getValue(), modo)
      if (sentencias.length === 0) {
        setPista(pistaSinSentencia())
        return
      }
      setPista(null)
      setConError(false)
      detenidoRef.current = false
      const lote = { marcas, sentencias, id: siguienteIdRef.current++ }
      // Desde ya: elegir una pestaña mientras corre la primera sentencia cuenta como elección.
      cambiarResultados((est) => sinLectores(empezarLote(est, lote.id)))
      marcas.iniciar(sentencias.map((s) => ({ desde: s.desde, hasta: s.hastaContenido })))
      setLoteMarcado(lote.id)
      const deps: DepsLote = {
        anotar,
        enviar,
        pedirConfirmacion,
        aplicarResultado,
        cambiarEnCurso,
        irAlSalida: () => cambiarResultados((est) => sinLectores(irASalidaDocs(est))),
        baseRef,
        conexionRef,
        desmontadoRef
      }
      let fallo = false
      for (let i = 0; i < sentencias.length; i++) {
        if (detenidoRef.current || desmontadoRef.current) {
          cancelarDesde(lote, i)
          break
        }
        const paso = await ejecutarSentencia(deps, lote, i)
        if (paso === 'salir') return
        if (paso === 'fallo') fallo = true
        if (paso !== 'sigue') break
      }
      if (stopRef.current !== null) clearTimeout(stopRef.current)
      stopRef.current = null
      cambiarEnCurso(null)
      setConError(fallo)
    },
    [
      anotar, enviar, pedirConfirmacion, aplicarResultado, cambiarEnCurso, cambiarResultados, baseRef, conexionRef, desmontadoRef, detenidoRef,
      modeloRef, marcasRef, cargadoRef, enCursoRef, dialogoRef, siguienteIdRef, stopRef, setPista, setConError, setLoteMarcado
    ]
  )
}

function useModoDelEditor(edRef: React.RefObject<editor.IStandaloneCodeEditor>, e: EstadoConsolaDocs): () => ModoEjecucionShell | null {
  const { modeloRef } = e
  return useCallback((): ModoEjecucionShell | null => {
    const ed = edRef.current
    const m = modeloRef.current
    if (!ed || !m || m.isDisposed()) return null
    return modoDelCursor(ed, m)
  }, [edRef, modeloRef])
}

function useDetener(e: EstadoConsolaDocs): () => void {
  const { api, perfilId, consolaId, anotar, enCursoRef, masRef, detenidoRef, stopRef } = e
  return useCallback((): void => {
    const en = enCursoRef.current
    const mas = masRef.current
    if (!en && !mas) return
    detenidoRef.current = true
    if (en) api.cancelar({ rol: 'consola', perfilId, consolaId, ejecucionId: en.peticionId }).catch(() => undefined)
    // El cursor de «Cargar más» vive en la sesión de la consola: se para por ella, con su `peticionId`.
    if (mas) api.cancelar({ rol: 'consola', perfilId, consolaId, ejecucionId: mas }).catch(() => undefined)
    if (!en) return
    if (stopRef.current !== null) clearTimeout(stopRef.current)
    stopRef.current = setTimeout(() => {
      stopRef.current = null
      // Sigue la MISMA petición: el servidor no soltó la operación.
      if (enCursoRef.current && enCursoRef.current.peticionId === en.peticionId) {
        // Etiqueta de «Forzar» en MongoDB: no hay transacción de consola que revertir.
        anotar([{ tipo: 'aviso', texto: textoSinRespuestaStop(), accion: { tipo: 'forzar', etiqueta: txConsolaDocs().forzarEtiqueta } }])
      }
    }, ESPERA_STOP_MS)
  }, [api, perfilId, consolaId, anotar, enCursoRef, masRef, detenidoRef, stopRef])
}

function useAccionSalida(e: EstadoConsolaDocs): (a: AccionSalida) => Promise<void> {
  const { api, pedirConfirmacion, conexionRef } = e
  return useCallback(
    async (a: AccionSalida): Promise<void> => {
      if (a.tipo !== 'forzar') return
      const c = conexionRef.current
      const t = txConsolaDocs()
      const ok = await pedirConfirmacion({
        titulo: t.forzarTitulo,
        mensaje: t.forzarMensaje(c.alias),
        confirmar: t.forzar,
        peligro: true
      })
      if (ok) await api.forzar(c.id).catch(() => undefined)
    },
    [api, pedirConfirmacion, conexionRef]
  )
}

function useIrA(e: EstadoConsolaDocs, edRef: React.RefObject<editor.IStandaloneCodeEditor>): (ir: IrAPosicion) => void {
  const { marcasRef, loteMarcado } = e
  return useCallback(
    (ir: IrAPosicion): void => {
      const ed = edRef.current
      const marcas = marcasRef.current
      if (!ed || !marcas || ir.loteId !== loteMarcado) return
      const r = marcas.rangoVivo(ir.sentencia)
      if (!r) return
      const pos = marcas.posicion(Math.min(r.hasta, r.desde + ir.desplazamiento))
      if (!pos) return
      ed.setPosition(pos)
      ed.revealPositionInCenterIfOutsideViewport(pos)
      ed.focus()
    },
    [edRef, marcasRef, loteMarcado]
  )
}

/** «Cargar más» de la pestaña activa: la página siguiente de su lector, añadida a sus documentos. */
function useCargarMas(e: EstadoConsolaDocs): () => Promise<void> {
  const { docs, anotar, resultadosRef, masRef, filasPorPaginaRef, desmontadoRef, setCargandoMas, cambiarResultados } = e
  return useCallback(async (): Promise<void> => {
    const id = resultadosRef.current.activa
    const v = id === ID_SALIDA ? undefined : resultadosRef.current.resultados[id]
    if (!v || v.tipo !== 'documentos' || !v.lector || masRef.current) return
    const lector = v.lector
    const peticionId = uuid()
    masRef.current = peticionId
    setCargandoMas(true)
    try {
      const r = await docs
        .lectorMas({ lector, maxDocumentos: filasPorPaginaRef.current, peticionId })
        .catch((err: unknown) => respuestaDeError<never>(err))
      if (desmontadoRef.current) return
      const actual = resultadosRef.current.resultados[id]
      // Si mientras tanto la pestaña se cerró o se sustituyó, esta página ya no es de nadie, ni
      // el cursor con el que volvió: se cierra, o seguiría abierto en el servidor.
      if (!actual || actual.tipo !== 'documentos' || actual.lector !== lector) {
        if (r.ok && r.valor.lector) docs.lectorCerrar(r.valor.lector).catch(() => undefined)
        return
      }
      if (!r.ok) {
        if (r.error.motivo !== 'cancelada') anotar([{ tipo: 'error', texto: txConsolaDocs().noSePudieronLeerMasDetalle(textoError(r.error)) }])
        return
      }
      const sig = {
        ...actual,
        columnas: unirColumnas(actual.columnas, r.valor.columnas),
        documentos: actual.documentos.concat(r.valor.documentos),
        lector: r.valor.lector
      }
      cambiarResultados((est) => sinLectores(actualizarResultado(est, id, sig)))
    } finally {
      if (masRef.current === peticionId) masRef.current = null
      setCargandoMas(false)
    }
  }, [docs, anotar, resultadosRef, masRef, filasPorPaginaRef, desmontadoRef, setCargandoMas, cambiarResultados])
}

/** Todo lo que el pane necesita para ejecutar, detener y paginar. */
export function useEjecucionDocs(
  e: EstadoConsolaDocs,
  edRef: React.RefObject<editor.IStandaloneCodeEditor>
): {
  ejecutar: () => void
  ejecutarTodo: () => void
  detener: () => void
  accionSalida: (a: AccionSalida) => Promise<void>
  irA: (ir: IrAPosicion) => void
  cargarMas: () => Promise<void>
} {
  const enviar = useEnviar(e)
  const aplicarResultado = useAplicarResultado(e)
  const correr = useCorrer(e, enviar, aplicarResultado)
  const modoDelEditor = useModoDelEditor(edRef, e)
  const ejecutar = useCallback((): void => {
    const modo = modoDelEditor()
    if (modo) void correr(modo)
  }, [modoDelEditor, correr])
  const ejecutarTodo = useCallback((): void => {
    void correr({ tipo: 'todo' })
  }, [correr])
  const detener = useDetener(e)
  const accionSalida = useAccionSalida(e)
  const irA = useIrA(e, edRef)
  const cargarMas = useCargarMas(e)
  return { ejecutar, ejecutarTodo, detener, accionSalida, irA, cargarMas }
}
