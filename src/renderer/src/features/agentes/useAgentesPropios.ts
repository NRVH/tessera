// =============================================================================
// Los agentes que no son pestaña (el de datos y el de la terminal) vistos desde fuera de su vista: de
// qué lugar es una carpeta, qué agentes tiene y cuál se enseña, cómo se despierta y cómo se va a él. Lo
// usa el mosaico, que los trata como un proyecto más de su perfil.
// Decisiones: docs/decisiones/mosaico/teselas-y-orden.md
// =============================================================================
import { useCallback, useMemo } from 'react'
import { AGENTES_DISPONIBLES } from '../../../../main/perfiles/types'
import type { IdAgente } from '../../../../shared/agentesManuales'
import { agenteAMostrar, pestanasDeLaTerminal } from './agentesDelProyecto'
import { resolverAgenteSeleccionado } from './agenteElegido'
import { despertarAlVerse } from './hibernacionFueraDePestanas'
import { actualizarHibernadosFueraDePestanas, seleccionarAgente, useStoreAgentes } from './store'
import { abrirAgenteTerminal, elegirAgenteTerminal, useStoreAgenteTerminal } from './storeAgenteTerminal'
import { txSesion } from './textosSesion.ts'
import type { LugarEnLaPrincipal } from './textosMontajeBases'
import { useAgentesDe, useFuenteAgentes } from './useAgentesDelProyecto'
import type { DestinoAgenteAbierto, UsePestanas } from '../pestanas'
import { fijarMaximizado, useStoreLayout } from '../layout'
import { useStoreBd } from '../bd'

/** Lo que el mosaico necesita saber de cada carpeta, sea proyecto, espacio de datos o agente de la terminal. */
export interface AgentesPropios {
  lugarDe: (rutaHostProyecto: string) => LugarEnLaPrincipal
  /** Cómo se llama la casilla del agente de datos o del de la terminal. */
  nombreDe: (lugar: Exclude<LugarEnLaPrincipal, 'proyecto'>) => string
  /** Los agentes de esa carpeta, en el orden de sus pestañas. */
  agentesDe: (perfilId: string, rutaHostProyecto: string) => readonly IdAgente[]
  /** El agente elegido en esa carpeta, o el primero. */
  elegidoDe: (perfilId: string, rutaHostProyecto: string) => IdAgente
  /** Despierta un agente que no es pestaña; false si su perfil aún se está hibernando. */
  despertar: (destino: Pick<DestinoAgenteAbierto, 'key' | 'profileId'>) => boolean
  /** Lleva a la vista donde vive: el proyecto, la vista de bases de datos o la terminal a pantalla completa. */
  irA: (destino: DestinoAgenteAbierto) => void
}

/** Abre la vista de bases de datos del perfil con su agente a la vista. */
function irAlAgenteDeDatos(perfilId: string, agente: IdAgente): void {
  seleccionarAgente(perfilId, agente)
  useStoreLayout.setState((s) =>
    s.vistaPorPerfil[perfilId] === 'db' ? {} : { vistaPorPerfil: { ...s.vistaPorPerfil, [perfilId]: 'db' } }
  )
  useStoreBd.setState((s) =>
    s.dbAgenteVisiblePorPerfil[perfilId] === true
      ? {}
      : { dbAgenteVisiblePorPerfil: { ...s.dbAgenteVisiblePorPerfil, [perfilId]: true } }
  )
}

/** Abre la terminal del perfil a pantalla completa con su agente al lado y el teclado en él. */
function irAlAgenteDeLaTerminal(destino: DestinoAgenteAbierto): void {
  const { profileId: perfilId, projectHostPath: rutaHostProyecto, agente } = destino
  elegirAgenteTerminal(perfilId, agente)
  useStoreLayout.setState((s) => ({
    franjaLibre: true,
    vistaPorPerfil: s.vistaPorPerfil[perfilId] === 'files' ? s.vistaPorPerfil : { ...s.vistaPorPerfil, [perfilId]: 'files' },
    panelPorPerfil: s.panelPorPerfil[perfilId] === 'terminal' ? s.panelPorPerfil : { ...s.panelPorPerfil, [perfilId]: 'terminal' }
  }))
  fijarMaximizado('terminal', true, perfilId)
  abrirAgenteTerminal(perfilId, rutaHostProyecto, true)
}

