// =============================================================================
// Estado visual de los puntos de la banda: por perfil (hibernando, hibernado o
// activo) y por proyecto del perfil activo, con el estado de sesión del agente que
// muestra la columna. La lógica pura vive en estadosPunto.ts.
// =============================================================================
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { calcularEstadosPuntoPerfil, calcularEstadosPuntoProyecto } from './estadosPunto'
import { claveDestinoAgente } from './modeloPestanas'
import type { UsePestanas } from './usePestanas'
import { resolverAgenteSeleccionado, useStoreAgentes, type EstadoPaneAgente } from '../agentes'

/** Puntos de perfil y de proyecto de la banda. */
export function usePuntosPerfil(pestanas: UsePestanas): {
  estadosPuntoPerfil: ReturnType<typeof calcularEstadosPuntoPerfil>
  estadosPuntoProyecto: ReturnType<typeof calcularEstadosPuntoProyecto>
} {
  const { estadoAgente, agenteSeleccionadoPorPerfil } = useStoreAgentes(
    useShallow((s) => ({ estadoAgente: s.estadoPorDestino, agenteSeleccionadoPorPerfil: s.agenteSeleccionadoPorPerfil }))
  )
  const estadosPuntoPerfil = useMemo(
    () =>
      calcularEstadosPuntoPerfil({
        perfilIds: pestanas.perfiles.map((p) => p.id),
        perfilIdsHibernando: pestanas.perfilIdsHibernando,
        perfilIdsHibernados: pestanas.perfilIdsHibernados,
        destinos: pestanas.todosLosDestinosAbiertos,
        estadoAgente
      }),
    [pestanas.perfiles, pestanas.perfilIdsHibernando, pestanas.perfilIdsHibernados, pestanas.todosLosDestinosAbiertos, estadoAgente]
  )
  const estadosPuntoProyecto = useMemo(() => {
    const estadoAgentePorProyecto: Record<string, EstadoPaneAgente> = {}
    const ap = pestanas.perfilActivo
    // El mismo agente que muestra la columna.
    const agente = resolverAgenteSeleccionado(ap?.id ?? null, agenteSeleccionadoPorPerfil)
    if (ap && agente) {
      for (const proyecto of pestanas.proyectosAbiertos) {
        const s = estadoAgente[claveDestinoAgente(ap.id, proyecto.rutaHostProyecto, agente)]
        if (s) estadoAgentePorProyecto[proyecto.rutaHostProyecto] = s
      }
    }
    return calcularEstadosPuntoProyecto({ proyectos: pestanas.proyectosAbiertos, estadoAgentePorProyecto })
  }, [pestanas.proyectosAbiertos, pestanas.perfilActivo, estadoAgente, agenteSeleccionadoPorPerfil])
  return { estadosPuntoPerfil, estadosPuntoProyecto }
}
