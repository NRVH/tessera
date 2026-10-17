// =============================================================================
// Los filtros del Git·Log del repo que se ve. Autor y fecha se aplican aquí y se recuerdan por repo
// en el store (`modelo/vistaLogPorRepo`): al volver a un repo están como se dejaron, en el mismo
// render, sin efecto que los copie. La rama la resuelve el backend y es local al panel: al cambiar
// de repo se olvida (`olvidarRama`), porque una rama de un repo no significa nada en otro.
// =============================================================================
import { useCallback, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { fijarVistaLog, useStoreGit } from './store'
import { vistaLogDe } from './modelo/vistaLogPorRepo'
import type { FiltrosLog } from './modelo/filtrosLog'

/** Los filtros vigentes y cómo cambiarlos. */
export interface FiltrosDelRepo {
  filtros: FiltrosLog
  setFiltros: (f: FiltrosLog) => void
  olvidarRama: () => void
}

/** Filtros del Git·Log de `repo`. */
export function useFiltrosDelRepo(repo: string | null): FiltrosDelRepo {
  const [rama, setRama] = useState<string | null>(null)
  const { autor, fecha } = useStoreGit(
    useShallow((s) => {
      const v = vistaLogDe(s.vistaLogPorRepo, repo)
      return { autor: v.autor, fecha: v.fecha }
    })
  )
  const filtros = useMemo<FiltrosLog>(() => ({ rama, autor, fecha }), [rama, autor, fecha])
  const setFiltros = useCallback(
    (f: FiltrosLog) => {
      setRama(f.rama)
      if (repo !== null) fijarVistaLog(repo, () => ({ autor: f.autor, fecha: f.fecha }))
    },
    [repo]
  )
  const olvidarRama = useCallback(() => setRama(null), [])
  return { filtros, setFiltros, olvidarRama }
}