/** De qué lugar es cada carpeta, qué agentes tiene y cuál está elegido. */
function useAgentesPorLugar(
  esEspacioDeDatos: (rutaHostProyecto: string) => boolean,
  esCarpetaAgenteTerminal: (rutaHostProyecto: string) => boolean
): Pick<AgentesPropios, 'lugarDe' | 'agentesDe' | 'elegidoDe'> {
  const agentesDeProyecto = useAgentesDe()
  const fuente = useFuenteAgentes()
  const agenteSeleccionadoPorPerfil = useStoreAgentes((s) => s.agenteSeleccionadoPorPerfil)
  const agenteTerminalPorPerfil = useStoreAgenteTerminal((s) => s.agentePorPerfil)
  const lugarDe = useCallback(
    (ruta: string): LugarEnLaPrincipal => (esCarpetaAgenteTerminal(ruta) ? 'terminal' : esEspacioDeDatos(ruta) ? 'datos' : 'proyecto'),
    [esEspacioDeDatos, esCarpetaAgenteTerminal]
  )
  const agentesDe = useCallback(
    (perfilId: string, ruta: string): readonly IdAgente[] => {
      const lugar = lugarDe(ruta)
      if (lugar === 'terminal') return pestanasDeLaTerminal(fuente, perfilId).map((x) => x.id)
      // El espacio de datos lanza los de serie (`useDestinosEspacio`).
      return lugar === 'datos' ? AGENTES_DISPONIBLES : agentesDeProyecto(perfilId, ruta)
    },
    [lugarDe, fuente, agentesDeProyecto]
  )
  const elegidoDe = useCallback(
    (perfilId: string, ruta: string): IdAgente => {
      const disponibles = agentesDe(perfilId, ruta)
      const elegido =
        lugarDe(ruta) === 'terminal'
          ? agenteAMostrar(disponibles, agenteTerminalPorPerfil[perfilId])
          : resolverAgenteSeleccionado(perfilId, agenteSeleccionadoPorPerfil, disponibles)
      return elegido ?? AGENTES_DISPONIBLES[0]
    },
    [agentesDe, lugarDe, agenteTerminalPorPerfil, agenteSeleccionadoPorPerfil]
  )
  return { lugarDe, agentesDe, elegidoDe }
}

/** Lugar, agentes, despertar y navegación de cualquier target de agente. */
export function useAgentesPropios(
  pestanas: Pick<UsePestanas, 'setActiveProfile' | 'perfilIdsHibernando'>,
  esEspacioDeDatos: (rutaHostProyecto: string) => boolean,
  esCarpetaAgenteTerminal: (rutaHostProyecto: string) => boolean,
  abrirDestinoAgente: (perfilId: string, rutaHostProyecto: string, agente: IdAgente) => void
): AgentesPropios {
  const { lugarDe, agentesDe, elegidoDe } = useAgentesPorLugar(esEspacioDeDatos, esCarpetaAgenteTerminal)
  const { setActiveProfile, perfilIdsHibernando } = pestanas
  const despertar = useCallback(
    (destino: Pick<DestinoAgenteAbierto, 'key' | 'profileId'>): boolean => {
      // Mientras el perfil se hiberna, el main aún está cerrando sus sesiones.
      if (perfilIdsHibernando.has(destino.profileId)) return false
      actualizarHibernadosFueraDePestanas((m) => despertarAlVerse(m, destino.key))
      return true
    },
    [perfilIdsHibernando]
  )
  const irA = useCallback(
    (destino: DestinoAgenteAbierto): void => {
      const lugar = lugarDe(destino.projectHostPath)
      if (lugar === 'proyecto') {
        abrirDestinoAgente(destino.profileId, destino.projectHostPath, destino.agente)
        return
      }
      setActiveProfile(destino.profileId)
      if (lugar === 'datos') irAlAgenteDeDatos(destino.profileId, destino.agente)
      else irAlAgenteDeLaTerminal(destino)
    },
    [lugarDe, abrirDestinoAgente, setActiveProfile]
  )
  return useMemo(
    () => ({
      lugarDe,
      nombreDe: (lugar) => (lugar === 'datos' ? txSesion().basesDeDatos : txSesion().terminal),
      agentesDe,
      elegidoDe,
      despertar,
      irA
    }),
    [lugarDe, agentesDe, elegidoDe, despertar, irA]
  )
}
