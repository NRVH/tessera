// =============================================================================
// Lo que el usuario dejó en el Git·Log de cada repo: los filtros que se aplican aquí (autor y fecha)
// y las carpetas y grupos de ramas cerrados a mano. Al volver a un repo, el log se ve como se dejó.
// La rama no: la resuelve el backend y volver con ella exigiría recargar antes de pintar. Efímero.
// Puro: lo prueba `test-vista-log-por-repo.mts`. Decisiones: docs/decisiones/git/log-filtros-y-grafo.md
// =============================================================================
import type { PresetFecha } from './filtrosLog.ts'

/** Lo recordado de un repo. */
export interface VistaLogRepo {
  autor: string | null
  fecha: PresetFecha
  /** Carpetas de ramas cerradas a mano (se guarda lo CERRADO: una rama nueva sale a la vista). */
  cerradas: ReadonlySet<string>
  gruposCerrados: ReadonlySet<string>
}

export type VistaLogPorRepo = Readonly<Record<string, VistaLogRepo>>

/** La de un repo que nunca se tocó. */
export const VISTA_LOG_INICIAL: VistaLogRepo = { autor: null, fecha: 'cualquiera', cerradas: new Set(), gruposCerrados: new Set() }

/** Lo recordado del repo `repo`; la inicial sin repo o sin entrada. */
export function vistaLogDe(mapa: VistaLogPorRepo, repo: string | null): VistaLogRepo {
  return (repo === null ? undefined : mapa[repo]) ?? VISTA_LOG_INICIAL
}

/** `mapa` con lo de `repo` cambiado; el MISMO objeto si no cambia nada. */
export function conVistaLog(
  mapa: VistaLogPorRepo,
  repo: string,
  cambio: (actual: VistaLogRepo) => Partial<VistaLogRepo>
): VistaLogPorRepo {
  const actual = vistaLogDe(mapa, repo)
  const siguiente = { ...actual, ...cambio(actual) }
  const igual =
    siguiente.autor === actual.autor &&
    siguiente.fecha === actual.fecha &&
    siguiente.cerradas === actual.cerradas &&
    siguiente.gruposCerrados === actual.gruposCerrados
  return igual ? mapa : { ...mapa, [repo]: siguiente }
}

/** Abre o cierra `id` en un conjunto de cerrados: un conjunto NUEVO. */
export function alternarCerrado(cerrados: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const siguiente = new Set(cerrados)
  if (siguiente.has(id)) siguiente.delete(id)
  else siguiente.add(id)
  return siguiente
}
