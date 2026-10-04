// =============================================================================
// Una sola forma de citar para shell: `citarSh` (POSIX) y `citarPowerShell`, con comillas
// simples. Cuál toca lo decide el llamador según la shell que RECIBE la línea.
// Puro: sin `fs`, Electron ni `process`. Lo usan el main (montajes del sandbox, atajos
// `tdb`, línea del agente, git en el contenedor) y los `test-*.mts`.
// La barra invertida va por `String.fromCharCode(92)` para que ninguna edición la colapse.
// Decisiones: docs/decisiones/shared/citado-para-shell.md
// =============================================================================

/** Una barra invertida, sin escribirla literal (ver la cabecera). */
const BARRA = String.fromCharCode(92)

/**
 * Entrecomilla un argumento para `sh -c` / `bash -c` con comillas SIMPLES. Todo es
 * literal salvo la propia comilla, que se cierra, se escapa fuera y se reabre.
 */
export function citarSh(valor: string): string {
  return "'" + valor.split("'").join("'" + BARRA + "''") + "'"
}

/**
 * Entrecomilla un argumento para una línea de PowerShell (`-Command <línea>`, un
 * `.ps1`) con comillas SIMPLES: dentro sólo se escapa la comilla, duplicándola.
 * NO sirve fuera de PowerShell (`''` en POSIX es nada; ver el ADR de la cabecera).
 */
export function citarPowerShell(valor: string): string {
  return "'" + valor.split("'").join("''") + "'"
}
