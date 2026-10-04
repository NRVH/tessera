// =============================================================================
// Entorno de los ptys de `TerminalService`: `cleanEnv` (el entorno del proceso sin
// `undefined`) y `envDocker` (qué variables de `extraEnv` cruzan a un `docker exec`).
// Solo depende de la lista blanca de `shared/db-ipc`.
// Decisiones: docs/decisiones/terminales/pty-y-detencion-de-sesion.md
// =============================================================================
import { ENV_CONTENEDOR } from '../../shared/db-ipc.ts'

/**
 * Variables de `extraEnv` que pueden cruzar a un contenedor, por nombre exacto. Lista blanca:
 * `docker exec -e K=V` pone V en el argv del proceso `docker` del host, visible para cualquier
 * proceso del usuario, así que reenviar `extraEnv` entero llevaría ahí las contraseñas de las
 * bases. Solo cruzan un token y una ruta.
 */
const DOCKER_ENV_PERMITIDAS = new Set<string>(ENV_CONTENEDOR)

/**
 * Proyecta `extraEnv` a los `-e` de `docker exec`, filtrando por la lista blanca. El PATH se
 * descarta: el del modo nativo apunta a carpetas del host que dentro del contenedor no existen.
 */
export function envDocker(extra: Record<string, string> | undefined): string[] {
  if (!extra) return []
  const args: string[] = []
  for (const [k, v] of Object.entries(extra)) {
    if (!DOCKER_ENV_PERMITIDAS.has(k)) continue
    args.push('-e', `${k}=${v}`)
  }
  return args
}

/** `process.env` sin `undefined`, como exige el tipo de node-pty. */
export function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v
  }
  return env
}
