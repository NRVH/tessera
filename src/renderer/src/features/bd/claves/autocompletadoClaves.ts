// =============================================================================
// Qué sugiere la consola de Redis: el nombre del comando (o de su subcomando: `CONFIG GET`) mientras se
// escribe la primera palabra de una línea, con su sintaxis al lado. Las claves y los argumentos no se
// sugieren: el servidor puede tener millones de claves y escribirlas es lo que el árbol ya resuelve.
// Puro, sin Monaco ni DOM; el proveedor es `proveedorClavesMonaco.ts` y la prueba `test-autocompletado-claves.mts`.
// Decisiones: docs/decisiones/bd/ui-claves-consola-historial-y-completado.md
// =============================================================================

import { COMANDOS_REDIS } from './comandosRedisCatalogo.ts'

/** Lo que ofrece una sugerencia. */
export interface CandidatoClaves {
  etiqueta: string
  /** Lo que sustituye a lo escrito. */
  insertar: string
  /** La sintaxis del comando ('' si no lleva argumentos). */
  detalle: string
}

/** Máximo de sugerencias por consulta (el catálogo entero cabe, pero una lista de cien no se lee). */
export const MAX_SUGERENCIAS_CLAVES = 60

/**
 * Lo escrito del comando si el cursor está en la primera palabra de la línea (o en la segunda de un
 * subcomando: `CONFIG G`); null en un comentario, entre comillas o en los argumentos.
 */
export function parcialDeComando(antesEnLinea: string): string | null {
  const m = /^\s*([A-Za-z][A-Za-z.]*(?: [A-Za-z-]*)?)?$/.exec(antesEnLinea)
  return m ? (m[1] ?? '') : null
}

/** Lo que en Redis Cluster no se ofrece: solo existe la base 0 y la consola no abre transacciones. */
const NO_EN_CLUSTER = new Set(['SELECT', 'SWAPDB', 'MOVE', 'MULTI', 'EXEC', 'DISCARD', 'WATCH', 'UNWATCH'])

/**
 * Los comandos cuyo nombre empieza por lo escrito, sin distinguir caja, en el orden del catálogo. Con
 * `cluster`, sin los que allí no tienen sentido.
 */
export function candidatosClaves(parcial: string, o: { cluster?: boolean } = {}): CandidatoClaves[] {
  const p = parcial.toUpperCase()
  const out: CandidatoClaves[] = []
  for (const c of COMANDOS_REDIS) {
    if (!c.nombre.startsWith(p)) continue
    if (o.cluster === true && NO_EN_CLUSTER.has(c.nombre)) continue
    out.push({ etiqueta: c.nombre, insertar: c.sintaxis === '' ? c.nombre : `${c.nombre} `, detalle: c.sintaxis })
    if (out.length >= MAX_SUGERENCIAS_CLAVES) break
  }
  return out
}
