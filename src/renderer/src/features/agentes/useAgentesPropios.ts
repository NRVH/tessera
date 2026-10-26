// =============================================================================
// Los agentes que no son pestaña (el de datos y el de la terminal) vistos desde fuera de su vista: de
// qué lugar es una carpeta, qué agentes tiene y cuál se enseña, cómo se despierta y cómo se va a él. Lo
// usa el mosaico, que los trata como un proyecto más de su perfil.
// Decisiones: docs/decisiones/mosaico/teselas-y-orden.md
// =============================================================================
import { useCallback, useMemo } from 'react'
import { AGENTES_DISPONIBLES } from '../../../../main/profiles/types'
import type { IdAgente } from '../../../../shared/agentesManuales'
import { agenteAMostrar, pestanasDeLaTerminal } from './agentesDelProyecto'
import { resolveSelectedAgent } from './agenteElegido'
import { despertarAlVerse } from './hibernacionFueraDePestanas'
import { actualizarHibernadosFueraDePestanas, selectAgent, useStoreAgentes } from './store'
import { abrirAgenteTerminal, elegirAgenteTerminal, useStoreAgenteTerminal } from './storeAgenteTerminal'
import { txSesion } from './textosSesion.ts'
import type { LugarEnLaPrincipal } from './textosMontajeBases'
import { useAgentesDe, useFuenteAgentes } from './useAgentesDelProyecto'
import type { OpenAgentTarget, UseTabs } from '../pestanas'
import { fijarMaximizado, useStoreLayout } from '../layout'
import { useStoreBd } from '../bd'

/** Lo que el mosaico necesita saber de cada carpeta, sea proyecto, espacio de datos o agente de la terminal. */
export interface AgentesPropios {
  lugarDe: (projectHostPath: string) => LugarEnLaPrincipal
  /** Cómo se llama la casilla del agente de datos o del de la terminal. */
  nombreDe: (lugar: Exclude<LugarEnLaPrincipal, 'proyecto'>) => string
  /** Los agentes de esa carpeta, en el orden de sus pestañas. */
  agentesDe: (profileId: string, projectHostPath: string) => readonly IdAgente[]
  /** El agente elegido en esa carpeta, o el primero. */
  elegidoDe: (profileId: string, projectHostPath: string) => IdAgente
  /** Despierta un agente que no es pestaña; false si su perfil aún se está hibernando. */
  despertar: (target: Pick<OpenAgentTarget, 'key' | 'profileId'>) => boolean
  /** Lleva a la vista donde vive: el proyecto, la vista de bases de datos o la terminal a pantalla completa. */
  irA: (target: OpenAgentTarget) => void
}

/** Abre la vista de bases de datos del perfil con su agente a la vista. */
function irAlAgenteDeDatos(profileId: string, agente: IdAgente): void {
  selectAgent(profileId, agente)
  useStoreLayout.setState((s) =>
    s.vistaPorPerfil[profileId] === 'db' ? {} : { vistaPorPerfil: { ...s.vistaPorPerfil, [profileId]: 'db' } }
  )
  useStoreBd.setState((s) =>
    s.dbAgenteVisiblePorPerfil[profileId] === true
      ? {}
      : { dbAgenteVisiblePorPerfil: { ...s.dbAgenteVisiblePorPerfil, [profileId]: true } }
  )
}

/** Abre la terminal del perfil a pantalla completa con su agente al lado y el teclado en él. */
function irAlAgenteDeLaTerminal(target: OpenAgentTarget): void {
  const { profileId, projectHostPath, agente } = target
  elegirAgenteTerminal(profileId, agente)
  useStoreLayout.setState((s) => ({
    franjaLibre: true,
    vistaPorPerfil: s.vistaPorPerfil[profileId] === 'files' ? s.vistaPorPerfil : { ...s.vistaPorPerfil, [profileId]: 'files' },
    panelPorPerfil: s.panelPorPerfil[profileId] === 'terminal' ? s.panelPorPerfil : { ...s.panelPorPerfil, [profileId]: 'terminal' }
  }))
  fijarMaximizado('terminal', true, profileId)
  abrirAgenteTerminal(profileId, projectHostPath, true)
}

