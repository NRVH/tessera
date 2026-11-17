// =============================================================================
// Terminal del agente (Claude Code, Codex): un pty interactivo por sesión, en el
// contenedor del perfil con su credencial montada durante toda la sesión, o nativo en
// el host. Fachada sobre las piezas de `terminalAgente/`, que comparten un solo estado;
// orquesta el GestorSandbox compartido y su propio ServicioTerminal.
// Lo compone `src/main/agentes/componer.ts`; sus canales los registra `agentes/ipc.ts`.
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import type { Agente, Perfil } from '../perfiles/types'
import type {
  MensajeActividadAgente,
  ResultadoDetenerVariosAgentes,
  MensajeFlujoAgente,
  PeticionHibernarInactivosAgente,
  ResultadoHibernarInactivosAgente,
  PeticionAbrirAgente,
  ResultadoAbrirAgente,
  MensajeRedimensionarAgente,
  MensajeEscribirAgente,
  ConstanciaParada,
  VigiaSaturacionConfig
} from '../../shared/agent-terminal-ipc'
import { VigiaSaturacion, type OpcionesVigia } from './terminalAgente/saturacion'
import type { DatosLogin } from './loginCodex'
import type { SesionNativa } from '../../shared/agentes-nativos-ipc'
import type { ServicioTerminal } from '../terminales/ServicioTerminal'
import { abrir } from './terminalAgente/apertura'
import { ServicioDelegacion, type DependenciasDelegacion } from './delegacion/ServicioDelegacion'
import { recargar } from './terminalAgente/recarga'
import { cerrar, cerrarDeVentana, cerrarDonde, cerrarTodasLasSesiones, detenerVarias, liberarTodasLasSesiones } from './terminalAgente/cierre'
import type { IdAgente } from '../../shared/agentesManuales'
import type { SesionDockerEnUso, TareaDockerEnUso } from '../../shared/agents-update-ipc'
import { cuentasDelPerfil } from './delegacion/cuentasDelegables'
import { pidsNativos, guardarImagen, sesionesDocker, sesionesNativas, prepararArchivoSesion } from './terminalAgente/nativas'
import { anclarPorEntrada, fotoActividad } from './terminalAgente/turnos'
import { contenedorDe } from './terminalAgente/credenciales'
import { aplicarSegundoPlanoDeSesion, hibernarInactivos, marcarEs } from './terminalAgente/hibernacion'
import type { CambioSegundoPlano } from '../transcripts/tareasSegundoPlano'
import type { SesionConContexto } from './manuales/contexto'
import {
  GRACIA_REDIMENSION_ACTIVIDAD_MS,
  PERFIL_VENTANA,
  crearNucleo,
  errMsg,
  esDeVentanaAgente,
  type OpcionesControladorTerminalAgente,
  type NucleoAgente,
  type SesionAgenteAbierta
} from './terminalAgente/tipos'

export type { OpcionesControladorTerminalAgente } from './terminalAgente/tipos'

/** Lo que «Continuar en…» necesita de la sesión de origen. */
export interface SesionDeOrigen {
  perfilId: string
  agente: Agente
  cuentaId: string
  host: boolean
  rutaHostProyecto: string
  /** La conversación en la que está, si se sabe (ver `conversacionDe`). */
  conversacion?: string
}

/** Sesiones del CLI del agente: apertura, reinicio, cierre, entrada y consultas. */
export class ControladorTerminalAgente {
  private readonly n: NucleoAgente

  private readonly vigia: VigiaSaturacion

  private delegacion: ServicioDelegacion | null = null

  constructor(opts: OpcionesControladorTerminalAgente, vigia: OpcionesVigia = {}) {
    this.n = crearNucleo(opts)
    this.vigia = new VigiaSaturacion(this.n, vigia)
  }

