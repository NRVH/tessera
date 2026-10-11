// =============================================================================
// Entorno de los ptys de `TerminalService`: `cleanEnv` (el entorno del proceso sin
// `undefined` ni las variables del AppImage) y `envDocker` (qué variables de `extraEnv`
// cruzan a un `docker exec`).
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

/**
 * Las que pone el arranque de un AppImage y solo describen a Tessera: heredadas, otra app
 * lanzada desde una terminal se creería ese AppImage (y su actualizador lo sustituiría) o
 * buscaría sus archivos en un montaje que desaparece al cerrar Tessera.
 */
const VARIABLES_DEL_APPIMAGE = new Set(['APPIMAGE', 'APPDIR', 'OWD', 'ARGV0'])

/** `process.env` sin `undefined` (como exige el tipo de node-pty) y sin las del AppImage. */
export function cleanEnv(entorno: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(entorno)) {
    if (v !== undefined && !VARIABLES_DEL_APPIMAGE.has(k)) env[k] = v
  }
  return env
}
