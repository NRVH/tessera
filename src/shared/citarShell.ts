// =============================================================================
// Una sola forma de citar para shell: `citarSh` (POSIX) y `citarPowerShell`, con comillas
// simples, y `rutaParaCmd` para una ruta en un `.cmd`. Cuál toca lo decide el llamador según la
// shell que RECIBE la línea.
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

/** Las variables de carpetas del usuario que cmd expande en Unicode, de la más concreta a la más general. */
const CARPETAS_CMD = ['LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'ProgramFiles']

/** Si el texto es todo ASCII. */
function esAscii(s: string): boolean {
  return [...s].every((c) => c.charCodeAt(0) < 0x80)
}

/** Si el carácter es un separador de ruta de Windows (barra invertida o normal). */
function esSeparador(c: string | undefined): boolean {
  return c === BARRA || c === '/'
}

/**
 * Una ruta para una línea de un `.cmd` (`set "X=<ruta>"`). cmd lee el archivo en la página de
 * códigos de la consola, así que una «ñ» en la ruta (la del usuario, casi siempre) llegaría
 * cambiada: si la ruta no es ASCII y empieza por una carpeta del usuario, se escribe con su
 * variable (`%LOCALAPPDATA%` y el resto), que cmd expande ya en Unicode. Los `%` literales van
 * doblados. `env` es el entorno del main; sin él solo se doblan los `%`.
 */
export function rutaParaCmd(ruta: string, env: Readonly<Record<string, string | undefined>> = {}): string {
  const doblar = (s: string): string => s.split('%').join('%%')
  if (esAscii(ruta)) return doblar(ruta)
  const valor = (nombre: string): string | undefined => env[Object.keys(env).find((k) => k.toUpperCase() === nombre.toUpperCase()) ?? '']
  for (const nombre of CARPETAS_CMD) {
    let base = valor(nombre) ?? ''
    while (esSeparador(base.at(-1))) base = base.slice(0, -1)
    if (!base) continue
    const resto = ruta.slice(base.length)
    if (ruta.toLowerCase().startsWith(base.toLowerCase()) && esSeparador(resto[0]) && esAscii(resto)) return `%${nombre}%${doblar(resto)}`
  }
  return doblar(ruta)
}
