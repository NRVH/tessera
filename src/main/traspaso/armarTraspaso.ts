// =============================================================================
// El traspaso derivado a un agente distinto: los últimos mensajes de texto del usuario y del agente de origen
// (sin herramientas, resultados, imágenes ni razonamiento), recortados a un tope con los más recientes
// primero, y el estado de git del proyecto, en un Markdown corto. También el primer mensaje del destino y su
// aviso de arranque. Es texto para el agente, no para la interfaz. Puro: lo prueba `test-traspaso.mts`.
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import { claudeMessageText, codexEventMessage, isCliWrapperText } from '../conversations/ConversationsReader.ts'
import type { LineaJsonl } from '../util/jsonlCola.ts'
import type { AgenteTraspaso } from './rutasTraspaso.ts'

/** Lo que mide como mucho la conversación del traspaso, en caracteres. */
export const TOPE_CONVERSACION = 16 * 1024
/** Un solo mensaje largo no se come el traspaso entero. */
export const TOPE_MENSAJE = 4 * 1024
/** Líneas de `git status --short` que van como mucho. */
export const MAX_LINEAS_STATUS = 60

const MARCA_RECORTE = ' […]'
const MINIMO_MENSAJE = 200

/** Un mensaje de texto de la conversación. */
export interface MensajeTexto {
  rol: 'usuario' | 'agente'
  texto: string
}

/** Texto que el CLI mete como si fuera del usuario: avisos del sistema y envoltorios de órdenes. */
function esInyectado(texto: string): boolean {
  return isCliWrapperText(texto) || /^<(system-reminder|environment_context|user_instructions)\b/.test(texto.trimStart())
}

/** El mensaje de texto de una línea de Claude Code, o null si no es uno que se lea. */
function mensajeClaude(l: LineaJsonl): MensajeTexto | null {
  if (l.type !== 'user' && l.type !== 'assistant') return null
  // Los avisos del CLI, los hilos de subagente y el resumen de una compactación no son la conversación.
  if (l.isMeta === true || l.isSidechain === true || l.isCompactSummary === true) return null
  const texto = claudeMessageText(l)
  if (!texto || (l.type === 'user' && esInyectado(texto))) return null
  return { rol: l.type === 'user' ? 'usuario' : 'agente', texto }
}

/** El mensaje de texto de una línea de Codex, o null. */
function mensajeCodex(l: LineaJsonl): MensajeTexto | null {
  const m = codexEventMessage(l)
  if (!m || (m.role === 'user' && esInyectado(m.text))) return null
  return { rol: m.role === 'user' ? 'usuario' : 'agente', texto: m.text }
}

/** El mensaje de texto de una línea de transcript, o null si no es uno que se lea. */
export function mensajeDeLinea(agente: AgenteTraspaso, l: LineaJsonl): MensajeTexto | null {
  return agente === 'codex' ? mensajeCodex(l) : mensajeClaude(l)
}

/** ¿Es el mismo mensaje que el anterior? Codex escribe algunos de dos formas seguidas: cuentan una vez. */
export function esRepetido(previo: MensajeTexto | null | undefined, m: MensajeTexto): boolean {
  return !!previo && previo.rol === m.rol && previo.texto === m.texto
}

/** Los mensajes de texto de un transcript, en orden; uno repetido seguido cuenta una vez. */
export function mensajesDeTexto(agente: AgenteTraspaso, lineas: readonly LineaJsonl[]): MensajeTexto[] {
  const fuera: MensajeTexto[] = []
  for (const l of lineas) {
    const m = mensajeDeLinea(agente, l)
    if (!m || esRepetido(fuera[fuera.length - 1], m)) continue
    fuera.push(m)
  }
  return fuera
}

function recortar(texto: string, max: number): string {
  return texto.length <= max ? texto : texto.slice(0, Math.max(0, max - MARCA_RECORTE.length)) + MARCA_RECORTE
}

