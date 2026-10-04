// =============================================================================
// Marcas de la consola SQL: qué glifo, qué barra, qué tooltip y qué tiempo lleva cada
// sentencia de un lote en el margen del editor (la tabla estado -> presentación), la
// forma única de escribir una duración y los marcadores de compilación. Puro: el
// adaptador de Monaco (`monacoConsola.ts`) solo traduce el descriptor a decoraciones.
// Decisiones: docs/decisiones/bd/ui-consola-monaco.md
// =============================================================================

import type { DbErrorCompilacion } from '../../../../../shared/db-explorador-ipc'

/** Estado de una sentencia dentro de un lote. */
export type EstadoMarca =
  | 'pendiente'
  | 'corriendo'
  | 'ok'
  | 'error'
  | 'cancelada'
  | 'omitida'
  | 'cliente'

export interface DescriptorMarca {
  /** Clase del glifo de la primera línea (`glyphMarginClassName`). */
  claseGlifo: string
  /** Clase de la barra de 2 px sobre el rango, o null si no se ejecutó. */
  claseBarra: string | null
  /** Tooltip del glifo. */
  hover: string
  /** Texto tras el último carácter de la sentencia (`after`), o null. */
  despues: string | null
}

const MS_SEGUNDO = 1000
const MS_MINUTO = 60 * MS_SEGUNDO
const MS_HORA = 60 * MS_MINUTO

/**
 * Una duración legible. Sin `vivo`: «671 ms», «2 s 270 ms», «1 min 3 s», «2 h 5 min».
 * Con `vivo` (cronómetro de lo que corre): '' por debajo de 1 s y después segundos
 * enteros, «3 s», «1 min 3 s».
 */
