// =============================================================================
// Tipos de base de las reglas por dialecto (el dialecto, el estilo de parámetros, los PRAGMA que
// leen, la gramática local) y `deDialecto`, la validación de una tabla por dialecto.
// Sin dependencias; los reexporta `dialectosSql.ts`, que es la entrada.
// Decisiones: docs/decisiones/bd/sql-dialectos-como-tabla.md
// =============================================================================

/**
 * Los motores SQL, por su fila de reglas léxicas. Subconjunto de `DbMotor`, y cada uno es el
 * dialecto de SU motor, con el mismo id (`MOTORES[m].sql.dialecto === m`).
 */
export type DialectoSql = 'oracle' | 'postgres' | 'sqlite' | 'sqlserver'

/**
 * Los PRAGMA de SQLite que solo LEEN, en minúsculas: la MISMA lista con la que el autorizador de
 * `src/tdb/sqliteComun.cjs` (perfil de lectura) deja pasar un PRAGMA; `test-sqlite-comun` los cruza.
 */
export interface PragmasDialecto {
  /** Pasan SOLO sin valor: con `= v` (o `(v)`) escriben (`user_version`, `journal_mode`…). */
  soloSinValor: readonly string[]
  /** Pasan también con argumento, porque el argumento es un NOMBRE de objeto (`table_info(t)`). */
  conArgumento: readonly string[]
}

/** Las gramáticas que el main sabe cargar (`main/db/sintaxisLocal.ts`). */
export type GramaticaLocal = 'postgres'

/**
 * La fila de una tabla POR DIALECTO (`REGLAS`, `RESERVADAS`, `PALABRAS_CLAVE`, `SEGURO`) VALIDANDO
 * la clave: con un dialecto que no está en la tabla, «Dialecto desconocido: "x".» y no el TypeError
 * anónimo de un índice a pelo. `hasOwnProperty` y no `in` ni `!== undefined`: con `'constructor'`
 * o `'toString'` esos encuentran lo heredado de `Object.prototype`. Solo cadenas, y compatible con
 * ES2020. Lo llama cada ENTRADA del léxico al empezar; las funciones internas reciben la fila.
 */
export function deDialecto<T>(tabla: Readonly<Record<DialectoSql, T>>, d: DialectoSql): T {
  if (typeof d !== 'string' || !Object.prototype.hasOwnProperty.call(tabla, d)) {
    throw new Error(`Dialecto desconocido: "${String(d)}".`)
  }
  return tabla[d]
}
