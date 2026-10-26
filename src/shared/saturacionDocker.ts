// =============================================================================
// Cuándo Docker está saturado y qué toca hacer: la memoria que usan sus contenedores por encima del
// umbral del usuario durante sus segundos (un pico no mata a nadie), el aviso previo y el respiro
// tras cada parada para que la memoria baje antes de decidir otra. Puro: lo prueba
// `test-saturacion-docker.mts`; el vigía del main solo mide y obedece.
// Decisiones: docs/decisiones/sandbox/saturacion-de-docker.md
// =============================================================================

import type { VigiaSaturacionConfig } from './agent-terminal-ipc.ts'
import { normalizarCupo } from './semaforoContenedores.ts'

export const UMBRALES_SATURACION = [80, 85, 90, 95] as const
export const SEGUNDOS_SATURACION = [15, 30, 60, 120] as const

/** Lo que el usuario decide de la saturación; son proporciones y tiempos, así que viajan en la copia de configuración. */
export interface AjustesSaturacion {
  /** Porcentaje de la memoria de Docker a partir del que se considera saturado. */
  umbralPct: number
  /** Cuánto tiene que durar por encima antes de actuar. */
  segundos: number
  /** Avisar y esperar `AVISO_PREVIO_MS` antes de parar, con la opción de elegir otro. */
  avisoPrevio: boolean
}

export const SATURACION_POR_DEFECTO: AjustesSaturacion = { umbralPct: 90, segundos: 30, avisoPrevio: true }

/** Lo que dura el aviso antes de parar. */
export const AVISO_PREVIO_MS = 30_000
/** El respiro tras parar uno: lo que tarda Docker en devolver su memoria y en verse en la medida. */
export const ENFRIAMIENTO_MS = 20_000

/** Los tres ajustes leídos de un archivo de ajustes: lo que no valga, al de serie. */
export function normalizarSaturacion(obj: Record<string, unknown>): {
  saturacionUmbral: number
  saturacionSegundos: number
  avisarAntesDeParar: boolean
} {
  const u = obj.saturacionUmbral
  const s = obj.saturacionSegundos
  return {
    saturacionUmbral: (UMBRALES_SATURACION as readonly unknown[]).includes(u) ? (u as number) : SATURACION_POR_DEFECTO.umbralPct,
    saturacionSegundos: (SEGUNDOS_SATURACION as readonly unknown[]).includes(s) ? (s as number) : SATURACION_POR_DEFECTO.segundos,
    avisarAntesDeParar: typeof obj.avisarAntesDeParar === 'boolean' ? obj.avisarAntesDeParar : SATURACION_POR_DEFECTO.avisoPrevio
  }
}

/**
 * La configuración que llega del renderer, validada: los ajustes y la política fuera de rango van al
 * de serie y la lista de lo que se ve se queda con lo que tenga forma. null si no es un objeto.
 */
export function sanearConfigSaturacion(x: unknown): VigiaSaturacionConfig | null {
  if (typeof x !== 'object' || x === null) return null
  const c = x as { ajustes?: unknown; politica?: unknown; enPantalla?: unknown }
  const aj = typeof c.ajustes === 'object' && c.ajustes !== null ? (c.ajustes as Record<string, unknown>) : {}
  const pol = typeof c.politica === 'object' && c.politica !== null ? (c.politica as Record<string, unknown>) : {}
  const s = normalizarSaturacion({ saturacionUmbral: aj.umbralPct, saturacionSegundos: aj.segundos, avisarAntesDeParar: aj.avisoPrevio })
  const cupo = normalizarCupo({ primeroEnPararse: pol.primero, protegerTrabajando: pol.protegerTrabajando })
  const enPantalla = (Array.isArray(c.enPantalla) ? c.enPantalla : [])
    .filter(
      (v): v is { profileId: string; projectHostPath: string } =>
        typeof v === 'object' && v !== null && typeof v.profileId === 'string' && typeof v.projectHostPath === 'string'
    )
    .map((v) => ({ profileId: v.profileId, projectHostPath: v.projectHostPath }))
  return {
    ajustes: { umbralPct: s.saturacionUmbral, segundos: s.saturacionSegundos, avisoPrevio: s.avisarAntesDeParar },
    politica: { primero: cupo.primeroEnPararse, protegerTrabajando: cupo.protegerTrabajando },
    enPantalla
  }
}

const UNIDADES: Record<string, number> = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4
}

/** Bytes de una cantidad de `docker stats` («512MiB», «1.5GiB», «0B»); null si no se entiende. */
export function bytesDeCantidad(texto: string): number | null {
  const m = /^\s*([0-9]+(?:\.[0-9]+)?)\s*([a-z]+)\s*$/i.exec(texto)
  if (!m) return null
  const factor = UNIDADES[m[2].toLowerCase()]
  return factor === undefined ? null : Number.parseFloat(m[1]) * factor
}

