// =============================================================================
// Constantes de módulo del panel de Log cuya IDENTIDAD importa: llegan a hijos y a
// efectos, y un array o un Set nuevo por render los repintaría enteros.
// Sin imports de valor: es hoja, así que no puede formar ciclos.
// =============================================================================

import type { Commit } from '../../../../shared/git-ipc'

/** Referencia estable de «sin commits» (evita crear un array nuevo por render). */
export const SIN_COMMITS: Commit[] = []

/** Referencia estable de «sin hashes» (evita repintar la lista por un Set nuevo). */
export const SIN_HASHES: ReadonlySet<string> = new Set<string>()

/** Antirrebote de la apertura automática, en ms (ver el ADR de apertura). */
export const AUTO_ABRIR_MS = 180
