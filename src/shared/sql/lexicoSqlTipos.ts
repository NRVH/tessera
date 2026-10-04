// =============================================================================
// Tipos del léxico SQL: el token y su tipo, y el resultado de leer un delimitado.
// Sin dependencias; los reexporta `lexicoSql.ts`, que es la entrada del léxico.
// Decisiones: docs/decisiones/bd/sql-lexico-y-divisor-compartidos.md
// =============================================================================

export type TipoToken =
  | 'palabra'
  | 'identCitado'
  | 'cadena'
  | 'numero'
  | 'bind'
  | 'comentario'
  | 'puntoYComa'
  | 'barraSola'
  | 'parenA'
  | 'parenC'
  | 'punto'
  | 'coma'
  | 'operador'
  | 'lineaCliente'
  /** `GO` solo en su línea (SQL Server, `separadorLote`): cierra el lote y no se envía. */
  | 'separadorLote'

export interface Token {
  tipo: TipoToken
  /** Offset UTF-16 del primer carácter en el texto completo. */
  desde: number
  /** Offset UTF-16 tras el último carácter. */
  hasta: number
  /**
   * `palabra`: en MAYÚSCULAS. `identCitado`: sin comillas y con `""` -> `"`.
   * Resto: el texto crudo.
   */
  valor: string
  /** Antes del token, en su línea, solo hay blancos (o es el inicio del rango). */
  inicioDeLinea: boolean
  /** Cadena, comentario o identificador que llega al final del rango sin cerrar. */
  sinCerrar?: true
  /** La palabra `GO` de un `GO n` solo en su línea (SQL Server): no es separador; el aviso lo dice. */
  loteRepetido?: true
}

/** Dónde acaba un elemento delimitado y si llegó al final del rango sin cerrarse. */
export interface Fin {
  hasta: number
  sinCerrar: boolean
}
