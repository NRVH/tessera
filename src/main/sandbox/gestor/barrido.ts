// =============================================================================
// Barrido y limpieza del sandbox: desmonta y borra raíces con el fragmento de
// `limpiezaMontajes.ts` (sin cambiar un byte), deja pizarra limpia de un perfil y, al
// arrancar y al cerrar, elimina SOLO los contenedores de esta instancia (`contenedoresPropios.ts`).
// Decisiones: docs/decisiones/sandbox/limpieza-de-montajes.md
// =============================================================================
import type { Profile } from '../../profiles/types.ts'
import { fragmentoDesmontarYBorrarVarias } from '../limpiezaMontajes.ts'
import { listarContenedoresDeTessera, type FiltroInstancia } from '../contenedoresPropios.ts'
import { runDocker } from '../adaptadores/docker.ts'
import { RAICES_WINDOWS_HEREDADAS } from '../rutasSandbox.ts'
import { esLinux, esWindows } from '../../../shared/plataforma.ts'
import { SANDBOX_IMAGE, agentcfgRootFor, errText, managedRootFor, raicesGestionadas, selloInstancia } from './nombres.ts'
import type { NucleoSandbox } from './NucleoSandbox.ts'
import type { MontajesSandbox } from './montajes.ts'
import type { ShutdownProgressLite } from './tipos.ts'
import { txSandbox } from '../textos.ts'

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

  /**
   * Lanza (UNA vez) el barrido de arranque y lo guarda para que `ensureContainer` lo espere.
   * `heredados`: también los contenedores y las raíces de Windows de versiones anteriores,
   * que no llevan el sello de ninguna instancia. El arnés de pruebas no los barre: pueden ser
   * los de la Tessera que el usuario tiene abierta. Linux tampoco: allí el Docker del sistema lo
   * comparten los usuarios del equipo, y ninguna versión anterior creó contenedores sin sello.
   */
  beginStartupSweep(heredados = true): void {
    if (this.n.startupSweep === null) this.n.startupSweep = this.sweepOnStartup(heredados && !esLinux())
  }

  /** Barrido de arranque: la misma limpieza que el cierre, sin progreso. Nunca lanza. */
  private async sweepOnStartup(heredados: boolean): Promise<void> {
    const n = await this.stopAllContainers(undefined, heredados)
    if (n > 0) console.log(`[sandbox] barrido de arranque: ${n} contenedor(es) residual(es) eliminado(s)`)
  }

  /**
   * CIERRE GARANTIZADO: elimina todos los contenedores DE ESTA TESSERA (nunca uno del usuario
   * ni de otra instancia), desmonta las dos raíces base y verifica que no quede ninguno.
   * Devuelve cuántos había. Best-effort en cada paso: el cierre no se cuelga y el arranque no se rompe.
   */
  async stopAllContainers(onProgress?: (p: ShutdownProgressLite) => void, heredados = false): Promise<number> {
    const filtro = { sello: selloInstancia(), heredados }
    const names = await this.listarPropios(filtro)
    const total = names.length
    const t = txSandbox().progreso
    onProgress?.({ phase: 'stopping', done: 0, total, label: total ? t.deteniendo : t.sinContenedores })
    let done = 0
    for (const name of names) {
      try {
        await runDocker(['rm', '-f', name]) // rm -f = stop (SIGKILL) + remove en uno
      } catch (err) {
        console.warn(`[sandbox] stopAllContainers: no se pudo eliminar "${name}":`, errText(err))
      }
      done++
      onProgress?.({ phase: 'stopping', done, total, label: t.detenido(name) })
    }
    onProgress?.({ phase: 'unmounting', done, total, label: t.liberando })
    try {
      await this.unmountManagedBases(heredados)
    } catch (err) {
      console.warn('[sandbox] stopAllContainers: no se pudieron liberar los montajes base:', errText(err))
    }
    onProgress?.({ phase: 'verifying', done, total, label: t.verificando })
    try {
      const left = (await listarContenedoresDeTessera((args) => runDocker(args), SANDBOX_IMAGE, filtro)) ?? []
      if (left.length > 0) await runDocker(['rm', '-f', ...left])
    } catch (err) {
      console.warn('[sandbox] stopAllContainers: falló la verificación/limpieza final:', errText(err))
    }
    // Estado en memoria a cero (por si se llama en runtime, no solo al salir).
    this.n.handles.clear()
    this.n.projectMounts.clear()
    this.n.agentConfigMounts.clear()
    this.n.liveSessions.clear()
    onProgress?.({ phase: 'done', done: total, total, label: t.listo })
    return total
  }

  /** Los contenedores de esta instancia que hay ahora; ninguno si no se pudieron listar (con su aviso). */
  private async listarPropios(filtro: FiltroInstancia): Promise<string[]> {
    try {
      const propios = await listarContenedoresDeTessera((args) => runDocker(args), SANDBOX_IMAGE, filtro)
      if (propios === null) throw new Error('docker ps no respondió')
      return propios
    } catch (err) {
      console.warn('[sandbox] stopAllContainers: no se pudieron listar los contenedores:', errText(err))
      return []
    }
  }

  /**
   * Desmonta y borra lo que cuelgue de las dos raíces base (fragmento de `limpiezaMontajes.ts`) y,
   * con `heredados` en Windows, de las compartidas de versiones anteriores: en el mismo auxiliar.
   */
  private unmountManagedBases(heredados: boolean): Promise<void> {
    const raices = raicesGestionadas()
    const viejas = heredados && esWindows() ? [RAICES_WINDOWS_HEREDADAS.proyectos, RAICES_WINDOWS_HEREDADAS.agentcfg] : []
    return this.limpiarRaices([raices.proyectos, raices.agentcfg, ...viejas])
  }
}
