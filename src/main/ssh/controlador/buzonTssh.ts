// =============================================================================
// `tssh` en los proyectos en modo Docker: el programa que el dominio SSH registra en el buzón del puente de
// `tdb`. Atiende en el host lo que deja el cliente del contenedor (`src/tssh/tssh-container.cjs`) corriendo el
// `tssh` real con el token de esa sesión, así que ve las mismas conexiones y reglas que en nativo. En `cp`
// la ruta local es siempre una carpeta temporal del host (`transferenciaBuzon.ts`), nunca una del contenedor.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md, docs/decisiones/bd/puente-buzon-de-docker.md
// =============================================================================
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ColaConcurrencia } from '../../../shared/colaConcurrencia.ts'
import type { Plataforma } from '../../../shared/plataforma.ts'
import type { ProgramaBuzon, RespuestaPrograma } from '../../db/dockerBridge.ts'
import { escribirSubida, leerBajada, nombreRemoto } from '../transferenciaBuzon.ts'

/** Topes del host (el cliente espera esto más un margen): `run` lleva el suyo, que el cliente pone siempre. */
const TOPE_CP_MS = 1800_000
const TOPE_OTRAS_MS = 90_000
const MARGEN_RUN_MS = 30_000
/** Lo que se recoge de la salida de la orden, y de la de errores. */
const MAX_SALIDA = 16 * 1024 * 1024
const MAX_ERRORES = 256 * 1024
/** Tope de la entrada de `run --stdin` (el mismo que el cliente). */
const MAX_ENTRADA = 8 * 1024 * 1024
/** `tssh` vivos a la vez por el buzón: cada uno es un Electron entero. */
const colaTssh = new ColaConcurrencia(4)

/** El resultado de una ejecución del `tssh` del host. */
export interface ResultadoTsshHost {
  exitCode: number
  salida: Buffer
  stderr: string
}

/** Lanza el `tssh` real (inyectable en las pruebas). */
export type EjecutarTssh = (argv: string[], o: { token: string; entrada?: Buffer; topeMs: number }) => Promise<ResultadoTsshHost>

export interface DepsBuzonTssh {
  /** `src/tssh`: de ahí salen el cliente y los módulos puros que se copian al buzón. */
  dirTssh: string
  ejecutar: EjecutarTssh
  plataforma: Plataforma
}

/** Un fallo antes de lanzar nada, con su código (los de `tsshSalida.cjs`). */
function fallo(exitCode: number, texto: string): RespuestaPrograma {
  return { exitCode, stderr: `tssh: ${texto}\n` }
}

/** El tope del host para una orden: `run` con el suyo (`--timeout N`) más margen. */
export function topeDe(argv: readonly string[]): number {
  if (argv[0] !== 'run') return TOPE_OTRAS_MS
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    const valor = a === '--timeout' ? argv[i + 1] : a.startsWith('--timeout=') ? a.slice('--timeout='.length) : undefined
    const n = Number(valor)
    if (valor !== undefined && Number.isFinite(n) && n > 0) return Math.min(n, 24 * 3600) * 1000 + MARGEN_RUN_MS
  }
  return 600_000 + MARGEN_RUN_MS
}

/** ¿Es `alias:ruta`, y no una ruta de este equipo (`C:\…`)? `tssh` lo vuelve a mirar al copiar. */
function remotoValido(remoto: unknown, plataforma: Plataforma): remoto is string {
  if (typeof remoto !== 'string' || !/^[^:\\/]+:/.test(remoto)) return false
  return !(plataforma === 'windows' && /^[A-Za-z]:([\\/]|$)/.test(remoto))
}

