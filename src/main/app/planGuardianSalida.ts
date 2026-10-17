// =============================================================================
// El guardián de la salida: un proceso aparte que nace justo antes de `app.exit` y termina la app si
// no ha salido en un plazo. Tras «sale», todo lo que quede (un pty cuya raíz sigue viva, una petición
// de libuv que no vuelve) se espera dentro del desmontaje de Node, sin JS que pueda cortarlo; desde
// fuera sí. Nunca mata por nombre ni por un pid que ya pudiera ser de otro: en Windows abre un handle
// al proceso (desde ahí el pid no se reutiliza) y comprueba que nació ANTES que el guardián; en POSIX
// solo mata mientras la app siga siendo su padre. Deja una línea en `cierre.log` antes de matar.
// Puro: la plataforma, el pid, el plazo y el registro entran por parámetro.
// Decisiones: docs/decisiones/app/cierre-ordenado.md
// =============================================================================
import path from 'node:path'
import type { Plataforma } from '../../shared/plataforma.ts'

/** Plazo tras «sale»: una salida sana tarda décimas de segundo. */
export const PLAZO_GUARDIAN_MS = 15_000
/** Cada cuánto mira el guardián POSIX si la app sigue siendo su padre. */
export const SONDEO_GUARDIAN_MS = 500

/** Marca de la línea que deja el guardián en `cierre.log` (la busca el arnés de e2e). */
export const MARCA_GUARDIAN = 'guardián:'

export interface OpcionesGuardian {
  plataforma: Plataforma
  pid: number
  plazoMs: number
  /** `cierre.log`, o `''` si no hay registro. */
  log: string
  /** `%SystemRoot%` en Windows. */
  systemRoot?: string
}

/** El programa y sus argumentos; sin shell de por medio. */
export interface PlanGuardian {
  archivo: string
  args: string[]
}

function lineaGuardian(segundos: number, pid: number): string {
  return `${MARCA_GUARDIAN} la app (pid ${pid}) no salió ${segundos} s después de «sale»; se termina`
}

/** Un literal entre comillas simples de PowerShell. */
function literalPs(texto: string): string {
  return `'${texto.replace(/'/g, "''")}'`
}

/** Un literal entre comillas simples de `sh`. */
function literalSh(texto: string): string {
  return `'${texto.replace(/'/g, `'\\''`)}'`
}

/** El guion de PowerShell. */
export function guionWindows(pid: number, plazoMs: number, log: string): string {
  const escribir = log
    ? `try { [System.IO.File]::AppendAllText(${literalPs(log)}, "[$([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ'))] " + ${literalPs(lineaGuardian(Math.round(plazoMs / 1000), pid))} + "\`n", (New-Object System.Text.UTF8Encoding $false)) } catch {}`
    : ''
  return [
    `$ErrorActionPreference = 'Stop'`,
    'try {',
    `  $p = [System.Diagnostics.Process]::GetProcessById(${pid})`,
    // Con el handle abierto, el pid ya no puede pasar a otro proceso.
    '  $null = $p.Handle',
    // Si la app ya salió y el pid es de otro, ese otro nació después que este guardián.
    '  if ($p.StartTime -ge [System.Diagnostics.Process]::GetCurrentProcess().StartTime) { exit 0 }',
    `  if ($p.WaitForExit(${plazoMs})) { exit 0 }`,
    `  ${escribir}`,
    // El árbol entero, por pid y con la ruta absoluta de `taskkill`; `Kill()` de respaldo si falla.
    `  try { & "$env:SystemRoot\\System32\\taskkill.exe" /PID ${pid} /T /F *> $null; if ($LASTEXITCODE -ne 0) { $p.Kill() } } catch { $p.Kill() }`,
    '} catch { exit 0 }'
  ].join('\n')
}

/** El guion de `sh`: sondea si la app sigue siendo su padre; al dejar de serlo, sale sin tocar nada. */
export function guionPosix(pid: number, plazoMs: number, log: string): string {
  const vueltas = Math.ceil(plazoMs / SONDEO_GUARDIAN_MS)
  const escribir = log
    ? `printf '%s\\n' "[$(date -u +%Y-%m-%dT%H:%M:%S.000Z)] "${literalSh(lineaGuardian(Math.round(plazoMs / 1000), pid))} >> ${literalSh(log)} 2>/dev/null; `
    : ''
  return [
    // Las utilidades salen de las rutas del sistema, no del PATH heredado.
    'PATH=/bin:/usr/bin:/usr/sbin:/sbin; export PATH',
    'n=0',
    `while [ "$(ps -o ppid= -p $$ 2>/dev/null | tr -d ' ')" = "${pid}" ]; do`,
    `  if [ "$n" -ge ${vueltas} ]; then ${escribir}kill -9 ${pid}; exit 0; fi`,
    `  sleep ${SONDEO_GUARDIAN_MS / 1000}`,
    '  n=$((n + 1))',
    'done'
  ].join('\n')
}

/**
 * El guardián de esta plataforma. Windows: PowerShell por ruta absoluta (el PATH heredado podría traer
 * otra) y con el guion codificado, sin citados de por medio. POSIX: `/bin/sh`.
 */
export function planGuardian(o: OpcionesGuardian): PlanGuardian {
  if (o.plataforma === 'windows') {
    const raiz = o.systemRoot || 'C:\\Windows'
    return {
      archivo: path.win32.join(raiz, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(guionWindows(o.pid, o.plazoMs, o.log), 'utf16le').toString('base64')]
    }
  }
  return { archivo: '/bin/sh', args: ['-c', guionPosix(o.pid, o.plazoMs, o.log)] }
}
