// =============================================================================
// Ejecutar, detener y «Cargar más» en la consola de MongoDB. El texto se parte en sentencias
// (`consolaDocs.ts`) y cada una viaja TAL CUAL al main, una por petición, en orden y
// parando en el primer fallo. Stop cancela por el `peticionId` de la sentencia y, pasado
// `ESPERA_STOP_MS` sin respuesta, la Salida ofrece «Forzar». Solo callbacks: ningún efecto.
// Decisiones: docs/decisiones/bd/ui-documentos-consola.md
// =============================================================================

import { useCallback } from 'react'
import type { editor } from 'monaco-editor'
import type { DbCancelar, DbRespuesta } from '../../../../../shared/db-explorador-ipc'
import type { DbDocResultado } from '../../../../../shared/db-documentos-ipc'
import { PISTA_SIN_SENTENCIA } from '../consola/estadoConsola'
import { TEXTO_SIN_RESPUESTA_STOP, textoError, type AccionSalida, type IrAPosicion } from '../consola/salidaConsola'
import { ESPERA_STOP_MS } from '../consola/vivoConsola'
import { baseTrasResultado, sentenciasShellAEjecutar, unirColumnas, type ModoEjecucionShell, type SentenciaShell } from './consolaDocs'
import { respuestaDeError, uuid } from './consolaComun'
import { cerrarLectorDeVista, type EstadoConsolaDocs, type VistaResultado } from './useEstadoConsolaDocs'
import { modoDelCursor } from './useEditorConsola'
import { cancelarDesde, ejecutarSentencia, type DepsLote } from './loteDocs'

/** Etiqueta de «Forzar» en MongoDB: no hay transacción de consola que revertir. */
const ETIQUETA_FORZAR_DOCS = 'Forzar (cierra la conexión y sus cursores abiertos)'

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

function useAplicarResultado(e: EstadoConsolaDocs): (r: DbDocResultado) => void {
  const { cambiarBase, baseRef, vistaRef, docs, setVista, setSeleccionado, setPestana } = e
  return useCallback(
    (r: DbDocResultado): void => {
      cambiarBase(baseTrasResultado(baseRef.current, r))
      if (r.tipo === 'documentos') {
        const v: VistaResultado = {
          tipo: 'documentos',
          columnas: r.pagina.columnas,
          documentos: r.pagina.documentos,
          lector: r.pagina.lector,
          coleccion: r.coleccion,
          ms: r.pagina.ms
        }
        cerrarLectorDeVista(docs, vistaRef.current)
        vistaRef.current = v
        setVista(v)
        // El primero elegido: el panel JSON nunca empieza vacío si hay algo que enseñar.
        setSeleccionado(r.pagina.documentos.length > 0 ? 0 : null)
        setPestana('resultado')
      } else if (r.tipo === 'valor') {
        const v: VistaResultado = { tipo: 'valor', texto: r.texto }
        cerrarLectorDeVista(docs, vistaRef.current)
        vistaRef.current = v
        setVista(v)
        setSeleccionado(null)
        setPestana('resultado')
      }
    },
    [cambiarBase, baseRef, vistaRef, docs, setVista, setSeleccionado, setPestana]
  )
}

