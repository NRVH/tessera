// =============================================================================
// Sandbox por perfil: un contenedor Docker por perfil con sus proyectos y credenciales
// montados en caliente. Fachada con la API de siempre sobre el núcleo y las operaciones de
// `gestor/`; la usan `index.ts`, las terminales, el agente y la hibernación.
// `DIR_DOCKERFILE_POR_DEFECTO` se resuelve desde su carpeta: el archivo no cambia de sitio.
// Decisiones: docs/decisiones/sandbox/gestor-concurrencia.md
// =============================================================================
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { Perfil } from '../perfiles/types.ts'
import type { IdAgente } from '../../shared/agentesManuales.ts'
import type { SandboxExtras } from '../../shared/sandboxExtras.ts'
import type { AvisoRed, ResultadoRedPrevuelo } from '../../shared/sandbox-red-ipc.ts'
import { CONTENEDOR_PUENTE_DB, cuentasDelPerfil, esDeCuenta, idBase } from './gestor/nombres.ts'
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
import { ArranqueDocker, ordenesInicioDocker } from './gestor/arranqueDocker.ts'
import { lanzarOrdenDocker } from './adaptadores/lanzarDocker.ts'
import { ejecutarDocker } from './adaptadores/docker.ts'
import { plataformaActual } from '../../shared/plataforma.ts'
import type { EstadoDocker, RecursosDocker } from '../../shared/sandbox-estado-ipc.ts'
import type { InstalacionAgente } from '../../shared/capaPerfil.ts'
import type { MuestraMemoria } from '../../shared/saturacionDocker.ts'
import type {
  MontajeConfigAgente,
  CapacidadesSandbox,
  CausaMuerteContenedor,
  DescriptorContenedor,
  ResultadoComprobarDocker,
  OpcionesExec,
  ResultadoExec,
  MontajeProyecto,
  AvanceCierreSandbox
} from './gestor/tipos.ts'

export type {
  MontajeConfigAgente,
  CapacidadesSandbox,
  CausaMuerteContenedor,
  DescriptorContenedor,
  ResultadoComprobarDocker,
  OpcionesExec,
  ResultadoExec,
  MontajeProyecto,
  AvanceCierreSandbox
} from './gestor/tipos.ts'
export { nombreContenedorPara, fijarBaseGestionada, perfilDeCuenta } from './gestor/nombres.ts'

const DIR_MODULO = path.dirname(fileURLToPath(import.meta.url))
/** src/main/sandbox -> raíz del repo -> docker/sandbox (contexto del `docker build`). */
const DIR_DOCKERFILE_POR_DEFECTO = path.resolve(DIR_MODULO, '../../../docker/sandbox')

