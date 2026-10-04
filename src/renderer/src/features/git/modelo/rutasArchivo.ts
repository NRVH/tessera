// =============================================================================
// rutasArchivo: helpers PUROS de presentación de rutas POSIX, compartidos por las
// dos superficies de git: nombre, carpeta y etiqueta de cada repo. Una fila enseña
// el nombre y no la ruta, que vive en el tooltip.
// Puro: solo `import type`, para probarlo con `node` a secas.
// Decisiones: docs/decisiones/git/cambios-arbol-de-archivos.md
// =============================================================================

import type { DetectedRepo } from '../../../../../shared/workspace-ipc'

/** Nombre + extensión de una ruta POSIX (la ruta entera si no tiene barras). */
export function nameOf(p: string): string {
  return p.split('/').pop() || p
}

/** Carpeta contenedora de una ruta POSIX ('' si está en la raíz). */
export function dirOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

/**
 * Etiqueta de cada repo para el selector: su `name`, numerado («server (1)», «server (2)»)
 * cuando varios lo comparten, porque `repoHostPath` no se enseña nunca.
 */
export function computeRepoLabels(repos: readonly DetectedRepo[]): Map<string, string> {
  const countByName = new Map<string, number>()
  for (const repo of repos) countByName.set(repo.name, (countByName.get(repo.name) ?? 0) + 1)

  const seenByName = new Map<string, number>()
  const labels = new Map<string, string>()
  for (const repo of repos) {
    if ((countByName.get(repo.name) ?? 0) <= 1) {
      labels.set(repo.repoHostPath, repo.name)
      continue
    }
    const n = (seenByName.get(repo.name) ?? 0) + 1
    seenByName.set(repo.name, n)
    labels.set(repo.repoHostPath, `${repo.name} (${n})`)
  }
  return labels
}
