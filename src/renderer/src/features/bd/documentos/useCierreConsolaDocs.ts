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
import { cerrarLectorDeVista, type EstadoConsolaDocs } from './useEstadoConsolaDocs'

/** Registra en la carcasa el cierre y el vaciado de esta consola. */
export function useCierreConsolaDocs(
  e: EstadoConsolaDocs,
  paneKey: string,
  detener: () => void,
  vaciar: () => Promise<void>
): void {
  const { api, docs, perfilId, consolaId, pedirConfirmacion, dialogoRef, consolaRef, enCursoRef, conflictoRef } = e
  const { masRef, conexionRef, vistaRef, modeloRef, cargadoRef, borradaRef } = e
  const solicitarCierre = useCallback(async (): Promise<boolean> => {
    if (dialogoRef.current) return false
    const preguntar = preguntasDeCierre({ enCursoRef, conflictoRef }).length > 0
    if (preguntar && !(await confirmarCierre({ pedirConfirmacion, dialogoRef, consolaRef, enCursoRef, conflictoRef }, detener))) {
      return false
    }
    const mas = masRef.current
    if (mas) api.cancelar({ rol: 'datos', conexionId: conexionRef.current.id, peticionId: mas }).catch(() => undefined)
    cerrarLectorDeVista(docs, vistaRef.current)
    vistaRef.current = null
    // La sesión de la consola en el gestor de documentos (sin transacción que resolver).
    await api.cerrarSesionConsola(perfilId, consolaId).catch(() => undefined)
    await vaciar()
    if (vaciaEnDisco({ modeloRef, cargadoRef, conflictoRef })) {
      borradaRef.current = true
      await api.borrarConsola(perfilId, consolaId).catch(() => undefined)
    }
    return true
  }, [
    api, docs, perfilId, consolaId, pedirConfirmacion, detener, vaciar, dialogoRef, consolaRef, enCursoRef, conflictoRef,
    masRef, conexionRef, vistaRef, modeloRef, cargadoRef, borradaRef
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
