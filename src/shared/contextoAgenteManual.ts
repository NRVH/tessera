// =============================================================================
// De dónde sale el contexto de un agente manual: un comando o un archivo que dan JSON (o
// JSON Lines) y en qué campos están lo usado y el máximo. Aquí, la validación de esa fuente
// y la lectura de su salida hasta el porcentaje. Puro: sin `fs`, Electron ni `process`; lo
// usan el main, el renderer y los `test-*.mts`.
// Decisiones: docs/decisiones/agentes/agentes-manuales.md
// =============================================================================
import { txContextoAgente } from './textosAgentes.ts'

export type OrigenContexto = 'comando' | 'archivo'

export interface FuenteContexto {
  origen: OrigenContexto
  /** La orden de shell o la ruta del archivo (`~/…` es la casa del agente; relativa, del proyecto). */
  valor: string
  /** Campo de lo usado, con puntos y corchetes: `context.used`, `turnos[-1].tokens`. */
  usado: string
  /** Campo del máximo, o el máximo como número fijo (`200000`). */
  maximo: string
}

export const MAX_VALOR_FUENTE = 500
export const MAX_CAMPO = 120
/** Lo que se lee del final de un archivo: un registro largo solo importa por sus últimas líneas. */
export const TOPE_LECTURA_BYTES = 256 * 1024
/** Líneas que se prueban desde el final cuando la salida es JSON Lines. */
const MAX_LINEAS_PROBADAS = 500

const RE_CAMPO = /^(?:[^.[\]\s]+|\[-?\d+\])(?:\.[^.[\]\s]+|\[-?\d+\])*$/
const RE_NUMERO_FIJO = /^\d+$/

type Campos = Record<string, unknown>

/** ¿Lleva saltos u otros caracteres de control? (Un campo o una orden es una sola línea.) */
function tieneControl(valor: string): boolean {
  for (let i = 0; i < valor.length; i++) {
    const c = valor.charCodeAt(i)
    if (c !== 9 && (c < 32 || c === 127)) return true
  }
  return false
}

function errorDeCampo(campo: 'usado' | 'maximo', valor: string): string | null {
  const t = txContextoAgente()[campo]
  if (!valor) return t.falta
  if (valor.length > MAX_CAMPO) return t.pasaDe(MAX_CAMPO)
  if (!RE_NUMERO_FIJO.test(valor) && !RE_CAMPO.test(valor)) return t.noValido
  return null
}

export type ResultadoFuente = { ok: true; valor: FuenteContexto | undefined } | { ok: false; error: string }

/** Valida la fuente tal como llega; `undefined` o `null` es «sin contexto», que también vale. */
export function validarFuenteContexto(raw: unknown): ResultadoFuente {
  if (raw === undefined || raw === null) return { ok: true, valor: undefined }
  const t = txContextoAgente()
  if (typeof raw !== 'object') return { ok: false, error: t.noEsObjeto }
  const c = raw as Campos
  const origen = c.origen
  if (origen !== 'comando' && origen !== 'archivo') return { ok: false, error: t.comandoOArchivo }
  const leer = (k: string): string => (typeof c[k] === 'string' ? (c[k] as string).trim() : '')
  const valor = leer('valor')
  const usado = leer('usado')
  const maximo = leer('maximo')
  const queEs = t[origen]
  if (!valor) return { ok: false, error: queEs.falta }
  if (valor.length > MAX_VALOR_FUENTE) return { ok: false, error: queEs.pasaDe(MAX_VALOR_FUENTE) }
  if (tieneControl(valor)) return { ok: false, error: queEs.unaLinea }
  if (RE_NUMERO_FIJO.test(usado)) return { ok: false, error: t.usadoNoNumero }
  const error = errorDeCampo('usado', usado) ?? errorDeCampo('maximo', maximo)
  if (error) return { ok: false, error }
  return { ok: true, valor: { origen, valor, usado, maximo } }
}

/** Los pasos de un campo: `a.b[0]` -> `['a', 'b', 0]`; los índices negativos cuentan desde el final. */
function pasosDe(campo: string): Array<string | number> {
  const pasos: Array<string | number> = []
  for (const m of campo.matchAll(/([^.[\]]+)|\[(-?\d+)\]/g)) pasos.push(m[2] !== undefined ? Number(m[2]) : m[1])
  return pasos
}

/** El valor de `campo` dentro de `dato`, o `undefined` si el camino no existe. */
export function valorEnCampo(dato: unknown, campo: string): unknown {
  let actual = dato
  for (const paso of pasosDe(campo)) {
    if (typeof paso === 'number') {
      if (!Array.isArray(actual)) return undefined
      actual = actual[paso < 0 ? actual.length + paso : paso]
    } else {
      if (typeof actual !== 'object' || actual === null) return undefined
      actual = (actual as Campos)[paso]
    }
  }
  return actual
}

/** Un número de verdad (o un texto que lo es entero), finito y no negativo. */
function comoNumero(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

export type LecturaContexto = { ok: true; usado: number; maximo: number; percent: number } | { ok: false; error: string }

/** Lo usado y el máximo de un objeto ya parseado; null si el objeto no los trae. */
function lecturaDe(dato: unknown, campos: Pick<FuenteContexto, 'usado' | 'maximo'>): { usado: number; maximo: number } | null {
  const usado = comoNumero(valorEnCampo(dato, campos.usado))
  const maximo = RE_NUMERO_FIJO.test(campos.maximo) ? Number(campos.maximo) : comoNumero(valorEnCampo(dato, campos.maximo))
  return usado === null || maximo === null ? null : { usado, maximo }
}

function parsear(texto: string): unknown {
  try {
    return JSON.parse(texto)
  } catch {
    return undefined
  }
}

/**
 * Lee lo usado y el máximo de la salida: un JSON entero o, si no lo es o no trae los campos,
 * la línea más reciente de un JSON Lines que sí los traiga (la primera puede venir cortada
 * por el tope de lectura).
 */
export function leerContexto(texto: string, campos: Pick<FuenteContexto, 'usado' | 'maximo'>): LecturaContexto {
  let par = lecturaDe(parsear(texto.trim()), campos)
  if (!par) {
    const lineas = texto.split(/\r?\n/)
    for (let i = lineas.length - 1, probadas = 0; i >= 0 && probadas < MAX_LINEAS_PROBADAS && !par; i--) {
      const l = lineas[i].trim()
      if (!l) continue
      probadas++
      par = lecturaDe(parsear(l), campos)
    }
  }
  if (!par) return { ok: false, error: txContextoAgente().salidaSinNumeros(campos.usado) }
  if (par.maximo <= 0) return { ok: false, error: txContextoAgente().maximoCero }
  const percent = Math.min(100, Math.max(0, Math.round((par.usado / par.maximo) * 100)))
  return { ok: true, usado: par.usado, maximo: par.maximo, percent }
}
