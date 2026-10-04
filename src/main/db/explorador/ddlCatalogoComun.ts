// =============================================================================
// Utilidades del «Ver DDL» que comparten los generadores de todos los motores.
// Puro y sin dependencias: `motores/ddl*.ts` lo importan y `ddlCatalogo.ts` lo re-exporta.
// Decisiones: docs/decisiones/bd/catalogo-ddl.md
// =============================================================================

/** Literal de cadena SQL (comillas simples duplicadas). Vale para todos los motores. */
export function literalCadena(s: string): string {
  return "'" + s.split("'").join("''") + "'"
}

/** Quita blancos y un `;` final: el generador pone el suyo. */
export function sinTerminador(s: string): string {
  return s.replace(/\s+$/, '').replace(/;$/, '').replace(/\s+$/, '')
}
