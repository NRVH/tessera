// =============================================================================
// Imagen base del sandbox: la pone al día (build incremental, coalescido por sello de
// versión + extras + usuario en Linux), degrada a una imagen sin extras si su build falla, la rehornea sin
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
import { argsBuildUsuario, imagenAlDia } from './usuarioImagen.ts'
import type { FaseImagen, NucleoSandbox } from './NucleoSandbox.ts'
import { txSandbox } from '../textos.ts'

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
    // Las tres etiquetas de una vez; sin etiqueta el template da `<no value>` y tampoco cuadra.
    const esperado = { version: SANDBOX_IMAGE_VERSION, extras: selloExtras(extras), usuario: this.n.usuario }
    const inspect = await runDocker([
      'image',
      'inspect',
      this.n.imagen,
      '--format',
      '{{index .Config.Labels "tessera.sandbox.version"}}|{{index .Config.Labels "tessera.sandbox.extras"}}' +
        '|{{index .Config.Labels "tessera.sandbox.usuario"}}'
    ])
    if (inspect.status === 0 && imagenAlDia(inspect.stdout, esperado)) return

    const t = txSandbox().imagen
    const motivo = inspect.status === 0 ? t.desactualizada : t.noExiste
    this.logImagen(t.preparando(motivo), 'inicio')

    // Build incremental (sin `--no-cache`, que es solo de «Actualizar agentes»).
    if (await this.construirImagen(extras)) {
      this.logImagen(t.lista, 'fin')
      return
    }

    // Falló CON extras: se degrada a una imagen sin ellos en vez de dejar el perfil sin agente.
    if (extras.apt.length === 0 && !extras.depsNavegador) {
      throw new Error(t.noSeConstruyo(this.n.imagen, this.n.dockerfileDir))
    }
    this.n.selloExtrasFallido = selloPedido
    this.logImagen(t.extrasFallidos, 'error')
    if (!(await this.construirImagen(EXTRAS_VACIOS))) {
      throw new Error(t.noSeConstruyo(this.n.imagen, this.n.dockerfileDir))
    }
    this.logImagen(t.listaSinExtras, 'fin')
  }

  /** Un `docker build` con unos extras; si sale bien con los vetados, levanta el veto. */
  private async construirImagen(extras: SandboxExtras): Promise<boolean> {
    const code = await runDockerBuild(
      ['build', ...argsBuildExtras(extras), ...argsBuildUsuario(this.n.usuario), '-t', this.n.imagen, this.n.dockerfileDir],
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
      [
        'build',
        '--no-cache',
        ...argsBuildExtras(this.n.extras),
        ...argsBuildUsuario(this.n.usuario),
        '-t',
        this.n.imagen,
        this.n.dockerfileDir
      ],
      { onLog }
    )
    if (code !== 0) {
      throw new Error(txSandbox().imagen.fallaReconstruccion(this.n.imagen, code))
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
      this.n.imagen,
      '-lc',
      'codex --version 2>/dev/null; echo "---"; claude --version 2>/dev/null'
    ])
    const [codexRaw = '', claudeRaw = ''] = r.stdout.split('---')
    const clean = (s: string): string => s.replace(/\r/g, '').trim() || '?'
    return { codex: clean(codexRaw), claude: clean(claudeRaw) }
  }
}
