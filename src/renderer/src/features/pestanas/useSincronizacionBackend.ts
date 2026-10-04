// =============================================================================
// useSincronizacionBackend: re-apunta el backend al proyecto activo por DOS ejes y
// solo entonces publica el objetivo confirmado en el store (`fijarConfirmado`).
// Ejes: git (`workspace.setActiveProject`, el repo activo) y archivos
// (`workspace.setFilesRoot`, la contenedora). Lo llama `useTabs` (useTabs.ts).
// Decisiones: docs/decisiones/renderer/objetivo-de-git-derivado.md
// =============================================================================

import { useEffect, useRef } from 'react'
import type { OpenProject } from './tabsModel'
import { fijarConfirmado, useStorePestanas, type ConfirmedTarget } from './store'
import type { DetectedRepo } from '../../../../shared/workspace-ipc'
import { cerrarTramo } from '../../util/diagnosticoRendimiento'

/** Fija el objetivo confirmado; si se está midiendo, ahí acaba el cambio de perfil. */
function confirmar(target: ConfirmedTarget): void {
  fijarConfirmado(target)
  cerrarTramo('perfil:cambio')
}

/**
 * Sincroniza el backend con el proyecto y repo activos y devuelve el objetivo
 * confirmado (null sin proyecto activo). El confirmado solo aparece cuando los
 * re-apuntados pendientes ya resolvieron, así el explorador, git y la terminal
 * no leen nunca contra un backend a medio re-apuntar.
 */
export function useSincronizacionBackend(
  activeProfileId: string | null,
  filesRootPath: string | null,
  gitTargetPath: string | null,
  globalActiveProject: OpenProject | null,
  globalActiveRepo: DetectedRepo | null
): ConfirmedTarget | null {
  const confirmedTarget = useStorePestanas((s) => s.confirmado)
  const lastFilesRoot = useRef<string | null>(null)
  const lastGitTarget = useRef<string | null>(null)
  useEffect(() => {
    if (
      activeProfileId === null ||
      globalActiveProject === null ||
      filesRootPath === null ||
      gitTargetPath === null
    ) {
      // Sin proyecto activo: se olvidan los últimos sincronizados (reabrir el mismo
      // path debe volver a dispararse) y se oculta el objetivo a los hijos.
      lastFilesRoot.current = null
      lastGitTarget.current = null
      fijarConfirmado(null)
      return
    }
    const target: ConfirmedTarget = {
      profileId: activeProfileId,
      project: globalActiveProject,
      repo: globalActiveRepo
    }
    // Dedupe por eje: cambiar SOLO el repo no re-ancla el explorador; cambiar SOLO de
    // pestaña con el mismo repo activo no re-apunta git. Se marca ANTES del await.
    const filesNeedsSync = filesRootPath !== lastFilesRoot.current
    const gitNeedsSync = gitTargetPath !== lastGitTarget.current
    if (!filesNeedsSync && !gitNeedsSync) {
      // Nada pendiente: se confirma directo (con un solo repo cuyo repoHostPath ===
      // projectHostPath, el escaneo solo cambia `repo` sin mover ningún path).
      confirmar(target)
      return
    }
    if (filesNeedsSync) lastFilesRoot.current = filesRootPath
    if (gitNeedsSync) lastGitTarget.current = gitTargetPath
    let cancelled = false
    const jobs: Promise<unknown>[] = []
    if (filesNeedsSync) {
      jobs.push(
        window.tessera.workspace.setFilesRoot(filesRootPath).catch((err) => {
          console.error('[tabs] setFilesRoot falló para', filesRootPath, err)
        })
      )
    }
    if (gitNeedsSync) {
      jobs.push(
        window.tessera.workspace.setActiveProject(gitTargetPath).catch((err) => {
          console.error('[tabs] setActiveProject falló para', gitTargetPath, err)
        })
      )
    }
    // Se confirma SOLO tras resolver los re-apuntados: candado de orden backend-vs-render.
    void Promise.all(jobs).then(() => {
      if (!cancelled) confirmar(target)
    })
    return () => {
      cancelled = true
    }
  }, [activeProfileId, filesRootPath, gitTargetPath, globalActiveProject, globalActiveRepo])

  return confirmedTarget
}
