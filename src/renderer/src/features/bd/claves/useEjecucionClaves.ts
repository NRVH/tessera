// =============================================================================
// Ejecutar y detener en la consola de Redis. El texto se parte en comandos (`consolaClaves.ts`,
// uno por línea) y cada uno viaja TAL CUAL al main, uno por petición, en orden y parando en el
// primer error. Ante `peligroso` o `produccion` se pregunta POR comando y se reenvía con la
// marca que corresponda. Stop cancela por el `peticionId` del comando y, pasado
// `ESPERA_DETENER_MS` sin respuesta, el registro ofrece «Forzar». Solo callbacks: ningún efecto.
// Decisiones: docs/decisiones/bd/ui-claves-consola.md
// =============================================================================

import { useCallback } from 'react'
import type { editor } from 'monaco-editor'
import type { DbErrorSql, DbRespuesta } from '../../../../../shared/db-explorador-ipc'
import type { DbKvResultado } from '../../../../../shared/db-claves-ipc'
import { confirmacionLoteProduccion, esProduccion } from '../consola/produccionConsola'
import { textoDetenerSinRespuesta, type AccionSalida, type IrAPosicion } from '../consola/salidaConsola'
import { ESPERA_DETENER_MS } from '../consola/vivoConsola'
import { respuestaDeError } from '../documentos/consolaComun'
import { modoDelCursor } from '../documentos/useEditorConsola'
import {
  comandosAEjecutar,
  confirmacionPeligroso,
  verboComando,
  type ComandoConsola,
  type ModoEjecucionClaves
} from './consolaClaves'
import type { Confirmaciones, EstadoConsolaClaves } from './useEstadoConsolaClaves'
import { cancelarDesde, ejecutarComando, type DepsLote } from './loteClaves'
import { txConsolaClaves } from './textosConsolaClaves'

type Enviar = (c: ComandoConsola, peticionId: string, conf: Confirmaciones) => Promise<DbRespuesta<DbKvResultado>>
type ConfirmarRechazo = (c: ComandoConsola, error: DbErrorSql, conf: Confirmaciones) => Promise<boolean | null>

/** Un comando al main, con su `peticionId` (el que para Stop) y lo ya confirmado. */
function useEnviar(e: EstadoConsolaClaves): Enviar {
  const { claves, perfilId, consolaId, conexionRef, baseRef } = e
  return useCallback(
    async (c, peticionId, conf) => {
      try {
        return await claves.ejecutarConsola({
          perfilId,
          consolaId,
          conexionId: conexionRef.current.id,
          base: baseRef.current,
          texto: c.texto,
          desplazamiento: c.desde,
          ...(conf.confirmado ? { confirmado: true } : {}),
          ...(conf.confirmadoPeligroso ? { confirmadoPeligroso: true } : {}),
          peticionId
        })
      } catch (err) {
        return respuestaDeError<DbKvResultado>(err)
      }
    },
    [claves, perfilId, consolaId, conexionRef, baseRef]
  )
}

/**
 * Pregunta lo que el main devolvió sin enviar ('peligroso', 'produccion'). true = el
 * usuario aceptó y `conf` ya lleva la marca; false = no quiso; null = no era eso.
 */
function useConfirmarRechazo(e: EstadoConsolaClaves): ConfirmarRechazo {
  const { pedirConfirmacion, conexionRef, baseRef } = e
  return useCallback(
    async (c, error, conf) => {
      const con = conexionRef.current
      const verbo = verboComando(c.texto)
      if (error.motivo === 'peligroso' && !conf.confirmadoPeligroso) {
        const t = confirmacionPeligroso({
          verbo,
          alias: con.alias,
          base: baseRef.current,
          mensaje: error.mensaje,
          produccion: esProduccion(con.entorno)
        })
        const ok = await pedirConfirmacion({ ...t, peligro: true, severidad: 'peligro' })
        if (ok) conf.confirmadoPeligroso = true
        return ok
      }
      if (error.motivo === 'produccion' && !conf.confirmado) {
        // La MISMA confirmación que las otras consolas; el main es la 2.ª barrera.
        const t = confirmacionLoteProduccion({ alias: con.alias, total: 1, escrituras: [{ indice: 0, verbo: verbo || txConsolaClaves().escritura }] })
        const ok = await pedirConfirmacion({ ...t, peligro: true, severidad: 'advertencia' })
        if (ok) conf.confirmado = true
        return ok
      }
      return null
    },
    [pedirConfirmacion, conexionRef, baseRef]
  )
}

function useCorrer(e: EstadoConsolaClaves, enviar: Enviar, confirmarRechazo: ConfirmarRechazo): (m: ModoEjecucionClaves) => Promise<void> {
  const { actualizarRegistro, anotar, cambiarEnCurso, cambiarBase, baseRef, desmontadoRef, detenidoRef } = e
  const { modeloRef, marcasRef, cargadoRef, enCursoRef, dialogoRef, siguienteIdRef, esperaDetenerRef } = e
  const { setPista, setConError, setLoteMarcado } = e
  return useCallback(
    async (modo: ModoEjecucionClaves): Promise<void> => {
      const m = modeloRef.current
      const marcas = marcasRef.current
      if (!m || m.isDisposed() || !marcas || !cargadoRef.current || enCursoRef.current || dialogoRef.current) return
      const comandos = comandosAEjecutar(m.getValue(), modo)
      if (comandos.length === 0) {
        setPista(txConsolaClaves().pistaSinComando)
        return
      }
      setPista(null)
      setConError(false)
      detenidoRef.current = false
      const lote = { marcas, comandos, id: siguienteIdRef.current++ }
      marcas.iniciar(comandos.map((c) => ({ desde: c.desde, hasta: c.hasta })))
      setLoteMarcado(lote.id)
      const deps: DepsLote = { actualizarRegistro, anotar, enviar, confirmarRechazo, cambiarEnCurso, cambiarBase, baseRef, desmontadoRef }
      let fallo = false
      for (let i = 0; i < comandos.length; i++) {
        if (detenidoRef.current || desmontadoRef.current) {
          cancelarDesde(lote, i)
          break
        }
        const paso = await ejecutarComando(deps, lote, i)
        if (paso === 'salir') return
        if (paso === 'fallo') fallo = true
        if (paso !== 'sigue') break
      }
      if (esperaDetenerRef.current !== null) clearTimeout(esperaDetenerRef.current)
      esperaDetenerRef.current = null
      cambiarEnCurso(null)
      setConError(fallo)
    },
    [
      actualizarRegistro, anotar, enviar, confirmarRechazo, cambiarEnCurso, cambiarBase, baseRef, desmontadoRef, detenidoRef,
      modeloRef, marcasRef, cargadoRef, enCursoRef, dialogoRef, siguienteIdRef, esperaDetenerRef, setPista, setConError, setLoteMarcado
    ]
  )
}