function useCorrer(e: EstadoConsolaDocs, enviar: Enviar, aplicarResultado: (r: DbDocResultado) => void): (m: ModoEjecucionShell) => Promise<void> {
  const { anotar, pedirConfirmacion, cambiarEnCurso, setPestana, baseRef, conexionRef, desmontadoRef, detenidoRef } = e
  const { modeloRef, marcasRef, cargadoRef, enCursoRef, dialogoRef, siguienteIdRef, stopRef } = e
  const { setPista, setConError, setLoteMarcado } = e
  return useCallback(
    async (modo: ModoEjecucionShell): Promise<void> => {
      const m = modeloRef.current
      const marcas = marcasRef.current
      if (!m || m.isDisposed() || !marcas || !cargadoRef.current || enCursoRef.current || dialogoRef.current) return
      const sentencias = sentenciasShellAEjecutar(m.getValue(), modo)
      if (sentencias.length === 0) {
        setPista(PISTA_SIN_SENTENCIA)
        return
      }
      setPista(null)
      setConError(false)
      detenidoRef.current = false
      const lote = { marcas, sentencias, id: siguienteIdRef.current++ }
      marcas.iniciar(sentencias.map((s) => ({ desde: s.desde, hasta: s.hastaContenido })))
      setLoteMarcado(lote.id)
      const deps: DepsLote = {
        anotar,
        enviar,
        pedirConfirmacion,
        aplicarResultado,
        cambiarEnCurso,
        irAlSalida: () => setPestana('salida'),
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
      anotar, enviar, pedirConfirmacion, aplicarResultado, cambiarEnCurso, setPestana, baseRef, conexionRef, desmontadoRef, detenidoRef,
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
  const { api, perfilId, consolaId, anotar, enCursoRef, masRef, detenidoRef, conexionRef, stopRef } = e
  return useCallback((): void => {
    const en = enCursoRef.current
    const mas = masRef.current
    if (!en && !mas) return
    detenidoRef.current = true
    if (en) api.cancelar({ rol: 'consola', perfilId, consolaId, ejecucionId: en.peticionId }).catch(() => undefined)
    if (mas) {
      const c: DbCancelar = { rol: 'datos', conexionId: conexionRef.current.id, peticionId: mas }
      api.cancelar(c).catch(() => undefined)
    }
    if (!en) return
    if (stopRef.current !== null) clearTimeout(stopRef.current)
    stopRef.current = setTimeout(() => {
      stopRef.current = null
      // Sigue la MISMA petición: el servidor no soltó la operación.
      if (enCursoRef.current && enCursoRef.current.peticionId === en.peticionId) {
        anotar([{ tipo: 'aviso', texto: TEXTO_SIN_RESPUESTA_STOP, accion: { tipo: 'forzar', etiqueta: ETIQUETA_FORZAR_DOCS } }])
      }
    }, ESPERA_STOP_MS)
  }, [api, perfilId, consolaId, anotar, enCursoRef, masRef, detenidoRef, conexionRef, stopRef])
}

function useAccionSalida(e: EstadoConsolaDocs): (a: AccionSalida) => Promise<void> {
  const { api, pedirConfirmacion, conexionRef } = e
  return useCallback(
    async (a: AccionSalida): Promise<void> => {
      if (a.tipo !== 'forzar') return
      const c = conexionRef.current
      const ok = await pedirConfirmacion({
        titulo: '¿Forzar el cierre de la conexión?',
        mensaje: `Se cerrará la conexión con «${c.alias}»: lo que esté corriendo se corta y los cursores abiertos de sus pestañas y consolas se pierden.`,
        confirmar: 'Forzar',
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

function useCargarMas(e: EstadoConsolaDocs): () => Promise<void> {
  const { docs, anotar, vistaRef, masRef, filasPorPaginaRef, desmontadoRef, setCargandoMas, setVista } = e
  return useCallback(async (): Promise<void> => {
    const v = vistaRef.current
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
      const actual = vistaRef.current
      // Si mientras tanto llegó otro resultado, esta página ya no es de nadie.
      if (!actual || actual.tipo !== 'documentos' || actual.lector !== lector) return
      if (!r.ok) {
        if (r.error.motivo !== 'cancelada') anotar([{ tipo: 'error', texto: `No se pudieron leer más documentos: ${textoError(r.error)}` }])
        return
      }
      const sig: VistaResultado = {
        ...actual,
        columnas: unirColumnas(actual.columnas, r.valor.columnas),
        documentos: actual.documentos.concat(r.valor.documentos),
        lector: r.valor.lector
      }
      vistaRef.current = sig
      setVista(sig)
    } finally {
      if (masRef.current === peticionId) masRef.current = null
      setCargandoMas(false)
    }
  }, [docs, anotar, vistaRef, masRef, filasPorPaginaRef, desmontadoRef, setCargandoMas, setVista])
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
