// =============================================================================
// Barrido y limpieza del sandbox: desmonta y borra raíces con el fragmento de
// `limpiezaMontajes.ts` (sin cambiar un byte), deja pizarra limpia de un perfil y, al
// arrancar y al cerrar, elimina SOLO los contenedores de esta instancia (`contenedoresPropios.ts`).
// Decisiones: docs/decisiones/sandbox/limpieza-de-montajes.md
// =============================================================================
import type { Perfil } from '../../perfiles/types.ts'
import { fragmentoDesmontarYBorrarVarias } from '../limpiezaMontajes.ts'
import { listarContenedoresDeTessera, type FiltroInstancia } from '../contenedoresPropios.ts'
import { ejecutarDocker } from '../adaptadores/docker.ts'
import { RAICES_WINDOWS_HEREDADAS } from '../rutasSandbox.ts'
import { esLinux, esWindows } from '../../../shared/plataforma.ts'
import { IMAGEN_SANDBOX, raizConfigAgentePara, textoErrorSandbox, raizGestionadaPara, raicesGestionadas, selloInstancia } from './nombres.ts'
import type { NucleoSandbox } from './NucleoSandbox.ts'
import type { MontajesSandbox } from './montajes.ts'
import type { AvanceCierreSandbox } from './tipos.ts'
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
  limpiarRaicesPerfil(perfil: Perfil): Promise<void> {
    return this.limpiarRaices([raizGestionadaPara(perfil), raizConfigAgentePara(perfil)])
  }

  /**
   * Corre la limpieza de unas raíces y deja en el log sus AVISO y, antes, si el helper
   * ni siquiera llegó a correr (`ejecutarDocker` nunca rechaza: sin esta rama no quedaría rastro).
   */
  private async limpiarRaices(bases: string[]): Promise<void> {
    const res = await this.montajes.ejecutarPrivilegiado(fragmentoDesmontarYBorrarVarias(bases))
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
  async restablecerMontajesPerfil(perfil: Perfil): Promise<void> {
    await this.limpiarRaicesPerfil(perfil)
    this.n.montajesProyecto.delete(perfil.id)
    this.n.montajesConfigAgente.delete(perfil.id)
    // Sus sesiones murieron sin `releaseSession`; la sesión nueva se registra DESPUÉS.
    this.n.sesionesVivas.delete(perfil.id)
  }

  /**
   * Lanza (UNA vez) el barrido de arranque y lo guarda para que `ensureContainer` lo espere.
   * `heredados`: también los contenedores y las raíces de Windows de versiones anteriores,
   * que no llevan el sello de ninguna instancia. El arnés de pruebas no los barre: pueden ser
   * los de la Tessera que el usuario tiene abierta. Linux tampoco: allí el Docker del sistema lo
   * comparten los usuarios del equipo, y ninguna versión anterior creó contenedores sin sello.
   */
  iniciarBarridoArranque(heredados = true): void {
    if (this.n.barridoArranque === null) this.n.barridoArranque = this.barrerAlArrancar(heredados && !esLinux())
  }

  /** Barrido de arranque: la misma limpieza que el cierre, sin progreso. Nunca lanza. */
  private async barrerAlArrancar(heredados: boolean): Promise<void> {
    const n = await this.detenerTodosLosContenedores(undefined, heredados)
    if (n > 0) console.log(`[sandbox] barrido de arranque: ${n} contenedor(es) residual(es) eliminado(s)`)
  }

  /**
   * CIERRE GARANTIZADO: elimina todos los contenedores DE ESTA TESSERA (nunca uno del usuario
   * ni de otra instancia), desmonta las dos raíces base y verifica que no quede ninguno.
   * Devuelve cuántos había. Best-effort en cada paso: el cierre no se cuelga y el arranque no se rompe.
   */
  async detenerTodosLosContenedores(onProgreso?: (p: AvanceCierreSandbox) => void, heredados = false): Promise<number> {
    const filtro = { sello: selloInstancia(), heredados }
    const nombres = await this.listarPropios(filtro)
    const total = nombres.length
    const t = txSandbox().progreso
    onProgreso?.({ fase: 'stopping', hecho: 0, total, etiqueta: total ? t.deteniendo : t.sinContenedores })
    let hecho = 0
    for (const nombre of nombres) {
      try {
        await ejecutarDocker(['rm', '-f', nombre]) // rm -f = stop (SIGKILL) + remove en uno
      } catch (err) {
        console.warn(`[sandbox] stopAllContainers: no se pudo eliminar "${nombre}":`, textoErrorSandbox(err))
      }
      hecho++
      onProgreso?.({ fase: 'stopping', hecho, total, etiqueta: t.detenido(nombre) })
    }
    onProgreso?.({ fase: 'unmounting', hecho, total, etiqueta: t.liberando })
    try {
      await this.desmontarBasesGestionadas(heredados)
    } catch (err) {
      console.warn('[sandbox] stopAllContainers: no se pudieron liberar los montajes base:', textoErrorSandbox(err))
    }
    onProgreso?.({ fase: 'verifying', hecho, total, etiqueta: t.verificando })
    try {
      const restantes = (await listarContenedoresDeTessera((args) => ejecutarDocker(args), IMAGEN_SANDBOX, filtro)) ?? []
      if (restantes.length > 0) await ejecutarDocker(['rm', '-f', ...restantes])
    } catch (err) {
      console.warn('[sandbox] stopAllContainers: falló la verificación/limpieza final:', textoErrorSandbox(err))
    }
    // Estado en memoria a cero (por si se llama en runtime, no solo al salir).
    this.n.descriptores.clear()
    this.n.montajesProyecto.clear()
    this.n.montajesConfigAgente.clear()
    this.n.sesionesVivas.clear()
    onProgreso?.({ fase: 'done', hecho: total, total, etiqueta: t.listo })
    return total
  }

  /** Los contenedores de esta instancia que hay ahora; ninguno si no se pudieron listar (con su aviso). */
  private async listarPropios(filtro: FiltroInstancia): Promise<string[]> {
    try {
      const propios = await listarContenedoresDeTessera((args) => ejecutarDocker(args), IMAGEN_SANDBOX, filtro)
      if (propios === null) throw new Error('docker ps no respondió')
      return propios
    } catch (err) {
      console.warn('[sandbox] stopAllContainers: no se pudieron listar los contenedores:', textoErrorSandbox(err))
      return []
    }
  }

  /**
   * Desmonta y borra lo que cuelgue de las dos raíces base (fragmento de `limpiezaMontajes.ts`) y,
   * con `heredados` en Windows, de las compartidas de versiones anteriores: en el mismo auxiliar.
   */
  private desmontarBasesGestionadas(heredados: boolean): Promise<void> {
    const raices = raicesGestionadas()
    const viejas = heredados && esWindows() ? [RAICES_WINDOWS_HEREDADAS.proyectos, RAICES_WINDOWS_HEREDADAS.agentcfg] : []
    return this.limpiarRaices([raices.proyectos, raices.agentcfg, ...viejas])
  }
}
