// =============================================================================
// Qué mira cada perfil: la vista lateral (archivos, git, bases de datos) y el panel
// de la franja inferior (terminal o Git·Log), derivados del perfil activo, y las
// acciones estables que los cambian. Poda los mapas por perfil al borrar perfiles.
// Depende de los stores de layout, bd, búsqueda y git.
// =============================================================================
import { useCallback, useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { esVistaLateral, type ActivityView, type PanelInferior } from './ActivityBar'
import { cambiarVistaSi, useStoreLayout } from './store'
import { useStorePestanas, type UseTabs } from '../pestanas'
import { useStoreBd } from '../bd'
import { useStoreBusqueda } from '../busqueda'
import { abrirHistorial, claveHistorial, useStoreGit } from '../git'
import { accionesSsh } from '../ssh'

/** Vista y franja del perfil activo, con sus acciones estables. */
export interface VistasPorPerfil {
  /** Id del perfil activo, o '' sin perfil (tiene su propia casilla en los mapas). */
  perfilUI: string
  activeView: ActivityView
  panelInferior: PanelInferior | null
  terminalVisible: boolean
  enConexiones: boolean
  setActiveView: (view: ActivityView) => void
  alternarPanelInferior: (cual: PanelInferior) => void
  abrirPanelInferior: (cual: PanelInferior) => void
  cerrarPanelInferior: () => void
  abrirHistorialArchivo: (path: string) => void
  /** Si el perfil a la vista está en bases de datos, lo devuelve a Archivos. */
  salirDeBd: () => void
}

function podarPorPerfil<V>(prev: Record<string, V>, vivos: Set<string>): Record<string, V> {
  const limpio = Object.fromEntries(Object.entries(prev).filter(([k]) => vivos.has(k)))
  return Object.keys(limpio).length === Object.keys(prev).length ? prev : limpio
}

/** Poda los mapas por perfil de los perfiles que ya no existen (nunca contra una lista vacía). */
function usePodaPorPerfil(tabs: UseTabs): void {
  const idsPerfiles = tabs.profiles.map((p) => p.id).join(',')
  useEffect(() => {
    // Sin perfiles no se poda: los mapas se hidratan antes de que llegue la lista.
    if (!idsPerfiles) return
    const vivos = new Set(idsPerfiles.split(','))
    useStoreLayout.setState((s) => ({
      vistaPorPerfil: podarPorPerfil(s.vistaPorPerfil, vivos),
      panelPorPerfil: podarPorPerfil(s.panelPorPerfil, vivos),
      columnaPorPerfil: podarPorPerfil(s.columnaPorPerfil, vivos)
    }))
    useStoreBd.setState((s) => ({ dbAgenteVisiblePorPerfil: podarPorPerfil(s.dbAgenteVisiblePorPerfil, vivos) }))
    useStoreBusqueda.setState((s) => ({ buscarQueryPorPerfil: podarPorPerfil(s.buscarQueryPorPerfil, vivos) }))
    useStoreGit.setState((s) => ({ busquedaLogPorPerfil: podarPorPerfil(s.busquedaLogPorPerfil, vivos) }))
    accionesSsh.podarPerfiles([...vivos])
  }, [idsPerfiles])
  // El historial de archivo es de un proyecto: se olvida al cerrarlo, o reabrirlo traería uno viejo.
  const abiertos = tabs.allOpenProjects.map((p) => `${p.profileId}|${p.projectHostPath}`).join('\u0000')
  const cargadas = useStorePestanas((s) => s.pestanasCargadas)
  useEffect(() => {
    if (!cargadas) return
    const vivos = new Set(abiertos ? abiertos.split('\u0000') : [])
    useStoreGit.setState((s) => {
      const historialPorProyecto = podarPorPerfil(s.historialPorProyecto, vivos)
      return historialPorProyecto === s.historialPorProyecto ? s : { historialPorProyecto }
    })
  }, [abiertos, cargadas])
}

/** Acciones estables sobre la vista y la franja; leen el perfil activo por ref. */
function useAccionesVista(perfilUIRef: { current: string }, proyectoRef: { current: string | null }): Omit<
  VistasPorPerfil,
  'perfilUI' | 'activeView' | 'panelInferior' | 'terminalVisible' | 'enConexiones'
> {
  const fijar = useStoreLayout.setState
  const setActiveView = useCallback(
    (view: ActivityView) => fijar((s) => ({ vistaPorPerfil: { ...s.vistaPorPerfil, [perfilUIRef.current]: view } })),
    [fijar, perfilUIRef]
  )
  const alternarPanelInferior = useCallback(
    (cual: PanelInferior) =>
      fijar((s) => {
        const k = perfilUIRef.current
        return { franjaLibre: true, panelPorPerfil: { ...s.panelPorPerfil, [k]: s.panelPorPerfil[k] === cual ? '' : cual } }
      }),
    [fijar, perfilUIRef]
  )
  // Lleva a Archivos y ABRE el panel sin alternar: desde bases de datos la franja no se ve.
  const abrirPanelInferior = useCallback(
    (cual: PanelInferior) =>
      fijar((s) => {
        const k = perfilUIRef.current
        return {
          franjaLibre: true,
          vistaPorPerfil: s.vistaPorPerfil[k] === 'files' ? s.vistaPorPerfil : { ...s.vistaPorPerfil, [k]: 'files' },
          panelPorPerfil: s.panelPorPerfil[k] === cual ? s.panelPorPerfil : { ...s.panelPorPerfil, [k]: cual }
        }
      }),
    [fijar, perfilUIRef]
  )
  const cerrarPanelInferior = useCallback(
    () => fijar((s) => ({ franjaLibre: true, panelPorPerfil: { ...s.panelPorPerfil, [perfilUIRef.current]: '' } })),
    [fijar, perfilUIRef]
  )
  // El historial vive dentro de la franja de git: pedirlo también la abre. Es del proyecto que se ve.
  const abrirHistorialArchivo = useCallback(
    (path: string) => {
      const proyecto = proyectoRef.current
      if (proyecto === null) return
      abrirHistorial(claveHistorial(perfilUIRef.current, proyecto), path)
      fijar((s) => ({ franjaLibre: true, panelPorPerfil: { ...s.panelPorPerfil, [perfilUIRef.current]: 'gitlog' } }))
    },
    [fijar, perfilUIRef, proyectoRef]
  )
  const salirDeBd = useCallback(() => cambiarVistaSi(perfilUIRef.current, 'db', 'files'), [perfilUIRef])
  return { setActiveView, alternarPanelInferior, abrirPanelInferior, cerrarPanelInferior, abrirHistorialArchivo, salirDeBd }
}

/** Vista lateral y franja inferior del perfil activo; poda y latch de restauración de Git·Log. */
export function useVistasPorPerfil(tabs: UseTabs): VistasPorPerfil {
  const perfilUI = tabs.activeProfile?.id ?? ''
  // Por ref y no por dependencia: las acciones las captura el listener global de teclado.
  const perfilUIRef = useRef(perfilUI)
  perfilUIRef.current = perfilUI
  const proyectoRef = useRef<string | null>(null)
  proyectoRef.current = tabs.objetivoVisto?.project.projectHostPath ?? null
  usePodaPorPerfil(tabs)
  const { vistaGuardada, panelGuardado, franjaLibre } = useStoreLayout(
    useShallow((s) => ({
      vistaGuardada: s.vistaPorPerfil[perfilUI],
      panelGuardado: (s.panelPorPerfil[perfilUI] || null) as PanelInferior | null,
      franjaLibre: s.franjaLibre
    }))
  )
  // Con guarda: lo recordado viene de un archivo y un id retirado pintaría el panel equivocado.
  const activeView: ActivityView = esVistaLateral(vistaGuardada) ? vistaGuardada : 'files'
  // Restaurar Git·Log espera a que haya un proyecto que mirar; la terminal se restaura en el acto.
  const hayProyecto = tabs.objetivoVisto !== null
  useEffect(() => {
    if (hayProyecto) useStoreLayout.setState({ franjaLibre: true })
  }, [hayProyecto])
  const panelInferior: PanelInferior | null = panelGuardado === 'gitlog' && !franjaLibre ? null : panelGuardado
  const acciones = useAccionesVista(perfilUIRef, proyectoRef)
  return {
    perfilUI,
    activeView,
    panelInferior,
    terminalVisible: panelInferior === 'terminal',
    enConexiones: activeView === 'db',
    ...acciones
  }
}
