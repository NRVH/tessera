// =============================================================================
// useAreaTira: lo que la tira de pestañas del área de BD pinta del perfil que se ve:
// el motor de cada conexión (icono de las consolas), los títulos (alias y entorno de
// su conexión, resueltos al titular) y el indicador visible de cada pestaña. Lo llama
// `DbArea`; solo son `useMemo`.
// Decisiones: docs/decisiones/bd/ui-area-modelo-de-pestanas.md
// =============================================================================

import { useMemo } from 'react'
import type { ConexionBd, DbMotor } from '../../../../shared/db-ipc'
import type { DbConsolaInfo } from '../../../../shared/db-explorador-ipc'
import {
  indicadorVisible,
  clavePaneBd,
  titulosPestanas,
  type PestanaBd,
  type IndicadorPestana,
  type TituloPestana
} from './modeloPestanasBd'
import { SIN_INDICADORES } from './useAreaPorPane'

/** Lo que recibe `PestanasBd` además de las pestañas. */
interface AreaTira {
  motores: ReadonlyMap<string, DbMotor>
  titulos: ReadonlyMap<string, TituloPestana>
  indicadoresTira: ReadonlyMap<string, IndicadorPestana>
}

/** Datos derivados de la tira del perfil que se ve (ver la cabecera). */
export function useAreaTira(
  perfilId: string | null,
  pestanas: readonly PestanaBd[],
  conexionesActuales: readonly ConexionBd[] | null,
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
      pestanas,
      (id) => porId.get(id)?.alias,
      (id) => nombres.get(id),
      (id) => porId.get(id)?.entorno
    )
  }, [pestanas, conexionesActuales, consolasActuales])

  const indicadoresTira = useMemo(() => {
    const salida = new Map<string, IndicadorPestana>()
    if (perfilId === null) return salida
    for (const t of pestanas) {
      const i = indicadorVisible(indicadores.get(clavePaneBd(perfilId, t.id)) ?? SIN_INDICADORES)
      if (i !== null) salida.set(t.id, i)
    }
    return salida
  }, [pestanas, indicadores, perfilId])

  return { motores, titulos, indicadoresTira }
}
