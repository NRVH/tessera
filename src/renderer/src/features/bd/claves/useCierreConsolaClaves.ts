// =============================================================================
// El cierre de la consola de Redis, que pide la carcasa aunque la pestaña esté oculta:
// «¿Detener y cerrar?» si corre algo, aviso si el archivo cambió fuera, cerrar la sesión de
// la consola (su conexión propia y su MULTI) y vaciar el texto pendiente. Solo se borra el
// archivo si se sabe vacío EN DISCO (con un conflicto, el disco es del agente). Se registra
// en `registroConsolas`.
// Decisiones: docs/decisiones/bd/ui-claves-consola.md
// =============================================================================

import { useCallback, useEffect, useRef } from 'react'
import { registrarConsola } from '../registroConsolas'
import { vaciaEnDisco } from '../consola/archivoConsola'
import { confirmarCierre, preguntasDeCierre } from '../documentos/cierreConsola'
import type { EstadoConsolaClaves } from './useEstadoConsolaClaves'

/** Registra en la carcasa el cierre y el vaciado de esta consola. */
export function useCierreConsolaClaves(
  e: EstadoConsolaClaves,
  paneKey: string,
  detener: () => void,
  vaciar: () => Promise<void>
): void {
  const { api, perfilId, consolaId, pedirConfirmacion, dialogoRef, consolaRef, enCursoRef, conflictoRef } = e
  const { modeloRef, cargadoRef, borradaRef } = e
  const solicitarCierre = useCallback(async (): Promise<boolean> => {
    if (dialogoRef.current) return false
    const preguntar = preguntasDeCierre({ enCursoRef, conflictoRef }).length > 0
    if (preguntar && !(await confirmarCierre({ pedirConfirmacion, dialogoRef, consolaRef, enCursoRef, conflictoRef }, detener))) {
      return false
    }
    await api.cerrarSesionConsola(perfilId, consolaId).catch(() => undefined)
    await vaciar()
    if (vaciaEnDisco({ modeloRef, cargadoRef, conflictoRef })) {
      borradaRef.current = true
      await api.borrarConsola(perfilId, consolaId).catch(() => undefined)
    }
    return true
  }, [
    api, perfilId, consolaId, pedirConfirmacion, detener, vaciar, dialogoRef, consolaRef, enCursoRef, conflictoRef,
    modeloRef, cargadoRef, borradaRef
  ])

  const cierreRef = useRef({ solicitarCierre, vaciar })
  cierreRef.current = { solicitarCierre, vaciar }
  useEffect(
    () =>
      registrarConsola(paneKey, {
        solicitarCierre: () => cierreRef.current.solicitarCierre(),
        vaciar: () => cierreRef.current.vaciar()
      }),
    [paneKey]
  )
}