/** El sandbox de todos los perfiles: una instancia compartida por el main. */
export class GestorSandbox {
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
  private readonly arranque: ArranqueDocker
  /** Paradas diferidas de contenedores de cuenta sin agentes, por id. */
  private readonly paradasPendientes = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(dirDockerfile: string = DIR_DOCKERFILE_POR_DEFECTO) {
    this.n = new NucleoSandbox(dirDockerfile)
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
      comprobarDocker: () => this.diag.comprobarDocker(),
      log: (linea) => console.log(linea)
    })
    this.arranque = new ArranqueDocker({
      comprobar: () => this.diag.comprobarDocker(),
      lanzar: lanzarOrdenDocker,
      ordenes: () => ordenesInicioDocker(plataformaActual(), process.env.ProgramFiles),
      log: (linea) => console.log(linea)
    })
    this.n.iniciarSupervision = () => this.supervisor.iniciar()
    this.n.alVerDockerCaido = () => this.supervisor.dockerCaidoSegunDiagnostico()
  }

  /** Sumidero de los cambios de disponibilidad de Docker que ve el supervisor. */
  fijarManejadorEstadoDocker(onEstado: ((estado: EstadoDocker) => void) | null): void {
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
   * agentes vivos se recuperan solos sobre la imagen nueva, como tras actualizar los agentes.
   */
  async aplicarCapa(perfil: Perfil, inst: InstalacionAgente[], onRegistrar: (linea: string) => void): Promise<ResultadoCapa> {
    const r = await this.capa.aplicar(perfil.id, inst, onRegistrar)
    if (r.ok) await this.detenerContenedor(perfil)
    return r
  }

  /** Olvida la capa de un perfil que se borra. */
  olvidarCapa(perfilId: string): void {
    this.capa.olvidar(perfilId)
  }

  /** Cablea el puente de BD: `preparar` en cada `ensureContainer`, `olvidar` en cada `detenerContenedor`. */
  fijarPuenteDb(
    prepararBuzon: (perfilId: string) => string,
    olvidarBuzon?: (perfilId: string) => void
  ): void {
    this.n.fijarPuenteDb(prepararBuzon, olvidarBuzon)
  }

  /** Ruta del buzón DENTRO del contenedor, para inyectarla en el entorno del pty. */
  get dbBridgeContainerPath(): string {
    return CONTENEDOR_PUENTE_DB
  }


  /** (Re)fija los paquetes extra; la imagen se rehornea en el siguiente `asegurarImagen`. */
  fijarExtras(extras: SandboxExtras): void {
    this.n.fijarExtras(extras)
  }

  /** Sumidero del progreso de un rebuild automático de la imagen. */
  fijarRegistroConstruccionImagen(onRegistrar: ((linea: string, fase?: FaseImagen) => void) | null): void {
    this.n.fijarRegistroConstruccionImagen(onRegistrar)
  }

  /** Sumidero de los avisos de red (la sonda, el choque del 1455). */
  fijarManejadorAvisoRed(onAviso: ((aviso: AvisoRed) => void) | null): void {
    this.n.fijarManejadorAvisoRed(onAviso)
  }

  /** ¿Lo que el perfil pide de red difiere de lo que su contenedor vivo tiene? */
  redPendienteDeReiniciar(perfil: Perfil): boolean {
    return this.red.redPendienteDeReiniciar(perfil)
  }

  /** Perfiles con un contenedor vivo en modo anfitrión ahora mismo. */
  perfilesEnModoAnfitrion(exceptoId?: string): string[] {
    return this.red.perfilesEnModoAnfitrion(exceptoId)
  }

  /** El prevuelo del modo anfitrión, medido y redactado. */
  prevueloRedHost(
    perfil: Perfil,
    perfiles: readonly Perfil[] = [],
    medirTrafico = true
  ): Promise<ResultadoRedPrevuelo> {
    return this.red.prevueloRedHost(perfil, perfiles, medirTrafico)
  }

  /** Qué puede hacer de verdad el contenedor vivo del perfil (sudo y extras horneados). */
  capacidades(perfil: Perfil): Promise<CapacidadesSandbox> {
    return this.diag.capacidades(perfil)
  }

  /** La memoria y los núcleos de Docker y cuántos contenedores corren (el semáforo del límite). */
  async recursos(): Promise<RecursosDocker> {
    return { ...(await this.diag.recursos()), vivos: this.n.descriptores.size }
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
  checkDocker(): Promise<ResultadoComprobarDocker> {
    return this.diag.comprobarDocker()
  }

  /** Docker listo para usarse: si el motor no responde, lo inicia y espera. `alEsperar` avisa de que va a tardar. */
  async asegurarDocker(alEsperar?: () => void): Promise<ResultadoComprobarDocker> {
    const r = await this.arranque.asegurar(() => {
      alEsperar?.()
      this.n.onEstadoDocker?.('iniciando')
    })
    if (r.ok) this.supervisor.dockerDisponibleTrasIniciarlo()
    return r
  }

  /** Por qué murió una sesión del perfil; `exitCode` es el suyo (decide si fue la memoria). */
  diagnosticarPerfil(perfil: Perfil, codigoSalida: number | null = null): Promise<CausaMuerteContenedor> {
    return this.diag.diagnosticarPerfil(perfil, codigoSalida)
  }

  /** Rehornea la imagen sin caché (actualizar los agentes en Docker). */
  reconstruirImagen(onRegistrar?: (linea: string) => void): Promise<void> {
    return this.imagen.reconstruirImagen(onRegistrar)
  }

  /**
   * Pone al día la imagen de esta instancia sin crear ningún contenedor: la usan las pruebas que corren sus propios
   * contenedores sobre ella (la de pruebas, nunca la del usuario).
   */
  asegurarImagen(): Promise<void> {
    return this.imagen.asegurarImagen()
  }

  /** Versiones de los CLI horneados en la imagen actual. */
  leerVersionesImagenAgentes(): Promise<{ codex: string; claude: string }> {
    return this.imagen.leerVersionesImagenAgentes()
  }

  /** El id de la imagen de los agentes, o null si aún no existe. */
  async idImagenAgentes(): Promise<string | null> {
    const r = await ejecutarDocker(['image', 'inspect', '--format', '{{.Id}}', this.n.imagen], { topeMs: 15_000 })
    return r.error || r.status !== 0 ? null : r.stdout.trim() || null
  }

  /** ¿Quedó fuera de la imagen lo que pidió el usuario porque su build falló? Solo reconstruirla lo levanta. */
  extrasVetados(): boolean {
    return this.n.selloExtrasFallido !== null
  }

  /** ¿Tiene algún perfil instalaciones propias, con su capa sobre la imagen? */
  hayCapasDePerfil(): boolean {
    return this.capa.hayCapas()
  }

  /** Crea o reutiliza el contenedor del perfil (o de una cuenta: `perfilDeCuenta`). */
  ensureContainer(perfil: Perfil): Promise<DescriptorContenedor> {
    this.cancelarParada(perfil.id)
    return this.contenedores.asegurarContenedor(perfil)
  }

  /**
   * Para el contenedor de una cuenta dentro de `ms` si nadie lo vuelve a pedir antes: un
   * `ensureContainer` lo cancela. Así un contenedor sin agentes no consume, y cambiar de cuenta y
   * volver no lo recrea.
   */
  programarParada(perfil: Perfil, ms: number): void {
    this.cancelarParada(perfil.id)
    const t = setTimeout(() => {
      if (this.paradasPendientes.get(perfil.id) !== t) return
      this.paradasPendientes.delete(perfil.id)
      // Una sesión que se abrió mientras se cerraba la última (su `ensureContainer` ya había vuelto)
      // está registrada aquí: con ella dentro no se para.
      if (this.contenedores.contarSesionesVivas(perfil.id) > 0) return
      this.contenedores.detenerContenedor(perfil).catch((err: unknown) => {
        console.log(`[sandbox] no se pudo parar el contenedor inactivo "${perfil.id}": ${String(err)}`)
      })
    }, ms)
    t.unref?.()
    this.paradasPendientes.set(perfil.id, t)
  }

  private cancelarParada(id: string): void {
    const t = this.paradasPendientes.get(id)
    if (t === undefined) return
    clearTimeout(t)
    this.paradasPendientes.delete(id)
  }

  /** Registra una sesión viva del contenedor (el de la cuenta). */
  retainSession(perfilId: string, claveSesion: string): void {
    this.contenedores.retenerSesion(perfilId, claveSesion)
  }

  /** Da de baja una sesión; `true` si era la última. Nunca detiene el contenedor. */
  releaseSession(perfil: Perfil, claveSesion: string): boolean {
    return this.contenedores.liberarSesion(perfil, claveSesion)
  }

  /**
   * Los ids de los contenedores de cuenta que corren ahora: lo que cuenta para el límite. Un contenedor muerto deja de estar en cuanto lo ve el supervisor.
   */
  contenedoresVivos(): string[] {
    return [...this.n.descriptores.keys()]
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
    return this.n.descriptores.has(id)
  }

  /** Nº de sesiones vivas registradas para un contenedor. */
  contarSesionesVivas(perfilId: string): number {
    return this.contenedores.contarSesionesVivas(perfilId)
  }

  /** Dónde está montado el proyecto en ese contenedor o dónde lo montará `addProject` (el nombre queda reservado), sin tocar Docker. */
  reservarRutaEnContenedor(perfil: Perfil, rutaHostProyecto: string): string {
    return this.montajes.reservarRuta(perfil.id, rutaHostProyecto)
  }

  /** Monta el proyecto en caliente en `/workspace/<nombre>`. */
  addProject(perfil: Perfil, rutaHostProyecto: string): Promise<MontajeProyecto> {
    return this.montajes.anadirProyecto(perfil, rutaHostProyecto)
  }

  /** Desmonta el proyecto en caliente. */
  quitarProyecto(perfil: Perfil, rutaHostProyecto: string): Promise<void> {
    return this.montajes.quitarProyecto(perfil, rutaHostProyecto)
  }

  /** Proyectos montados en el perfil. */
  listarProyectos(perfil: Perfil): Promise<MontajeProyecto[]> {
    return this.montajes.listarProyectos(perfil)
  }

  /** Monta en caliente las credenciales de (agente, cuenta) del perfil. */
  mountAgentConfig(
    perfil: Perfil,
    agente: IdAgente,
    cuentaId: string,
    dirConfigHost: string
  ): Promise<MontajeConfigAgente> {
    return this.credenciales.montarConfigAgente(perfil, agente, cuentaId, dirConfigHost)
  }

  /** Desmonta las credenciales de (agente, cuenta) del perfil. */
  unmountAgentConfig(perfil: Perfil, agente: IdAgente, cuentaId: string): Promise<void> {
    return this.credenciales.desmontarConfigAgente(perfil, agente, cuentaId)
  }

  /** Credenciales montadas en el perfil. */
  listarConfigsAgente(perfil: Perfil): Promise<MontajeConfigAgente[]> {
    return this.credenciales.listarConfigsAgente(perfil)
  }

  /** Ejecuta una orden en el contenedor del perfil. */
  exec(perfil: Perfil, comando: string, opts?: OpcionesExec): Promise<ResultadoExec> {
    return this.contenedores.exec(perfil, comando, opts)
  }

  /** Escribe un archivo en `/tmp` del contenedor y devuelve su ruta allí. */
  escribirArchivoEnContenedor(
    perfil: Perfil,
    bytes: Buffer,
    nombreArchivo: string,
    marcaTiempo: number
  ): Promise<string> {
    return this.contenedores.escribirArchivoEnContenedor(perfil, bytes, nombreArchivo, marcaTiempo)
  }

  /**
   * Detiene y elimina el contenedor y limpia sus raíces. Con el de un perfil, también los de sus
   * cuentas (hibernar, borrar el perfil o aplicar su capa los afecta a todos); con el de una
   * cuenta, solo ese.
   */
  async detenerContenedor(perfil: Perfil): Promise<void> {
    const ids = esDeCuenta(perfil.id) ? [perfil.id] : [...cuentasDelPerfil(perfil.id), perfil.id]
    for (const id of ids) this.cancelarParada(id)
    // Todos se intentan aunque falle uno: si no, una cuenta que no se para dejaría vivo el del perfil.
    const r = await Promise.allSettled(ids.map((id) => this.contenedores.detenerContenedor(id === perfil.id ? perfil : { ...perfil, id })))
    const fallo = r.find((x): x is PromiseRejectedResult => x.status === 'rejected')
    if (fallo) throw fallo.reason
  }

  /** Lanza (una vez) el barrido de arranque; `ensureContainer` lo espera. `heredados`: ver `BarridoSandbox`. */
  iniciarBarridoArranque(heredados = true): void {
    this.barrido.iniciarBarridoArranque(heredados)
  }

  /** Cierre total: elimina los contenedores de esta instancia y libera sus raíces base. */
  detenerTodosLosContenedores(onProgreso?: (p: AvanceCierreSandbox) => void): Promise<number> {
    return this.barrido.detenerTodosLosContenedores(onProgreso)
  }
}
