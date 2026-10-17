// =============================================================================
// Ajuste de Configuración › Proyectos «Hibernar el agente inactivo tras»: los minutos sin
// actividad tras los que se cierra el agente de un proyecto que no está en pantalla.
// Puro: lo leen `workspace-state-ipc.ts`, el main (que decide) y el renderer (que lo
// enseña), y los tres tienen que llegar al mismo número. No lee la plataforma.
// Decisiones: docs/decisiones/agentes/hibernacion-por-inactividad.md
// =============================================================================
import { crearTextos } from './i18n.ts'

/** «Nunca»: el valor que se guarda en el archivo. */
export const AGENTE_INACTIVIDAD_NUNCA = 0

/** Por defecto: 5 minutos. */
export const AGENTE_INACTIVIDAD_MIN_POR_DEFECTO = 5

/** Los minutos que ofrece el selector, en orden; «Nunca» al final. */
const AGENTE_INACTIVIDAD_MINUTOS: readonly number[] = [5, 10, 15, 30, 60, AGENTE_INACTIVIDAD_NUNCA]

const txAjustesAgente = crearTextos(
  {
    minutos: (n: number) => `${n} minutos`,
    unaHora: '1 hora',
    nunca: 'Nunca',
    ayuda:
      'Cierra el agente (Claude Code o Codex) de un proyecto que no está en pantalla cuando lleva ese tiempo sin ' +
      'escribir ni recibir nada, y libera su memoria y la de sus servidores MCP. Al volver a su pestaña se reanuda ' +
      'su conversación; tarda unos segundos. No se cierra un agente que Tessera ve trabajando, con una tarea en ' +
      'segundo plano, esperando tu respuesta, con texto sin enviar o con un resultado que aún no has visto; ni ' +
      'las terminales. Solo se aplica a los proyectos en modo nativo.',
    ayudaNunca: 'Los agentes siguen abiertos hasta que cierres su pestaña, hibernes el perfil o cierres Tessera.'
  },
  {
    minutos: (n: number) => `${n} minutes`,
    unaHora: '1 hour',
    nunca: 'Never',
    ayuda:
      'Closes the agent (Claude Code or Codex) of a project that is not on screen once it has gone that long without ' +
      'typing or receiving anything, and frees its memory and that of its MCP servers. When you return to its tab its ' +
      'conversation resumes; it takes a few seconds. An agent that Tessera sees working, with a background task, ' +
      'waiting for your reply, with unsent text or with a result you have not seen yet is not closed; neither are ' +
      'terminals. It only applies to projects in native mode.',
    ayudaNunca: 'Agents stay open until you close their tab, hibernate the profile or close Tessera.'
  }
)

/** Lo que ofrece el selector, en minutos y en orden; «Nunca» al final. */
export function agenteInactividadOpciones(): readonly { min: number; etiqueta: string }[] {
  const t = txAjustesAgente()
  return AGENTE_INACTIVIDAD_MINUTOS.map((min) => ({
    min,
    etiqueta: min === AGENTE_INACTIVIDAD_NUNCA ? t.nunca : min === 60 ? t.unaHora : t.minutos(min)
  }))
}

/** Minutos SANEADOS: solo un valor de la lista (0 = Nunca); lo demás, o la ausencia, 5. */
export function normalizarInactividadAgenteMin(v: unknown): number {
  return typeof v === 'number' && AGENTE_INACTIVIDAD_MINUTOS.includes(v)
    ? v
    : AGENTE_INACTIVIDAD_MIN_POR_DEFECTO
}

/** El umbral en ms, o null con «Nunca»: quien decide no hiberna nada. */
export function inactividadAgenteMs(min: unknown): number | null {
  const m = normalizarInactividadAgenteMin(min)
  return m === AGENTE_INACTIVIDAD_NUNCA ? null : m * 60_000
}

/** Suelo del umbral de pruebas: un mando que mata procesos no puede bajar de aquí. */
export const AGENTE_INACTIVIDAD_PRUEBAS_SUELO_MS = 3000

/** Lo que pide el entorno de pruebas: un umbral en ms, apagar la función, o nada. */
export type UmbralPruebas = number | 'nunca' | null

/**
 * El umbral de PRUEBAS (`TESSERA_AGENTE_INACTIVIDAD_MS`, que solo lee el main): un entero
 * de milisegundos entre el suelo y una hora, `nunca` (la suite de interfaz apaga así la
 * función en las pruebas que no la miden), o null. No enciende nada: solo acorta el umbral,
 * o lo apaga, cuando el ajuste no es «Nunca».
 */
export function umbralPruebasDe(texto: string | undefined): UmbralPruebas {
  const t = texto?.trim()
  if (t === 'nunca') return 'nunca'
  if (t === undefined || !/^\d+$/.test(t)) return null
  const ms = Number(t)
  return ms >= AGENTE_INACTIVIDAD_PRUEBAS_SUELO_MS && ms <= 3_600_000 ? ms : null
}

/** El umbral que se aplica: «Nunca» gana siempre; el de pruebas solo sustituye a los minutos. */
export function umbralEfectivoMs(min: unknown, pruebas: UmbralPruebas): number | null {
  const real = inactividadAgenteMs(min)
  if (real === null || pruebas === 'nunca') return null
  return pruebas ?? real
}

/**
 * La ayuda de la fila. Dice solo lo que se garantiza: qué se cierra, qué muere con él y
 * qué cuesta volver.
 */
export function ayudaInactividadAgente(): string {
  return txAjustesAgente().ayuda
}

/** La ayuda de la fila con «Nunca». */
export function ayudaInactividadAgenteNunca(): string {
  return txAjustesAgente().ayudaNunca
}
