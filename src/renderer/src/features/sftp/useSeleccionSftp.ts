// =============================================================================
// La selección de la carpeta que se ve en el explorador SFTP: se guarda con la carpeta a la que
// pertenece, así que al entrar en otra empieza vacía, y al refrescar la misma se queda con lo que
// sigue existiendo. Las reglas de cómo cambia son de `seleccionSftp` (puro). Sin dependencias de IPC.
// =============================================================================

import { useCallback, useMemo, useState } from 'react'
import { podarSeleccion, SELECCION_VACIA, type SeleccionSftp } from './seleccionSftp'
import type { ListadoSftp } from './useSesionSftp'

export interface VistaSeleccionSftp {
  seleccion: SeleccionSftp
  /** Los nombres de las filas, en el orden en que se ven. */
  orden: string[]
  /** Los nombres elegidos, en ese mismo orden. */
  elegidos: string[]
  /** Cambia la selección con una de las reglas puras. */
  cambiar: (f: (s: SeleccionSftp, orden: readonly string[]) => SeleccionSftp) => void
}

export function useSeleccionSftp(listado: ListadoSftp | null): VistaSeleccionSftp {
  const [guardada, setGuardada] = useState<{ ruta: string; sel: SeleccionSftp }>({ ruta: '', sel: SELECCION_VACIA })
  const ruta = listado?.ruta ?? ''
  const orden = useMemo(() => listado?.entradas.map((e) => e.nombre) ?? [], [listado])
  const seleccion = useMemo(
    () => (guardada.ruta === ruta ? podarSeleccion(guardada.sel, orden) : SELECCION_VACIA),
    [guardada, ruta, orden]
  )
  const elegidos = useMemo(() => orden.filter((n) => seleccion.nombres.has(n)), [orden, seleccion])
  const cambiar = useCallback(
    (f: (s: SeleccionSftp, o: readonly string[]) => SeleccionSftp) =>
      setGuardada((g) => ({ ruta, sel: f(g.ruta === ruta ? podarSeleccion(g.sel, orden) : SELECCION_VACIA, orden) })),
    [ruta, orden]
  )
  return { seleccion, orden, elegidos, cambiar }
}
