// =============================================================================
// useAreaCierre: cerrar pestañas del área de BD. Una consola o una pestaña que edita
// pregunta antes a su pane, y un «Cancelar» para el gesto entero; Mod+W solo actúa
// con el foco dentro del área. Lo llama `DbArea`.
// Decisiones: docs/decisiones/bd/ui-area-pestanas-y-panes.md
// =============================================================================

import { useCallback, useRef } from 'react'
import { clavePaneBd } from './modeloPestanasBd'
import { solicitarCierreConsola } from './registroConsolas'
import { solicitarCierreDatos } from './rejilla/registroEdicion'
import type { DbVistaApi } from './useDbVista'
import { esCerrarPestana } from '../../util/atajos'

/** Lo que el área usa para cerrar: la acción y el manejador de teclado del área. */
interface AreaCierre {
  cerrar: (pid: string, ids: readonly string[]) => Promise<void>
  alPulsarTecla: (e: React.KeyboardEvent<HTMLDivElement>) => void
}

/** Cierre de pestañas del área (ver la cabecera). */
export function useAreaCierre(
  vista: DbVistaApi,
  perfilId: string | null,
  pestanaActivaId: string | null,
  onConsolasCambiaron: (perfilId: string) => void
): AreaCierre {
  // La vista se lee por ref: el cierre espera diálogos, y al volver lo que valga es
  // el estado de AHORA, no el del clic.
  const vistaRef = useRef(vista)
  vistaRef.current = vista
  /** paneKeys con un cierre en curso: un doble clic en el aspa no pregunta dos veces. */
  const cerrando = useRef(new Set<string>())
  const cerrar = useCallback(
    async (pid: string, ids: readonly string[]): Promise<void> => {
      const confirmadas: string[] = []
      let consolaTocada = false
      for (const id of ids) {
        const pestana = vistaRef.current.vistaDe(pid).pestanas.pestanas.find((t) => t.id === id)
        if (!pestana) continue
        if (pestana.pane.tipoPane === 'consola' || pestana.pane.tipoPane === 'datos' || pestana.pane.tipoPane === 'coleccion') {
          const pk = clavePaneBd(pid, id)
          if (cerrando.current.has(pk)) continue
          cerrando.current.add(pk)
          let ok = false
          try {
            ok = await (pestana.pane.tipoPane === 'consola' ? solicitarCierreConsola(pk) : solicitarCierreDatos(pk))
          } finally {
            cerrando.current.delete(pk)
          }
          // Cancelar para el gesto entero: "Cerrar todas" no sigue cerrando detrás
          // de un diálogo al que acabas de decir que no.
          if (!ok) break
          if (pestana.pane.tipoPane === 'consola') consolaTocada = true
        }
        confirmadas.push(id)
      }
      if (confirmadas.length > 0) vistaRef.current.cerrar(pid, confirmadas)
      if (consolaTocada) onConsolasCambiaron(pid)
    },
    [onConsolasCambiaron]
  )

  const alPulsarTecla = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (perfilId === null || !esCerrarPestana(e)) return
    // Un diálogo montado dentro del área (renombrar, la transacción pendiente de una
    // consola) también burbujea hasta aquí: React propaga por el árbol de
    // componentes, no por el DOM. Con un modal delante, el teclado es suyo.
    if (e.target instanceof Element && e.target.closest('.modal-overlay, [aria-modal="true"]')) return
    // Se consume también la autorrepetición: si siguiera, llegaría al navegador.
    e.preventDefault()
    e.stopPropagation()
    if (e.repeat || pestanaActivaId === null) return
    void cerrar(perfilId, [pestanaActivaId])
  }
  return { cerrar, alPulsarTecla }
}
