// =============================================================================
// El archivo de la consola SQL sobre el protocolo común (`useArchivoConsola`): sus avisos van
// a la Salida, «ejecutando» es el lote, y el validador de avisos corre al cargar, al teclear
// y cuando cambia el solo lectura de la conexión. Pieza de `useConsola`.
// Decisiones: docs/decisiones/bd/ui-consola-motor.md
// =============================================================================

import { useCallback, useEffect } from 'react'
import { ejecutando as hayEjecucion } from './estadoConsola'
import type { NucleoConsola } from './useConsolaNucleo'
import { useArchivoConsola, type ArchivoConsolaHook } from './useArchivoConsola'

/** Guardado, relecturas por visibilidad y foco, y las dos salidas de un conflicto. */
export function useDiscoConsola(n: NucleoConsola, visible: boolean): ArchivoConsolaHook {
  const { r, api, perfilId, consolaId, salida, cambiarConflicto, setCargado, setErrorCarga, modelo, soloLectura } = n
  const avisar = useCallback((texto: string): void => salida('error', texto), [salida])
  const ejecutando = useCallback((): boolean => hayEjecucion(r.estadoRef.current), [r])
  const alCargar = useCallback((): void => r.validadorRef.current?.ahora(), [r])
  const alEditar = useCallback((): void => r.validadorRef.current?.programar(), [r])
  const archivo = useArchivoConsola({
    refs: r, api, perfilId, consolaId, modelo, visible, cambiarConflicto, setCargado, setErrorCarga,
    avisar, ejecutando, alCargar, alEditar
  })
  // Solo lectura cambió (se editó la conexión): los avisos se recalculan.
  useEffect(() => {
    r.validadorRef.current?.programar()
  }, [soloLectura, r])
  return archivo
}
