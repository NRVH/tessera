// =============================================================================
// Imagen base del sandbox: la pone al día (build incremental, coalescido por sello de
// versión + extras + usuario en Linux), degrada a una imagen sin extras si su build falla, la rehornea sin
// caché para actualizar los agentes y lee las versiones de los CLI horneados.
// Decisiones: docs/decisiones/sandbox/imagen-y-extras.md
// =============================================================================
import {
  EXTRAS_VACIOS,
  VERSION_IMAGEN_SANDBOX,
  argumentosCompilarExtras,
  selloExtras,
  type SandboxExtras
} from '../../../shared/sandboxExtras.ts'
import { ejecutarDocker, ejecutarConstruccionDocker } from '../adaptadores/docker.ts'
import { argsConstruirUsuario, imagenAlDia } from './usuarioImagen.ts'
import type { FaseImagen, NucleoSandbox } from './NucleoSandbox.ts'
import { txSandbox } from '../textos.ts'

/**
 * Un valor distinto en cada build para la capa de los CLI: la caché guarda los de builds anteriores, y un build
 * incremental los devolvería a una versión más vieja que la que ya tenía la imagen.
 */
function argsConstruirClis(): string[] {
  return ['--build-arg', `CLIS_CONSTRUCCION=${Date.now()}`]
}

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
  asegurarImagen(): Promise<void> {
    const sello = `${VERSION_IMAGEN_SANDBOX}|${selloExtras(this.n.extras)}`
    const enVuelo = this.n.construccionImagenEnCurso
    if (enVuelo && enVuelo.sello === sello) return enVuelo.promesa
    const promesa = this.asegurarImagenInterna().finally(() => {
      if (this.n.construccionImagenEnCurso?.promesa === promesa) this.n.construccionImagenEnCurso = null
    })
    this.n.construccionImagenEnCurso = { sello, promesa }
    return promesa
  }

  private async asegurarImagenInterna(): Promise<void> {
    // Extras EFECTIVOS: sin ellos si su build ya falló (`selloExtrasFallido`).
    const selloPedido = selloExtras(this.n.extras)
    const extras = this.n.selloExtrasFallido === selloPedido ? EXTRAS_VACIOS : this.n.extras
    // Las tres etiquetas de una vez; sin etiqueta el template da `<no value>` y tampoco cuadra.
    const esperado = { version: VERSION_IMAGEN_SANDBOX, extras: selloExtras(extras), usuario: this.n.usuario }
    const inspeccion = await ejecutarDocker([
      'image',
      'inspect',
      this.n.imagen,
      '--format',
      '{{index .Config.Labels "tessera.sandbox.version"}}|{{index .Config.Labels "tessera.sandbox.extras"}}' +
        '|{{index .Config.Labels "tessera.sandbox.usuario"}}'
    ])
    if (inspeccion.status === 0 && imagenAlDia(inspeccion.stdout, esperado)) return

    const t = txSandbox().imagen
    const motivo = inspeccion.status === 0 ? t.desactualizada : t.noExiste
    this.registrarImagen(t.preparando(motivo), 'inicio')

    // Build incremental (sin `--no-cache`, que es solo de actualizar los agentes).
    if (await this.construirImagen(extras)) {
      this.registrarImagen(t.lista, 'fin')
      return
    }

    // Falló CON extras: se degrada a una imagen sin ellos en vez de dejar el perfil sin agente.
    if (extras.apt.length === 0 && !extras.depsNavegador) {
      throw new Error(t.noSeConstruyo(this.n.imagen, this.n.dirDockerfile))
    }
    this.n.selloExtrasFallido = selloPedido
    this.registrarImagen(t.extrasFallidos, 'error')
    if (!(await this.construirImagen(EXTRAS_VACIOS))) {
      throw new Error(t.noSeConstruyo(this.n.imagen, this.n.dirDockerfile))
    }
    this.registrarImagen(t.listaSinExtras, 'fin')
  }

  /** Un `docker build` con unos extras; si sale bien con los vetados, levanta el veto. */
  private async construirImagen(extras: SandboxExtras): Promise<boolean> {
    const codigo = await ejecutarConstruccionDocker(
      ['build', ...argumentosCompilarExtras(extras), ...argsConstruirUsuario(this.n.usuario), ...argsConstruirClis(), '-t', this.n.imagen, this.n.dirDockerfile],
      { onRegistrar: (linea) => this.registrarImagen(linea) }
    )
    if (codigo === 0 && this.n.selloExtrasFallido === selloExtras(extras)) {
      this.n.selloExtrasFallido = null
    }
    return codigo === 0
  }

  /** Progreso del build automático: siempre a consola, y a la UI si el main la cableó. */
  private registrarImagen(linea: string, fase?: FaseImagen): void {
    console.log(`[sandbox] imagen: ${linea}`)
    this.n.onRegistrarConstruccionImagen?.(linea, fase)
  }

  /**
   * RECONSTRUYE la imagen sin caché para hornear los CLI de agente más recientes (el
   * self-update dentro del contenedor no persiste). Emite el progreso por `onRegistrar`.
   */
  async reconstruirImagen(onRegistrar?: (linea: string) => void): Promise<void> {
    const codigo = await ejecutarConstruccionDocker(
      [
        'build',
        '--no-cache',
        ...argumentosCompilarExtras(this.n.extras),
        ...argsConstruirUsuario(this.n.usuario),
        '-t',
        this.n.imagen,
        this.n.dirDockerfile
      ],
      { onRegistrar }
    )
    if (codigo !== 0) {
      throw new Error(txSandbox().imagen.fallaReconstruccion(this.n.imagen, codigo))
    }
    // Salió bien CON los extras del usuario: se levanta el veto de un fallo anterior.
    this.n.selloExtrasFallido = null
  }

  /** Versiones de los CLI horneados en la imagen actual; '?' en el que no se pueda leer. */
  async leerVersionesImagenAgentes(): Promise<{ codex: string; claude: string }> {
    const r = await ejecutarDocker([
      'run',
      '--rm',
      '--entrypoint',
      'sh',
      this.n.imagen,
      '-lc',
      'codex --version 2>/dev/null; echo "---"; claude --version 2>/dev/null'
    ])
    const [codexCrudo = '', claudeCrudo = ''] = r.stdout.split('---')
    const limpiar = (s: string): string => s.replace(/\r/g, '').trim() || '?'
    return { codex: limpiar(codexCrudo), claude: limpiar(claudeCrudo) }
  }
}
