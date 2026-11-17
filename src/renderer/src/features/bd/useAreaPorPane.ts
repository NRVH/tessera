// =============================================================================
// useAreaPorPane: lo que el área de BD guarda por pane (`clavePane`): los indicadores
// que publica cada uno con un callback estable, la última conexión y consola que se
// le conocieron, y la etiqueta de cada pestaña que edita para el diálogo de salida.
// Lo llama `DbArea`; sus dos efectos corren en el orden en que se declaran (poda, etiquetas).
// Decisiones: docs/decisiones/bd/ui-area-pestanas-y-panes.md
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConexionBd } from '../../../../shared/db-ipc'
import type { DbConsolaInfo } from '../../../../shared/db-explorador-ipc'
import type { IndicadorPestana } from './modeloPestanasBd'
import { mismosIndicadores } from './consola/vivoConsola'
import { etiquetaSalidaDatos, etiquetarDatos } from './rejilla/registroEdicion'
import type { PestanaBdMontada } from './useDbVista'

type Indicadores = ReadonlyMap<string, ReadonlySet<IndicadorPestana>>

/** El conjunto vacío compartido: un pane sin indicadores no tiene entrada en el mapa. */
export const SIN_INDICADORES: ReadonlySet<IndicadorPestana> = new Set()

/** Lo que el área necesita de sus panes al pintarlos. */
export interface AreaPorPane {
  indicadores: Indicadores
  /** Callback estable por pane para publicar su conjunto de indicadores. */
  onIndicadorDe: (pk: string) => (i: ReadonlySet<IndicadorPestana>) => void
  /** La conexión viva de un pane o, si falta un instante en la lista, la última conocida. */
  conexionDe: (pid: string, conexionId: string, pk: string) => ConexionBd | null
  /** La consola viva de un pane o, si falta un instante en la lista, la última conocida. */
  consolaDe: (pid: string, consolaId: string, pk: string) => DbConsolaInfo | null
}

/** El mapa con el conjunto de `pk` puesto; el MISMO si no cambia nada. */
function conIndicador(prev: Indicadores, pk: string, i: ReadonlySet<IndicadorPestana>): Indicadores {
  const antes = prev.get(pk) ?? SIN_INDICADORES
  if (mismosIndicadores(antes, i)) return prev
  const siguiente = new Map(prev)
  if (i.size === 0) siguiente.delete(pk)
  else siguiente.set(pk, new Set(i))
  return siguiente
}

/** El mapa sin los panes que ya no están montados; el MISMO si no sobra ninguno. */
function soloVivos(prev: Indicadores, vivas: ReadonlySet<string>): Indicadores {
  let sobra = false
  for (const k of prev.keys()) {
    if (!vivas.has(k)) {
      sobra = true
      break
    }
  }
  if (!sobra) return prev
  const siguiente = new Map<string, ReadonlySet<IndicadorPestana>>()
  for (const [k, v] of prev) if (vivas.has(k)) siguiente.set(k, v)
  return siguiente
}

/**
 * Pone la etiqueta de salida de cada pestaña que edita (datos y colección) de TODOS los
 * perfiles montados; devuelve la limpieza que las quita.
 */
function etiquetarMontadas(
  montadas: readonly PestanaBdMontada[],
  conexionesPorPerfil: ReadonlyMap<string, readonly ConexionBd[]>,
  ultimaConexion: ReadonlyMap<string, ConexionBd>
): () => void {
  const bajas: Array<() => void> = []
  for (const { perfilId: pid, pestana, clavePane: pk } of montadas) {
    const pane = pestana.pane
    if (pane.tipoPane !== 'datos' && pane.tipoPane !== 'coleccion') continue
    const conexionId = pane.conexionId
    const alias =
      conexionesPorPerfil.get(pid)?.find((c) => c.id === conexionId)?.alias ?? ultimaConexion.get(pk)?.alias
    bajas.push(
      etiquetarDatos(
        pk,
        pane.tipoPane === 'datos' ? etiquetaSalidaDatos(alias, pane.esquema, pane.objeto) : etiquetaSalidaDatos(alias, pane.base, pane.coleccion)
      )
    )
  }
  return () => {
    for (const baja of bajas) baja()
  }
}

/** La viva (que se recuerda) o la última que se recordó para ese pane. */
function recordada<T>(ultimas: Map<string, T>, pk: string, viva: T | undefined): T | null {
  if (viva) {
    ultimas.set(pk, viva)
    return viva
  }
  return ultimas.get(pk) ?? null
}

/** El estado por pane del área (ver la cabecera). */
export function useAreaPorPane(
  montadas: readonly PestanaBdMontada[],
  conexionesPorPerfil: ReadonlyMap<string, readonly ConexionBd[]>,
  consolasPorPerfil: ReadonlyMap<string, readonly DbConsolaInfo[]>
): AreaPorPane {
  const [indicadores, setIndicadores] = useState<Indicadores>(() => new Map())
  // Un callback ESTABLE por pane: uno que lo ponga en las dependencias de un efecto no
  // se re-suscribe en cada render del área.
  const oyentesIndicador = useRef(new Map<string, (i: ReadonlySet<IndicadorPestana>) => void>())
  const onIndicadorDe = useCallback((pk: string) => {
    let cb = oyentesIndicador.current.get(pk)
    if (!cb) {
      cb = (i) => setIndicadores((prev) => conIndicador(prev, pk, i))
      oyentesIndicador.current.set(pk, cb)
    }
    return cb
  }, [])

  // Poda de lo que es por pane cuando su pestaña ya no existe: los panes no avisan al
  // desmontarse.
  const ultimaConexion = useRef(new Map<string, ConexionBd>())
  const ultimaConsola = useRef(new Map<string, DbConsolaInfo>())
  useEffect(() => {
    const vivas = new Set(montadas.map((m) => m.clavePane))
    for (const mapa of [oyentesIndicador.current, ultimaConexion.current, ultimaConsola.current]) {
      for (const k of [...mapa.keys()]) if (!vivas.has(k)) mapa.delete(k)
    }
    setIndicadores((prev) => soloVivos(prev, vivas))
  }, [montadas])

  // Las etiquetas del diálogo de SALIDA: el pane solo sabe contar sus cambios; cómo se
  // llama la pestaña lo sabe el área.
  useEffect(() => etiquetarMontadas(montadas, conexionesPorPerfil, ultimaConexion.current), [montadas, conexionesPorPerfil])

  const conexionDe = (pid: string, conexionId: string, pk: string): ConexionBd | null =>
    recordada(ultimaConexion.current, pk, conexionesPorPerfil.get(pid)?.find((c) => c.id === conexionId))
  const consolaDe = (pid: string, consolaId: string, pk: string): DbConsolaInfo | null =>
    recordada(ultimaConsola.current, pk, consolasPorPerfil.get(pid)?.find((c) => c.id === consolaId))
  return { indicadores, onIndicadorDe, conexionDe, consolaDe }
}
