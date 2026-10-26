// =============================================================================
// El lado del renderer del vigía de la saturación de Docker: le manda los ajustes, la política y lo
// que se ve (el main no para un proyecto a la vista), y pinta lo que dice: el aviso previo con
// «Parar otro», la cancelación, el «nada que parar» y la parada con su regla. Si el límite de
// contenedores del usuario está en rojo, el aviso de la parada lo recuerda.
// Decisiones: docs/decisiones/sandbox/saturacion-de-docker.md
// =============================================================================

import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { AgentKind, AvisoSaturacion, ParadaPorLimite, ProyectoParado } from '../../../../shared/agent-terminal-ipc'
import { ETIQUETA_AGENTE } from '../../../../shared/etiquetasAgente'
import { colorDe, cortesSemaforo, limiteEfectivo } from '../../../../shared/semaforoContenedores'
import { useStoreAjustes, useStoreRecursosDocker } from '../ajustes'
import type { UseTabs } from '../pestanas'
import { dismiss, notify } from '../../comun/notifications'
import { claveProyecto, etiquetasProyectos } from './autoHibernacion'
import { useProyectosEnPantalla } from './useAutoHibernacion'
import { txSesion } from './textosSesion.ts'

/** Cuántos nombres lleva un aviso antes de contar «y N más». */
const MAX_NOMBRES = 3

/** Las claves de `claveProyecto` de vuelta a pares. */
function pares(claves: ReadonlySet<string>): Array<{ profileId: string; projectHostPath: string }> {
  return [...claves].flatMap((c) => {
    const [profileId, projectHostPath] = JSON.parse(c) as [string, string]
    return typeof profileId === 'string' && typeof projectHostPath === 'string' ? [{ profileId, projectHostPath }] : []
  })
}

/** «a, b, c y N más» con los nombres de las pestañas abiertas; null si no hay proyectos. */
function listaDe(proyectos: readonly ProyectoParado[], tabs: UseTabs): string | null {
  if (proyectos.length === 0) return null
  const nombres = new Map(tabs.allOpenProjects.map((x) => [claveProyecto(x.profileId, x.projectHostPath), x.name]))
  const etiquetas = etiquetasProyectos(
    proyectos,
    (perfil, ruta) => nombres.get(claveProyecto(perfil, ruta)),
    (a) => ETIQUETA_AGENTE[a as AgentKind] ?? a
  ).map((e) => `«${e}»`)
  const visibles = etiquetas.slice(0, MAX_NOMBRES)
  const resto = etiquetas.length - visibles.length
  return resto > 0 ? `${visibles.join(', ')} ${txSesion().limiteYMas(resto)}` : visibles.join(', ')
}

/** ¿Está en rojo el límite que eligió el usuario? Sin saber la memoria de Docker, no se afirma. */
function limiteEnRojo(): boolean {
  const memoria = useStoreRecursosDocker.getState().recursos?.memoriaBytes ?? null
  if (memoria === null) return false
  const cortes = cortesSemaforo(memoria)
  return colorDe(limiteEfectivo(useStoreAjustes.getState().limiteContenedores, cortes), cortes) === 'rojo'
}

/** Los avisos del vigía; `vigente` es el aviso previo en pantalla, que se cambia o se quita. */
function pintar(a: AvisoSaturacion, tabs: UseTabs, vigente: { id: number | null }): void {
  const t = txSesion()
  if (vigente.id !== null) dismiss(vigente.id)
  vigente.id = null
  if (a.tipo === 'cancelado') {
    notify('info', t.saturacionCanceladoTitulo, t.saturacionCancelado(a.porcentaje))
    return
  }
  if (a.tipo === 'sin-candidatos') {
    notify('warn', t.saturacionTitulo(a.porcentaje), t.saturacionSinCandidatos)
    return
  }
  const segundos = Math.max(1, Math.round(a.plazoMs / 1000))
  vigente.id = notify('warn', t.saturacionTitulo(a.porcentaje), t.saturacionAviso(listaDe(a.proyectos, tabs), segundos), {
    vidaMs: a.plazoMs + 2_000,
    ...(a.proyectos.length > 0
      ? {
          accion: {
            etiqueta: t.saturacionOtro,
            onClick: () => {
              void window.tessera.agentTerminal.saturacionPararOtro().then((hay) => {
                if (!hay) notify('info', t.saturacionTitulo(a.porcentaje), t.saturacionSinOtro)
              })
            }
          }
        }
      : {})
  })
}

/** La parada que hizo el vigía, con la regla y, si el límite está en rojo, el recordatorio. */
function pintarParada(p: ParadaPorLimite, tabs: UseTabs, vigente: { id: number | null }): void {
  if (p.motivo !== 'saturacion') return
  if (vigente.id !== null) dismiss(vigente.id)
  vigente.id = null
  const t = txSesion()
  const proyectos = p.hibernados.map((h) => ({ profileId: h.profileId, projectHostPath: h.projectHostPath, agentes: h.sesiones.map((s) => s.agente) }))
  const lista = listaDe(proyectos, tabs)
  const detalle = lista === null ? t.saturacionSinAgentes : t.saturacionParada(lista, p.primero, proyectos.length > 1)
  notify('warn', t.saturacionTitulo(p.porcentaje ?? 0), limiteEnRojo() ? `${detalle} ${t.saturacionRojo}` : detalle)
}

/** Mantiene al vigía del main al día y pinta sus avisos. Sin los ajustes cargados no le manda nada. */
export function useSaturacionDocker(tabs: UseTabs): void {
  const a = useStoreAjustes(
    useShallow((s) => ({
      cargados: s.settingsLoaded,
      umbralPct: s.saturacionUmbral,
      segundos: s.saturacionSegundos,
      avisoPrevio: s.avisarAntesDeParar,
      primero: s.primeroEnPararse,
      protegerTrabajando: s.protegerTrabajando
    }))
  )
  const pantalla = useProyectosEnPantalla(tabs)
  useEffect(() => {
    if (!a.cargados) return
    window.tessera.agentTerminal.configurarSaturacion({
      ajustes: { umbralPct: a.umbralPct, segundos: a.segundos, avisoPrevio: a.avisoPrevio },
      politica: { primero: a.primero, protegerTrabajando: a.protegerTrabajando },
      enPantalla: pares(pantalla)
    })
  }, [a.cargados, a.umbralPct, a.segundos, a.avisoPrevio, a.primero, a.protegerTrabajando, pantalla])

  // Los avisos leen las pestañas de AHORA al llegar, no las del montaje.
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  useEffect(() => {
    const vigente = { id: null as number | null }
    const quitarAviso = window.tessera.agentTerminal.onAvisoSaturacion((aviso) => pintar(aviso, tabsRef.current, vigente))
    const quitarParada = window.tessera.agentTerminal.onParadaPorLimite((p) => pintarParada(p, tabsRef.current, vigente))
    return () => {
      quitarAviso()
      quitarParada()
    }
  }, [])
}
