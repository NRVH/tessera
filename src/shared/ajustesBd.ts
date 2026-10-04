// =============================================================================
// Ajustes de Configuración › «Bases de datos» (tamaño de letra, filas por página, transacción al
// abrir e inactividad de la consola), con su saneado y su valor por defecto.
// Puro y ES2020: lo leen `workspace-state-ipc.ts`, el main y el renderer, y los tres tienen que
// llegar al mismo número. Solo importa los topes de `db-explorador-ipc.ts`.
// Decisiones: docs/decisiones/bd/contratos-ajustes-de-bd.md
// =============================================================================

import { DB_PAGINA_MAX, DB_PAGINA_POR_DEFECTO, type DbTxModo } from './db-explorador-ipc.ts'

// --- Filas por página ------------------------------------------------------------

/** Lo que ofrece el selector, en orden. El último es `DB_PAGINA_MAX`, que el main acepta. */
export const DB_FILAS_POR_PAGINA_OPCIONES: readonly number[] = [100, 200, 500, 1000, 2000, DB_PAGINA_MAX]

/** Por defecto, el de siempre: 500. */
export const DB_FILAS_POR_PAGINA_POR_DEFECTO = DB_PAGINA_POR_DEFECTO

/**
 * Filas por página SANEADAS: solo un valor de la lista. Cualquier otra cosa —ausente, un
 * texto, un número que no está en la lista (de una versión con otra lista, o escrito a
 * mano)— vuelve al de siempre en vez de acercarse al más próximo: un valor raro en el
 * archivo es un archivo raro, y el por defecto es lo que el usuario ya conocía.
 */
export function normalizarFilasPorPagina(v: unknown): number {
  return typeof v === 'number' && DB_FILAS_POR_PAGINA_OPCIONES.includes(v) ? v : DB_FILAS_POR_PAGINA_POR_DEFECTO
}

// --- Transacción al abrir -----------------------------------------------------------

export const DB_TX_INICIAL_POR_DEFECTO: DbTxModo = 'auto'

/** La ayuda de la fila «Transacción al abrir»: dice a quién afecta un cambio. */
export const AYUDA_TX_INICIAL =
  'Con qué modo empieza la sesión de una consola. Vale también para las pestañas abiertas que aún no han ejecutado nada; ' +
  'las que ya tienen sesión conservan su modo. En producción empiezan siempre en Manual.'

/**
 * La preferencia de Tx que trae una PETICIÓN (`txInicial` de ejecutar, explicar, tx,
 * modo, esquema, exportar y leer un valor): 'auto' o 'manual', o `undefined` si no trae
 * una válida, y entonces manda la que el main recibió por los ajustes. Distinta de
 * `normalizarTxInicial` solo en eso: ausente NO es Automática, es «la del main».
 */
export function txInicialDePeticion(v: unknown): DbTxModo | undefined {
  return v === 'manual' || v === 'auto' ? v : undefined
}

/** Solo 'auto' o 'manual'; lo demás, Automática (lo de siempre). */
export function normalizarTxInicial(v: unknown): DbTxModo {
  return txInicialDePeticion(v) ?? DB_TX_INICIAL_POR_DEFECTO
}

// --- Inactividad de la consola --------------------------------------------------------

/** «Nunca»: el valor que se guarda en el archivo. */
export const DB_INACTIVIDAD_NUNCA = 0

/** Por defecto: 30 minutos. */
export const DB_INACTIVIDAD_CONSOLA_MIN_POR_DEFECTO = 30

/** Lo que ofrece el selector, en minutos y en orden; «Nunca» al final. */
export const DB_INACTIVIDAD_CONSOLA_OPCIONES: readonly { min: number; etiqueta: string }[] = [
  { min: 15, etiqueta: '15 minutos' },
  { min: 30, etiqueta: '30 minutos' },
  { min: 60, etiqueta: '1 hora' },
  { min: 120, etiqueta: '2 horas' },
  { min: 240, etiqueta: '4 horas' },
  { min: DB_INACTIVIDAD_NUNCA, etiqueta: 'Nunca' }
]

/** Minutos SANEADOS: solo un valor de la lista (0 = Nunca); lo demás, 30. */
export function normalizarInactividadConsolaMin(v: unknown): number {
  return typeof v === 'number' && DB_INACTIVIDAD_CONSOLA_OPCIONES.some((o) => o.min === v)
    ? v
    : DB_INACTIVIDAD_CONSOLA_MIN_POR_DEFECTO
}

/**
 * El umbral que usa la máquina de estados, en ms. «Nunca» es `Infinity` y no un número
 * enorme: `ahora - ultimoUso < Infinity` es cierto siempre, sin que ningún reloj lo alcance.
 */
export function inactividadConsolaMs(min: number): number {
  const m = normalizarInactividadConsolaMin(min)
  return m === DB_INACTIVIDAD_NUNCA ? Number.POSITIVE_INFINITY : m * 60_000
}

// --- Lo que necesita el main --------------------------------------------------------------

/** Los dos ajustes que el MAIN aplica (el resto son solo del renderer). */
export interface AjustesSesionesBd {
  /** Preferencia con la que nace una consola que no es de producción ni de solo lectura. */
  txInicial: DbTxModo
  /** Umbral de inactividad de las consolas, en ms (`Infinity` = Nunca). */
  inactividadConsolaMs: number
}

export const AJUSTES_SESIONES_POR_DEFECTO: AjustesSesionesBd = {
  txInicial: DB_TX_INICIAL_POR_DEFECTO,
  inactividadConsolaMs: inactividadConsolaMs(DB_INACTIVIDAD_CONSOLA_MIN_POR_DEFECTO)
}

/**
 * Los ajustes del main a partir del slice de ajustes, SANEANDO cada campo aunque ya venga
 * saneado: el handler de `SAVE_SETTINGS` recibe lo que manda el renderer tal cual, y un
 * valor raro no puede dejar al gestor con un umbral `NaN` (que no cerraría nunca sin que
 * nadie lo hubiera pedido) ni con un modo que no existe.
 */
export function ajustesSesionesDe(
  s: { dbTxInicial?: unknown; dbConsolaInactividadMin?: unknown } | null | undefined
): AjustesSesionesBd {
  return {
    txInicial: normalizarTxInicial(s?.dbTxInicial),
    inactividadConsolaMs: inactividadConsolaMs(normalizarInactividadConsolaMin(s?.dbConsolaInactividadMin))
  }
}

/**
 * Los ajustes del main YA en ms, re-saneados: lo que aplica `GestorSesiones.fijarAjustes`
 * a lo que le llegue (hoy, siempre de `ajustesSesionesDe`, pero el gestor no puede
 * depender de eso). Solo corrige lo que rompería al gestor en silencio: un modo que no
 * existe, y un umbral que no es un número positivo (NaN no cerraría nunca, como un
 * «Nunca» que nadie eligió; 0 cerraría en cada barrido). `Infinity` es «Nunca» y vale.
 */
export function sanearAjustesSesiones(a: Partial<AjustesSesionesBd> | null | undefined): AjustesSesionesBd {
  const ms = a?.inactividadConsolaMs
  return {
    txInicial: normalizarTxInicial(a?.txInicial),
    inactividadConsolaMs: typeof ms === 'number' && ms > 0 ? ms : AJUSTES_SESIONES_POR_DEFECTO.inactividadConsolaMs
  }
}
