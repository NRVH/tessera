// =============================================================================
// useEscaneoRepos: detecta los repos del proyecto ACTIVO (workspace.scanRepos) y los
// guarda en el modelo de pestañas (`setScannedRepos`). Escanea al activarse el
// proyecto y de nuevo, coalescido, con el watcher de FS y con el foco de la ventana.
// Lo llama `useTabs` (useTabs.ts).
// =============================================================================

import { useCallback, useEffect, useRef } from 'react'
import { selectGlobalActivePath } from './tabsModel'
import { despacharTabs as dispatch, leerTabs } from './store'
import { useCoalescedCallback } from '../../util/useCoalescedCallback'
import { necesitaReescaneo } from '../../../../shared/rescanRepos'

/** Ventana (ms) que funde una ráfaga de eventos del watcher en UN escaneo. */
const RESCAN_COALESCE_MS = 400

/**
 * Escanea el proyecto activo al cambiar de perfil o de proyecto y re-escanea con el
 * watcher y el foco. Devuelve `rescanActiveProject`, que lanza un escaneo y devuelve
 * su cancelador (el botón «Recargar» de git lo suelta).
 */
export function useEscaneoRepos(
  activeProfileId: string | null,
  globalActivePath: string | null
): () => () => void {
  /** Generación del escaneo de repos: solo la última en salir puede aplicar. */
  const scanGen = useRef(0)

  const rescanActiveProject = useCallback((): (() => void) => {
    const profileId = leerTabs().activeProfileId
    const projectHostPath = selectGlobalActivePath(leerTabs())
    if (profileId === null || projectHostPath === null) return () => {}
    let cancelled = false
    // Solo el escaneo MÁS RECIENTE puede escribir: dos escaneos del mismo proyecto
    // pueden estar en vuelo a la vez, y uno lento que aterrice después del rápido
    // resucitaría un repo ya borrado.
    const mia = ++scanGen.current
    window.tessera.workspace
      .scanRepos(projectHostPath)
      .then((res) => {
        if (cancelled || mia !== scanGen.current) return
        dispatch({ type: 'setScannedRepos', profileId, projectHostPath, repos: res.repos })
      })
      .catch((err) => {
        if (cancelled || mia !== scanGen.current) return
        console.error('[tabs] scanRepos falló para', projectHostPath, err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (activeProfileId === null || globalActivePath === null) return
    return rescanActiveProject()
    // El escaneo no depende de si faltaba: si dependiera, su propio dispatch lo re-dispararía.
  }, [activeProfileId, globalActivePath, rescanActiveProject])

  // Re-escaneo reactivo: clonar, borrar o mover una carpeta cambia la lista de repos.
  // `files:changed` se filtra por payload (`necesitaReescaneo`); `files:gitChanged`
  // (aparece o desaparece un `.git`) no. El foco cubre un watcher que no vea el cambio.
  const scheduleRescan = useCoalescedCallback(() => void rescanActiveProject(), RESCAN_COALESCE_MS)
  useEffect(
    () =>
      window.tessera.files.onChanged((ev) => {
        if (necesitaReescaneo(ev)) scheduleRescan()
      }),
    [scheduleRescan]
  )
  useEffect(() => window.tessera.files.onGitChanged(scheduleRescan), [scheduleRescan])
  useEffect(() => {
    window.addEventListener('focus', scheduleRescan)
    return () => window.removeEventListener('focus', scheduleRescan)
  }, [scheduleRescan])

  return rescanActiveProject
}
