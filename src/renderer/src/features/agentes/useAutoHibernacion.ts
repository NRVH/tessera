// =============================================================================
// Orquestador de la hibernación por inactividad: lleva el temporizador, apunta cuándo deja
// de verse cada proyecto y, en cada ronda, le dice al main qué hay en pantalla; el main
// mide, decide y cierra, y aquí se marca el modelo sin avisar (la pestaña atenuada ya lo dice).
// Solo avisa, una vez por racha, de que queda poca memoria, con un botón que hiberna ya lo que se
// pueda. Reglas en `autoHibernacion.ts`. Vive en el renderer porque solo él sabe qué se ve; con
// «Nunca», o sin los ajustes cargados, no hace nada.
// Decisiones: docs/decisiones/agentes/hibernacion-por-inactividad.md
// =============================================================================

import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { AgentHibernarInactivosResult, ParadaPorLimite } from '../../../../shared/agent-terminal-ipc'
import { AGENTE_INACTIVIDAD_NUNCA } from '../../../../shared/ajustesAgente'
import { ETIQUETA_AGENTE } from '../../../../shared/etiquetasAgente'
import { useStoreAjustes } from '../ajustes'
import { useStoreMosaico } from '../mosaico'
import { useStorePestanas, type UseTabs } from '../pestanas'
import { notify } from '../../comun/notifications'
import {
  PRIMERA_RONDA_MS,
  apuntarSalidas,
  avisoPocaMemoria,
  claveProyecto,
  construirPeticion,
  etiquetasHibernados,
  planAplicacion,
  proyectosEnPantalla,
  siguienteEsperaMs
} from './autoHibernacion'
import { txSesion } from './textosSesion.ts'
import type { ActividadAgentes } from './useActividadAgentes'
import type { UseActualizacionNativa } from './useActualizacionNativa'

/** Cuántos nombres lleva el aviso de una parada por el límite antes de contar «y N más». */
const MAX_NOMBRES_AVISO = 3

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
  /** Ya se avisó de la poca memoria en esta racha (se rearma cuando el main dice que se recuperó). */
  avisadoPocaMemoria: boolean
  /** Pide una ronda ya que hiberne sin esperar al plazo; null con la hibernación apagada. */
  forzar: (() => void) | null
}

