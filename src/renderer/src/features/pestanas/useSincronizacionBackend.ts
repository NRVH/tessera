// =============================================================================
// useSincronizacionBackend: re-apunta el backend al proyecto activo por DOS ejes y
// solo entonces publica el objetivo confirmado en el store (`fijarConfirmado`).
// Ejes: git (`workspace.setActiveProject`, el repo activo) y archivos
// (`workspace.fijarRaizArchivos`, la contenedora). Lo llama `usePestanas` (usePestanas.ts).
// Decisiones: docs/decisiones/renderer/objetivo-de-git-derivado.md
// =============================================================================

import { useLayoutEffect, useRef } from 'react'
import type { ProyectoAbiertoDePerfil } from './modeloPestanas'
import { fijarConfirmado, useStorePestanas, type ObjetivoConfirmado } from './store'
import type { RepoDetectado } from '../../../../shared/workspace-ipc'
import { cerrarTramo } from '../../util/diagnosticoRendimiento'

/** Fija el objetivo confirmado; si se está midiendo, ahí acaba el cambio de perfil. */
function confirmar(objetivo: ObjetivoConfirmado): void {
  fijarConfirmado(objetivo)
  cerrarTramo('perfil:cambio')
}

/**
 * Sincroniza el backend con el proyecto y repo activos y devuelve el objetivo
 * confirmado (null sin proyecto activo). El confirmado solo aparece cuando los
 * re-apuntados pendientes ya resolvieron, así el explorador y git no leen nunca
 * contra un backend a medio re-apuntar.
 */
export function useSincronizacionBackend(
  perfilActivoId: string | null,
  rutaRaizArchivos: string | null,
  rutaObjetivoGit: string | null,
  proyectoActivoGlobal: ProyectoAbiertoDePerfil | null,
  repoActivoGlobal: RepoDetectado | null
): ObjetivoConfirmado | null {
  const objetivoConfirmado = useStorePestanas((s) => s.confirmado)
  const ultimaRaizArchivos = useRef<string | null>(null)
  const ultimoObjetivoGit = useRef<string | null>(null)
  // De LAYOUT: corre antes que los efectos de los hijos, así `fijarRaizArchivos` llega al main antes que
  // la primera petición del proyecto nuevo, y el main ya lo conoce (`ServicioArchivos.paraRaiz`,
  // `ServicioGit.paraRaiz`): ni los archivos ni git esperan al confirmado.
  useLayoutEffect(() => {
    if (
      perfilActivoId === null ||
      proyectoActivoGlobal === null ||
      rutaRaizArchivos === null ||
      rutaObjetivoGit === null
    ) {
      // Sin proyecto activo: se olvidan los últimos sincronizados (reabrir el mismo
      // path debe volver a dispararse) y se oculta el objetivo a los hijos.
      ultimaRaizArchivos.current = null
      ultimoObjetivoGit.current = null
      fijarConfirmado(null)
      return
    }
    const objetivo: ObjetivoConfirmado = {
      perfilId: perfilActivoId,
      proyecto: proyectoActivoGlobal,
      repo: repoActivoGlobal
    }
    // Dedupe por eje: cambiar SOLO el repo no re-ancla el explorador; cambiar SOLO de
    // pestaña con el mismo repo activo no re-apunta git. Se marca ANTES del await.
    const archivosPorSincronizar = rutaRaizArchivos !== ultimaRaizArchivos.current
    const gitPorSincronizar = rutaObjetivoGit !== ultimoObjetivoGit.current
    if (!archivosPorSincronizar && !gitPorSincronizar) {
      // Nada pendiente: se confirma directo (con un solo repo cuyo repoHostPath ===
      // projectHostPath, el escaneo solo cambia `repo` sin mover ningún path).
      confirmar(objetivo)
      return
    }
    if (archivosPorSincronizar) ultimaRaizArchivos.current = rutaRaizArchivos
    if (gitPorSincronizar) ultimoObjetivoGit.current = rutaObjetivoGit
    let cancelado = false
    const tareas: Promise<unknown>[] = []
    if (archivosPorSincronizar) {
      tareas.push(
        window.tessera.workspace.fijarRaizArchivos(rutaRaizArchivos).catch((err) => {
          console.error('[tabs] fijarRaizArchivos falló para', rutaRaizArchivos, err)
        })
      )
    }
    if (gitPorSincronizar) {
      tareas.push(
        window.tessera.workspace.setActiveProject(rutaObjetivoGit).catch((err) => {
          console.error('[tabs] setActiveProject falló para', rutaObjetivoGit, err)
        })
      )
    }
    // Se confirma SOLO tras resolver los re-apuntados: candado de orden backend-vs-render.
    void Promise.all(tareas).then(() => {
      if (!cancelado) confirmar(objetivo)
    })
    return () => {
      cancelado = true
    }
  }, [perfilActivoId, rutaRaizArchivos, rutaObjetivoGit, proyectoActivoGlobal, repoActivoGlobal])

  return objetivoConfirmado
}
