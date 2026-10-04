// =============================================================================
// useCoalescedCallback: devuelve una versión colapsada de un callback; varias invocaciones dentro
// de una ráfaga se funden en UNA sola, que corre `ms` después de la ÚLTIMA. Para reacciones caras
// a eventos de alta frecuencia (el watcher de FS): el estado en disco se re-consulta al disparar,
// así que colapsar no pierde información. Solo para eventos EXTERNOS: las acciones del propio
// usuario (commit, stage, guardar) refrescan al instante, sin pasar por este hook.
// =============================================================================

import { useCallback, useEffect, useRef } from 'react'

export function useCoalescedCallback(fn: () => void, ms: number): () => void {
  const fnRef = useRef(fn)
  fnRef.current = fn
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    []
  )

  return useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      fnRef.current()
    }, ms)
  }, [ms])
}