/** De qué lugar es cada carpeta, qué agentes tiene y cuál está elegido. */
function useAgentesPorLugar(
  esEspacioDeDatos: (projectHostPath: string) => boolean,
  esCarpetaAgenteTerminal: (projectHostPath: string) => boolean
): Pick<AgentesPropios, 'lugarDe' | 'agentesDe' | 'elegidoDe'> {
  const agentesDeProyecto = useAgentesDe()
  const fuente = useFuenteAgentes()
  const selectedAgentByProfile = useStoreAgentes((s) => s.selectedAgentByProfile)
  const agenteTerminalPorPerfil = useStoreAgenteTerminal((s) => s.agentePorPerfil)
  const lugarDe = useCallback(
    (ruta: string): LugarEnLaPrincipal => (esCarpetaAgenteTerminal(ruta) ? 'terminal' : esEspacioDeDatos(ruta) ? 'datos' : 'proyecto'),
    [esEspacioDeDatos, esCarpetaAgenteTerminal]
  )
  const agentesDe = useCallback(
    (profileId: string, ruta: string): readonly IdAgente[] => {
      const lugar = lugarDe(ruta)
      if (lugar === 'terminal') return pestanasDeLaTerminal(fuente, profileId).map((x) => x.id)
      // El espacio de datos lanza los de serie (`useTargetsEspacio`).
      return lugar === 'datos' ? AGENTES_DISPONIBLES : agentesDeProyecto(profileId, ruta)
    },
    [lugarDe, fuente, agentesDeProyecto]
  )
  const elegidoDe = useCallback(
    (profileId: string, ruta: string): IdAgente => {
      const disponibles = agentesDe(profileId, ruta)
      const elegido =
        lugarDe(ruta) === 'terminal'
          ? agenteAMostrar(disponibles, agenteTerminalPorPerfil[profileId])
          : resolveSelectedAgent(profileId, selectedAgentByProfile, disponibles)
      return elegido ?? AGENTES_DISPONIBLES[0]
    },
    [agentesDe, lugarDe, agenteTerminalPorPerfil, selectedAgentByProfile]
  )
  return { lugarDe, agentesDe, elegidoDe }
}

/** Lugar, agentes, despertar y navegación de cualquier target de agente. */
export function useAgentesPropios(
  tabs: Pick<UseTabs, 'setActiveProfile' | 'hibernatingProfiles'>,
  esEspacioDeDatos: (projectHostPath: string) => boolean,
  esCarpetaAgenteTerminal: (projectHostPath: string) => boolean,
  openAgentTarget: (profileId: string, projectHostPath: string, agente: IdAgente) => void
): AgentesPropios {
  const { lugarDe, agentesDe, elegidoDe } = useAgentesPorLugar(esEspacioDeDatos, esCarpetaAgenteTerminal)
  const { setActiveProfile, hibernatingProfiles } = tabs
  const despertar = useCallback(
    (target: Pick<OpenAgentTarget, 'key' | 'profileId'>): boolean => {
      // Mientras el perfil se hiberna, el main aún está cerrando sus sesiones.
      if (hibernatingProfiles.has(target.profileId)) return false
      actualizarHibernadosFueraDePestanas((m) => despertarAlVerse(m, target.key))
      return true
    },
    [hibernatingProfiles]
  )
  const irA = useCallback(
    (target: OpenAgentTarget): void => {
      const lugar = lugarDe(target.projectHostPath)
      if (lugar === 'proyecto') {
        openAgentTarget(target.profileId, target.projectHostPath, target.agente)
        return
      }
      setActiveProfile(target.profileId)
      if (lugar === 'datos') irAlAgenteDeDatos(target.profileId, target.agente)
      else irAlAgenteDeLaTerminal(target)
    },
    [lugarDe, openAgentTarget, setActiveProfile]
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
