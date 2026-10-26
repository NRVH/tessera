// =============================================================================
// Las constancias de parada de Docker (las que guarda el main) puestas en texto para la lista
// «Últimas paradas» de Configuración › Contenedores Docker. Puro: lo prueba
// `test-constancias-paradas.mts`.
// =============================================================================

import type { ConstanciaParada, ProyectoParado } from '../../../../shared/agent-terminal-ipc.ts'
import { ETIQUETA_AGENTE } from '../../../../shared/etiquetasAgente.ts'
import { txContenedores } from './textosContenedores.ts'

/** Cuántas paradas enseña la lista. */
export const MAX_PARADAS = 20

/** Una constancia lista para pintar, una cadena por columna. */
export interface FilaParada {
  cuando: string
  motivo: string
  que: string
  regla: string
}

/** El último segmento de una ruta del host, con `/` o `\`; la ruta entera si no tiene segmentos. */
export function nombreDeCarpeta(ruta: string): string {
  const partes = ruta.split(/[\\/]+/).filter((p) => p !== '')
  return partes.length > 0 ? partes[partes.length - 1] : ruta
}

/** El agente por su nombre; un id que no es de serie (un agente manual) se deja tal cual. */
function etiquetaDeAgente(id: string): string {
  return Object.hasOwn(ETIQUETA_AGENTE, id) ? ETIQUETA_AGENTE[id as keyof typeof ETIQUETA_AGENTE] : id
}

function textoProyecto(p: ProyectoParado): string {
  const carpeta = nombreDeCarpeta(p.projectHostPath)
  return p.agentes.length === 0 ? carpeta : `${carpeta} (${p.agentes.map(etiquetaDeAgente).join(', ')})`
}

/** Una constancia en texto; la fecha en el idioma que se le pase. */
export function filaDeConstancia(c: ConstanciaParada, locale: string): FilaParada {
  const t = txContenedores()
  const motivo = c.motivo === 'limite' ? t.motivoLimite(c.limite ?? null) : t.motivoSaturacion(c.porcentaje ?? null, c.umbralPct ?? null)
  const que = c.proyectos.length === 0 ? t.sinAgentes : c.proyectos.map(textoProyecto).join('; ')
  const regla = `${t.primero[c.primero].label}, ${c.protegerTrabajando ? t.reglaProtege : t.reglaNoProtege}`
  return { cuando: new Date(c.en).toLocaleString(locale), motivo, que, regla }
}

/** Las `max` paradas más recientes, la más reciente primero, sin tocar la lista que llega. */
export function masRecientes(lista: readonly ConstanciaParada[], max: number = MAX_PARADAS): ConstanciaParada[] {
  return [...lista].sort((a, b) => b.en - a.en).slice(0, max)
}