/**
 * Los mensajes que caben en `tope`, de los más recientes hacia atrás, en orden de lectura, y cuántos se
 * quedaron fuera. El último siempre va, recortado si hace falta.
 */
export function recientesQueCaben(mensajes: readonly MensajeTexto[], tope: number): { mensajes: MensajeTexto[]; omitidos: number } {
  const elegidos: MensajeTexto[] = []
  let usado = 0
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const resto = tope - usado
    // Un trozo de unas pocas palabras no dice nada: con menos sitio que esto, el anterior ya no entra.
    if (elegidos.length > 0 && resto < MINIMO_MENSAJE) break
    const texto = recortar(mensajes[i].texto, Math.min(TOPE_MENSAJE, Math.max(resto, MINIMO_MENSAJE)))
    elegidos.unshift({ rol: mensajes[i].rol, texto })
    usado += texto.length
  }
  return { mensajes: elegidos, omitidos: mensajes.length - elegidos.length }
}

/** Lo que entra en el traspaso. `gitStatus`/`gitLog` a null: el proyecto no es un repositorio (o git no contestó). */
export interface EntradaTraspaso {
  /** El nombre del agente de origen y el de su cuenta, tal como se enseñan. */
  agente: string
  cuenta: string
  mensajes: readonly MensajeTexto[]
  gitStatus: string | null
  gitLog: string | null
  tope?: number
}

function bloque(texto: string): string {
  return ['```text', texto, '```'].join('\n')
}

function seccionGit(status: string | null, log: string | null): string[] {
  if (status === null && log === null) return ['El proyecto no es un repositorio de git, o git no contestó.']
  const fuera: string[] = []
  if (status !== null) {
    const lineas = status.split(/\r?\n/).filter((l) => l.trim() !== '')
    const mas = lineas.length > MAX_LINEAS_STATUS ? [`… y ${lineas.length - MAX_LINEAS_STATUS} más`] : []
    fuera.push('`git status --short`:', lineas.length === 0 ? 'Sin cambios sin commitear.' : bloque([...lineas.slice(0, MAX_LINEAS_STATUS), ...mas].join('\n')))
  }
  if (log !== null && log.trim() !== '') fuera.push('', '`git log --oneline -5`:', bloque(log.trim()))
  return fuera
}

/** El Markdown del traspaso, con sus tres encabezados fijos. */
export function armarTraspaso(e: EntradaTraspaso): string {
  const { mensajes, omitidos } = recientesQueCaben(e.mensajes, e.tope ?? TOPE_CONVERSACION)
  const conversacion: string[] = []
  if (mensajes.length === 0) conversacion.push('La conversación de origen no tiene mensajes de texto.')
  if (omitidos > 0) conversacion.push(`(Se omiten ${omitidos} mensajes anteriores.)`, '')
  for (const m of mensajes) conversacion.push(`**${m.rol === 'usuario' ? 'Usuario' : e.agente}:**`, m.texto, '')
  return [
    `# Traspaso desde ${e.agente} (${e.cuenta})`,
    '',
    '## Conversación reciente',
    '',
    ...conversacion,
    '## Estado de git',
    '',
    ...seccionGit(e.gitStatus, e.gitLog),
    ''
  ].join('\n')
}

/** El primer mensaje del agente de destino. */
export function promptInicialTraspaso(agenteOrigen: string): string {
  return `Continúas un trabajo que empezó ${agenteOrigen}. Lee el traspaso con \`tctx traspaso\`, resume en 5 líneas dónde quedó y espera instrucciones.`
}

/** El aviso de arranque del destino: sin él, Codex no oiría cómo pedir que `tctx` salga de su sandbox. */
export function avisoTraspaso(agenteOrigen: string): string {
  return `Hay un traspaso del trabajo que empezó ${agenteOrigen} en este proyecto: léelo con \`tctx traspaso\` (lo da Tessera, no está en el repositorio).`
}