  /** Las tareas delegadas, que corren en los contenedores de este controlador. Nace tarde: necesita el lector del uso. */
  crearDelegacion(deps: DependenciasDelegacion): ServicioDelegacion {
    this.delegacion = new ServicioDelegacion(this.n, deps)
    return this.delegacion
  }

  /** La app empieza a cerrarse: las tareas en marcha quedan registradas para reanudarlas al volver. */
  alCerrarApp(): void {
    this.delegacion?.alCerrarApp()
  }

  /** La sesión con esa clave (de agente o de terminal) terminó: sus tareas delegadas se cancelan. */
  alCerrarOrigenDelegacion(clave: string): void {
    this.delegacion?.alCerrarOrigen(clave)
  }

  /** Lo que el renderer manda al vigía de la saturación; la primera vez lo pone a medir. */
  configurarSaturacion(config: VigiaSaturacionConfig): void {
    this.vigia.configurar(config)
  }

  /** «Parar otro» durante el aviso de saturación. */
  saturacionPararOtro(): boolean {
    return this.vigia.pararOtro()
  }

  /** Una ronda del vigía ya, sin esperar a su intervalo (pruebas). */
  rondaSaturacion(): Promise<void> {
    return this.vigia.ronda()
  }

  /** El login de Codex pendiente en un contenedor de cuenta, o null. */
  loginCodexEnCurso(): DatosLogin | null {
    return this.n.loginCodex.enCurso()
  }

  /** La constancia de las últimas paradas, la más reciente primero. */
  registroParadas(): ConstanciaParada[] {
    return this.n.registroParadas.leer()
  }

  // Las pruebas leen el mapa de sesiones y sustituyen el servicio de terminales.
  private get sesiones(): Map<string, SesionAgenteAbierta> {
    return this.n.sesiones
  }

  private get terminales(): ServicioTerminal {
    return this.n.terminales
  }

  private set terminales(t: ServicioTerminal) {
    this.n.terminales = t
  }

  /** Entrega a la sesión la marca de turno leída de su transcript; cerrada, se ignora. */
  aplicarMarcaTurno(sesionId: string, marca: { tipo: 'abre' | 'cierra'; en: number }): void {
    this.sesiones.get(sesionId)?.actividad.onMarcaTurno(marca)
  }

  /** Entrega a la sesión lo que su transcript dice de las tareas en segundo plano. */
  aplicarSegundoPlano(sesionId: string, cambios: readonly CambioSegundoPlano[]): void {
    aplicarSegundoPlanoDeSesion(this.n, sesionId, cambios)
  }

  /** Una ronda de hibernación por inactividad: decide y suelta en el mismo tick. */
  hibernarInactivos(req: PeticionHibernarInactivosAgente): ResultadoHibernarInactivosAgente {
    return hibernarInactivos(this.n, req)
  }

  /**
   * Estado de actividad crudo de las sesiones vivas. Con `ventana`, solo las suyas y las que no
   * tienen dueño: cada ventana ve la actividad de lo que ella abrió.
   */
  fotoActividad(ventana?: number): MensajeActividadAgente[] {
    const todas = fotoActividad(this.n)
    if (ventana === undefined) return todas
    return todas.filter((m) => {
      const dueno = this.sesiones.get(m.sesionId)?.ventana
      return dueno === undefined || dueno === ventana
    })
  }

  /** La ventana dueña de una sesión: su id, `undefined` si no tiene, o null si la sesión no existe. */
  ventanaDe(sesionId: string): number | undefined | null {
    const s = this.sesiones.get(sesionId)
    return s ? s.ventana : null
  }

  /** Las sesiones de una ventana, con su agente. */
  sesionesDeVentana(ventana: number): Array<{ sesionId: string; agente: IdAgente }> {
    return [...this.sesiones.values()].filter((s) => s.ventana === ventana).map((s) => ({ sesionId: s.sesionId, agente: s.agente }))
  }

