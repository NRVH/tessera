// =============================================================================
// Hooks del botón de actualización de la barra de título: el `UpdateState` del main
// (también lo lee Configuración › Actualizaciones), el cierre del popover sin contenido
// y el descarte de la noticia al cerrarlo. El reloj y el cierre fuera/Escape son de
// `comun/`. El componente llama a sus efectos en el orden en que corren.
// Decisiones: docs/decisiones/renderer/actualizaciones-de-la-app.md
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import type { UpdateState } from '../../../../shared/update-ipc'
import { debeDescartarAlCerrar } from './vistaUpdate'

/** Estado del updater: el `getState()` inicial y cada difusión del main. */
export function useEstadoUpdate(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => {
    let cancelado = false
    // Si el handler no existe (modo captura, arranque raro), el update se trata como
    // desactivado en vez de reventar la barra superior entera.
    window.tessera.update
      .getState()
      .then((s) => {
        if (!cancelado) setState(s)
      })
      .catch(() => {
        if (!cancelado) setState(null)
      })
    const unsub = window.tessera.update.onState((s) => setState(s))
    return () => {
      cancelado = true
      unsub()
    }
  }, [])
  return state
}

/** Un popover sin nada que enseñar se cierra solo (ver `tieneContenido`). */
export function useCerrarSinContenido(hayContenido: boolean, setAbierto: (v: boolean) => void): void {
  useEffect(() => {
    if (!hayContenido) setAbierto(false)
  }, [hayContenido, setAbierto])
}

/**
 * Cerrar el popover con la noticia delante = haberla leído. Va en la LIMPIEZA de un efecto
 * que solo depende de `abierto`, así que corre una vez por transición abierto -> cerrado,
 * sea cual sea la salida. El estado se lee de una ref: si el efecto dependiera de `state`,
 * cada difusión del main con el popover abierto ejecutaría su limpieza y descartaría el
 * aviso delante del usuario.
 */
export function useDescartarAlCerrar(abierto: boolean, state: UpdateState | null): void {
  const stateRef = useRef<UpdateState | null>(null)
  useEffect(() => {
    stateRef.current = state
  }, [state])
  useEffect(() => {
    if (!abierto) return
    return () => {
      if (debeDescartarAlCerrar(stateRef.current)) void window.tessera.update.dismiss('aplicada')
    }
  }, [abierto])
}
