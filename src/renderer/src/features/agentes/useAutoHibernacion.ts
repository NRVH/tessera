// =============================================================================
// Orquestador de la hibernación por inactividad: lleva el temporizador, apunta cuándo deja
// de verse cada proyecto y, en cada ronda, le dice al main qué hay en pantalla; el main
// mide, decide y cierra, y aquí se marca el modelo (sin avisar: la pestaña atenuada ya lo
// dice y un toast cada pocos minutos era ruido). Las reglas son de
// `autoHibernacion.ts`. Vive en el renderer porque solo él sabe qué se ve; si se cuelga,
// nadie hiberna. Con «Nunca», o sin los ajustes cargados, no hace nada.
// Decisiones: docs/decisiones/agentes/hibernacion-por-inactividad.md
// =============================================================================

import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { AgentHibernarInactivosResult } from '../../../../shared/agent-terminal-ipc'
import { AGENTE_INACTIVIDAD_NUNCA } from '../../../../shared/ajustesAgente'
import { useStoreAjustes } from '../ajustes'
import { useStoreMosaico } from '../mosaico'
import { useStorePestanas, type UseTabs } from '../pestanas'
import {
  PRIMERA_RONDA_MS,
  apuntarSalidas,
  construirPeticion,
  planAplicacion,
  proyectosEnPantalla,
  siguienteEsperaMs
} from './autoHibernacion'
import type { ActividadAgentes } from './useActividadAgentes'
import type { UseActualizacionNativa } from './useActualizacionNativa'

/** Lo último que vio el render: la ronda lo lee al dispararse, no al programarse. */
interface Vivo {
  tabs: UseTabs
  unseen: ReadonlySet<string>
  minutos: number
  /** Corre la actualización de los agentes nativos, que no admite que le desaparezca una sesión. */
  pausado: boolean
  panes: UseActualizacionNativa['panes']
}

/** Relojes del orquestador: cuándo empezó a mirar y cuándo dejó de verse cada proyecto. */
interface Relojes {
  montadoEn: number
  dejoDeVerse: Map<string, number>
  antes: ReadonlySet<string>
  /** El umbral que aplicó el main en la última ronda; null hasta la primera respuesta. */
  umbralMs: number | null
}

/** Lo que se ve AHORA, leído de los stores: tras un `await`, el render puede ir por detrás. */
function pantallaAhora(tabs: UseTabs): Set<string> {
  const pestanas = useStorePestanas.getState()
  const perfil = pestanas.tabs.activeProfileId
  const ruta = perfil === null ? null : (pestanas.tabs.byProfile[perfil]?.activePath ?? null)
  const confirmado = pestanas.confirmado
  const mosaico = useStoreMosaico.getState()
  return proyectosEnPantalla({
    activo: perfil !== null && ruta !== null ? { profileId: perfil, projectHostPath: ruta } : null,
    confirmado: confirmado ? { profileId: confirmado.profileId, projectHostPath: confirmado.project.projectHostPath } : null,
    mosaicoActivo: mosaico.mosaicoActivo,
    teselas: mosaico.teselas,
    targets: tabs.allOpenTargets
  })
}

/** Aplica la respuesta del main: el chat de cada pane, el modelo y la carrera con un clic. */
function aplicar(resultado: AgentHibernarInactivosResult, v: Vivo): void {
  const panes = v.panes()
  for (const { hibernado, despertar } of planAplicacion(resultado, pantallaAhora(v.tabs))) {
    const { profileId, projectHostPath } = hibernado
    for (const s of hibernado.sesiones) {
      // Antes de marcar: el pane suelta su sesión al verse hibernado y ya no se le encontraría.
      if (s.resumeSessionId) panes.find((p) => p.sessionId() === s.sessionId)?.reanudarCon(s.resumeSessionId)
    }
    v.tabs.hibernarAgentes(profileId, projectHostPath)
    // En otra tarea: el pane tiene que verse hibernado en un commit propio para soltar el
    // id muerto antes de reabrir.
    if (despertar) setTimeout(() => v.tabs.wakeProject(profileId, projectHostPath), 0)
  }
}

