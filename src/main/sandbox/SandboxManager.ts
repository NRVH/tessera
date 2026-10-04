// =============================================================================
// Sandbox por perfil: un contenedor Docker por perfil con sus proyectos y credenciales
// montados en caliente. Fachada con la API de siempre sobre el núcleo y las operaciones de
// `gestor/`; la usan `index.ts`, las terminales, el agente y la hibernación.
// `DEFAULT_DOCKERFILE_DIR` se resuelve desde su carpeta: el archivo no cambia de sitio.
// Decisiones: docs/decisiones/sandbox/gestor-concurrencia.md
// =============================================================================
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { Agente, Profile } from '../profiles/types.ts'
import type { SshSetup } from './sshSetup.ts'
import type { SandboxExtras } from '../../shared/sandboxExtras.ts'
import type { AvisoRed, ResultadoRedPrevuelo } from '../../shared/sandbox-red-ipc.ts'
import { DB_BRIDGE_CONTAINER } from './gestor/nombres.ts'
import { NucleoSandbox, type FaseImagen } from './gestor/NucleoSandbox.ts'
import { DiagnosticoSandbox } from './gestor/diagnostico.ts'
import { ImagenSandbox } from './gestor/imagen.ts'
import { MontajesSandbox } from './gestor/montajes.ts'
import { CredencialesSandbox } from './gestor/credenciales.ts'
import { RedSandbox } from './gestor/red.ts'
import { BarridoSandbox } from './gestor/barrido.ts'
import { ContenedoresSandbox } from './gestor/contenedores.ts'
import type {
  AgentConfigMount,
  CapacidadesSandbox,
  ContainerDeathCause,
  ContainerHandle,
  DockerCheckResult,
  ExecOptions,
  ExecResult,
  ProjectMount,
  ShutdownProgressLite
} from './gestor/tipos.ts'

export type {
  AgentConfigMount,
  CapacidadesSandbox,
  ContainerDeathCause,
  ContainerHandle,
  DockerCheckResult,
  ExecOptions,
  ExecResult,
  ProjectMount,
  ShutdownProgressLite
} from './gestor/tipos.ts'
export { fijarBaseGestionada } from './gestor/nombres.ts'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
/** src/main/sandbox -> raíz del repo -> docker/sandbox (contexto del `docker build`). */
const DEFAULT_DOCKERFILE_DIR = path.resolve(MODULE_DIR, '../../../docker/sandbox')

/** El sandbox de todos los perfiles: una instancia compartida por el main. */
export class SandboxManager {
  private readonly n: NucleoSandbox
  private readonly diag: DiagnosticoSandbox
  private readonly imagen: ImagenSandbox
  private readonly montajes: MontajesSandbox
  private readonly credenciales: CredencialesSandbox
  private readonly red: RedSandbox
  private readonly barrido: BarridoSandbox
  private readonly contenedores: ContenedoresSandbox

  constructor(dockerfileDir: string = DEFAULT_DOCKERFILE_DIR, sshSetup: SshSetup | null = null) {
    this.n = new NucleoSandbox(dockerfileDir, sshSetup)
    this.diag = new DiagnosticoSandbox(this.n)
    this.imagen = new ImagenSandbox(this.n)
    this.montajes = new MontajesSandbox(this.n)
    this.credenciales = new CredencialesSandbox(this.n, this.montajes)
    this.red = new RedSandbox(this.n)
    this.barrido = new BarridoSandbox(this.n, this.montajes)
    this.contenedores = new ContenedoresSandbox(this.n, {
      diag: this.diag,
      imagen: this.imagen,
      montajes: this.montajes,
      red: this.red,
      barrido: this.barrido
    })
  }

  /** Cablea el puente de BD: `preparar` en cada `ensureContainer`, `olvidar` en cada `stopContainer`. */
  setDbBridge(
    prepararBuzon: (profileId: string) => string,
    olvidarBuzon?: (profileId: string) => void
  ): void {
    this.n.setDbBridge(prepararBuzon, olvidarBuzon)
  }

  /** Ruta del buzón DENTRO del contenedor, para inyectarla en el entorno del pty. */
  get dbBridgeContainerPath(): string {
    return DB_BRIDGE_CONTAINER
  }

  /** (Re)fija el setup ssh global. Los contenedores ya vivos lo toman al recrearse. */
  setSshSetup(setup: SshSetup | null): void {
    this.n.setSshSetup(setup)
  }

  /** (Re)fija los paquetes extra; la imagen se rehornea en el siguiente `ensureImage`. */
  setExtras(extras: SandboxExtras): void {
    this.n.setExtras(extras)
  }

  /** Sumidero del progreso de un rebuild automático de la imagen. */
  setImageBuildLogger(onLog: ((line: string, fase?: FaseImagen) => void) | null): void {
    this.n.setImageBuildLogger(onLog)
  }

  /** Sumidero de los avisos de red (la sonda, el choque del 1455). */
  setAvisoRedHandler(onAviso: ((aviso: AvisoRed) => void) | null): void {
    this.n.setAvisoRedHandler(onAviso)
  }