  /**
   * La conversación en la que está una sesión ahora: la anclada o, si no, con la que arrancó. El ancla
   * solo vale si es de esta sesión sola (las mismas guardas que `alinearChatConAncla`): dos ventanas del
   * mismo agente comparten clave, y fiarse de ella haría que las dos reanudaran el mismo transcript.
   * Dudosa (tras un `/clear` o un `/resume`) no se sabe cuál es: sin conversación, nace un chat nuevo.
   */
  conversacionDe(sesionId: string): string | undefined {
    const s = this.sesiones.get(sesionId)
    if (!s) return undefined
    const ancla = s.claveAncla && this.n.anclas ? this.n.anclas.get(s.claveAncla) : undefined
    if (ancla && ancla.refs === 1) {
      if (ancla.estado.tipo === 'anclada') return ancla.estado.sesionId
      if (ancla.estado.tipo === 'dudosa') return undefined
    }
    return s.conversacionReanudarId
  }

  /** Las conversaciones en las que están ahora las sesiones vivas (las que se saben, ver `conversacionDe`). */
  conversacionesAbiertas(): Set<string> {
    const fuera = new Set<string>()
    for (const id of this.sesiones.keys()) {
      const c = this.conversacionDe(id)
      if (c) fuera.add(c)
    }
    return fuera
  }

  /**
   * De quién es una sesión de un agente de serie y en qué conversación está, para «Continuar en…». Null si
   * no existe, es de un agente manual o de una ventana de agente (sin perfil).
   */
  origenDeTraspaso(sesionId: string): SesionDeOrigen | null {
    const s = this.sesiones.get(sesionId)
    if (!s || s.manual !== null || esDeVentanaAgente(s.perfilId)) return null
    const conversacion = this.conversacionDe(sesionId)
    return {
      perfilId: s.perfilId,
      agente: s.agente as Agente,
      cuentaId: s.cuentaId,
      host: s.host,
      rutaHostProyecto: s.rutaHostProyecto,
      ...(conversacion ? { conversacion } : {})
    }
  }

  /**
   * De quién es una sesión viva, también la de un agente manual, para el alcance de `tctx buscar`: su perfil, su
   * agente, su cuenta y si corre en el equipo. Null si no existe.
   */
  sesionParaHistorial(sesionId: string): { profileId: string; agente: string; accountId: string; host: boolean } | null {
    const s = this.sesiones.get(sesionId)
    // Una tarea delegada no está en el mapa de sesiones, pero su token es el de un agente en Docker de su cuenta.
    if (!s) return this.delegacion?.sesionDe(sesionId) ?? null
    return { profileId: s.perfilId, agente: s.agente, accountId: s.cuentaId, host: s.host }
  }

  /**
   * Dónde ve el proyecto el agente de esa cuenta en su contenedor (`/workspace/<carpeta>`); null sin el perfil.
   * Si aún no está montado, el nombre queda reservado para que `addProject` lo use luego.
   */
  rutaEnContenedor(perfilId: string, agente: Agente, cuentaId: string, rutaHostProyecto: string): string | null {
    const perfil = this.n.perfiles.get(perfilId)
    if (!perfil) return null
    return this.n.sandbox.reservarRutaEnContenedor(contenedorDe(perfil, agente, cuentaId), rutaHostProyecto)
  }

  /** Cierra las sesiones de una ventana que se cierra (sus árboles de una vez); las demás siguen. */
  cerrarDeVentana(ventana: number, topeMs: number, anotar?: (msg: string) => void): Promise<string[]> {
    return cerrarDeVentana(this.n, ventana, topeMs, anotar)
  }

  /** Sesiones nativas con el proceso vivo, para el botón de los agentes nativos. */
  sesionesNativas(): Array<Omit<SesionNativa, 'atrasada'>> {
    return sesionesNativas(this.n)
  }

