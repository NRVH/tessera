// =============================================================================
// useExportarBd: exportar a archivo desde un dueño de rejilla (la pestaña de datos o un
// resultado de consola). Pide `EXPORTAR`, sigue el progreso de SU petición por el
// repartidor único de `exportarBd.ts`, ofrece Detener y avisa al final. Una exportación
// por dueño; al desmontar se cancela. Lo puro (ids, textos, repartidor), en `exportarBd.ts`.
// Decisiones: docs/decisiones/bd/ui-rejilla-modelo-exportar.md
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DbExportado,
  DbExportar,
  DbFormatoFilas,
  DbRespuesta
} from '../../../../../shared/db-explorador-ipc'
import { notify, notifyError } from '../../../comun/notifications'
import {
  avisoDetenida,
  avisoExportado,
  crearRepartidorProgreso,
  nuevoIdExportacion,
  type RepartidorProgreso
} from './exportarBd'

/**
 * El repartidor de la ventana, creado con la primera exportación: al importar el
 * módulo no se toca `window` (y el canal no tiene oyente hasta que alguien exporta).
 */
let repartidor: RepartidorProgreso | null = null
function progreso(): RepartidorProgreso {
  if (repartidor === null) {
    repartidor = crearRepartidorProgreso((cb) => window.tessera.dbExplorador.onExportacion(cb))
  }
  return repartidor
}

export interface ExportacionEnCurso {
  peticionId: string
  filas: number
  formato: DbFormatoFilas
}

export interface ExportadorBd {
  enCurso: ExportacionEnCurso | null
  /**
   * Abre el diálogo nativo, sigue el progreso (onExportacion) y avisa al final.
   *
   * `alternativa`: otra petición para cuando el main responde `noReleible` a la
   * primera. Es el caso de la consola: pide el origen `consulta` (vuelve a leer la
   * consulta entera), pero el main además exige que sea PURA (un `nextval` no se
   * repite), y entonces solo queda exportar lo cargado (`filas`). El main valida el
   * origen ANTES de abrir el diálogo, así que el usuario ve un solo diálogo.
   */
  exportar: (
    req: Omit<DbExportar, 'peticionId'>,
    alternativa?: Omit<DbExportar, 'peticionId'>
  ) => Promise<void>
  cancelar: () => void
}

/** El `unknown` de un invoke que lanzó (no debería: el contrato no lanza) como texto. */
function mensajeDe(err: unknown): string {
  if (err instanceof Error) return err.message
  return typeof err === 'string' && err ? err : 'Error inesperado al exportar'
}

export function useExportarBd(): ExportadorBd {
  const [enCurso, setEnCurso] = useState<ExportacionEnCurso | null>(null)
  /**
   * La exportación en marcha, se vea ya o no (el diálogo puede seguir abierto). Pasa a
   * `enCurso` con el primer progreso.
   */
  const actualRef = useRef<ExportacionEnCurso | null>(null)
  const vivoRef = useRef(true)

  useEffect(() => {
    vivoRef.current = true
    return () => {
      vivoRef.current = false
      const act = actualRef.current
      if (act) {
        void window.tessera.dbExplorador
          .cancelar({ rol: 'exportacion', peticionId: act.peticionId })
          .catch(() => undefined)
      }
    }
  }, [])

  const exportar = useCallback(
    async (
      primera: Omit<DbExportar, 'peticionId'>,
      alternativa?: Omit<DbExportar, 'peticionId'>
    ): Promise<void> => {
      if (actualRef.current) return
      const ctx: ContextoPeticion = { actualRef, vivoRef, setEnCurso }
      let r = await pedirExportacion(primera, ctx)
      if (!r.ok && r.error.motivo === 'noReleible' && alternativa && vivoRef.current) {
        r = await pedirExportacion(alternativa, ctx)
      }

      actualRef.current = null
      if (vivoRef.current) setEnCurso(null)
      avisarFinal(r, vivoRef.current)
    },
    []
  )

  const cancelar = useCallback((): void => {
    const act = actualRef.current
    if (!act) return
    void window.tessera.dbExplorador
      .cancelar({ rol: 'exportacion', peticionId: act.peticionId })
      .catch(() => undefined)
  }, [])

  return { enCurso, exportar, cancelar }
}

/** Los refs y el estado del hook que toca una petición de exportación. */
interface ContextoPeticion {
  actualRef: { current: ExportacionEnCurso | null }
  vivoRef: { current: boolean }
  setEnCurso: (e: ExportacionEnCurso | null) => void
}

/** Pide UNA exportación y sigue su progreso por su `peticionId` mientras dura el invoke. */
async function pedirExportacion(
  req: Omit<DbExportar, 'peticionId'>,
  ctx: ContextoPeticion
): Promise<DbRespuesta<DbExportado | null>> {
  const peticionId = nuevoIdExportacion()
  ctx.actualRef.current = { peticionId, filas: 0, formato: req.formato }
  // Antes del invoke: el main no avisa de nada hasta tenerlo.
  const dejar = progreso().escuchar(peticionId, (filas) => {
    const act = ctx.actualRef.current
    if (!act || act.peticionId !== peticionId) return
    const siguiente: ExportacionEnCurso = { ...act, filas }
    ctx.actualRef.current = siguiente
    if (ctx.vivoRef.current) ctx.setEnCurso(siguiente)
  })
  try {
    return await window.tessera.dbExplorador.exportar({
      ...req,
      peticionId
    })
  } catch (err) {
    return {
      ok: false,
      error: { motivo: 'interno', mensaje: mensajeDe(err) }
    }
  } finally {
    dejar()
  }
}

/** El aviso del final según cómo acabó; `vivo` = la pestaña que la lanzó sigue abierta. */
function avisarFinal(r: DbRespuesta<DbExportado | null>, vivo: boolean): void {
  if (!r.ok) {
    if (r.error.motivo === 'cancelada') {
      const a = avisoDetenida(!vivo)
      notify('info', a.titulo, a.detalle)
      return
    }
    const detalle = r.error.codigo ? `[${r.error.codigo}] ${r.error.mensaje}` : r.error.mensaje
    notifyError('No se pudo exportar', detalle)
    return
  }
  // El usuario canceló el diálogo de guardar: lo está viendo, no hay nada que decir.
  if (r.valor === null) return

  const hecho = r.valor
  const aviso = avisoExportado(hecho, window.tessera.plataforma)
  notify(aviso.tipo, aviso.titulo, aviso.detalle, {
    accion: {
      etiqueta: aviso.accion,
      onClick: () => {
        void window.tessera.dbExplorador
          .revelarExportacion(hecho.token)
          .catch((err: unknown) => notifyError('No se pudo mostrar el archivo', err))
      }
    }
  })
}
