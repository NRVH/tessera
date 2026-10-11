// =============================================================================
// El cierre de la consola de MongoDB, que pide la carcasa aunque la pestaña esté oculta:
// «¿Detener y cerrar?» si corre algo, aviso si el archivo cambió fuera, cancelar lo en vuelo,
// cerrar la sesión y vaciar el texto pendiente. Solo se borra el archivo si se sabe vacío EN
// DISCO (con un conflicto, el disco es del agente). Se registra en `registroConsolas`.
// Decisiones: docs/decisiones/bd/ui-documentos-consola.md
// =============================================================================

import { useCallback, useEffect, useRef } from 'react'
import { registrarConsola } from '../registroConsolas'
import { vaciaEnDisco } from '../consola/archivoConsola'
import { confirmarCierre, preguntasDeCierre } from './cierreConsola'
import type { EstadoConsolaDocs } from './useEstadoConsolaDocs'
import { cerrarTodas } from '../resultados/pestanasResultado'

/** Registra en la carcasa el cierre y el vaciado de esta consola. */
export function useCierreConsolaDocs(
  e: EstadoConsolaDocs,
  paneKey: string,
  detener: () => void,
  vaciar: () => Promise<void>
): void {
  const { api, perfilId, consolaId, pedirConfirmacion, dialogoRef, consolaRef, enCursoRef, conflictoRef } = e
  const { masRef, cambiarResultados, modeloRef, cargadoRef, borradaRef } = e
  const solicitarCierre = useCallback(async (): Promise<boolean> => {
    if (dialogoRef.current) return false
    const preguntar = preguntasDeCierre({ enCursoRef, conflictoRef }).length > 0
    if (preguntar && !(await confirmarCierre({ pedirConfirmacion, dialogoRef, consolaRef, enCursoRef, conflictoRef }, detener))) {
      return false
    }
    const mas = masRef.current
    // El cursor de «Cargar más» vive en la sesión de la consola: se para por ella.
    if (mas) api.cancelar({ rol: 'consola', perfilId, consolaId, ejecucionId: mas }).catch(() => undefined)
    cambiarResultados(cerrarTodas)
    // La sesión de la consola en el gestor de documentos (sin transacción que resolver).
    await api.cerrarSesionConsola(perfilId, consolaId).catch(() => undefined)
    await vaciar()
    if (vaciaEnDisco({ modeloRef, cargadoRef, conflictoRef })) {
      borradaRef.current = true
      await api.borrarConsola(perfilId, consolaId).catch(() => undefined)
    }
    return true
  }, [
    api, perfilId, consolaId, pedirConfirmacion, detener, vaciar, dialogoRef, consolaRef, enCursoRef, conflictoRef,
    masRef, cambiarResultados, modeloRef, cargadoRef, borradaRef
  ])

  const registroRef = useRef({ solicitarCierre, vaciar })
  registroRef.current = { solicitarCierre, vaciar }
  useEffect(
    () =>
      registrarConsola(paneKey, {
        solicitarCierre: () => registroRef.current.solicitarCierre(),
        vaciar: () => registroRef.current.vaciar()
      }),
    [paneKey]
  )
}
