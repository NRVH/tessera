// =============================================================================
// useEscaneoRepos: detecta los repos del proyecto ACTIVO (workspace.escanearRepos) y los
// guarda en el modelo de pestañas (`setScannedRepos`). Escanea al activarse el
// proyecto y de nuevo, coalescido, con el watcher de FS y con el foco de la ventana.
// Lo llama `usePestanas` (usePestanas.ts).
// =============================================================================

import { useCallback, useEffect, useRef } from 'react'
import { seleccionarRutaActivaGlobal } from './modeloPestanas'
import { despacharPestanas as dispatch, leerPestanas } from './store'
import { useCallbackColapsado } from '../../util/useCallbackColapsado'
import { necesitaReescaneo } from '../../../../shared/reescaneoRepos'

/** Ventana (ms) que funde una ráfaga de eventos del watcher en UN escaneo. */
const AGRUPACION_REESCANEO_MS = 400

/**
 * Escanea el proyecto activo al cambiar de perfil o de proyecto y re-escanea con el
 * watcher y el foco. Devuelve `reescanearProyectoActivo`, que lanza un escaneo y devuelve
 * su cancelador (el botón «Recargar» de git lo suelta).
 */
export function useEscaneoRepos(
  perfilActivoId: string | null,
  rutaActivaGlobal: string | null
): () => () => void {
  /** Generación del escaneo de repos: solo la última en salir puede aplicar. */
  const genEscaneo = useRef(0)

  const reescanearProyectoActivo = useCallback((): (() => void) => {
    const perfilId = leerPestanas().perfilActivoId
    const rutaHostProyecto = seleccionarRutaActivaGlobal(leerPestanas())
    if (perfilId === null || rutaHostProyecto === null) return () => {}
    let cancelado = false
    // Solo el escaneo MÁS RECIENTE puede escribir: dos escaneos del mismo proyecto
    // pueden estar en vuelo a la vez, y uno lento que aterrice después del rápido
    // resucitaría un repo ya borrado.
    const mia = ++genEscaneo.current
    window.tessera.workspace
      .escanearRepos(rutaHostProyecto)
      .then((res) => {
        if (cancelado || mia !== genEscaneo.current) return
        dispatch({ tipo: 'setScannedRepos', perfilId, rutaHostProyecto, repos: res.repos })
      })
      .catch((err) => {
        if (cancelado || mia !== genEscaneo.current) return
        console.error('[tabs] escanearRepos falló para', rutaHostProyecto, err)
      })
    return () => {
      cancelado = true
    }
  }, [])

  useEffect(() => {
    if (perfilActivoId === null || rutaActivaGlobal === null) return
    return reescanearProyectoActivo()
    // El escaneo no depende de si faltaba: si dependiera, su propio dispatch lo re-dispararía.
  }, [perfilActivoId, rutaActivaGlobal, reescanearProyectoActivo])

  // Re-escaneo reactivo: clonar, borrar o mover una carpeta cambia la lista de repos.
  // `files:changed` se filtra por payload (`necesitaReescaneo`); `files:gitChanged`
  // (aparece o desaparece un `.git`) no. El foco cubre un watcher que no vea el cambio.
  const programarReescaneo = useCallbackColapsado(() => void reescanearProyectoActivo(), AGRUPACION_REESCANEO_MS)
  useEffect(
    () =>
      window.tessera.files.alCambiar((ev) => {
        if (necesitaReescaneo(ev)) programarReescaneo()
      }),
    [programarReescaneo]
  )
  useEffect(() => window.tessera.files.alCambiarGit(programarReescaneo), [programarReescaneo])
  useEffect(() => {
    window.addEventListener('focus', programarReescaneo)
    return () => window.removeEventListener('focus', programarReescaneo)
  }, [programarReescaneo])

  return reescanearProyectoActivo
}
