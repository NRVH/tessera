// =============================================================================
// Lanza el programa que inicia Docker, suelto de Tessera para que siga vivo aunque ella se cierre. Sin shell: el programa
// y sus argumentos son fijos. Si a los pocos segundos sigue corriendo, se da por lanzado (Docker Desktop no termina).
// Decisiones: docs/decisiones/sandbox/iniciar-docker-al-necesitarlo.md
// =============================================================================
import { spawn } from 'node:child_process'

export interface OrdenInicio {
  programa: string
  args: string[]
}

const SIGUE_VIVO_MS = 8000

export function lanzarOrdenDocker(orden: OrdenInicio): Promise<boolean> {
  return new Promise((resolve) => {
    let hecho = false
    const acabar = (valor: boolean): void => {
      if (hecho) return
      hecho = true
      clearTimeout(reloj)
      resolve(valor)
    }
    const hijo = spawn(orden.programa, orden.args, { detached: true, stdio: 'ignore', windowsHide: true })
    const reloj = setTimeout(() => {
      hijo.unref()
      acabar(true)
    }, SIGUE_VIVO_MS)
    hijo.on('error', () => acabar(false))
    hijo.on('exit', (codigo) => acabar(codigo === 0))
  })
}
