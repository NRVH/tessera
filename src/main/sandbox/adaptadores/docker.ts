// =============================================================================
// Adaptador del CLI `docker`: lanza los subprocesos y recoge su salida sin bloquear el main.
// Un semáforo ÚNICO acota cuántos corren a la vez; todo comando lleva techo de tiempo y
// de salida, y el build y la escritura por stdin, el suyo propio.
// Lo usan las operaciones de `sandbox/gestor/` y el puente del login de Codex; no importa nada del dominio (F4).
// Decisiones: docs/decisiones/sandbox/gestor-concurrencia.md
// =============================================================================
import { spawn } from 'node:child_process'
import type { Socket } from 'node:net'

/** Resultado de un comando `docker`: nunca rechaza; el fallo va en `status`/`error`. */
export interface ResultadoComandoDocker {
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
  private activos = 0
  private readonly waiters: Array<() => void> = []
  private readonly max: number
  constructor(max: number) {
    this.max = max
  }
  adquirir(): Promise<void> {
    if (this.activos < this.max) {
      this.activos++
      return Promise.resolve()
    }
    return new Promise<void>((resolver) => this.waiters.push(resolver))
  }
  release(): void {
    const siguiente = this.waiters.shift()
    if (siguiente) siguiente() // cede el permiso al siguiente (active se mantiene)
    else this.activos-- // nadie espera: libera el permiso
  }
}

/** Tope de subprocesos `docker` simultáneos: los picos se encolan. */
const DOCKER_CONCURRENCY = 8
/** Techo por defecto de un comando (red de seguridad ante un daemon colgado); no aplica al build. */
const TOPE_DOCKER_POR_DEFECTO_MS = 120_000
/** Tope de salida acumulada de un comando docker (evita OOM si un `exec` escupe mucho). */
const MAX_SALIDA_DOCKER_BYTES = 64 * 1024 * 1024
/** Techo de un `docker build`: generoso pero finito, porque corre dentro del `candadoPerfil`. */
const TOPE_CONSTRUCCION_DOCKER_MS = 15 * 60_000
/** Techo de una escritura de archivo al contenedor (`docker exec -i`). */
const TOPE_ESCRITURA_CONTENEDOR_MS = 60_000
const dockerSem = new Semaphore(DOCKER_CONCURRENCY)

interface OpcionesEjecutarDocker {
  /** Timeout en ms; por defecto TOPE_DOCKER_POR_DEFECTO_MS. */
  topeMs?: number
}

/**
 * Ejecuta `docker <args>` de forma asíncrona, pasando por el semáforo global y con techo
 * de tiempo y de salida: al vencer, SIGKILL y se resuelve con `error`.
 */
export async function ejecutarDocker(args: string[], opts: OpcionesEjecutarDocker = {}): Promise<ResultadoComandoDocker> {
  await dockerSem.adquirir()
  try {
    return await lanzarProcesoDocker(args, opts.topeMs ?? TOPE_DOCKER_POR_DEFECTO_MS)
  } finally {
    dockerSem.release()
  }
}

function lanzarProcesoDocker(args: string[], topeMs: number): Promise<ResultadoComandoDocker> {
  return new Promise((resolver) => {
    const procesoHijo = spawn('docker', args)
    let stdout = ''
    let stderr = ''
    let bytesSalida = 0
    let finalizado = false
    const finalizar = (r: ResultadoComandoDocker): void => {
      if (finalizado) return
      finalizado = true
      clearTimeout(temporizador)
      resolver(r)
    }
    const temporizador = setTimeout(() => {
      try {
        procesoHijo.kill('SIGKILL')
      } catch {
        /* el proceso ya murió */
      }
      finalizar({
        status: null,
        stdout,
        stderr,
        error: new Error(`docker ${args[0] ?? ''} excedió el tiempo límite (${topeMs} ms) y fue terminado`)
      })
    }, topeMs)
    const cap = (bytesAnadidos: number): void => {
      bytesSalida += bytesAnadidos
      if (bytesSalida > MAX_SALIDA_DOCKER_BYTES && !finalizado) {
        try {
          procesoHijo.kill('SIGKILL')
        } catch {
          /* el proceso ya murió */
        }
        finalizar({
          status: null,
          stdout,
          stderr,
          error: new Error(`docker ${args[0] ?? ''} superó el tope de salida (${MAX_SALIDA_DOCKER_BYTES} bytes) y fue terminado`)
        })
      }
    }
    procesoHijo.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8')
      cap(d.length)
    })
    procesoHijo.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
      cap(d.length)
    })
    procesoHijo.on('error', (error) => finalizar({ status: null, stdout, stderr, error }))
    procesoHijo.on('close', (codigo) => finalizar({ status: codigo, stdout, stderr }))
  })
}

