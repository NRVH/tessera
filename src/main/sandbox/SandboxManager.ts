// =============================================================================
// Sandbox por perfil: un contenedor Docker por perfil con sus proyectos y credenciales
// montados en caliente. Fachada con la API de siempre sobre el núcleo y las operaciones de
// `gestor/`; la usan `index.ts`, las terminales, el agente y la hibernación.
// `DEFAULT_DOCKERFILE_DIR` se resuelve desde su carpeta: el archivo no cambia de sitio.
// Decisiones: docs/decisiones/sandbox/gestor-concurrencia.md
// =============================================================================
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { Profile } from '../profiles/types.ts'
import type { IdAgente } from '../../shared/agentesManuales.ts'
import type { SshSetup } from './sshSetup.ts'
import type { SandboxExtras } from '../../shared/sandboxExtras.ts'
import type { AvisoRed, ResultadoRedPrevuelo } from '../../shared/sandbox-red-ipc.ts'
import { DB_BRIDGE_CONTAINER, cuentasDelPerfil, esDeCuenta, idBase } from './gestor/nombres.ts'
import { NucleoSandbox, type FaseImagen } from './gestor/NucleoSandbox.ts'
import { DiagnosticoSandbox } from './gestor/diagnostico.ts'
import { ImagenSandbox } from './gestor/imagen.ts'
import { MontajesSandbox } from './gestor/montajes.ts'
import { CredencialesSandbox } from './gestor/credenciales.ts'
import { RedSandbox } from './gestor/red.ts'
import { BarridoSandbox } from './gestor/barrido.ts'
import { ContenedoresSandbox } from './gestor/contenedores.ts'
import { CapaPerfilSandbox, type ResultadoCapa } from './gestor/capaPerfil.ts'
import { SupervisorContenedores } from './gestor/supervisor.ts'
import type { EstadoDocker, RecursosDocker } from '../../shared/sandbox-estado-ipc.ts'
import type { InstalacionAgente } from '../../shared/capaPerfil.ts'
import type { MuestraMemoria } from '../../shared/saturacionDocker.ts'
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
export { containerNameFor, fijarBaseGestionada, perfilDeCuenta } from './gestor/nombres.ts'

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
  private readonly capa: CapaPerfilSandbox
  private readonly supervisor: SupervisorContenedores
  /** Paradas diferidas de contenedores de cuenta sin agentes, por id. */
  private readonly paradasPendientes = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(dockerfileDir: string = DEFAULT_DOCKERFILE_DIR, sshSetup: SshSetup | null = null) {
    this.n = new NucleoSandbox(dockerfileDir, sshSetup)
    this.diag = new DiagnosticoSandbox(this.n)
    this.imagen = new ImagenSandbox(this.n)
    this.montajes = new MontajesSandbox(this.n)
    this.credenciales = new CredencialesSandbox(this.n, this.montajes)
    this.red = new RedSandbox(this.n)
    this.barrido = new BarridoSandbox(this.n, this.montajes)
    this.capa = new CapaPerfilSandbox(this.n, this.imagen)
    this.contenedores = new ContenedoresSandbox(this.n, {
      diag: this.diag,
      imagen: this.imagen,
      montajes: this.montajes,
      red: this.red,
      barrido: this.barrido,
      capa: this.capa
    })
    this.supervisor = new SupervisorContenedores(this.n, {
      checkDocker: () => this.diag.checkDocker(),
      log: (linea) => console.log(linea)
    })
    this.n.iniciarSupervision = () => this.supervisor.iniciar()
    this.n.alVerDockerCaido = () => this.supervisor.dockerCaidoSegunDiagnostico()
  }

  /** Sumidero de los cambios de disponibilidad de Docker que ve el supervisor. */
  setEstadoDockerHandler(onEstado: ((estado: EstadoDocker) => void) | null): void {
    this.n.onEstadoDocker = onEstado
  }

  /** Deja de vigilar los contenedores (cierre de la app, antes de pararlos todos). */
  detenerSupervision(): void {
    this.supervisor.detener()
  }

  /** Dónde se guardan las capas de imagen de los perfiles (lo que instalan sus agentes manuales). */
  usarRegistroCapas(ruta: string): void {
    this.capa.usarRegistro(ruta)
  }

  /**
   * Aplica la capa de un perfil (construir y comprobar) y, si salió, para su contenedor: los
   * agentes vivos se recuperan solos sobre la imagen nueva, como tras «Actualizar agentes».
   */
  async aplicarCapa(profile: Profile, inst: InstalacionAgente[], onLog: (linea: string) => void): Promise<ResultadoCapa> {
    const r = await this.capa.aplicar(profile.id, inst, onLog)
    if (r.ok) await this.stopContainer(profile)
    return r
  }

  /** Olvida la capa de un perfil que se borra. */
  olvidarCapa(profileId: string): void {
    this.capa.olvidar(profileId)
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

  /** La memoria y los núcleos de Docker y cuántos contenedores corren (el semáforo del límite). */
  async recursos(): Promise<RecursosDocker> {
    return { ...(await this.diag.recursos()), vivos: this.n.handles.size }
  }

  /**
   * Lo que usan los contenedores y lo que tiene Docker (el vigía de la saturación); null si no se
   * pudo medir. La memoria total se relee como mucho cada 5 minutos: solo cambia si el usuario se
   * la cambia a Docker.
   */
  async medirMemoria(): Promise<MuestraMemoria | null> {
    if (this.memoriaTotal === null || Date.now() - this.memoriaTotal.en > 300_000) {
      const { memoriaBytes } = await this.diag.recursos()
      if (memoriaBytes === null) return null
      this.memoriaTotal = { bytes: memoriaBytes, en: Date.now() }
    }
    const uso = await this.diag.usoMemoria()
    return uso === null ? null : { usoBytes: uso, totalBytes: this.memoriaTotal.bytes }
  }

  private memoriaTotal: { bytes: number; en: number } | null = null

  /** ¿Responde el daemon de Docker? */
  checkDocker(): Promise<DockerCheckResult> {
    return this.diag.checkDocker()
  }

  /** Por qué murió una sesión del perfil; `exitCode` es el suyo (decide si fue la memoria). */
  diagnoseProfile(profile: Profile, exitCode: number | null = null): Promise<ContainerDeathCause> {
    return this.diag.diagnoseProfile(profile, exitCode)
  }

  /** Rehornea la imagen sin caché (botón «Actualizar agentes»). */
  rebuildImage(onLog?: (line: string) => void): Promise<void> {
    return this.imagen.rebuildImage(onLog)
  }

  /** Versiones de los CLI horneados en la imagen actual. */
  agentImageVersions(): Promise<{ codex: string; claude: string }> {
    return this.imagen.agentImageVersions()
  }

  /** Crea o reutiliza el contenedor del perfil (o de una cuenta: `perfilDeCuenta`). */
  ensureContainer(profile: Profile): Promise<ContainerHandle> {
    this.cancelarParada(profile.id)
    return this.contenedores.ensureContainer(profile)
  }

  /**
   * Para el contenedor de una cuenta dentro de `ms` si nadie lo vuelve a pedir antes: un
   * `ensureContainer` lo cancela. Así un contenedor sin agentes no consume, y cambiar de cuenta y
   * volver no lo recrea.
   */
  programarParada(profile: Profile, ms: number): void {
    this.cancelarParada(profile.id)
    const t = setTimeout(() => {
      if (this.paradasPendientes.get(profile.id) !== t) return
      this.paradasPendientes.delete(profile.id)
      // Una sesión que se abrió mientras se cerraba la última (su `ensureContainer` ya había vuelto)
      // está registrada aquí: con ella dentro no se para.
      if (this.contenedores.liveSessionCount(profile.id) > 0) return
      this.contenedores.stopContainer(profile).catch((err: unknown) => {
        console.log(`[sandbox] no se pudo parar el contenedor inactivo "${profile.id}": ${String(err)}`)
      })
    }, ms)
    t.unref?.()
    this.paradasPendientes.set(profile.id, t)
  }

  private cancelarParada(id: string): void {
    const t = this.paradasPendientes.get(id)
    if (t === undefined) return
    clearTimeout(t)
    this.paradasPendientes.delete(id)
  }

  /** Registra una sesión viva del perfil (informativo). */
  retainSession(profileId: string, sessionKey: string): void {
    this.contenedores.retainSession(profileId, sessionKey)
  }

  /** Da de baja una sesión; `true` si era la última. Nunca detiene el contenedor. */
  releaseSession(profile: Profile, sessionKey: string): boolean {
    return this.contenedores.releaseSession(profile, sessionKey)
  }

  /**
   * Los ids de los contenedores que corren ahora (los de perfil y los de cuenta): lo que cuenta para
   * el límite. Un contenedor muerto deja de estar en cuanto lo ve el supervisor.
   */
  contenedoresVivos(): string[] {
    return [...this.n.handles.keys()]
  }

  /** ¿Es el contenedor de una cuenta (y no el de un perfil)? */
  esDeCuenta(id: string): boolean {
    return esDeCuenta(id)
  }

  /** El perfil del que es un contenedor de cuenta, o el mismo id si es el de un perfil. */
  idBase(id: string): string {
    return idBase(id)
  }

  /** ¿Corre ya el contenedor con ese id? Uno que corre no ocupa cupo nuevo. */
  estaVivo(id: string): boolean {
    return this.n.handles.has(id)
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
    agente: IdAgente,
    accountId: string,
    hostConfigDir: string
  ): Promise<AgentConfigMount> {
    return this.credenciales.mountAgentConfig(profile, agente, accountId, hostConfigDir)
  }

  /** Desmonta las credenciales de (agente, cuenta) del perfil. */
  unmountAgentConfig(profile: Profile, agente: IdAgente, accountId: string): Promise<void> {
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

  /**
   * Detiene y elimina el contenedor y limpia sus raíces. Con el de un perfil, también los de sus
   * cuentas (hibernar, borrar el perfil o aplicar su capa los afecta a todos); con el de una
   * cuenta, solo ese.
   */
  async stopContainer(profile: Profile): Promise<void> {
    const ids = esDeCuenta(profile.id) ? [profile.id] : [...cuentasDelPerfil(profile.id), profile.id]
    for (const id of ids) this.cancelarParada(id)
    // Todos se intentan aunque falle uno: si no, una cuenta que no se para dejaría vivo el del perfil.
    const r = await Promise.allSettled(ids.map((id) => this.contenedores.stopContainer(id === profile.id ? profile : { ...profile, id })))
    const fallo = r.find((x): x is PromiseRejectedResult => x.status === 'rejected')
    if (fallo) throw fallo.reason
  }

  /** Lanza (una vez) el barrido de arranque; `ensureContainer` lo espera. `heredados`: ver `BarridoSandbox`. */
  beginStartupSweep(heredados = true): void {
    this.barrido.beginStartupSweep(heredados)
  }

  /** Cierre total: elimina los contenedores de esta instancia y libera sus raíces base. */
  stopAllContainers(onProgress?: (p: ShutdownProgressLite) => void): Promise<number> {
    return this.barrido.stopAllContainers(onProgress)
  }
}
