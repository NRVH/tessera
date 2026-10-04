// =============================================================================
// useMarcasCambios: las casillas marcadas de la vista de Cambios, con clave
// `${seccion} ${ruta}`, y su poda al refrescarse la lista. Vive en el padre de
// todos los repos para sobrevivir al colapso de una sección y permitir lotes que
// crucen repos. Ver docs/decisiones/git/cambios-lista-y-marcas.md.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import type { RepoStatus } from '../../../../shared/git-ipc'
import { clavesMarcables, podarMarcas } from './modelo/seccionesCambios'

/** Las claves marcadas y la función que marca o desmarca un grupo de ellas. */
export function useMarcasCambios(repoStatuses: RepoStatus[] | null): {
  marcadas: ReadonlySet<string>
  alternarMarcas: (claves: readonly string[], marcar: boolean) => void
} {
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(() => new Set())

  // PODA, no borrado: se quitan las claves que ya no existen y se conserva el resto.
  useEffect(() => {
    if (repoStatuses === null) return
    const validas = clavesMarcables(repoStatuses)
    setMarcadas((prev) => podarMarcas(prev, validas))
  }, [repoStatuses])

  const alternarMarcas = useCallback((claves: readonly string[], marcar: boolean): void => {
    if (claves.length === 0) return
    setMarcadas((prev) => {
      const siguiente = new Set(prev)
      for (const clave of claves) {
        if (marcar) siguiente.add(clave)
        else siguiente.delete(clave)
      }
      return siguiente
    })
  }, [])

  return { marcadas, alternarMarcas }
}