/** `cp` en los dos sentidos, con una carpeta temporal que se borra siempre. */
async function copiar(token: string, cp: unknown, d: DepsBuzonTssh): Promise<RespuestaPrograma> {
  const c = cp as Partial<Record<string, unknown>> | null
  if (!c || typeof c.subida !== 'boolean' || !remotoValido(c.remoto, d.plataforma)) return fallo(2, 'La petición del contenedor no se entiende.')
  const r = c.recursivo === true ? ['-r'] : []
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'tessera-tssh-'))
  try {
    if (c.subida) {
      const subida = escribirSubida(tmp, c, d.plataforma)
      if (!subida.ok) return fallo(6, subida.error)
      const res = await d.ejecutar(['cp', ...r, subida.ruta, c.remoto], { token, topeMs: TOPE_CP_MS })
      return { exitCode: res.exitCode, stderr: res.stderr.split(tmp).join('(copia temporal)') }
    }
    const destino = path.join(tmp, 'bajada')
    const res = await d.ejecutar(['cp', ...r, c.remoto, destino], { token, topeMs: TOPE_CP_MS })
    const stderr = res.stderr.split(tmp).join('(copia temporal)')
    if (res.exitCode !== 0) return { exitCode: res.exitCode, stderr }
    const bajada = leerBajada(destino, nombreRemoto(c.remoto.slice(c.remoto.indexOf(':') + 1)))
    return bajada.ok ? { exitCode: 0, stderr, descarga: bajada.contenido } : { ...fallo(6, bajada.error), stderr: stderr + `tssh: ${bajada.error}\n` }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** Atiende una petición del cliente del contenedor. */
export async function atenderTssh(p: Readonly<Record<string, unknown>>, d: DepsBuzonTssh): Promise<RespuestaPrograma> {
  const token = typeof p.token === 'string' ? p.token : ''
  if (!Array.isArray(p.argv) || !p.argv.every((a) => typeof a === 'string')) return fallo(2, 'La petición del contenedor no se entiende.')
  const argv = p.argv as string[]
  if (argv[0] === 'cp') return colaTssh.correr(() => copiar(token, p.cp, d))
  let entrada: Buffer | undefined
  if (p.entrada !== undefined) {
    if (typeof p.entrada !== 'string' || p.entrada.length > (MAX_ENTRADA * 4) / 3 + 4) return fallo(2, 'La entrada supera el tope del puente.')
    entrada = Buffer.from(p.entrada, 'base64')
  }
  const res = await colaTssh.correr(() => d.ejecutar(argv, { token, entrada, topeMs: topeDe(argv) }))
  return { exitCode: res.exitCode, salida: res.salida.toString('base64'), stderr: res.stderr }
}

/**
 * Mata el `tssh` del host y lo que cuelgue de él: matar solo el padre deja vivo a ssh, que hereda su salida
 * (la respuesta no llegaría nunca y la plaza de la cola se perdería). Windows: `taskkill /T`; POSIX: el
 * grupo entero, que existe porque se lanza con `detached`.
 */
function matarArbol(pid: number | undefined, plataforma: Plataforma): void {
  if (pid === undefined) return
  if (plataforma === 'windows') {
    const taskkill = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')
    spawnSync(taskkill, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' })
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // Ya no estaba.
  }
}

/**
 * El `tssh` real del host, con el ejecutable de Tessera como Node, el puente y el token de la sesión del
 * contenedor: lo mismo que pone un atajo en una terminal nativa. `TESSERA_TSSH_BUZON` solo cambia lo que
 * enseña `doctor`.
 */
export function ejecutorTssh(o: { exe: string; script: string; pipe: () => string; plataforma: Plataforma }): EjecutarTssh {
  return (argv, { token, entrada, topeMs }) =>
    new Promise((resolve) => {
      const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', TESSERA_DB_PIPE: o.pipe(), TESSERA_DB_SESSION: token, TESSERA_TSSH_BUZON: '1' }
      delete env.TESSERA_SHIM
      const hijo = spawn(o.exe, [o.script, ...argv], { env, cwd: os.tmpdir(), windowsHide: true, detached: o.plataforma !== 'windows', stdio: ['pipe', 'pipe', 'pipe'] })
      const salida: Buffer[] = []
      let bytes = 0
      let errores = ''
      let corte = ''
      const tope = setTimeout(() => {
        corte = `tssh: no terminó en ${Math.round(topeMs / 1000)} s y se cortó.\n`
        matarArbol(hijo.pid, o.plataforma)
      }, topeMs)
      hijo.stdout.on('data', (t: Buffer) => {
        bytes += t.length
        if (bytes <= MAX_SALIDA) salida.push(t)
        else if (!corte) {
          corte = `tssh: la salida pasó de ${MAX_SALIDA / (1024 * 1024)} MiB y se cortó: acótala o redirígela a un archivo remoto.\n`
          matarArbol(hijo.pid, o.plataforma)
        }
      })
      hijo.stderr.on('data', (t: Buffer) => {
        if (errores.length < MAX_ERRORES) errores += t.toString('utf-8')
      })
      hijo.stdin.on('error', () => {
        // EPIPE: `tssh` terminó sin leer su entrada.
      })
      hijo.stdin.end(entrada ?? Buffer.alloc(0))
      let acabado = false
      const acabar = (exitCode: number): void => {
        if (acabado) return
        acabado = true
        clearTimeout(tope)
        resolve({ exitCode: corte ? 124 : exitCode, salida: Buffer.concat(salida), stderr: errores + corte })
      }
      hijo.on('error', (e) => {
        errores += `tssh: no se pudo lanzar en este equipo: ${e.message}\n`
        acabar(3)
      })
      hijo.on('close', (codigo) => acabar(codigo ?? 1))
      // Cortado, no se espera a que se cierren las tuberías: un nieto que sobreviviera las tendría abiertas.
      hijo.on('exit', (codigo) => {
        if (!corte) return
        hijo.stdout.destroy()
        hijo.stderr.destroy()
        acabar(codigo ?? 1)
      })
    })
}

/** El programa `tssh` del buzón: sus archivos, su cliente y quién atiende. */
export function programaTssh(d: DepsBuzonTssh): ProgramaBuzon {
  const de = (nombre: string): string => path.join(d.dirTssh, nombre)
  return {
    nombre: 'tssh',
    archivos: {
      'tssh-cliente.cjs': de('tssh-container.cjs'),
      'tsshArgumentos.cjs': de('tsshArgumentos.cjs'),
      'tsshRutas.cjs': de('tsshRutas.cjs'),
      'tsshSalida.cjs': de('tsshSalida.cjs')
    },
    cliente: 'tssh-cliente.cjs',
    // 32 MiB de archivos (o 16 de salida) en base64, con holgura.
    maxRespuesta: 60 * 1024 * 1024,
    atender: (p) => atenderTssh(p, d)
  }
}