  /** Lo que usa los contenedores ahora: lo que actualizar la imagen va a cortar. */
  usoDocker(): { cuentas: number; perfiles: number; sesiones: SesionDockerEnUso[]; tareas: TareaDockerEnUso[] } {
    const porPerfil = [...this.n.perfiles.keys()].map((id) => cuentasDelPerfil(this.n.cuentas, id)).filter((l) => l.length > 0)
    return {
      // Una global está en todos los perfiles: se cuenta una vez.
      cuentas: new Set(porPerfil.flat().map((c) => c.id)).size,
      perfiles: porPerfil.length,
      sesiones: sesionesDocker(this.n),
      tareas: this.delegacion?.enMarcha() ?? []
    }
  }

  /** La imagen nueva está lista: las tareas delegadas se paran antes de perder su contenedor. */
  async pararTareasPorActualizacion(): Promise<void> {
    await this.delegacion?.cancelarDonde(() => true, 'actualizacion')
  }

  /** Pids de los ptys de las sesiones nativas de un agente. */
  pidsNativos(agente: Agente): number[] {
    return pidsNativos(this.n, agente)
  }

  /** Para varias sesiones nativas de una vez (todas o ninguna), conservándolas. */
  detenerVarias(sesionIds: readonly string[]): Promise<ResultadoDetenerVariosAgentes> {
    return detenerVarias(this.n, sesionIds)
  }

  /** Reemplaza el registro de perfiles conocido (tras un CRUD de perfiles). */
  actualizarPerfiles(perfiles: Perfil[]): void {
    this.n.perfiles.clear()
    for (const p of perfiles) this.n.perfiles.set(p.id, p)
    // El de las ventanas de agente no se persiste ni llega con la lista: se repone siempre.
    this.n.perfiles.set(PERFIL_VENTANA.id, PERFIL_VENTANA)
  }

  /**
   * Entrada del usuario: el rastreador la ve primero (el Enter arma el turno y cada tecla
   * congela la detección del eco), luego el ancla y por último el pty.
   */
  escribir(msg: MensajeEscribirAgente): void {
    try {
      const sesionAbierta = this.sesiones.get(msg.sessionId)
      sesionAbierta?.actividad.onEntrada(msg.data)
      if (sesionAbierta) anclarPorEntrada(this.n, sesionAbierta, msg.data)
      // Lo tecleado es actividad aunque el CLI no conteste: retrasa la hibernación.
      marcarEs(this.n, msg.sessionId)
      this.terminales.write(msg.sessionId, msg.data)
    } catch (err) {
      this.n.log(`WRITE error: ${errMsg(err)}`)
    }
  }

  /** Resize del pty; el repintado que provoca no cuenta como trabajo. */
  redimensionar(msg: MensajeRedimensionarAgente): void {
    try {
      this.sesiones.get(msg.sessionId)?.actividad.congelar(GRACIA_REDIMENSION_ACTIVIDAD_MS)
      this.terminales.resize(msg.sessionId, msg.cols, msg.rows)
    } catch (err) {
      this.n.log(`RESIZE error: ${errMsg(err)}`)
    }
  }

  /** Contrapresión del pty; mientras dura, el silencio no cierra el turno. */
  flujo(msg: MensajeFlujoAgente): void {
    try {
      this.sesiones.get(msg.sessionId)?.actividad.fijarPausado(msg.paused)
      this.terminales.fijarPausado(msg.sessionId, msg.paused)
    } catch (err) {
      this.n.log(`FLOW error: ${errMsg(err)}`)
    }
  }

  /** Copia un archivo del host a la sesión y devuelve la ruta que verá el CLI. */
  prepararArchivoSesion(sesionId: string, rutaHost: string): Promise<string | null> {
    return prepararArchivoSesion(this.n, sesionId, rutaHost)
  }

  /** Vuelca la imagen del portapapeles para la sesión y devuelve la ruta que verá el CLI. */
  guardarImagen(sesionId: string): Promise<string | null> {
    return guardarImagen(this.n, sesionId)
  }

  /** Abre una sesión de agente, en contenedor o nativa; `ventana` es el id del `webContents` que la pide. */
  abrir(req: PeticionAbrirAgente, ventana?: number): Promise<ResultadoAbrirAgente> {
    return abrir(this.n, req, ventana)
  }

