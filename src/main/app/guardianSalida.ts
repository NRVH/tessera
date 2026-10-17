// =============================================================================
// Lanza el guardián de la salida (`planGuardianSalida.ts`) desacoplado del proceso: sin consola, sin
// tuberías y con el cwd en el temporal del sistema, para no retener la carpeta de un proyecto ni la de
// instalación. No importa `electron`: el pid, el plazo y el registro entran por parámetro.
// Decisiones: docs/decisiones/app/cierre-ordenado.md
// =============================================================================
import { spawn } from 'node:child_process'
import os from 'node:os'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import { PLAZO_GUARDIAN_MS, planGuardian } from './planGuardianSalida.ts'

export interface OpcionesArmarGuardian {
  pid?: number
  plazoMs?: number
  log: string
  plataforma?: Plataforma
}

/** Arma el guardián; devuelve su pid, o `null` si no se pudo lanzar. Nunca lanza: salir no puede depender de él. */
export function armarGuardianSalida(o: OpcionesArmarGuardian): number | null {
  try {
    const plataforma = o.plataforma ?? plataformaActual()
    const plan = planGuardian({
      plataforma,
      pid: o.pid ?? process.pid,
      plazoMs: o.plazoMs ?? PLAZO_GUARDIAN_MS,
      log: o.log,
      systemRoot: process.env.SystemRoot
    })
    // `detached` solo fuera de Windows, donde lo aparta del grupo de procesos de la app. En Windows
    // lanza sin consola, y así PowerShell sale al instante sin hacer nada; allí un hijo no
    // muere con su padre, así que no le hace falta.
    const hijo = spawn(plan.archivo, plan.args, { detached: plataforma !== 'windows', stdio: 'ignore', windowsHide: true, cwd: os.tmpdir() })
    hijo.on('error', () => {})
    hijo.unref()
    return hijo.pid ?? null
  } catch {
    return null
  }
}
