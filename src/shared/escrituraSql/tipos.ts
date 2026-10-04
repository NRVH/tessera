// =============================================================================
// El contrato de cómo escribe SQL cada motor para que una persona lo lea o lo corra en su cliente:
// el literal de una celda, el guion INSERT y la vista previa de «Enviar».
// Solo `import type`; lo importan el renderer y el main. Neutral y ES2020.
// Decisiones: docs/decisiones/bd/escritura-sql-contrato-por-motor.md
// =============================================================================

import type { DbTipoLogico } from '../db-explorador-ipc.ts'
import type { ColumnaFormato, EscritorFilas } from '../formatosFilas.ts'

/**
 * Lo que cierra una sentencia enseñada en un guion: `;` tras una sentencia, y la `/` en
 * su línea tras un bloque (la vista de Oracle en un EXECUTE IMMEDIATE).
 */
export type TerminadorSql = ';' | '\n/'

/** La sentencia de un cambio de «Enviar» tal como se ENSEÑA, con su terminador. */
export interface VistaDml {
  vista: string
  terminador: TerminadorSql
}

export interface EscrituraSqlMotor {
  /**
   * El literal de una celda que NO es NULL (el NULL lo escribe quien llama), en SEGMENTOS:
   * juntos con un espacio son el literal, y entre dos se puede partir la línea. `comoClob`:
   * el texto largo va como lo que se INSERTA o se asigna (puede ser un CLOB) y no como lo
   * que se COMPARA en un WHERE (ver `literalComparacionSql`).
   */
  segmentosLiteral(v: string | boolean, tipo: DbTipoLogico | undefined, comoClob: boolean): string[]
  /**
   * El guion INSERT, por trozos. `cabeza` es `INSERT INTO tabla (a, b) VALUES (` ya montada;
   * `tabla` (citada) y `nombres` (las columnas citadas) son sus piezas, para el motor que
   * tenga que partir la sentencia (Oracle, por las líneas de SQL*Plus).
   */
  escritorInsert(cabeza: string, columnas: readonly ColumnaFormato[], tabla: string, nombres: readonly string[]): EscritorFilas
  /**
   * Cómo se enseña la sentencia de UN cambio en la vista previa de «Enviar»: `vista` es la
   * sentencia con los valores como literales, y `nombres` los nombres que cita tal cual (sin
   * comillas), que es lo que el cliente de línea puede romper y un literal no.
   */
  vistaDml(vista: string, nombres: readonly string[]): VistaDml
}
