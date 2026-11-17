// =============================================================================
// Credenciales de agente montadas en caliente en `/agent-config/<tipo>/<cuenta>`, siempre
// bajo la raíz de credenciales del PROPIO perfil. Los públicos toman el `candadoPerfil`; los
// `…Inner` no, porque el remonteo se llama con el candado ya tomado.
// Decisiones: docs/decisiones/sandbox/montajes-en-caliente.md
// =============================================================================
import type { Perfil } from '../../perfiles/types.ts'
import type { IdAgente } from '../../../shared/agentesManuales.ts'
import { citarSh } from '../../../shared/citarShell.ts'
import { RAIZ_CONFIG_AGENTE, raizConfigAgentePara, normalizarRutaHostSandbox, aRutaDaemon } from './nombres.ts'
import type { NucleoSandbox } from './NucleoSandbox.ts'
import type { MontajesSandbox } from './montajes.ts'
import type { MontajeConfigAgente } from './tipos.ts'
import { txSandbox } from '../textos.ts'

/** Montaje y desmontaje de la carpeta de credenciales de cada (agente, cuenta). */
export class CredencialesSandbox {
  private readonly n: NucleoSandbox
  private readonly montajes: MontajesSandbox

  constructor(n: NucleoSandbox, montajes: MontajesSandbox) {
    this.n = n
    this.montajes = montajes
  }

  private montajesConfigAgentePara(perfilId: string): Map<string, MontajeConfigAgente> {
    let m = this.n.montajesConfigAgente.get(perfilId)
    if (!m) {
      m = new Map<string, MontajeConfigAgente>()
      this.n.montajesConfigAgente.set(perfilId, m)
    }
    return m
  }

  /** Clave interna del montaje de credencial: `<agente>/<cuenta>`. */
  private claveConfigAgente(agente: IdAgente, cuentaId: string): string {
    return `${agente}/${cuentaId}`
  }

  /**
   * Monta EN CALIENTE la carpeta de credenciales de (agente, cuenta) del perfil.
   * Idempotente: misma carpeta → la devuelve; otra → desmonta y remonta limpio.
   */
  async montarConfigAgente(
    perfil: Perfil,
    agente: IdAgente,
    cuentaId: string,
    dirConfigHost: string
  ): Promise<MontajeConfigAgente> {
    return this.n.candadoPerfil.ejecutarExclusivo(perfil.id, () =>
      this.montarConfigAgenteBajoCandado(perfil, agente, cuentaId, dirConfigHost)
    )
  }

  private async montarConfigAgenteBajoCandado(
    perfil: Perfil,
    agente: IdAgente,
    cuentaId: string,
    dirConfigHost: string
  ): Promise<MontajeConfigAgente> {
    const descriptor = this.n.descriptores.get(perfil.id)
    if (!descriptor) {
      throw new Error(
        `No hay contenedor activo para el perfil "${perfil.id}". Llama a ensureContainer() primero.`
      )
    }

    const normalizada = normalizarRutaHostSandbox(dirConfigHost)
    const montajes = this.montajesConfigAgentePara(perfil.id)
    const clave = this.claveConfigAgente(agente, cuentaId)
    const existente = montajes.get(clave)
    if (existente) {
      if (existente.dirConfigHost.toLowerCase() === normalizada.toLowerCase()) return existente
      await this.desmontarConfigAgenteBajoCandado(perfil, agente, cuentaId)
    }

    const rutaDaemon = aRutaDaemon(normalizada)
    const destino = `${raizConfigAgentePara(perfil)}/${agente}/${cuentaId}`
    const rutaContenedor = `${RAIZ_CONFIG_AGENTE}/${agente}/${cuentaId}`
    const res = await this.montajes.ejecutarPrivilegiado(`mkdir -p ${citarSh(destino)} && mount --bind ${citarSh(rutaDaemon)} ${citarSh(destino)}`)
    if (res.status !== 0) {
      throw new Error(
        txSandbox().montajes.noSeMontaronCredenciales(
          agente,
          perfil.id,
          res.stderr.trim() || res.stdout.trim() || txSandbox().montajes.nsenterSalio(res.status)
        )
      )
    }

    const montaje: MontajeConfigAgente = {
      perfilId: perfil.id,
      agente,
      cuentaId,
      dirConfigHost: normalizada,
      containerPath: rutaContenedor
    }
    montajes.set(clave, montaje)
    return montaje
  }

  /**
   * Desmonta la carpeta de credenciales de (agente, cuenta); si era la última cuenta del
   * agente, también desaparece `/agent-config/<tipo>`. Idempotente.
   */
  async desmontarConfigAgente(perfil: Perfil, agente: IdAgente, cuentaId: string): Promise<void> {
    return this.n.candadoPerfil.ejecutarExclusivo(perfil.id, () =>
      this.desmontarConfigAgenteBajoCandado(perfil, agente, cuentaId)
    )
  }

  private async desmontarConfigAgenteBajoCandado(perfil: Perfil, agente: IdAgente, cuentaId: string): Promise<void> {
    const montajes = this.montajesConfigAgentePara(perfil.id)
    const clave = this.claveConfigAgente(agente, cuentaId)
    if (!montajes.has(clave)) return

    const dirAgente = `${raizConfigAgentePara(perfil)}/${agente}`
    const destino = `${dirAgente}/${cuentaId}`
    // `rmdir` del agente sin `-p` y tragado: si queda otra cuenta montada, no está vacía.
    const res = await this.montajes.ejecutarPrivilegiado(
      `umount ${citarSh(destino)} && rmdir ${citarSh(destino)} && { rmdir ${citarSh(dirAgente)} 2>/dev/null || true; }`
    )
    if (res.status !== 0) {
      throw new Error(
        txSandbox().montajes.noSeDesmontaronCredenciales(
          agente,
          perfil.id,
          res.stderr.trim() || res.stdout.trim() || txSandbox().montajes.nsenterSalio(res.status)
        )
      )
    }
    montajes.delete(clave)
  }

  /** Credenciales montadas en el perfil. */
  async listarConfigsAgente(perfil: Perfil): Promise<MontajeConfigAgente[]> {
    return [...this.montajesConfigAgentePara(perfil.id).values()]
  }
}
