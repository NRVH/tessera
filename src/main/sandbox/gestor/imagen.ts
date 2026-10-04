// =============================================================================
// Imagen base del sandbox: la pone al día (build incremental, coalescido por sello de
// versión + extras), degrada a una imagen sin extras si su build falla, la rehornea sin
// caché para «Actualizar agentes» y lee las versiones de los CLI horneados.
// Decisiones: docs/decisiones/sandbox/imagen-y-extras.md
// =============================================================================
import {
  EXTRAS_VACIOS,
  SANDBOX_IMAGE_VERSION,
  argsBuildExtras,
  selloExtras,
  type SandboxExtras
} from '../../../shared/sandboxExtras.ts'
import { runDocker, runDockerBuild } from '../adaptadores/docker.ts'
import { SANDBOX_IMAGE } from './nombres.ts'
import type { FaseImagen, NucleoSandbox } from './NucleoSandbox.ts'

/** Construcción y consulta de la imagen base. */
export class ImagenSandbox {
  private readonly n: NucleoSandbox

  constructor(n: NucleoSandbox) {
    this.n = n
  }

  /**
   * Garantiza una imagen base AL DÍA. Coalesce los builds concurrentes por SELLO: dos
   * perfiles (candados distintos) no lanzan dos builds del mismo tag, y un cambio de
   * extras a mitad de un build no hereda ese build.
   */
  ensureImage(): Promise<void> {
    const sello = `${SANDBOX_IMAGE_VERSION}|${selloExtras(this.n.extras)}`
    const enVuelo = this.n.imageInFlight
    if (enVuelo && enVuelo.sello === sello) return enVuelo.promesa
    const promesa = this.ensureImageInner().finally(() => {
      if (this.n.imageInFlight?.promesa === promesa) this.n.imageInFlight = null
    })
    this.n.imageInFlight = { sello, promesa }
    return promesa
  }

  private async ensureImageInner(): Promise<void> {
    // Extras EFECTIVOS: sin ellos si su build ya falló (`selloExtrasFallido`).
    const selloPedido = selloExtras(this.n.extras)
    const extras = this.n.selloExtrasFallido === selloPedido ? EXTRAS_VACIOS : this.n.extras
    // Las dos etiquetas de una vez; sin etiqueta el template da `<no value>` y tampoco cuadra.
    const esperado = `${SANDBOX_IMAGE_VERSION}|${selloExtras(extras)}`
    const inspect = await runDocker([
      'image',
      'inspect',
      SANDBOX_IMAGE,
      '--format',
      '{{index .Config.Labels "tessera.sandbox.version"}}|{{index .Config.Labels "tessera.sandbox.extras"}}'
    ])
    if (inspect.status === 0 && inspect.stdout.trim() === esperado) return

    const motivo = inspect.status === 0 ? 'está desactualizada' : 'no existe'
    this.logImagen(`La imagen del sandbox ${motivo}: preparándola…`, 'inicio')

    // Build incremental (sin `--no-cache`, que es solo de «Actualizar agentes»).
    if (await this.construirImagen(extras)) {
      this.logImagen('Imagen del sandbox lista.', 'fin')
      return
    }

    // Falló CON extras: se degrada a una imagen sin ellos en vez de dejar el perfil sin agente.
    if (extras.apt.length === 0 && !extras.depsNavegador) {
      throw new Error(`No se pudo construir la imagen "${SANDBOX_IMAGE}" desde "${this.n.dockerfileDir}".`)
    }
    this.n.selloExtrasFallido = selloPedido
    this.logImagen(
      'No se pudieron instalar los paquetes extra (¿algún nombre no existe en Debian?). ' +
        'Se construye el sandbox SIN ellos; revísalos en Configuración → Proyectos → Sandbox de Docker.',
      'error'
    )
    if (!(await this.construirImagen(EXTRAS_VACIOS))) {
      throw new Error(`No se pudo construir la imagen "${SANDBOX_IMAGE}" desde "${this.n.dockerfileDir}".`)
    }
    this.logImagen('Imagen del sandbox lista (sin los paquetes extra).', 'fin')
  }

  /** Un `docker build` con unos extras; si sale bien con los vetados, levanta el veto. */
  private async construirImagen(extras: SandboxExtras): Promise<boolean> {
    const code = await runDockerBuild(
      ['build', ...argsBuildExtras(extras), '-t', SANDBOX_IMAGE, this.n.dockerfileDir],
      { onLog: (line) => this.logImagen(line) }
    )
    if (code === 0 && this.n.selloExtrasFallido === selloExtras(extras)) {
      this.n.selloExtrasFallido = null
    }
    return code === 0
  }

  /** Progreso del build automático: siempre a consola, y a la UI si el main la cableó. */
  private logImagen(line: string, fase?: FaseImagen): void {
    console.log(`[sandbox] imagen: ${line}`)
    this.n.onImageBuildLog?.(line, fase)
  }

  /**
   * RECONSTRUYE la imagen sin caché para hornear los CLI de agente más recientes (el
   * self-update dentro del contenedor no persiste). Emite el progreso por `onLog`.
   */
  async rebuildImage(onLog?: (line: string) => void): Promise<void> {
    const code = await runDockerBuild(
      ['build', '--no-cache', ...argsBuildExtras(this.n.extras), '-t', SANDBOX_IMAGE, this.n.dockerfileDir],
      { onLog }
    )
    if (code !== 0) {
      throw new Error(`Falló la reconstrucción de la imagen "${SANDBOX_IMAGE}" (docker build salió con ${code}).`)
    }
    // Salió bien CON los extras del usuario: se levanta el veto de un fallo anterior.
    this.n.selloExtrasFallido = null
  }

  /** Versiones de los CLI horneados en la imagen actual; '?' en el que no se pueda leer. */
  async agentImageVersions(): Promise<{ codex: string; claude: string }> {
    const r = await runDocker([
      'run',
      '--rm',
      '--entrypoint',
      'sh',
      SANDBOX_IMAGE,
      '-lc',
      'codex --version 2>/dev/null; echo "---"; claude --version 2>/dev/null'
    ])
    const [codexRaw = '', claudeRaw = ''] = r.stdout.split('---')
    const clean = (s: string): string => s.replace(/\r/g, '').trim() || '?'
    return { codex: clean(codexRaw), claude: clean(claudeRaw) }
  }
}
