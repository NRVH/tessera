// =============================================================================
// Lo del sistema para `GestorTuneles`: lanzar el ssh (sin ventana, guardando la cola de su stderr),
// pedir un puerto libre de 127.0.0.1 y comprobar si uno ya acepta conexiones.
// Decisiones: docs/decisiones/bd/conexiones-tunel-ssh.md
// =============================================================================
import { spawn } from 'node:child_process'
import { createServer, connect } from 'node:net'
import type { LineaTunel, ProcesoTunel } from './GestorTuneles'

/** Lo que se guarda de stderr: basta para la última línea del error. */
const COLA_ERRORES = 4096

/**
 * Lo que `ssh -v` escribe al empezar la sesión: con `ExitOnForwardFailure`, solo si el reenvío ya escucha
 * (si el puerto lo tomó otro proceso, sale antes con `bind … Permission denied`).
 */
const MARCA_SESION = 'Entering interactive session'

export function lanzarTunel(linea: LineaTunel): ProcesoTunel {
  const hijo = spawn(linea.exe, linea.args, { env: linea.env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  let errores = ''
  let salido = false
  let enSesion = false
  const alSalir: Array<() => void> = []
  hijo.stderr?.setEncoding('utf8')
  hijo.stderr?.on('data', (t: string) => {
    errores = (errores + t).slice(-COLA_ERRORES)
    if (!enSesion && errores.includes(MARCA_SESION)) enSesion = true
  })
  const terminar = (): void => {
    if (salido) return
    salido = true
    for (const cb of alSalir) cb()
  }
  hijo.on('exit', terminar)
  hijo.on('error', (e) => {
    errores += `\n${e.message}`
    terminar()
  })
  return {
    alSalir: (cb) => (salido ? cb() : alSalir.push(cb)),
    errores: () => errores,
    enSesion: () => enSesion,
    matar: () => {
      if (!salido) hijo.kill()
    }
  }
}

/** Un puerto libre de 127.0.0.1 (el que da el sistema al escuchar en el 0). */
export function puertoLibre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const dir = s.address()
      const puerto = typeof dir === 'object' && dir !== null ? dir.port : 0
      s.close(() => (puerto > 0 ? resolve(puerto) : reject(new Error('No se encontró un puerto libre para el túnel.'))))
    })
  })
}

/** ¿Acepta conexiones `127.0.0.1:puerto`? Un intento de como mucho un segundo. */
export function escucha(puerto: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ host: '127.0.0.1', port: puerto })
    const fin = (ok: boolean): void => {
      s.destroy()
      resolve(ok)
    }
    s.setTimeout(1000, () => fin(false))
    s.once('connect', () => fin(true))
    s.once('error', () => fin(false))
  })
}
