// =============================================================================
// usePersistenciaTabs: carga inicial de perfiles y sesión restaurada (`init`) y
// guardado a disco, con debounce, de la lista de perfiles y del esqueleto del
// workspace. Lo llama `useTabs` (useTabs.ts); el estado vive en el store de pestañas.
// Decisiones: docs/decisiones/renderer/persistencia-de-pestanas.md
// =============================================================================

import { useEffect, useRef } from 'react'
import type { TabsState } from './tabsModel'
import { restoredSessionFromState, serializeWorkspace } from './workspaceSnapshot'
import { iniciarPestanas, marcarPestanasCargadas } from './store'

/**
 * Carga los perfiles y la sesión persistida al montar y despacha UN solo `init`. Si
 * `loadState` falla o no hay archivo, el arranque es limpio; un fallo suyo nunca
 * impide cargar los perfiles.
 */
export function useCargaInicialTabs(): void {
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const profiles = await window.tessera.getProfiles()
        const persisted = await window.tessera.workspace.loadState().catch((err) => {
          console.error('[tabs] loadState (workspace) falló; arranque limpio:', err)
          return null
        })
        if (!cancelled) iniciarPestanas(profiles, restoredSessionFromState(persisted))
      } catch (err) {
        console.error('[tabs] getProfiles falló:', err)
        // Sin esto, lo que espera a las pestañas (las aperturas del sistema) esperaría para siempre.
        if (!cancelled) marcarPestanasCargadas()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
}

/**
 * Guarda a disco cada cambio de la lista de perfiles (debounce 250 ms) y del
 * esqueleto del workspace (debounce 150 ms, deduplicado por proyección). Los dos
 * temporizadores solo se cancelan al desmontar.
 */
export function usePersistenciaTabs(state: TabsState): void {
  const persistedRef = useRef(false)
  const profilesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    // Lista vacía antes de `init` = «aún no se leyó el disco»: nada que guardar.
    // Vacía DESPUÉS = «se borró el último perfil»: eso sí se persiste.
    if (!persistedRef.current) {
      if (state.profiles.length === 0) return
      persistedRef.current = true
      return // la carga inicial no se reescribe: es justo lo que `init` acaba de leer
    }
    const profilesSnapshot = state.profiles
    if (profilesTimerRef.current !== null) clearTimeout(profilesTimerRef.current)
    profilesTimerRef.current = setTimeout(() => {
      profilesTimerRef.current = null
      window.tessera.saveProfiles(profilesSnapshot).catch((err) => {
        console.error('[tabs] saveProfiles falló:', err)
      })
    }, 250)
  }, [state.profiles])

  // El temporizador vive en un ref y no en la limpieza del efecto: ver el ADR.
  const lastSavedWorkspaceRef = useRef<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    // Sin perfiles y sin nada guardado aún = antes de `init`: no hay nada que persistir.
    if (
      state.activeProfileId === null &&
      state.profiles.length === 0 &&
      lastSavedWorkspaceRef.current === null
    ) {
      return
    }
    const json = JSON.stringify(serializeWorkspace(state))
    if (json === lastSavedWorkspaceRef.current) return // proyección sin cambios: no-op
    const isFirst = lastSavedWorkspaceRef.current === null
    lastSavedWorkspaceRef.current = json
    if (isFirst) return // snapshot post-init: el disco ya lo tiene (o arranque limpio)
    const snapshot = serializeWorkspace(state)
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      window.tessera.workspace.saveState(snapshot).catch((err) => {
        console.error('[tabs] saveState (workspace) falló:', err)
      })
    }, 150)
    // `serializeWorkspace` lee solo `byProfile` y `activeProfileId`: depender de `state`
    // entero reejecutaría este efecto (y su JSON.stringify) en cada cambio de estado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.byProfile, state.activeProfileId, state.profiles])

  // Lo pendiente se cancela SOLO al desmontar (deps vacías), no en cada re-ejecución.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
      if (profilesTimerRef.current !== null) clearTimeout(profilesTimerRef.current)
    }
  }, [])
}