/**
 * La memoria que usan todos los contenedores, sumando la columna «MemUsage» de `docker stats`
 * («usado / límite», una línea por contenedor). Una línea que no se entiende no cuenta; si no se
 * entiende ninguna habiendo líneas, null: mejor no actuar que actuar con una medida rota.
 */
export function usoDeStats(salida: string): number | null {
  const lineas = salida.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lineas.length === 0) return 0
  let total = 0
  let entendidas = 0
  for (const l of lineas) {
    const b = bytesDeCantidad(l.split('/')[0] ?? '')
    if (b === null) continue
    total += b
    entendidas++
  }
  return entendidas === 0 ? null : total
}

/** Una medida: lo que usan los contenedores y lo que tiene Docker. */
export interface MuestraMemoria {
  usoBytes: number
  totalBytes: number
}

export type FaseVigia = 'normal' | 'sostenido' | 'avisando' | 'enfriando'

export interface EstadoVigia {
  fase: FaseVigia
  /** `sostenido`: desde cuándo está por encima. */
  desde: number | null
  /** `avisando` y `enfriando`: cuándo acaban. */
  hasta: number | null
}

export const VIGIA_INICIAL: EstadoVigia = { fase: 'normal', desde: null, hasta: null }

/**
 * `avisar`: empieza el aviso previo; `parar`: toca parar uno ya; `cancelar`: la memoria bajó durante el
 * aviso (no se para nada); `nada`: seguir midiendo.
 */
export type AccionVigia = 'nada' | 'avisar' | 'parar' | 'cancelar'

export interface PasoVigia {
  estado: EstadoVigia
  accion: AccionVigia
  /** El porcentaje medido, redondeado; null sin medida. */
  porcentaje: number | null
}

export interface TiemposVigia {
  avisoMs: number
  enfriamientoMs: number
}

const TIEMPOS: TiemposVigia = { avisoMs: AVISO_PREVIO_MS, enfriamientoMs: ENFRIAMIENTO_MS }

/** La saturación ya sostenida: avisar o parar según el ajuste. */
function actuar(aj: AjustesSaturacion, ahora: number, t: TiemposVigia, porcentaje: number): PasoVigia {
  if (aj.avisoPrevio) return { estado: { fase: 'avisando', desde: null, hasta: ahora + t.avisoMs }, accion: 'avisar', porcentaje }
  return { estado: { fase: 'enfriando', desde: null, hasta: ahora + t.enfriamientoMs }, accion: 'parar', porcentaje }
}

/**
 * Un paso del vigía con la medida de ahora. Sin medida no se decide nada (ni se para ni se cancela un
 * aviso: Docker que no responde no es Docker que se recuperó), pero la cuenta de los segundos se pierde. Tras parar uno, al acabar el respiro,
 * si sigue saturado se actúa sin volver a esperar los segundos: es la misma racha.
 */
export function pasoVigia(
  e: EstadoVigia,
  muestra: MuestraMemoria | null,
  aj: AjustesSaturacion,
  ahora: number,
  t: TiemposVigia = TIEMPOS
): PasoVigia {
  if (muestra === null || !(muestra.totalBytes > 0) || !Number.isFinite(muestra.usoBytes)) {
    // Un hueco sin medida no cuenta como tiempo por encima: la racha sostenida vuelve a empezar.
    return { estado: e.fase === 'sostenido' ? VIGIA_INICIAL : e, accion: 'nada', porcentaje: null }
  }
  const porcentaje = Math.round((muestra.usoBytes / muestra.totalBytes) * 100)
  const encima = porcentaje >= aj.umbralPct
  if (e.fase === 'enfriando') {
    if (ahora < (e.hasta ?? 0)) return { estado: e, accion: 'nada', porcentaje }
    return encima ? actuar(aj, ahora, t, porcentaje) : { estado: VIGIA_INICIAL, accion: 'nada', porcentaje }
  }
  if (!encima) return { estado: VIGIA_INICIAL, accion: e.fase === 'avisando' ? 'cancelar' : 'nada', porcentaje }
  if (e.fase === 'avisando') {
    if (ahora < (e.hasta ?? 0)) return { estado: e, accion: 'nada', porcentaje }
    return { estado: { fase: 'enfriando', desde: null, hasta: ahora + t.enfriamientoMs }, accion: 'parar', porcentaje }
  }
  const desde = e.fase === 'sostenido' && e.desde !== null ? e.desde : ahora
  if (ahora - desde >= aj.segundos * 1000) return actuar(aj, ahora, t, porcentaje)
  return { estado: { fase: 'sostenido', desde, hasta: null }, accion: 'nada', porcentaje }
}
