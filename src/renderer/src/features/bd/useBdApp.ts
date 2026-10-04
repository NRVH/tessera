// =============================================================================
// Vista de bases de datos en la ventana: su estado (que sobrevive al desmontar el
// lateral), las listas de conexiones, consolas y sesiones de los perfiles que
// interesan, la consola nueva «en contexto» y las respuestas al cierre de la app.
// =============================================================================
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { DbConnection } from '../../../../shared/db-ipc'
import { notify, notifyError } from '../../comun/notifications'
import { anclaDelFoco } from '../../comun/anclaDelFoco'
import { conexionDeClave } from './arbolBd'
import { pestanaActiva } from './dbTabsModel'
import { vivasParaPodarPestanas } from './dbMounts'
import { TITULO_FORMATO_AJENO, motivoSinConsola } from './filasArbolBd'
import { vaciarTodasLasConsolas } from './registroConsolas'
import { pestanasSinEnviar } from './rejilla/registroEdicion'
import { olvidarPeticionesArbol, pedirAltaConexion, useStoreBd } from './store'
import { useDbVista, type DbVistaApi } from './useDbVista'
import { useConexionesBd, type ConexionesBd } from './useConexionesBd'
import { useConsolasBd, type ConsolasBd } from './useConsolasBd'
import { useSesionesBd } from './useSesionesBd'
import type { MontajesBd } from './useMontajesBd'
import type { UseTabs } from '../pestanas'

/** Estado y acciones de la vista de bases de datos. */
export interface BdApp {
  perfilActivoId: string | null
  vistaDb: DbVistaApi
  conexionesBd: ConexionesBd
  consolasBd: ConsolasBd
  sesionesBd: ReturnType<typeof useSesionesBd>
  crearConsolaEn: (perfilId: string, conexionId: string, textoInicial?: string) => Promise<void>
  /** Mod+N en la vista: la conexión seleccionada, la de la pestaña activa o la única. */
  nuevaConsolaEnContexto: () => void
  alEliminarConexion: (conexionId: string, perfilId: string) => void
}

/** Crea una consola en una conexión y la abre; el texto inicial se escribe antes de abrir. */
function useCrearConsola(consolasBd: ConsolasBd, vistaDb: DbVistaApi): BdApp['crearConsolaEn'] {
  const { anadir: anadirConsolaBd } = consolasBd
  const { abrir: abrirPestanaBd } = vistaDb
  return useCallback(
    async (perfilId: string, conexionId: string, textoInicial?: string): Promise<void> => {
      try {
        const r = await window.tessera.dbExplorador.crearConsola(perfilId, conexionId)
        if (!r.ok) {
          notifyError('No se pudo crear la consola', r.error.mensaje)
          return
        }
        if (textoInicial !== undefined && textoInicial !== '') {
          const w = await window.tessera.dbExplorador.escribirConsola(perfilId, r.valor.id, textoInicial)
          if (!w.ok) notifyError('No se pudo escribir el texto inicial de la consola', w.error.mensaje)
        }
        // Primero la lista y luego la pestaña: el pane necesita su info para montarse.
        anadirConsolaBd(perfilId, r.valor)
        abrirPestanaBd(perfilId, { kind: 'consola', conexionId, consolaId: r.valor.id })
      } catch (err) {
        notifyError('No se pudo crear la consola', err)
      }
    },
    [anadirConsolaBd, abrirPestanaBd]
  )
}

/** Conexión para una consola nueva: la seleccionada, la de la pestaña activa o la única. */
function conexionElegida(v: ReturnType<DbVistaApi['vistaDe']>, conexiones: readonly DbConnection[]): string | null {
  const existe = (id: string | null): id is string => id !== null && conexiones.some((c) => c.id === id)
  const deSeleccion = v.seleccion !== null ? conexionDeClave(v.seleccion) : null
  const deActiva = pestanaActiva(v.pestanas)?.pane.conexionId ?? null
  const unica = conexiones.length === 1 ? conexiones[0].id : null
  return existe(deSeleccion) ? deSeleccion : existe(deActiva) ? deActiva : unica
}

/** Sin conexión obvia: alta si no hay ninguna, si no el menú para elegir (o el motivo de que no se pueda). */
function resolverSinElegida(perfilId: string, conexiones: readonly DbConnection[], aviso: string | undefined): void {
  if (conexiones.length === 0) {
    // Con un registro de formato ajeno el alta la rechazaría el main: se dice por qué.
    if (aviso !== undefined) notify('warn', TITULO_FORMATO_AJENO, aviso)
    else pedirAltaConexion()
    return
  }
  const sinConsola = conexiones.every((c) => motivoSinConsola(c) !== null) ? motivoSinConsola(conexiones[0]) : null
  if (sinConsola !== null) {
    notify('info', 'Nueva consola', sinConsola)
    return
  }
  useStoreBd.setState({ menuConexiones: { ...anclaDelFoco(), perfilId } })
}

