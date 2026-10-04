// =============================================================================
// La tabla de procesos de Windows (`Get-CimInstance Win32_Process` por PowerShell), para quien
// necesite saber QUIÉN tiene abierta una carpeta: `update/installDirLock.ts` antes de aplicar
// una actualización y `agents/procesosBloqueo.ts` antes de reinstalar un CLI (npm no sustituye
// una carpeta con un ejecutable vivo dentro). Solo Windows: en macOS un ejecutable vivo no
// impide sustituir su carpeta, y fuera de Windows no se finge una tabla vacía (la síncrona
// lanza, la asíncrona devuelve `ok: false`). Lo puro se prueba en `agents/test-procesos-bloqueo.mts`.
// Decisiones: docs/decisiones/actualizacion/relevo-de-windows.md
// =============================================================================

import { execFile, execFileSync } from 'node:child_process'
import { esWindows } from '../../shared/plataforma.ts'
import { withSep } from './installDirLockPure.ts'

/** Un proceso vivo, tal como lo da Windows. */
export interface ProcesoSistema {
  pid: number
  /**
   * Pid del padre SEGÚN WINDOWS, o null si no vino. Ojo (ver `guionListado`): no se
   * reescribe al morir el padre y el pid puede estar ya reutilizado.
   */
  ppid: number | null
  /** Nombre del ejecutable (`codex.exe`); '' si Windows no lo dio. */
  nombre: string
  /**
   * Ruta completa del ejecutable; '' cuando Windows no la da (procesos del sistema o
   * elevados vistos desde un proceso sin elevar). Se conservan igualmente: son
   * eslabones de la cadena de padres.
   */
  ruta: string
  /** Línea de comandos, sólo si se pidió (`conLineaComando`) y Windows la dio. */
  lineaComando?: string
}

export interface OpcionesListado {
  /**
   * Sólo los procesos cuyo ejecutable cuelga de esta carpeta (se añade la barra final
   * para que `…\Tessera` no case `…\TesseraOtra`). El filtro se hace DENTRO de
   * PowerShell para que la salida sea diminuta. Sin él, la tabla entera.
   */
  bajoRaiz?: string
  /** Pedir también la línea de comandos (cuesta bytes, no tiempo; ver `guionListado`). */
  conLineaComando?: boolean
  /** Tope de la llamada a PowerShell, en ms. */
  timeoutMs?: number
}

/** Resultado de la consulta asíncrona: la tabla, o por qué no se pudo ver. */
export type ResultadoListado = { ok: true; procesos: ProcesoSistema[] } | { ok: false; error: string }

/** Variable de entorno por la que viaja la raíz del filtro (sin entrecomillar nada). */
const VAR_RAIZ = 'TESSERA_RAIZ_PROCESOS'
const TIMEOUT_POR_DEFECTO_MS = 10_000
/** La tabla entera con líneas de comandos ronda 300 KB; el margen es para equipos cargados. */
const TOPE_SALIDA = 32 * 1024 * 1024

/**
 * El guion de PowerShell que produce la tabla en JSON. Puro. La raíz del filtro NO se
 * interpola: la lee de `$env:TESSERA_RAIZ_PROCESOS`, así que una carpeta con comillas,
 * `$` o backticks no puede romper el guion ni inyectar nada.
 *
 * CIM y no `tasklist` (no da ruta ni padre) ni `wmic` (retirado en Windows 11): da las
 * cinco columnas en una consulta (~1,3 s con 600 procesos). `CommandLine` no cuesta
 * tiempo sino bytes (×4), así que se pide solo cuando hace falta. La salida se fija a
 * UTF-8 al principio, en un `try`: PowerShell 5.1 escribe en la página OEM de la consola
 * y una ruta con tilde no casaba con el filtro por prefijo, así que el proceso que había
 * que matar no se mataba, en silencio. El `ParentProcessId` no se reescribe al morir el
 * padre y los pid se reutilizan: un huérfano puede aparentar descender de otro proceso.
 */
export function guionListado(opts: { bajoRaiz?: boolean; conLineaComando?: boolean } = {}): string {
  const columnas =
    'pid = $_.ProcessId; ppid = $_.ParentProcessId; name = $_.Name; path = $_.ExecutablePath' +
    (opts.conLineaComando ? '; cmd = $_.CommandLine' : '')
  return (
    'try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}; ' +
    (opts.bajoRaiz ? `$root = $env:${VAR_RAIZ}; ` : '') +
    'Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ' +
    (opts.bajoRaiz
      ? 'Where-Object { $_.ExecutablePath -and ' +
        '$_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) } | '
      : '') +
    `ForEach-Object { [pscustomobject]@{ ${columnas} } } | ` +
    'ConvertTo-Json -Compress'
  )
}