function useModoDelEditor(editorMonacoRef: React.RefObject<editor.IStandaloneCodeEditor>, e: EstadoConsolaClaves): () => ModoEjecucionClaves | null {
  const { modeloRef } = e
  return useCallback((): ModoEjecucionClaves | null => {
    const editorMonaco = editorMonacoRef.current
    const m = modeloRef.current
    if (!editorMonaco || !m || m.isDisposed()) return null
    return modoDelCursor(editorMonaco, m)
  }, [editorMonacoRef, modeloRef])
}

function useDetener(e: EstadoConsolaClaves): () => void {
  const { api, perfilId, consolaId, anotar, enCursoRef, detenidoRef, esperaDetenerRef } = e
  return useCallback((): void => {
    const en = enCursoRef.current
    if (!en) return
    detenidoRef.current = true
    api.cancelar({ rol: 'consola', perfilId, consolaId, ejecucionId: en.peticionId }).catch(() => undefined)
    if (esperaDetenerRef.current !== null) clearTimeout(esperaDetenerRef.current)
    esperaDetenerRef.current = setTimeout(() => {
      esperaDetenerRef.current = null
      // Sigue la MISMA petición: el trabajador no soltó el comando.
      if (enCursoRef.current && enCursoRef.current.peticionId === en.peticionId) {
        // Etiqueta de «Forzar» en Redis: no hay transacción de consola que revertir (un MULTI abierto se pierde).
        anotar({ tono: 'aviso', texto: textoDetenerSinRespuesta(), accion: { tipo: 'forzar', etiqueta: txConsolaClaves().forzarEtiqueta } })
      }
    }, ESPERA_DETENER_MS)
  }, [api, perfilId, consolaId, anotar, enCursoRef, detenidoRef, esperaDetenerRef])
}

function useAccionRegistro(e: EstadoConsolaClaves): (a: AccionSalida) => Promise<void> {
  const { api, pedirConfirmacion, conexionRef } = e
  return useCallback(
    async (a: AccionSalida): Promise<void> => {
      if (a.tipo !== 'forzar') return
      const c = conexionRef.current
      const t = txConsolaClaves()
      const ok = await pedirConfirmacion({
        titulo: t.forzarTitulo,
        mensaje: t.forzarMensaje(c.alias),
        confirmar: t.forzar,
        peligro: true,
        severidad: 'advertencia'
      })
      if (ok) await api.forzar(c.id).catch(() => undefined)
    },
    [api, pedirConfirmacion, conexionRef]
  )
}

function useIrA(e: EstadoConsolaClaves, editorMonacoRef: React.RefObject<editor.IStandaloneCodeEditor>): (ir: IrAPosicion) => void {
  const { marcasRef, loteMarcado } = e
  return useCallback(
    (ir: IrAPosicion): void => {
      const editorMonaco = editorMonacoRef.current
      const marcas = marcasRef.current
      if (!editorMonaco || !marcas || ir.loteId !== loteMarcado) return
      const r = marcas.rangoVivo(ir.sentencia)
      if (!r) return
      const pos = marcas.posicion(Math.min(r.hasta, r.desde + ir.desplazamiento))
      if (!pos) return
      editorMonaco.setPosition(pos)
      editorMonaco.revealPositionInCenterIfOutsideViewport(pos)
      editorMonaco.focus()
    },
    [editorMonacoRef, marcasRef, loteMarcado]
  )
}

/** Todo lo que el pane necesita para ejecutar y detener. */
export function useEjecucionClaves(
  e: EstadoConsolaClaves,
  editorMonacoRef: React.RefObject<editor.IStandaloneCodeEditor>
): {
  ejecutar: () => void
  ejecutarTodo: () => void
  detener: () => void
  accionRegistro: (a: AccionSalida) => Promise<void>
  irA: (ir: IrAPosicion) => void
} {
  const enviar = useEnviar(e)
  const confirmarRechazo = useConfirmarRechazo(e)
  const correr = useCorrer(e, enviar, confirmarRechazo)
  const modoDelEditor = useModoDelEditor(editorMonacoRef, e)
  const ejecutar = useCallback((): void => {
    const modo = modoDelEditor()
    if (modo) void correr(modo)
  }, [modoDelEditor, correr])
  const ejecutarTodo = useCallback((): void => {
    void correr({ tipo: 'todo' })
  }, [correr])
  const detener = useDetener(e)
  const accionRegistro = useAccionRegistro(e)
  const irA = useIrA(e, editorMonacoRef)
  return { ejecutar, ejecutarTodo, detener, accionRegistro, irA }
}