/** Elige la conexión de una consola nueva en contexto; sin ninguna obvia, menú o alta. */
function useConsolaEnContexto(
  tabs: UseTabs,
  conexionesBd: ConexionesBd,
  vistaDb: DbVistaApi,
  crearConsolaEn: BdApp['crearConsolaEn']
): () => void {
  const perfilActivoRef = useRef(tabs.activeProfile)
  perfilActivoRef.current = tabs.activeProfile
  return useCallback(() => {
    const perfil = perfilActivoRef.current
    if (!perfil) return
    // Sin la lista aún no se sabe si hay que elegir o dar de alta.
    if (conexionesBd.cargando(perfil.id)) return
    const conexiones = conexionesBd.porPerfil.get(perfil.id) ?? []
    const elegida = conexionElegida(vistaDb.vistaDe(perfil.id), conexiones)
    if (elegida === null) {
      resolverSinElegida(perfil.id, conexiones, conexionesBd.avisoFormatoPorPerfil.get(perfil.id))
      return
    }
    const sinConsola = motivoSinConsola(conexiones.find((c) => c.id === elegida))
    if (sinConsola !== null) notify('info', 'Nueva consola', sinConsola)
    else void crearConsolaEn(perfil.id, elegida)
  }, [conexionesBd, vistaDb, crearConsolaEn])
}

/** Respuestas al cierre de la app: vaciar consolas y listar cambios sin enviar (siempre montado). */
function useCierreBd(): void {
  useEffect(
    () =>
      window.tessera.dbExplorador.onVaciarConsolas(() => {
        void vaciarTodasLasConsolas().finally(() => window.tessera.dbExplorador.consolasVaciadas())
      }),
    []
  )
  useEffect(
    () =>
      window.tessera.dbExplorador.onPedirSinEnviar((id) => {
        window.tessera.dbExplorador.responderSinEnviar({ id, pestanas: pestanasSinEnviar() })
      }),
    []
  )
}

/** Vista de bases de datos: estado, listas y acciones. */
export function useBdApp(tabs: UseTabs, enConexiones: boolean, montajes: MontajesBd): BdApp {
  const vistaDb = useDbVista(tabs.profiles.map((p) => p.id).join(','))
  const { podarConexion: podarConexionBd, podarConexiones: podarConexionesBd, podarConsolas: podarConsolasBd } = vistaDb
  const perfilActivoId = tabs.activeProfile?.id ?? null
  const perfilesInteresBd = useMemo(
    () => (perfilActivoId !== null ? [perfilActivoId, ...vistaDb.perfilesConPestanas] : [...vistaDb.perfilesConPestanas]),
    [perfilActivoId, vistaDb.perfilesConPestanas]
  )
  const conexionesBd = useConexionesBd(perfilesInteresBd)
  // Tras cada listado bueno, fuera las pestañas de consolas que ya no existen.
  const consolasBd = useConsolasBd(perfilesInteresBd, podarConsolasBd)
  const { recargar: recargarConsolasBd } = consolasBd
  const sesionesBd = useSesionesBd()
  const { porPerfil, ajenasPorPerfil, avisoFormatoPorPerfil } = conexionesBd
  // Las ajenas cuentan como vivas y un perfil de formato ajeno no se poda.
  useEffect(() => {
    if (porPerfil.size === 0) return
    podarConexionesBd(vivasParaPodarPestanas(porPerfil, ajenasPorPerfil, avisoFormatoPorPerfil))
  }, [porPerfil, ajenasPorPerfil, avisoFormatoPorPerfil, podarConexionesBd])
  // Al salir de la vista se olvidan las peticiones al árbol.
  useEffect(() => {
    if (enConexiones) return
    olvidarPeticionesArbol()
  }, [enConexiones])
  const crearConsolaEn = useCrearConsola(consolasBd, vistaDb)
  const nuevaConsolaEnContexto = useConsolaEnContexto(tabs, conexionesBd, vistaDb, crearConsolaEn)
  const { olvidarConexionMontada } = montajes
  const alEliminarConexion = useCallback(
    (conexionId: string, perfilId: string) => {
      olvidarConexionMontada(conexionId, perfilId)
      podarConexionBd(conexionId, perfilId)
      recargarConsolasBd(perfilId)
    },
    [olvidarConexionMontada, podarConexionBd, recargarConsolasBd]
  )
  useCierreBd()
  return {
    perfilActivoId,
    vistaDb,
    conexionesBd,
    consolasBd,
    sesionesBd,
    crearConsolaEn,
    nuevaConsolaEnContexto,
    alEliminarConexion
  }
}
