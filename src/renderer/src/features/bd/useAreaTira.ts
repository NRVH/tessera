// =============================================================================
// useAreaTira: lo que la tira de pestañas del área de BD pinta del perfil que se ve:
// el motor de cada conexión (icono de las consolas), los títulos (alias y entorno de
// su conexión, resueltos al titular) y el indicador visible de cada pestaña. Lo llama
// `DbArea`; solo son `useMemo`.
// Decisiones: docs/decisiones/bd/ui-area-modelo-de-pestanas.md
// =============================================================================

import { useMemo } from 'react'
import type { DbConnection, DbMotor } from '../../../../shared/db-ipc'
import type { DbConsolaInfo } from '../../../../shared/db-explorador-ipc'
import {
  indicadorVisible,
  paneKeyDb,
  titulosPestanas,
  type DbTab,
  type IndicadorPestana,
  type TituloPestana
} from './dbTabsModel'
import { SIN_INDICADORES } from './useAreaPorPane'

/** Lo que recibe `DbTabs` además de las pestañas. */
interface AreaTira {
  motores: ReadonlyMap<string, DbMotor>
  titulos: ReadonlyMap<string, TituloPestana>
  indicadoresTira: ReadonlyMap<string, IndicadorPestana>
}

/** Datos derivados de la tira del perfil que se ve (ver la cabecera). */
export function useAreaTira(
  perfilId: string | null,
  tabs: readonly DbTab[],
  conexionesActuales: readonly DbConnection[] | null,
  consolasActuales: readonly DbConsolaInfo[] | null,
  indicadores: ReadonlyMap<string, ReadonlySet<IndicadorPestana>>
): AreaTira {
  const motores = useMemo(
    () => new Map<string, DbMotor>((conexionesActuales ?? []).map((c) => [c.id, c.motor])),
    [conexionesActuales]
  )

  const titulos = useMemo(() => {
    const porId = new Map((conexionesActuales ?? []).map((c) => [c.id, c]))
    const nombres = new Map((consolasActuales ?? []).map((c) => [c.id, c.nombre]))
    return titulosPestanas(
      tabs,
      (id) => porId.get(id)?.alias,
      (id) => nombres.get(id),
      (id) => porId.get(id)?.entorno
    )
  }, [tabs, conexionesActuales, consolasActuales])

  const indicadoresTira = useMemo(() => {
    const out = new Map<string, IndicadorPestana>()
    if (perfilId === null) return out
    for (const t of tabs) {
      const i = indicadorVisible(indicadores.get(paneKeyDb(perfilId, t.id)) ?? SIN_INDICADORES)
      if (i !== null) out.set(t.id, i)
    }
    return out
  }, [tabs, indicadores, perfilId])

  return { motores, titulos, indicadoresTira }
}
