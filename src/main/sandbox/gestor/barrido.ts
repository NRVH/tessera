// =============================================================================
// Barrido y limpieza del sandbox: desmonta y borra raíces con el fragmento de
// `limpiezaMontajes.ts` (sin cambiar un byte), deja pizarra limpia de un perfil y, al
// arrancar y al cerrar, elimina SOLO los contenedores de Tessera (`contenedoresPropios.ts`).
// Decisiones: docs/decisiones/sandbox/limpieza-de-montajes.md
// =============================================================================
import type { Profile } from '../../profiles/types.ts'
import { fragmentoDesmontarYBorrarVarias } from '../limpiezaMontajes.ts'
import { listarContenedoresDeTessera } from '../contenedoresPropios.ts'
import { runDocker } from '../adaptadores/docker.ts'
import { SANDBOX_IMAGE, agentcfgRootFor, errText, managedRootFor, raicesGestionadas } from './nombres.ts'
import type { NucleoSandbox } from './NucleoSandbox.ts'
import type { MontajesSandbox } from './montajes.ts'
import type { ShutdownProgressLite } from './tipos.ts'

/** Limpieza de raíces, pizarra limpia por perfil y cierre total. */
export class BarridoSandbox {
  private readonly n: NucleoSandbox
  private readonly montajes: MontajesSandbox

  constructor(n: NucleoSandbox, montajes: MontajesSandbox) {
    this.n = n
    this.montajes = montajes
  }

  /** Desmonta y borra las DOS raíces de ESTE perfil en un solo helper privilegiado. */
  cleanProfileRoots(profile: Profile): Promise<void> {
    return this.limpiarRaices([managedRootFor(profile), agentcfgRootFor(profile)])
  }

  /**
   * Corre la limpieza de unas raíces y deja en el log sus AVISO y, antes, si el helper
   * ni siquiera llegó a correr (`runDocker` nunca rechaza: sin esta rama no quedaría rastro).
   */
  private async limpiarRaices(bases: string[]): Promise<void> {
    const res = await this.montajes.runPrivileged(fragmentoDesmontarYBorrarVarias(bases))
    if (res.error || res.status !== 0) {
      console.warn(
        `[sandbox] la limpieza de montajes no se pudo ejecutar (${res.error?.message ?? `status=${res.status}`}): ${res.stderr.trim()}`
      )
    }
    for (const linea of res.stdout.split('\n')) {
      if (linea.startsWith('AVISO')) console.warn(`[sandbox] ${linea}`)
    }
  }

  /**
   * PIZARRA LIMPIA de un perfil cuyo contenedor se perdió fuera de nuestro control:
   * desmonta sus binds y borra su estado en memoria para que el próximo montaje se haga
   * de verdad. No para ni elimina el contenedor, ni toca otros perfiles.
   */
  async resetProfileMounts(profile: Profile): Promise<void> {
    await this.cleanProfileRoots(profile)
    this.n.projectMounts.delete(profile.id)
    this.n.agentConfigMounts.delete(profile.id)
    // Sus sesiones murieron sin `releaseSession`; la sesión nueva se registra DESPUÉS.
    this.n.liveSessions.delete(profile.id)
  }

  /** Lanza (UNA vez) el barrido de arranque y lo guarda para que `ensureContainer` lo espere. */
  beginStartupSweep(): void {
    if (this.n.startupSweep === null) this.n.startupSweep = this.sweepOnStartup()
  }

  /** Barrido de arranque: la misma limpieza que el cierre, sin progreso. Nunca lanza. */
  private async sweepOnStartup(): Promise<void> {
    const n = await this.stopAllContainers()
    if (n > 0) console.log(`[sandbox] barrido de arranque: ${n} contenedor(es) residual(es) eliminado(s)`)
  }

  /**
   * CIERRE GARANTIZADO: elimina todos los contenedores DE TESSERA (nunca uno del usuario),
   * desmonta las dos raíces base y verifica que no quede ninguno. Devuelve cuántos había.
   * Best-effort en cada paso: el cierre no se cuelga y el arranque no se rompe.
   */
  async stopAllContainers(onProgress?: (p: ShutdownProgressLite) => void): Promise<number> {
    let names: string[] = []
    try {
      const propios = await listarContenedoresDeTessera((args) => runDocker(args), SANDBOX_IMAGE)
      if (propios === null) throw new Error('docker ps no respondió')
      names = propios
    } catch (err) {
      console.warn('[sandbox] stopAllContainers: no se pudieron listar los contenedores:', errText(err))
    }
    const total = names.length
    onProgress?.({ phase: 'stopping', done: 0, total, label: total ? 'Deteniendo contenedores…' : 'Sin contenedores activos' })
    let done = 0
    for (const name of names) {
      try {
        await runDocker(['rm', '-f', name]) // rm -f = stop (SIGKILL) + remove en uno
      } catch (err) {
        console.warn(`[sandbox] stopAllContainers: no se pudo eliminar "${name}":`, errText(err))
      }
      done++
      onProgress?.({ phase: 'stopping', done, total, label: `Contenedor detenido: ${name}` })
    }
    onProgress?.({ phase: 'unmounting', done, total, label: 'Liberando montajes…' })
    try {
      await this.unmountManagedBases()
    } catch (err) {
      console.warn('[sandbox] stopAllContainers: no se pudieron liberar los montajes base:', errText(err))
    }
    onProgress?.({ phase: 'verifying', done, total, label: 'Verificando…' })
    try {
      const left = (await listarContenedoresDeTessera((args) => runDocker(args), SANDBOX_IMAGE)) ?? []
      if (left.length > 0) await runDocker(['rm', '-f', ...left])
    } catch (err) {
      console.warn('[sandbox] stopAllContainers: falló la verificación/limpieza final:', errText(err))
    }
    // Estado en memoria a cero (por si se llama en runtime, no solo al salir).
    this.n.handles.clear()
    this.n.projectMounts.clear()
    this.n.agentConfigMounts.clear()
    this.n.liveSessions.clear()
    onProgress?.({ phase: 'done', done: total, total, label: 'Listo' })
    return total
  }

  /** Desmonta y borra lo que cuelgue de las dos raíces base (fragmento de `limpiezaMontajes.ts`). */
  private unmountManagedBases(): Promise<void> {
    const raices = raicesGestionadas()
    return this.limpiarRaices([raices.proyectos, raices.agentcfg])
  }
}