/**
 * Ejecuta `docker build` fuera del semáforo y con su propio techo; al vencer, mata el
 * proceso y resuelve con `null`. Sin `inheritStdio`, stdout y stderr van por `onRegistrar`.
 */
export function ejecutarConstruccionDocker(
  args: string[],
  opts: { inheritStdio?: boolean; onRegistrar?: (linea: string) => void } = {}
): Promise<number | null> {
  return new Promise((resolver) => {
    const procesoHijo = opts.inheritStdio
      ? spawn('docker', args, { stdio: 'inherit' })
      : spawn('docker', args)
    let finalizado = false
    const finalizar = (codigo: number | null): void => {
      if (finalizado) return
      finalizado = true
      clearTimeout(temporizador)
      resolver(codigo)
    }
    const temporizador = setTimeout(() => {
      try {
        procesoHijo.kill('SIGKILL')
      } catch {
        /* el proceso ya murió */
      }
      opts.onRegistrar?.(`error: el build superó el tiempo límite (${TOPE_CONSTRUCCION_DOCKER_MS} ms) y fue terminado`)
      finalizar(null)
    }, TOPE_CONSTRUCCION_DOCKER_MS)
    if (!opts.inheritStdio) {
      const pipe = (buf: Buffer): void => {
        for (const linea of buf.toString('utf8').split('\n')) {
          const t = linea.replace(/\r/g, '').trimEnd()
          if (t) opts.onRegistrar?.(t)
        }
      }
      procesoHijo.stdout?.on('data', pipe)
      procesoHijo.stderr?.on('data', pipe) // docker build emite progreso por stderr
    }
    procesoHijo.on('error', (e) => {
      opts.onRegistrar?.(`error: ${e.message}`)
      finalizar(null)
    })
    procesoHijo.on('close', (c) => finalizar(c))
  })
}

/**
 * Une una conexión del equipo con `127.0.0.1:<puerto>` DENTRO de un contenedor, por la
 * entrada y la salida de un `docker exec -i`: no hace falta publicar el puerto. La corta
 * a los `topeMs` si nadie la cierra antes.
 */
export function unirConContenedor(contenedor: string, puerto: number, socket: Socket, topeMs = 60_000): void {
  const guion =
    `const s=require('net').connect(${puerto},'127.0.0.1');process.stdin.pipe(s);s.pipe(process.stdout);` +
    "s.on('error',()=>process.exit(1));s.on('close',()=>process.exit(0))"
  const procesoHijo = spawn('docker', ['exec', '-i', contenedor, 'node', '-e', guion])
  const matar = (): void => {
    clearTimeout(tope)
    try {
      procesoHijo.kill('SIGKILL')
    } catch {
      /* ya murió */
    }
  }
  const tope = setTimeout(() => {
    matar()
    socket.destroy()
  }, topeMs)
  socket.pipe(procesoHijo.stdin)
  procesoHijo.stdout.pipe(socket)
  procesoHijo.stdin.on('error', () => {})
  socket.on('error', matar)
  socket.on('close', matar)
  procesoHijo.on('error', () => socket.destroy())
  // `end` y no `destroy`: lo último que mandó el contenedor aún puede estar en el búfer.
  procesoHijo.on('close', () => {
    clearTimeout(tope)
    socket.end()
  })
}

/**
 * Lanza `docker <args>` (un `exec -i`), le escribe `bytes` por stdin y resuelve cuando sale
 * con 0; rechaza con su stderr, con el error de spawn o al vencer su techo de tiempo.
 */
export function escribirPorStdinDocker(args: string[], bytes: Buffer): Promise<void> {
  return new Promise<void>((resolver, rechazar) => {
    const procesoHijo = spawn('docker', args)
    let stderr = ''
    let finalizado = false
    const finalizar = (fn: () => void): void => {
      if (finalizado) return
      finalizado = true
      clearTimeout(temporizador)
      fn()
    }
    const temporizador = setTimeout(() => {
      try {
        procesoHijo.kill('SIGKILL')
      } catch {
        /* ya murió */
      }
      finalizar(() => rechazar(new Error(`docker exec (escritura al contenedor) excedió el tiempo límite (${TOPE_ESCRITURA_CONTENEDOR_MS} ms)`)))
    }, TOPE_ESCRITURA_CONTENEDOR_MS)
    procesoHijo.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
    })
    procesoHijo.on('error', (e) => finalizar(() => rechazar(e)))
    procesoHijo.on('close', (codigo) => {
      if (codigo === 0) finalizar(resolver)
      else finalizar(() => rechazar(new Error(stderr.trim() || `docker exec salió con código ${codigo}`)))
    })
    procesoHijo.stdin.on('error', () => {}) // EPIPE si el exec muere antes: lo cubre el 'close'
    procesoHijo.stdin.write(bytes)
    procesoHijo.stdin.end()
  })
}