export function formatoDuracion(ms: number, vivo: boolean = false): string {
  const valido = Number.isFinite(ms) && ms > 0 ? ms : 0
  const r = vivo ? Math.floor(valido) : Math.round(valido)
  if (r < MS_SEGUNDO) return vivo ? '' : `${r} ms`
  if (r < MS_MINUTO) {
    const s = Math.floor(r / MS_SEGUNDO)
    const resto = r % MS_SEGUNDO
    return vivo || resto === 0 ? `${s} s` : `${s} s ${resto} ms`
  }
  if (r < MS_HORA) {
    const m = Math.floor(r / MS_MINUTO)
    const s = Math.floor((r % MS_MINUTO) / MS_SEGUNDO)
    return s === 0 ? `${m} min` : `${m} min ${s} s`
  }
  const h = Math.floor(r / MS_HORA)
  const m = Math.floor((r % MS_HORA) / MS_MINUTO)
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Texto por defecto del tooltip de las que no traen detalle. */
export const HOVER_OMITIDA = 'No se ejecutó: el lote se detuvo antes'
export const HOVER_CLIENTE = 'Comando del cliente: no se envía al servidor'
export const HOVER_PENDIENTE = 'En cola'
/** Tooltip de la marca de un plan que llegó bien, si no trae detalle. */
export const HOVER_PLAN = 'Plan de ejecución: la sentencia NO se ejecutó'

/** El tooltip por defecto de las que no llegaron al servidor. */
const HOVER_SIN_ENVIAR: Readonly<Record<'pendiente' | 'omitida' | 'cliente', string>> = {
  pendiente: HOVER_PENDIENTE,
  omitida: HOVER_OMITIDA,
  cliente: HOVER_CLIENTE
}

/**
 * Presentación de una sentencia según su estado.
 * - `ms`: duración final, o el tiempo transcurrido si está corriendo (null = sin dato).
 * - `detalle`: resumen del resultado («40 filas», «[ORA-00942] …», el motivo de un
 *   bloqueo). Va al tooltip.
 * - `codigo`: código del error, que sustituye al tiempo detrás de la sentencia.
 * - `avisos`: avisos de compilación de una ✓ (la vuelven ámbar; en otro estado no
 *   cambian nada).
 * - `plan`: la sentencia es la de un «Explicar plan». NO SE EJECUTÓ, así que no lleva
 *   la barra de «lo ejecutado» en ningún estado, y su final bueno no es una ✓ sino su
 *   glifo propio (`db-glifo-plan`). El ✗ y el ⊘ sí son los de siempre.
 */
export function descriptorMarca(
  e: EstadoMarca,
  ms: number | null,
  detalle: string = '',
  codigo?: string | null,
  avisos: number = 0,
  plan: boolean = false
): DescriptorMarca {
  if (plan) return descriptorPlan(e, ms, detalle, codigo)
  const dur = ms !== null ? formatoDuracion(ms) : null
  if (e === 'ok' && avisos > 0) {
    const texto = detalle || `Compilado con ${avisos === 1 ? '1 aviso' : `${avisos} avisos`}`
    return { claseGlifo: 'db-glifo-avisos', claseBarra: 'db-barra-avisos', hover: conDuracion(texto, dur), despues: dur }
  }
  switch (e) {
    case 'pendiente':
    case 'omitida':
    case 'cliente':
      return { claseGlifo: `db-glifo-${e}`, claseBarra: null, hover: detalle || HOVER_SIN_ENVIAR[e], despues: null }
    default:
      return descriptorEnviada(e, ms, dur, detalle, codigo)
  }
}

function conDuracion(texto: string, dur: string | null): string {
  return dur ? `${texto} · ${dur}` : texto
}

/** Las que llegaron al servidor: son las únicas con barra de «lo ejecutado». */
function descriptorEnviada(
  e: 'corriendo' | 'ok' | 'error' | 'cancelada',
  ms: number | null,
  dur: string | null,
  detalle: string,
  codigo: string | null | undefined
): DescriptorMarca {
  const claseGlifo = `db-glifo-${e}`
  switch (e) {
    case 'corriendo': {
      const vivo = ms !== null ? formatoDuracion(ms, true) : ''
      return {
        claseGlifo,
        claseBarra: 'db-barra-corriendo',
        hover: vivo ? `Ejecutando · ${vivo}` : 'Ejecutando',
        despues: vivo || null
      }
    }
    case 'ok':
      return { claseGlifo, claseBarra: 'db-barra-ok', hover: conDuracion(detalle || 'Correcta', dur), despues: dur }
    case 'error':
      return {
        claseGlifo,
        claseBarra: 'db-barra-error',
        hover: conDuracion(detalle || 'Error', dur),
        despues: codigo ? codigo : dur
      }
    case 'cancelada':
      return { claseGlifo, claseBarra: 'db-barra-cancelada', hover: dur ? `Cancelada tras ${dur}` : 'Cancelada', despues: dur }
  }
}

/** La marca de un «Explicar plan»: nunca lleva barra, y su final bueno no es una ✓. */
function descriptorPlan(e: EstadoMarca, ms: number | null, detalle: string, codigo?: string | null): DescriptorMarca {
  if (e === 'ok') {
    const dur = ms !== null ? formatoDuracion(ms) : null
    return { claseGlifo: 'db-glifo-plan', claseBarra: null, hover: conDuracion(detalle || HOVER_PLAN, dur), despues: dur }
  }
  const base = descriptorMarca(e, ms, detalle, codigo, 0, false)
  if (e === 'corriendo') {
    const vivo = ms !== null ? formatoDuracion(ms, true) : ''
    return { ...base, claseBarra: null, hover: vivo ? `Obteniendo el plan · ${vivo}` : 'Obteniendo el plan' }
  }
  return { ...base, claseBarra: null }
}

/** Un marcador del editor por error o aviso de compilación situado. */
export interface MarcaCompilacion {
  /** UTF-16, relativo al inicio de la sentencia (lo calculó el main). */
  desplazamiento: number
  mensaje: string
  severidad: 'error' | 'aviso'
  /** Línea y columna del servidor, para el `code` del marcador («línea 3, col 5»). */
  linea: number
  columna: number
}

/**
 * Los marcadores de una lista de compilación: solo los situados (`posicion` válida),
 * ordenados por posición y, a igual posición, los errores primero. El mensaje va sin
 * espacios de más; uno vacío se sustituye por la severidad (un marcador sin texto no
 * dice nada al pasar el ratón).
 */
export function marcasCompilacion(lista: readonly DbErrorCompilacion[] | undefined): MarcaCompilacion[] {
  if (!lista || lista.length === 0) return []
  const out: MarcaCompilacion[] = []
  for (const e of lista) {
    const p = e.posicion
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0) continue
    const mensaje = (e.mensaje || '').trim() || (e.esAviso ? 'Aviso de compilación' : 'Error de compilación')
    out.push({ desplazamiento: p, mensaje, severidad: e.esAviso ? 'aviso' : 'error', linea: e.linea, columna: e.columna })
  }
  return out.sort((a, b) =>
    a.desplazamiento !== b.desplazamiento
      ? a.desplazamiento - b.desplazamiento
      : a.severidad === b.severidad
        ? 0
        : a.severidad === 'error'
          ? -1
          : 1
  )
}