  /** Relanza el proceso de una sesión conservando su id y su conversación. */
  recargar(sesionId: string, conexionDbIds?: string[], conversacionReanudarId?: string, manual?: unknown): Promise<ResultadoAbrirAgente> {
    return recargar(this.n, sesionId, conexionDbIds, conversacionReanudarId, manual)
  }

  /** Cierra la sesión y desmonta su credencial si era la última; el contenedor sigue vivo. */
  cerrar(sesionId: string): Promise<void> {
    return cerrar(this.n, sesionId)
  }

  /** Cierre de la app: mata el árbol de cada agente y su pty, con tope; devuelve cuántos había. */
  matarPtysConArbol(topeMs: number, anotar?: (msg: string) => void): Promise<number> {
    return this.terminales.matarTodoConArbol(topeMs, anotar)
  }

  /** Cierra todas las sesiones sin parar contenedores (tras un fallo del renderer). */
  cerrarTodasLasSesiones(): Promise<void> {
    return cerrarTodasLasSesiones(this.n)
  }

  /** Cierra todas las sesiones al salir de la app. */
  liberarTodasLasSesiones(): Promise<void> {
    this.vigia.detener()
    return liberarTodasLasSesiones(this.n)
  }

  /** Cierra todas las sesiones de un perfil (hibernar). */
  async cerrarSesionesDePerfil(perfilId: string): Promise<string[]> {
    await this.delegacion?.cancelarDonde((t) => t.profileId === perfilId)
    return cerrarDonde(this.n, (s) => s.perfilId === perfilId)
  }

  /** Cierra todas las sesiones de una cuenta en cualquier perfil (logout o borrado), también sus tareas delegadas. */
  async cerrarSesionesDeCuenta(cuentaId: string): Promise<string[]> {
    await this.delegacion?.cancelarDonde((t) => t.accountId === cuentaId)
    return cerrarDonde(this.n, (s) => s.cuentaId === cuentaId)
  }

  /** Cuántas sesiones abiertas usan esa configuración: las nativas del agente o, con cuenta, las de ella en Docker. */
  contarSesionesDeConfig(agente: IdAgente, cuentaId: string | null): number {
    let total = 0
    for (const s of this.sesiones.values()) {
      if (s.agente === agente && (cuentaId === null ? s.host : !s.host && s.cuentaId === cuentaId)) total++
    }
    return total
  }

  /** Cierra las sesiones en contenedor de un agente en un perfil, de todas sus cuentas (eliminarlo). */
  async cerrarSesionesDeAgente(perfilId: string, agente: IdAgente): Promise<string[]> {
    await this.delegacion?.cancelarDonde((t) => t.profileId === perfilId && t.agente === agente)
    return cerrarDonde(this.n, (s) => s.perfilId === perfilId && s.agente === agente && !s.host)
  }

  /** Ids de las sesiones de agente abiertas. */
  sesionIdsVivas(): string[] {
    return [...this.sesiones.keys()]
  }

  /** Dónde corre una sesión de agente manual con fuente de contexto, o null si no lo es. */
  sesionConContexto(sesionId: unknown): SesionConContexto | null {
    const s = typeof sesionId === 'string' ? this.sesiones.get(sesionId) : undefined
    const fuente = s?.manual?.contexto
    if (!s || !fuente) return null
    return { perfilId: s.perfilId, agente: s.agente, cuentaId: s.cuentaId, rutaHostProyecto: s.rutaHostProyecto, host: s.host, home: s.homeManual ?? '', fuente }
  }

  /** El perfil de una sesión abierta, o `undefined` si no existe (o el id no es un texto). */
  perfilDeSesion(sesionId: unknown): string | undefined {
    return typeof sesionId === 'string' ? this.sesiones.get(sesionId)?.perfilId : undefined
  }
}
