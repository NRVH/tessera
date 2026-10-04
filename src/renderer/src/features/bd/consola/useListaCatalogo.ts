// =============================================================================
// La lista de esquemas o de bases que pintan los popovers de la vista de BD, leída de la
// caché del catálogo (`cacheMetaBd`) y pedida si falta o caducó.
// Decisiones: docs/decisiones/bd/ui-consola-popovers.md
// =============================================================================

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type {
  DbBasesRespuesta,
  DbErrorSql,
  DbEsquema,
  DbEsquemasRespuesta
} from '../../../../../shared/db-explorador-ipc'
import { cacheMetaBd } from '../cacheMetaBd'
import type { FuentePopover } from '../nivelBasesBd'

/**
 * La lista de la caché con la forma que pintan los popovers: los esquemas tal cual, o
 * las bases (`DbBase` cabe en `DbEsquema`). null sin lista.
 */
function listaComoEsquemas(
  r: DbEsquemasRespuesta | DbBasesRespuesta | null
): { esquemas: DbEsquema[]; porDefecto: string } | null {
  if (!r) return null
  return { esquemas: 'bases' in r ? r.bases : r.esquemas, porDefecto: r.porDefecto }
}

/**
 * Lee de la caché del catálogo la lista de esquemas (de la conexión o de una `base`) o
 * de bases, y la pide si falta o caducó. Un ERROR no se reintenta solo: cada fallo
 * cambia la versión y se repetiría sin fin; el reintento es el botón.
 */
export function useListaCatalogo(
  conexionId: string,
  deBases: boolean,
  base: string | undefined,
  fuente: FuentePopover
): {
  cache: ReturnType<typeof cacheMetaBd>
  resp: ReturnType<typeof listaComoEsquemas>
  errorCarga: DbErrorSql | null
} {
  const cache = cacheMetaBd()
  const version = useSyncExternalStore(cache.suscribir, cache.version)
  // `version` cambia cuando la caché cambia: los datos se leen aquí dentro.
  const { crudo, errorCarga } = useMemo(() => {
    void version
    return {
      crudo: deBases ? cache.bases(conexionId) : cache.esquemas(conexionId, base),
      errorCarga: cache.error(fuente.clave)
    }
  }, [cache, version, conexionId, deBases, base, fuente.clave])
  // Con la identidad de lo que da la caché: un cambio ajeno no recoloca el cursor.
  const resp = useMemo(() => listaComoEsquemas(crudo), [crudo])

  useEffect(() => {
    void version
    const clave = fuente.clave
    if (cache.error(clave)) return
    const hay = deBases ? cache.bases(conexionId) : cache.esquemas(conexionId, base)
    if (hay && !cache.obsoleta(clave)) return
    void cache.cargar(fuente.carga)
  }, [cache, conexionId, version, deBases, base, fuente])

  return { cache, resp, errorCarga }
}