/** Lo que se ve AHORA, leído de los stores: tras un `await`, el render puede ir por detrás. */
export function pantallaAhora(tabs: UseTabs): Set<string> {
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
function aplicar(resultado: Pick<AgentHibernarInactivosResult, 'hibernados'>, v: Vivo, despertarVisibles = true): void {
  const panes = v.panes()
  for (const { hibernado, despertar: visible } of planAplicacion(resultado, pantallaAhora(v.tabs))) {
    // Tras una parada por el límite, despertar un proyecto a la vista reabriría su contenedor y pararía otro.
    const despertar = visible && despertarVisibles
    const { profileId, projectHostPath } = hibernado
    for (const s of hibernado.sesiones) {
      // Antes de marcar: el pane suelta su sesión al verse hibernado y ya no se le encontraría.
      const pane = panes.find((p) => p.sessionId() === s.sessionId)
      if (s.resumeSessionId) pane?.reanudarCon(s.resumeSessionId)
      else if (s.nuevaSiNadaDesde !== undefined) pane?.reanudarSiHuboDesde(s.nuevaSiNadaDesde)
    }
    v.tabs.hibernarAgentes(profileId, projectHostPath)
    // En otra tarea: el pane tiene que verse hibernado en un commit propio para soltar el
    // id muerto antes de reabrir.
    if (despertar) setTimeout(() => v.tabs.wakeProject(profileId, projectHostPath), 0)
  }
}

/** Aplica y cuenta la parada que hizo el main para abrir un agente con el límite de contenedores alcanzado. */
function aplicarParadaPorLimite(p: ParadaPorLimite, v: Vivo): void {
  // La de la saturación la cuenta su propio aviso (`useSaturacionDocker`).
  if (p.motivo !== 'limite') return
  // Sin marcar los proyectos: cada agente parado ya recibió su salida (`parado-por-limite`) y los
  // demás de su proyecto, que pueden ser de otra cuenta, siguen. Aquí solo se avisa con la regla.
  const t = txSesion()
  if (p.hibernados.length === 0) {
    if (p.sinAgentes) notify('info', t.limiteTitulo(p.limite), t.limiteSinAgentes)
    return
  }
  const nombres = new Map(v.tabs.allOpenProjects.map((x) => [claveProyecto(x.profileId, x.projectHostPath), x.name]))
  const etiquetas = etiquetasHibernados(
    p.hibernados,
    (perfil, ruta) => nombres.get(claveProyecto(perfil, ruta)),
    (agente) => ETIQUETA_AGENTE[agente]
  ).map((e) => `«${e}»`)
  const visibles = etiquetas.slice(0, MAX_NOMBRES_AVISO)
  const resto = etiquetas.length - visibles.length
  const lista = resto > 0 ? `${visibles.join(', ')} ${t.limiteYMas(resto)}` : visibles.join(', ')
  notify('warn', t.limiteTitulo(p.limite), t.limiteDetalle(lista, p.primero, etiquetas.length > 1))
}

/** El aviso de poca memoria, una vez por racha, con el botón que hiberna ya lo que se pueda. */
function avisarPocaMemoria(resultado: AgentHibernarInactivosResult, relojes: Relojes): void {
  const paso = avisoPocaMemoria(resultado.pocaMemoria, relojes.avisadoPocaMemoria)
  relojes.avisadoPocaMemoria = paso.avisado
  if (!paso.avisar) return
  const t = txSesion()
  notify('warn', t.pocaMemoriaTitulo, t.pocaMemoriaDetalle, {
    accion: { etiqueta: t.pocaMemoriaAccion, onClick: () => relojes.forzar?.() }
  })
}

/** Una ronda; devuelve cuánto esperar hasta la siguiente. `ahora`: hibernar sin esperar al plazo. */
async function unaRonda(vivo: MutableRefObject<Vivo>, relojes: Relojes, ahora = false): Promise<number> {
  const v = vivo.current
  if (v.pausado) return siguienteEsperaMs(null, relojes.umbralMs)
  const base = construirPeticion({
    minutos: v.minutos,
    proyectos: v.tabs.allOpenProjects,
    targets: v.tabs.allOpenTargets,
    enPantalla: pantallaAhora(v.tabs),
    unseen: v.unseen,
    dejoDeVerse: relojes.dejoDeVerse,
    ahora: performance.now(),
    montadoEn: relojes.montadoEn
  })
  const peticion = ahora ? { ...base, ahora: true } : base
  // Sin ningún candidato no se molesta al main; la primera vez sí, para conocer el umbral, y tras
  // avisar de poca memoria también, para saber cuándo se recupera y rearmar el aviso.
  const hayCandidato = peticion.proyectos.some((p) => !p.enPantalla && !p.hibernado)
  if (!hayCandidato && relojes.umbralMs !== null && !relojes.avisadoPocaMemoria) return siguienteEsperaMs(null, relojes.umbralMs)
  const resultado = await window.tessera.agentTerminal.hibernarInactivos(peticion)
  // El plazo cero de una ronda forzada no es el umbral: guardarlo dejaría las rondas a un segundo.
  if (!ahora) relojes.umbralMs = resultado.umbralMs
  // Con lo de AHORA: durante el viaje pudo cambiar lo que se ve y montarse otro pane.
  aplicar(resultado, vivo.current)
  avisarPocaMemoria(resultado, relojes)
  return ahora ? siguienteEsperaMs(null, relojes.umbralMs) : siguienteEsperaMs(resultado.revisarEnMs, resultado.umbralMs)
}

/** Las claves de los proyectos que se ven, recalculadas solo cuando cambia algo que lo decide. */
export function useProyectosEnPantalla(tabs: UseTabs): ReadonlySet<string> {
  const { mosaicoActivo, teselas } = useStoreMosaico(
    useShallow((s) => ({ mosaicoActivo: s.mosaicoActivo, teselas: s.teselas }))
  )
  const perfil = tabs.activeProfile?.id ?? null
  const ruta = tabs.activeProject?.projectHostPath ?? null
  const confirmado = tabs.confirmedTarget
  return useMemo(
    () => pantallaAhora(tabs),
    // Los stores ya traen estos valores al llegar aquí; las dependencias dicen cuándo releerlos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [perfil, ruta, confirmado, mosaicoActivo, teselas, tabs.allOpenTargets]
  )
}

/** Apunta, en cada cambio de lo que se ve, la hora a la que dejó de verse cada proyecto. */
function useRelojes(tabs: UseTabs): MutableRefObject<Relojes> {
  const relojes = useRef<Relojes>({
    montadoEn: performance.now(),
    dejoDeVerse: new Map(),
    antes: new Set(),
    umbralMs: null,
    avisadoPocaMemoria: false,
    forzar: null
  })
  const pantalla = useProyectosEnPantalla(tabs)
  useEffect(() => {
    apuntarSalidas(relojes.current.dejoDeVerse, relojes.current.antes, pantalla, performance.now())
    relojes.current.antes = pantalla
  }, [pantalla])
  return relojes
}

/** Atiende las paradas por el límite de contenedores; no depende de «Nunca»: las decide el main al abrir un agente. */
function useParadaPorLimite(vivo: MutableRefObject<Vivo>): void {
  useEffect(() => window.tessera.agentTerminal.onParadaPorLimite((p) => aplicarParadaPorLimite(p, vivo.current)), [vivo])
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
  useParadaPorLimite(vivo)
  const encendido = cargados && minutos !== AGENTE_INACTIVIDAD_NUNCA
  // `minutos` en las dependencias: al cambiar el ajuste se empieza de nuevo y se olvida el
  // umbral de la ronda anterior.
  useEffect(() => {
    if (!encendido) return
    const r = relojes.current
    r.umbralMs = null
    let cancelado = false
    let temporizador: ReturnType<typeof setTimeout> | null = null
    // Una ronda en vuelo como mucho: la forzada que llega durante otra corre al terminar esa.
    let enVuelo = false
    let forzadaPendiente = false
    const ronda = (ahora = false): void => {
      if (temporizador !== null) clearTimeout(temporizador)
      temporizador = null
      enVuelo = true
      unaRonda(vivo, r, ahora)
        .catch((err: unknown) => {
          console.error('[agentes] la ronda de hibernación por inactividad falló:', err)
          return siguienteEsperaMs(null, null, true)
        })
        .then((espera) => {
          enVuelo = false
          if (cancelado) return
          if (forzadaPendiente) {
            forzadaPendiente = false
            ronda(true)
            return
          }
          temporizador = setTimeout(ronda, espera)
        })
    }
    r.forzar = () => {
      if (cancelado) return
      if (enVuelo) forzadaPendiente = true
      else ronda(true)
    }
    temporizador = setTimeout(ronda, PRIMERA_RONDA_MS)
    return () => {
      cancelado = true
      r.forzar = null
      if (temporizador !== null) clearTimeout(temporizador)
    }
  }, [encendido, minutos, relojes])
}
