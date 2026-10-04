// =============================================================================
// ■ y «Forzar» de la consola SQL. ■ cancela por su `ejecucionId` la sentencia que
// corre (lo encolado ya no se envía) y por sus `peticionId` guardados las páginas de
// «más», los «Contar» y los «Traer todas». Sin respuesta a tiempo, «Forzar» confirma
// LISTANDO las transacciones que se pierden. Pieza de `useConsola`.
// Decisiones: docs/decisiones/bd/ui-consola-lote-stop-y-cierre.md
// =============================================================================

import { useCallback } from 'react'
import type { DbEstadoSesion } from '../../../../../shared/db-explorador-ipc'
import { descriptorSql } from '../../../../../shared/motores/index'
import { ejecutando as hayEjecucion } from './estadoConsola'
import type { EjecucionEnCurso } from './tiposConsola'
import type { DialogosConsola } from './useConsolaDialogos'
import { pintarMarcas } from './useConsolaLote'
import type { NucleoConsola } from './useConsolaNucleo'
import { mensajeDe } from '../documentos/consolaComun'
import { alcanceForzar, avisoStopSinRespuesta, cancelacionesDetener, mensajeForzar, txEnRiesgo } from './vivoConsola'

type Piezas = Pick<NucleoConsola, 'r' | 'api' | 'perfilId' | 'consolaId' | 'despachar'>

/** Cancela en el main las páginas de «más» y los «Contar» en vuelo (y la sentencia, si se da). */
export function cancelarEnVuelo(p: Omit<Piezas, 'despachar'>, ejecucionId: string | null): void {
  const { r } = p
  const cancelaciones = cancelacionesDetener({
    perfilId: p.perfilId,
    consolaId: p.consolaId,
    conexionId: r.conexionRef.current.id,
    ejecucionId,
    masEnVuelo: r.masEnVueloRef.current.values(),
    conteosEnVuelo: r.conteosEnVueloRef.current.values()
  })
  for (const c of cancelaciones) p.api.cancelar(c).catch(() => undefined)
}

/** Si la sentencia no para a tiempo, la Salida ofrece «Forzar» (en SQLite, enseguida). */
function programarForzar(p: Piezas, ej: EjecucionEnCurso): void {
  const { r } = p
  if (r.stopRef.current !== null) clearTimeout(r.stopRef.current)
  const aviso = avisoStopSinRespuesta(alcanceForzar(descriptorSql(r.conexionRef.current.motor).sesion.procesoPorSesion))
  r.stopRef.current = setTimeout(() => {
    r.stopRef.current = null
    const sigue = r.ejecucionRef.current
    if (!sigue || sigue.ejecucionId !== ej.ejecucionId) return
    p.despachar({
      tipo: 'salida',
      entrada: { tipo: 'aviso', texto: aviso.texto, accion: { tipo: 'forzar', etiqueta: aviso.etiqueta } },
      ahora: Date.now()
    })
  }, aviso.esperaMs)
}

function detenerTodo(p: Piezas): void {
  const { r } = p
  const l = r.estadoRef.current.lote
  const hayLote = l !== null && hayEjecucion(r.estadoRef.current)
  if (hayLote) {
    p.despachar({ tipo: 'detener', loteId: l.id, ahora: Date.now() })
    pintarMarcas(r)
  }
  const ej = hayLote ? r.ejecucionRef.current : null
  // Entre dos páginas de «Traer todas» no hay nada que cancelar: la marca para el bucle.
  for (const c of r.trayendoRef.current.values()) c.detenido = true
  // «Más» y «Contar» se cancelan haya lote o no: ocupan la misma sesión.
  cancelarEnVuelo(p, ej ? ej.ejecucionId : null)
  // «Forzar» es solo para la sentencia: una página o un conteo no justifican matar el proceso.
  if (!ej) return
  programarForzar(p, ej)
}

async function forzarCierre(
  p: Pick<NucleoConsola, 'r' | 'api' | 'perfilId' | 'consolaId' | 'salida'>,
  pedirConfirmacion: DialogosConsola['pedirConfirmacion']
): Promise<void> {
  const { r, api, perfilId, consolaId } = p
  const c = r.conexionRef.current
  const [sesiones, lista] = await Promise.all([
    api.sesiones().catch((): DbEstadoSesion[] => []),
    api.listarConsolas(perfilId).catch(() => null)
  ])
  const nombres = new Map<string, string>([[consolaId, r.consolaRef.current.nombre]])
  if (lista && lista.ok) for (const x of lista.valor) nombres.set(x.id, x.nombre)
  // Con un proceso por consola, Forzar cierra solo la sesión de ESTA consola.
  const alcance = alcanceForzar(descriptorSql(c.motor).sesion.procesoPorSesion)
  const soloConsola = alcance === 'consola' ? { perfilId, consolaId } : undefined
  const ok = await pedirConfirmacion({
    titulo: alcance === 'consola' ? 'Forzar el cierre de la sesión' : 'Forzar el cierre de la conexión',
    mensaje: mensajeForzar(c.alias, txEnRiesgo(sesiones, c.id, nombres, soloConsola), alcance),
    confirmar: 'Forzar el cierre',
    peligro: true
  })
  if (!ok) return
  try {
    await api.forzar(c.id, soloConsola)
  } catch (err) {
    p.salida('error', `No se pudo forzar el cierre: ${mensajeDe(err)}`)
  }
}

/** ■ y «Forzar». */
export function useStopConsola(n: NucleoConsola, pedirConfirmacion: DialogosConsola['pedirConfirmacion']) {
  const { r, api, perfilId, consolaId, despachar, salida } = n
  const detener = useCallback(
    (): void => detenerTodo({ r, api, perfilId, consolaId, despachar }),
    [api, perfilId, consolaId, despachar, r]
  )
  const forzar = useCallback(
    (): Promise<void> => forzarCierre({ r, api, perfilId, consolaId, salida }, pedirConfirmacion),
    [api, perfilId, consolaId, pedirConfirmacion, salida, r]
  )
  return { detener, forzar }
}