  /** ¿Lo que el perfil pide de red difiere de lo que su contenedor vivo tiene? */
  redPendienteDeReiniciar(profile: Profile): boolean {
    return this.red.redPendienteDeReiniciar(profile)
  }

  /** Perfiles con un contenedor vivo en modo anfitrión ahora mismo. */
  perfilesEnModoAnfitrion(exceptoId?: string): string[] {
    return this.red.perfilesEnModoAnfitrion(exceptoId)
  }

  /** El prevuelo del modo anfitrión, medido y redactado. */
  prevueloRedHost(
    profile: Profile,
    perfiles: readonly Profile[] = [],
    medirTrafico = true
  ): Promise<ResultadoRedPrevuelo> {
    return this.red.prevueloRedHost(profile, perfiles, medirTrafico)
  }

  /** Qué puede hacer de verdad el contenedor vivo del perfil (sudo y extras horneados). */
  capacidades(profile: Profile): Promise<CapacidadesSandbox> {
    return this.diag.capacidades(profile)
  }

  /** ¿Responde el daemon de Docker? */
  checkDocker(): Promise<DockerCheckResult> {
    return this.diag.checkDocker()
  }

  /** Por qué murió una sesión del perfil. */
  diagnoseProfile(profile: Profile): Promise<ContainerDeathCause> {
    return this.diag.diagnoseProfile(profile)
  }

  /** Rehornea la imagen sin caché (botón «Actualizar agentes»). */
  rebuildImage(onLog?: (line: string) => void): Promise<void> {
    return this.imagen.rebuildImage(onLog)
  }

  /** Versiones de los CLI horneados en la imagen actual. */
  agentImageVersions(): Promise<{ codex: string; claude: string }> {
    return this.imagen.agentImageVersions()
  }

  /** Crea o reutiliza el contenedor del perfil. */
  ensureContainer(profile: Profile): Promise<ContainerHandle> {
    return this.contenedores.ensureContainer(profile)
  }

  /** Registra una sesión viva del perfil (informativo). */
  retainSession(profileId: string, sessionKey: string): void {
    this.contenedores.retainSession(profileId, sessionKey)
  }

  /** Da de baja una sesión; `true` si era la última. Nunca detiene el contenedor. */
  releaseSession(profile: Profile, sessionKey: string): boolean {
    return this.contenedores.releaseSession(profile, sessionKey)
  }

  /** Nº de sesiones vivas registradas para un perfil. */
  liveSessionCount(profileId: string): number {
    return this.contenedores.liveSessionCount(profileId)
  }

  /** Monta el proyecto en caliente en `/workspace/<nombre>`. */
  addProject(profile: Profile, projectHostPath: string): Promise<ProjectMount> {
    return this.montajes.addProject(profile, projectHostPath)
  }

  /** Desmonta el proyecto en caliente. */
  removeProject(profile: Profile, projectHostPath: string): Promise<void> {
    return this.montajes.removeProject(profile, projectHostPath)
  }

  /** Proyectos montados en el perfil. */
  listProjects(profile: Profile): Promise<ProjectMount[]> {
    return this.montajes.listProjects(profile)
  }

  /** Monta en caliente las credenciales de (agente, cuenta) del perfil. */
  mountAgentConfig(
    profile: Profile,
    agente: Agente,
    accountId: string,
    hostConfigDir: string
  ): Promise<AgentConfigMount> {
    return this.credenciales.mountAgentConfig(profile, agente, accountId, hostConfigDir)
  }

  /** Desmonta las credenciales de (agente, cuenta) del perfil. */
  unmountAgentConfig(profile: Profile, agente: Agente, accountId: string): Promise<void> {
    return this.credenciales.unmountAgentConfig(profile, agente, accountId)
  }

  /** Credenciales montadas en el perfil. */
  listAgentConfigs(profile: Profile): Promise<AgentConfigMount[]> {
    return this.credenciales.listAgentConfigs(profile)
  }

  /** Ejecuta una orden en el contenedor del perfil. */
  exec(profile: Profile, command: string, opts?: ExecOptions): Promise<ExecResult> {
    return this.contenedores.exec(profile, command, opts)
  }

  /** Escribe un archivo en `/tmp` del contenedor y devuelve su ruta allí. */
  writeFileToContainer(
    profile: Profile,
    bytes: Buffer,
    filename: string,
    timestamp: number
  ): Promise<string> {
    return this.contenedores.writeFileToContainer(profile, bytes, filename, timestamp)
  }

  /** Detiene y elimina el contenedor del perfil y limpia sus raíces. */
  stopContainer(profile: Profile): Promise<void> {
    return this.contenedores.stopContainer(profile)
  }

  /** Lanza (una vez) el barrido de arranque; `ensureContainer` lo espera. */
  beginStartupSweep(): void {
    this.barrido.beginStartupSweep()
  }

  /** Cierre total: elimina los contenedores de Tessera y libera las raíces base. */
  stopAllContainers(onProgress?: (p: ShutdownProgressLite) => void): Promise<number> {
    return this.barrido.stopAllContainers(onProgress)
  }
}
