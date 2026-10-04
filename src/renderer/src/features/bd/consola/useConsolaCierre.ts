// =============================================================================
// Cerrar una consola SQL: «¿Detener y cerrar?» -> conflicto -> transacción pendiente
// -> cancelar lecturas en vuelo -> cerrar la sesión -> vaciar el texto -> borrar el
// archivo si está vacía. Si el main rechaza por `ocupada`, la pestaña NO se cierra
// (`cierreFallidoRetiene`). Pieza de `useConsola`; se registra en `registroConsolas`.
// Decisiones: docs/decisiones/bd/ui-consola-lote-stop-y-cierre.md
// =============================================================================

import { useCallback, useEffect, useRef } from 'react'
import type { DbResolverTx, DbRespuesta } from '../../../../../shared/db-explorador-ipc'
import { registrarConsola } from '../registroConsolas'
import { ejecutando as hayEjecucion } from './estadoConsola'
import { textoError } from './salidaConsola'
import type { RefsConsola } from './tiposConsola'
import type { DialogosConsola, PreguntaConsola } from './useConsolaDialogos'
import type { NucleoConsola } from './useConsolaNucleo'
import { cancelarEnVuelo } from './useConsolaStop'
import { respuestaDeError } from '../documentos/consolaComun'
import { ESPERA_STOP_MS, cierreFallidoRetiene, hayTxQueResolver } from './vivoConsola'
import { vaciaEnDisco } from './archivoConsola'

type Piezas = Pick<NucleoConsola, 'r' | 'api' | 'perfilId' | 'consolaId' | 'salida'>

const CONTEXTO_CIERRE = 'Para cerrar la consola hay que confirmarla o revertirla antes.'

function esperarFinEjecucion(r: RefsConsola, maxMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const hasta = Date.now() + maxMs
    const mirar = (): void => {
      if (!r.ejecucionRef.current || Date.now() >= hasta) resolve()
      else setTimeout(mirar, 100)
    }
    mirar()
  })
}

function preguntaDetener(nombre: string): PreguntaConsola {
  return {
    titulo: '¿Detener y cerrar?',
    mensaje: `${nombre} está ejecutando. Se detendrá lo que corre y se cerrará la pestaña.`,
    confirmar: 'Detener y cerrar',
    peligro: true
  }
}

/** Con un conflicto, si acepta se queda la del disco (no se escribe). */
function preguntaConflicto(nombre: string): PreguntaConsola {
  return {
    titulo: 'El archivo cambió fuera de Tessera',
    mensaje: `${nombre} tiene cambios sin guardar y el archivo cambió fuera de Tessera. Si la cierras, se queda la versión del disco y se pierden tus cambios.`,
    confirmar: 'Cerrar sin guardar',
    peligro: true
  }
}

function cerrarEnMain(p: Piezas, resolver: DbResolverTx | undefined): Promise<DbRespuesta<void>> {
  return p.api.cerrarSesionConsola(p.perfilId, p.consolaId, resolver).catch((err: unknown) => respuestaDeError<void>(err))
}

/** El main sabe de una transacción que aquí no se vio (el evento no llegó aún). */
function faltaResolver(cierre: DbRespuesta<void>, resolver: DbResolverTx | undefined): boolean {
  return !cierre.ok && cierre.error.motivo === 'txPendiente' && !resolver
}

/** Un cierre fallido se cuenta en la Salida; true = la pestaña se queda (`cierreFallidoRetiene`). */
function cierreRetiene(p: Piezas, cierre: DbRespuesta<void>, resolver: DbResolverTx | undefined): boolean {
  if (cierre.ok) return false
  p.salida('error', `No se pudo cerrar la sesión: ${textoError(cierre.error)}`)
  return cierreFallidoRetiene(cierre.error.motivo, resolver !== undefined)
}

// Todos los `await` del cierre viven en esta función: repartirlos en funciones `async`
// intermedias metía turnos de microtarea entre los pasos que el cierre no tenía.
async function solicitarCierreDe(
  p: Piezas,
  d: Pick<DialogosConsola, 'pedirConfirmacion' | 'pedirResolucionTx'>,
  detener: () => void,
  vaciar: () => Promise<void>
): Promise<boolean> {
  const { r } = p
  if (r.dialogoRef.current) return false
  const nombre = r.consolaRef.current.nombre
  if (hayEjecucion(r.estadoRef.current)) {
    if (!(await d.pedirConfirmacion(preguntaDetener(nombre)))) return false
    detener()
    // Tanto como el Stop: rendirse antes pedía cerrar una sesión aún `ocupada`.
    await esperarFinEjecucion(r, ESPERA_STOP_MS)
  }
  if (r.conflictoRef.current && !(await d.pedirConfirmacion(preguntaConflicto(nombre)))) return false
  let resolver: DbResolverTx | undefined
  if (hayTxQueResolver(r.estadoRef.current.sesion)) {
    const res = await d.pedirResolucionTx(r.estadoRef.current.sesion, CONTEXTO_CIERRE)
    if (!res) return false
    resolver = res
  }
  // El cierre se encola DETRÁS de «más» y «Contar»: se cancelan antes.
  cancelarEnVuelo(p, null)
  let cierre = await cerrarEnMain(p, resolver)
  if (faltaResolver(cierre, resolver)) {
    const res = await d.pedirResolucionTx(r.estadoRef.current.sesion, CONTEXTO_CIERRE)
    if (!res) return false
    resolver = res
    cierre = await cerrarEnMain(p, res)
  }
  if (cierreRetiene(p, cierre, resolver)) return false
  await vaciar()
  if (vaciaEnDisco(r)) {
    r.borradaRef.current = true
    await p.api.borrarConsola(p.perfilId, p.consolaId).catch(() => undefined)
  }
  return true
}

/** Registra la consola para que cerrar pestaña y salir de la app pregunten y vacíen. */
export function useCierreConsola(
  n: NucleoConsola,
  paneKey: string,
  dialogos: DialogosConsola,
  detener: () => void,
  vaciar: () => Promise<void>
): void {
  const { r, api, perfilId, consolaId, salida } = n
  const { pedirConfirmacion, pedirResolucionTx } = dialogos
  const solicitarCierre = useCallback(
    (): Promise<boolean> =>
      solicitarCierreDe({ r, api, perfilId, consolaId, salida }, { pedirConfirmacion, pedirResolucionTx }, detener, vaciar),
    [api, perfilId, consolaId, pedirConfirmacion, pedirResolucionTx, detener, salida, vaciar, r]
  )
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