/** Una ronda; devuelve cuánto esperar hasta la siguiente. */
async function unaRonda(vivo: MutableRefObject<Vivo>, relojes: Relojes): Promise<number> {
  const v = vivo.current
  if (v.pausado) return siguienteEsperaMs(null, relojes.umbralMs)
  const peticion = construirPeticion({
    minutos: v.minutos,
    proyectos: v.tabs.allOpenProjects,
    targets: v.tabs.allOpenTargets,
    enPantalla: pantallaAhora(v.tabs),
    unseen: v.unseen,
    dejoDeVerse: relojes.dejoDeVerse,
    ahora: performance.now(),
    montadoEn: relojes.montadoEn
  })
  // Sin ningún candidato no se molesta al main; la primera vez sí, para conocer el umbral.
  const hayCandidato = peticion.proyectos.some((p) => !p.enPantalla && !p.hibernado)
  if (!hayCandidato && relojes.umbralMs !== null) return siguienteEsperaMs(null, relojes.umbralMs)
  const resultado = await window.tessera.agentTerminal.hibernarInactivos(peticion)
  relojes.umbralMs = resultado.umbralMs
  // Con lo de AHORA: durante el viaje pudo cambiar lo que se ve y montarse otro pane.
  aplicar(resultado, vivo.current)
  return siguienteEsperaMs(resultado.revisarEnMs, resultado.umbralMs)
}

/** Apunta, en cada cambio de lo que se ve, la hora a la que dejó de verse cada proyecto. */
function useRelojes(tabs: UseTabs): MutableRefObject<Relojes> {
  const { mosaicoActivo, teselas } = useStoreMosaico(
    useShallow((s) => ({ mosaicoActivo: s.mosaicoActivo, teselas: s.teselas }))
  )
  const relojes = useRef<Relojes>({ montadoEn: performance.now(), dejoDeVerse: new Map(), antes: new Set(), umbralMs: null })
  const perfil = tabs.activeProfile?.id ?? null
  const ruta = tabs.activeProject?.projectHostPath ?? null
  const confirmado = tabs.confirmedTarget
  const pantalla = useMemo(
    () => pantallaAhora(tabs),
    // Los stores ya traen estos valores al llegar aquí; las dependencias dicen cuándo releerlos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [perfil, ruta, confirmado, mosaicoActivo, teselas, tabs.allOpenTargets]
  )
  useEffect(() => {
    apuntarSalidas(relojes.current.dejoDeVerse, relojes.current.antes, pantalla, performance.now())
    relojes.current.antes = pantalla
  }, [pantalla])
  return relojes
}

/**
 * Hiberna los agentes de los proyectos fuera de pantalla que llevan inactivos más que el
 * ajuste. Las rondas nunca se solapan (la siguiente se programa al terminar la anterior) y
 * un fallo solo alarga la espera.
 */
export function useAutoHibernacion(
  tabs: UseTabs,
  actividad: ActividadAgentes,
  actualizacion: Pick<UseActualizacionNativa, 'enCurso' | 'panes'>
): void {
  const minutos = useStoreAjustes((s) => s.agenteInactividadMin)
  const cargados = useStoreAjustes((s) => s.settingsLoaded)
  const relojes = useRelojes(tabs)
  const vivo = useRef<Vivo>({ tabs, unseen: actividad.activity.unseen, minutos, pausado: false, panes: actualizacion.panes })
  vivo.current = {
    tabs,
    unseen: actividad.activity.unseen,
    minutos,
    pausado: actualizacion.enCurso !== null,
    panes: actualizacion.panes
  }
  const encendido = cargados && minutos !== AGENTE_INACTIVIDAD_NUNCA
  // `minutos` en las dependencias: al cambiar el ajuste se empieza de nuevo y se olvida el
  // umbral de la ronda anterior.
  useEffect(() => {
    if (!encendido) return
    const r = relojes.current
    r.umbralMs = null
    let cancelado = false
    let temporizador: ReturnType<typeof setTimeout> | null = null
    const ronda = (): void => {
      unaRonda(vivo, r)
        .catch((err: unknown) => {
          console.error('[agentes] la ronda de hibernación por inactividad falló:', err)
          return siguienteEsperaMs(null, null, true)
        })
        .then((espera) => {
          if (!cancelado) temporizador = setTimeout(ronda, espera)
        })
    }
    temporizador = setTimeout(ronda, PRIMERA_RONDA_MS)
    return () => {
      cancelado = true
      if (temporizador !== null) clearTimeout(temporizador)
    }
  }, [encendido, minutos, relojes])
}
