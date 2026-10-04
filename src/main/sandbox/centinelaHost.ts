// =============================================================================
// Centinela de fugas del host para las pruebas de aislamiento: los tramos que, si aparecen en
// lo que ve un proceso del contenedor, delatan la ruta o la identidad del equipo. Se calculan
// en ejecución (usuario y tramos de una ruta del host), así que valen en cualquier máquina.
// Lo usan los test-*.mts del sandbox y de las terminales, y el modo captura. Solo Node core.
// =============================================================================

import os from 'node:os'

/** Tramos tan comunes que aparecerían dentro del contenedor sin que haya fuga. */
const GENERICOS = new Set([
  'users', 'home', 'dev', 'src', 'code', 'repos', 'projects', 'workspace', 'documents',
  'desktop', 'tmp', 'var', 'mnt', 'volumes', 'private', 'opt', 'agente', 'node'
])

/** Nombre del usuario del sistema; vacío si el sistema no lo da. */
function usuarioActual(): string {
  try {
    return os.userInfo().username
  } catch {
    return ''
  }
}

/**
 * Tramos de `rutaHost` (sin la letra de unidad) más el nombre de usuario y el último tramo del
 * home, en minúsculas y sin repetir. Se descartan los de menos de 3 letras, los genéricos y los
 * de `excepto` (lo que la prueba SÍ espera ver dentro, como el nombre del proyecto montado).
 */
export function tramosDelHost(rutaHost: string, excepto: readonly string[] = []): string[] {
  const fuera = new Set(excepto.map((t) => t.toLowerCase()))
  const home = os.homedir().split(/[\\/]+/).pop() ?? ''
  const candidatos = [...rutaHost.split(/[\\/]+/), usuarioActual(), home]
  const tramos = new Set<string>()
  for (const c of candidatos) {
    const t = c.toLowerCase()
    if (t.length < 3 || /^[a-z]:$/.test(t) || GENERICOS.has(t) || fuera.has(t)) continue
    tramos.add(t)
  }
  return [...tramos]
}