/**
 * Parsea la salida de `guionListado`. Tolerante a lo que hace `ConvertTo-Json`: un
 * OBJETO suelto con un resultado, un ARRAY con varios y NADA con cero. Descarta las
 * entradas sin pid válido; conserva las que no traen ruta (con `ruta: ''`).
 *
 * Devuelve `null` si la salida no es JSON: no es lo mismo «no hay procesos» que «no
 * sé leer lo que ha dicho PowerShell», y quien decide con la tabla lo necesita saber.
 */
export function parsearTablaProcesos(raw: string): ProcesoSistema[] | null {
  const recortado = raw.trim()
  if (!recortado) return []
  let data: unknown
  try {
    data = JSON.parse(recortado)
  } catch {
    return null
  }
  const lista = Array.isArray(data) ? data : [data]
  const out: ProcesoSistema[] = []
  for (const item of lista) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const pid = typeof o.pid === 'number' ? o.pid : Number(o.pid)
    if (!Number.isInteger(pid) || pid <= 0) continue
    const ppidCrudo = typeof o.ppid === 'number' ? o.ppid : o.ppid == null ? NaN : Number(o.ppid)
    const proceso: ProcesoSistema = {
      pid,
      ppid: Number.isInteger(ppidCrudo) && ppidCrudo >= 0 ? ppidCrudo : null,
      nombre: typeof o.name === 'string' ? o.name : '',
      ruta: typeof o.path === 'string' ? o.path : ''
    }
    if (typeof o.cmd === 'string') proceso.lineaComando = o.cmd
    out.push(proceso)
  }
  return out
}

/**
 * Argumentos y entorno de la llamada a PowerShell (los mismos para las dos variantes). Las
 * dos pasan `windowsHide`: desde un proceso GUI, un `powershell.exe` sin esa opción abre una
 * consola VISIBLE (un parpadeo negro al cerrar la app).
 */
function invocacion(opts: OpcionesListado): { args: string[]; env: NodeJS.ProcessEnv } {
  const script = guionListado({ bajoRaiz: opts.bajoRaiz !== undefined, conLineaComando: opts.conLineaComando })
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (opts.bajoRaiz !== undefined) env[VAR_RAIZ] = withSep(opts.bajoRaiz.replace(/\//g, '\\'))
  return { args: ['-NoProfile', '-NonInteractive', '-Command', script], env }
}

/**
 * Consulta SÍNCRONA. Bloquea el hilo mientras PowerShell responde (hasta el tope), así
 * que sólo vale donde bloquear no importa: el cierre de la app para actualizarse, que
 * es su único llamador (`installDirLock`). LANZA si PowerShell falla o vence el tope, o
 * fuera de Windows; una salida ilegible se trata como tabla vacía, que el llamador ya
 * interpreta como «no veo bloqueadores» (era lo que hacía el parser propio que tuvo
 * `installDirLock` antes de compartir esta consulta).
 */
export function listarProcesosWindowsSync(opts: OpcionesListado = {}): ProcesoSistema[] {
  if (!esWindows()) throw new Error('la tabla de procesos sólo se consulta en Windows')
  const { args, env } = invocacion(opts)
  const out = execFileSync('powershell.exe', args, {
    timeout: opts.timeoutMs ?? TIMEOUT_POR_DEFECTO_MS,
    encoding: 'utf8',
    env,
    maxBuffer: TOPE_SALIDA,
    windowsHide: true
  })
  return parsearTablaProcesos(out) ?? []
}

/**
 * Consulta ASÍNCRONA, para el main en marcha (no congela la interfaz ~1 s). Nunca
 * rechaza: fuera de Windows, con PowerShell caído, con el tope vencido o con una salida
 * ilegible devuelve `ok: false` y el motivo, para que «no pude mirar» no se confunda
 * con «no hay nadie».
 */
export function listarProcesosWindows(opts: OpcionesListado = {}): Promise<ResultadoListado> {
  if (!esWindows()) {
    return Promise.resolve({ ok: false, error: 'la tabla de procesos sólo se consulta en Windows' })
  }
  return new Promise((resolve) => {
    try {
      const { args, env } = invocacion(opts)
      execFile(
        'powershell.exe',
        args,
        {
          timeout: opts.timeoutMs ?? TIMEOUT_POR_DEFECTO_MS,
          encoding: 'utf8',
          env,
          maxBuffer: TOPE_SALIDA,
          windowsHide: true
        },
        (error, stdout) => {
          if (error) {
            resolve({
              ok: false,
              error: error.killed
                ? `PowerShell no respondió en ${opts.timeoutMs ?? TIMEOUT_POR_DEFECTO_MS} ms`
                : `no se pudo consultar la tabla de procesos: ${error.message}`
            })
            return
          }
          const procesos = parsearTablaProcesos(stdout)
          resolve(
            procesos === null
              ? { ok: false, error: 'PowerShell devolvió una tabla de procesos ilegible' }
              : { ok: true, procesos }
          )
        }
      )
    } catch (e) {
      resolve({ ok: false, error: `no se pudo lanzar PowerShell: ${String(e)}` })
    }
  })
}
