// =============================================================================
// Actividad de los agentes de todos los perfiles: se suscribe a los cambios del
// main, se resincroniza al montar y al recuperar el foco, marca visto lo que de
// verdad se está mirando y poda lo de targets cerrados o hibernados.
// El modelo (estado pegajoso «terminó sin ver») vive en actividadAgente.ts.
// =============================================================================
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Agente } from '../../../../main/perfiles/types'
import type { MotivoEsperaAgente } from '../../../../shared/agent-terminal-ipc'
import {
  aplicarActividad,
  limpiarClavesActividad,
  dejarDeVer,
  marcarVisto,
  podarActividad,
  sincronizarActividad,
  type EstadoActividad,
  type TrabajoAgente
} from './actividadAgente'
import { actualizarActividad, useStoreAgentes } from './store'
import type { AgentesApp } from './useAgentesApp'
import { claveDestinoAgente, type DestinoAgenteAbierto } from '../pestanas'
import { claveVista, useStoreMosaico } from '../mosaico'
import { useStoreVentanasFranja } from '../layout'

/** Actividad y atención por perfil. */
export interface ActividadAgentes {
  estadoActividad: EstadoActividad
  /** Claves que trabajan ahora. */
  conjuntoTrabajando: Set<string>
  /** Claves que te esperan (lo dice el agente). */
  conjuntoEsperando: Set<string>
  atencionActividad: { perfilesSinVer: Set<string>; perfilesTrabajando: Set<string>; perfilesEsperando: Set<string> }
}

/** Qué se está mirando AHORA: la regla única de «visto» (suscripción y marca). */
function useClaveVista(agentes: AgentesApp, ccOculto: boolean): string | null {
  const { mosaicoActivo, enfocada, teselas } = useStoreMosaico(
    useShallow((s) => ({ mosaicoActivo: s.mosaicoActivo, enfocada: s.enfocada, teselas: s.teselas }))
  )
  const disposicion = agentes.disposicion
  return claveVista({
    mosaico: mosaicoActivo,
    enfocada,
    teselas,
    claveDestinoActivo: agentes.claveDestinoActivoEfectivo,
    // La columna enseña el agente del proyecto que se ve desde el mismo commit que el clic.
    ccVisible: disposicion.agente === 'espacio' || disposicion.agente === 'terminal' ? !disposicion.cc.oculta : !ccOculto
  })
}

/** Suscripción a los cambios y resincronización con la foto completa. */
function observarFoco(alCambiar: () => void): () => void {
  window.addEventListener('focus', alCambiar)
  window.addEventListener('blur', alCambiar)
  return () => {
    window.removeEventListener('focus', alCambiar)
    window.removeEventListener('blur', alCambiar)
  }
}

function focoPrincipal(): boolean {
  return document.hasFocus()
}

function useSuscripcionActividad(claveVistaRef: { current: string | null }): void {
  useEffect(
    () =>
      window.tessera.terminalAgente.alCambiarActividad((msg) => {
        const clave = claveDestinoAgente(msg.perfilId, msg.rutaHostProyecto, msg.agente as Agente)
        const esActivo = clave === claveVistaRef.current
        actualizarActividad((s) => aplicarActividad(s, clave, msg.estado, esActivo, msg.motivo ?? null))
      }),
    [claveVistaRef]
  )
  // Un cambio puede perderse (recarga, crash del renderer): al montar y al volver el foco se pide la foto.
  useEffect(() => {
    const sincronizar = (): void => {
      void window.tessera.terminalAgente
        .fotoActividad()
        .then((fotos) => {
          const vivos: Record<string, TrabajoAgente> = {}
          const esperando = new Map<string, MotivoEsperaAgente | null>()
          for (const msg of fotos) {
            const clave = claveDestinoAgente(msg.perfilId, msg.rutaHostProyecto, msg.agente as Agente)
            vivos[clave] = msg.estado === 'working' ? 'working' : 'idle'
            if (msg.estado === 'blocked') esperando.set(clave, msg.motivo ?? null)
          }
          actualizarActividad((s) => sincronizarActividad(s, vivos, esperando))
        })
        .catch(() => {
          // Sin foto se sigue con lo que haya: el main acabará emitiendo el cierre.
        })
    }
    sincronizar()
    window.addEventListener('focus', sincronizar)
    return () => window.removeEventListener('focus', sincronizar)
  }, [])
}

/** Actividad de los agentes, «visto» y poda. */
export function useActividadAgentes(
  agentes: AgentesApp,
  ccOculto: boolean
): ActividadAgentes {
  const estadoActividad = useStoreAgentes((s) => s.actividad)
  const clavePrincipal = useClaveVista(agentes, ccOculto)
  const perfilHija = useStoreVentanasFranja((s) => s.enfocada)
  const hayHijas = useStoreVentanasFranja((s) => s.abiertas.size > 0)
  const principalEnfocada = useSyncExternalStore(observarFoco, focoPrincipal)
  const claveVistaActual = perfilHija !== null
    ? agentes.agentesEnHijas.get(perfilHija) ?? null
    : !hayHijas || principalEnfocada ? clavePrincipal : null
  // La suscripción se registra una vez y lee la regla al vuelo.
  const claveVistaRef = useRef(claveVistaActual)
  claveVistaRef.current = claveVistaActual
  useSuscripcionActividad(claveVistaRef)
  // Lo que dejas de mirar sin contestar vuelve a avisar; lo que miras queda visto.
  const vistaAnterior = useRef<string | null>(null)
  useEffect(() => {
    const anterior = vistaAnterior.current
    vistaAnterior.current = claveVistaActual
    if (anterior && anterior !== claveVistaActual) actualizarActividad((s) => dejarDeVer(s, anterior))
    if (claveVistaActual) actualizarActividad((s) => marcarVisto(s, claveVistaActual))
  }, [claveVistaActual])
  const destinosAgente: DestinoAgenteAbierto[] = agentes.destinosAgente
  useEffect(() => {
    const abierto = new Set(destinosAgente.map((t) => t.key))
    actualizarActividad((s) => podarActividad(s, abierto))
  }, [destinosAgente])
  // Al hibernar no llega un 'idle' final: sin esto el 'working' quedaría pegado. Con los targets
  // que no son pestaña de un perfil hibernado (la unión que ve la columna).
  const hibernados = agentes.clavesDestinoHibernados
  useEffect(() => {
    if (hibernados.size === 0) return
    actualizarActividad((s) => limpiarClavesActividad(s, hibernados))
  }, [hibernados])
  const atencionActividad = useMemo(() => {
    const perfilesSinVer = new Set<string>()
    const perfilesTrabajando = new Set<string>()
    const perfilesEsperando = new Set<string>()
    for (const t of destinosAgente) {
      if (estadoActividad.sinVer.has(t.key)) perfilesSinVer.add(t.profileId)
      if (estadoActividad.crudo[t.key] === 'working') perfilesTrabajando.add(t.profileId)
      if (estadoActividad.esperando.has(t.key)) perfilesEsperando.add(t.profileId)
    }
    return { perfilesSinVer, perfilesTrabajando, perfilesEsperando }
  }, [destinosAgente, estadoActividad])
  const conjuntoTrabajando = useMemo(
    () => new Set(Object.keys(estadoActividad.crudo).filter((k) => estadoActividad.crudo[k] === 'working')),
    [estadoActividad.crudo]
  )
  const conjuntoEsperando = useMemo(() => new Set(estadoActividad.esperando.keys()), [estadoActividad.esperando])
  return { estadoActividad, conjuntoTrabajando, conjuntoEsperando, atencionActividad }
}
