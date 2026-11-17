// =============================================================================
// Buscar el programa de un agente manual con la shell de las sesiones nativas: la orden (pura,
// con el nombre citado para esa shell, porque lo escribió el usuario) y la lectura de su
// salida, que solo vale si es una ruta (un alias o una función no se pueden lanzar igual).
// =============================================================================

import type { Plataforma } from '../../../shared/plataforma.ts'
import { citarPowerShell, citarSh } from '../../../shared/citarShell.ts'

/** Orden que imprime la ruta del programa, o nada (y sale con error) si no lo encuentra. */
export function ordenBuscarPrograma(programa: string, plataforma: Plataforma): string {
  if (plataforma === 'windows') return `(Get-Command ${citarPowerShell(programa)} -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source`
  return `command -v ${citarSh(programa)}`
}

/** La ruta leída de la salida, o null si no es una ruta de esa plataforma. */
export function rutaDeSalida(salida: string, plataforma: Plataforma): string | null {
  const primera = salida.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  const esRuta = plataforma === 'windows' ? /^(?:[A-Za-z]:[\\/]|\\\\)/.test(primera) : primera.startsWith('/')
  return esRuta ? primera : null
}
