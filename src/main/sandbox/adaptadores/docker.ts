// =============================================================================
// Adaptador del CLI `docker`: lanza los subprocesos y recoge su salida sin bloquear el main.
// Un semáforo ÚNICO acota cuántos corren a la vez; todo comando lleva techo de tiempo y
// de salida, y el build y la escritura por stdin, el suyo propio.
// Lo usan las operaciones de `sandbox/gestor/`; no importa nada del dominio (F4).
// Decisiones: docs/decisiones/sandbox/gestor-concurrencia.md
// =============================================================================
import { spawn } from 'node:child_process'

/** Resultado de un comando `docker`: nunca rechaza; el fallo va en `status`/`error`. */
export interface CommandResult {
  status: number | null
  stdout: string
  stderr: string
  error?: Error
}

/**
 * Semáforo de conteo mínimo. `release()` transfiere el permiso directo al siguiente en
 * espera (no decrementa y vuelve a incrementar), así no hay ventana de carrera.
 */
class Semaphore {
  private active = 0
  private readonly waiters: Array<() => void> = []
  private readonly max: number
  constructor(max: number) {
    this.max = max
  }
  acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve))
  }
  release(): void {
    const next = this.waiters.shift()
    if (next) next() // cede el permiso al siguiente (active se mantiene)
    else this.active-- // nadie espera: libera el permiso
  }
}

/** Tope de subprocesos `docker` simultáneos: los picos se encolan. */
const DOCKER_CONCURRENCY = 8
/** Techo por defecto de un comando (red de seguridad ante un daemon colgado); no aplica al build. */
const DEFAULT_DOCKER_TIMEOUT_MS = 120_000
/** Tope de salida acumulada de un comando docker (evita OOM si un `exec` escupe mucho). */
const DOCKER_MAX_OUTPUT_BYTES = 64 * 1024 * 1024
/** Techo de un `docker build`: generoso pero finito, porque corre dentro del `profileLock`. */
const DOCKER_BUILD_TIMEOUT_MS = 15 * 60_000
/** Techo de una escritura de archivo al contenedor (`docker exec -i`). */
const CONTAINER_WRITE_TIMEOUT_MS = 60_000
const dockerSem = new Semaphore(DOCKER_CONCURRENCY)

interface RunDockerOptions {
  /** Timeout en ms; por defecto DEFAULT_DOCKER_TIMEOUT_MS. */
  timeoutMs?: number
}

/**
 * Ejecuta `docker <args>` de forma asíncrona, pasando por el semáforo global y con techo
 * de tiempo y de salida: al vencer, SIGKILL y se resuelve con `error`.
 */
export async function runDocker(args: string[], opts: RunDockerOptions = {}): Promise<CommandResult> {
  await dockerSem.acquire()
  try {
    return await spawnDocker(args, opts.timeoutMs ?? DEFAULT_DOCKER_TIMEOUT_MS)
  } finally {
    dockerSem.release()
  }
}

function spawnDocker(args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn('docker', args)
    let stdout = ''
    let stderr = ''
    let outBytes = 0
    let settled = false
    const finish = (r: CommandResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* el proceso ya murió */
      }
      finish({
        status: null,
        stdout,
        stderr,
        error: new Error(`docker ${args[0] ?? ''} excedió el tiempo límite (${timeoutMs} ms) y fue terminado`)
      })
    }, timeoutMs)
    const cap = (added: number): void => {
      outBytes += added
      if (outBytes > DOCKER_MAX_OUTPUT_BYTES && !settled) {
        try {
          child.kill('SIGKILL')
        } catch {
          /* el proceso ya murió */
        }
        finish({
          status: null,
          stdout,
          stderr,
          error: new Error(`docker ${args[0] ?? ''} superó el tope de salida (${DOCKER_MAX_OUTPUT_BYTES} bytes) y fue terminado`)
        })
      }
    }
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8')
      cap(d.length)
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
      cap(d.length)
    })
    child.on('error', (error) => finish({ status: null, stdout, stderr, error }))
    child.on('close', (code) => finish({ status: code, stdout, stderr }))
  })
}

/**
 * Ejecuta `docker build` fuera del semáforo y con su propio techo; al vencer, mata el
 * proceso y resuelve con `null`. Sin `inheritStdio`, stdout y stderr van por `onLog`.
 */
export function runDockerBuild(
  args: string[],
  opts: { inheritStdio?: boolean; onLog?: (line: string) => void } = {}
): Promise<number | null> {
  return new Promise((resolve) => {
    const child = opts.inheritStdio
      ? spawn('docker', args, { stdio: 'inherit' })
      : spawn('docker', args)
    let settled = false
    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(code)
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* el proceso ya murió */
      }
      opts.onLog?.(`error: el build superó el tiempo límite (${DOCKER_BUILD_TIMEOUT_MS} ms) y fue terminado`)
      finish(null)
    }, DOCKER_BUILD_TIMEOUT_MS)
    if (!opts.inheritStdio) {
      const pipe = (buf: Buffer): void => {
        for (const line of buf.toString('utf8').split('\n')) {
          const t = line.replace(/\r/g, '').trimEnd()
          if (t) opts.onLog?.(t)
        }
      }
      child.stdout?.on('data', pipe)
      child.stderr?.on('data', pipe) // docker build emite progreso por stderr
    }
    child.on('error', (e) => {
      opts.onLog?.(`error: ${e.message}`)
      finish(null)
    })
    child.on('close', (c) => finish(c))
  })
}

/**
 * Lanza `docker <args>` (un `exec -i`), le escribe `bytes` por stdin y resuelve cuando sale
 * con 0; rechaza con su stderr, con el error de spawn o al vencer su techo de tiempo.
 */
export function escribirPorStdinDocker(args: string[], bytes: Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('docker', args)
    let stderr = ''
    let settled = false
    const done = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ya murió */
      }
      done(() => reject(new Error(`docker exec (escritura al contenedor) excedió el tiempo límite (${CONTAINER_WRITE_TIMEOUT_MS} ms)`)))
    }, CONTAINER_WRITE_TIMEOUT_MS)
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
    })
    child.on('error', (e) => done(() => reject(e)))
    child.on('close', (code) => {
      if (code === 0) done(resolve)
      else done(() => reject(new Error(stderr.trim() || `docker exec salió con código ${code}`)))
    })
    child.stdin.on('error', () => {}) // EPIPE si el exec muere antes: lo cubre el 'close'
    child.stdin.write(bytes)
    child.stdin.end()
  })
}
