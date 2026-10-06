// =============================================================================
// Composición de las sesiones, parte de la raíz de composición de la app: el sandbox compartido,
// la terminal de abajo, la del agente con sus anclas y su vigilante de turnos, los agentes
// nativos, cuentas, conversaciones, uso, contexto, hibernación y el guardado de perfiles, con
// sus `ipc.ts`. Lo llama `src/main/index.ts` con las referencias, `ipcMain` y lo ya compuesto.
// =============================================================================
import { app, type IpcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { esWindows, plataformaActual } from '../../shared/plataforma'
import { IPC_CHANNELS } from '../../shared/ipc'
import type { WorkspaceSettings } from '../../shared/workspace-state-ipc'
import { normalizarExtras } from '../../shared/sandboxExtras'
import { umbralPruebasDe } from '../../shared/ajustesAgente'
import { AGENTS_UPDATE_CHANNELS } from '../../shared/agents-update-ipc'
import { AGENTES_NATIVOS_CHANNELS } from '../../shared/agentes-nativos-ipc'
import { SANDBOX_RED_CHANNELS } from '../../shared/sandbox-red-ipc'
import { USAGE_CHANNELS, type UsageChanged } from '../../shared/usage-ipc'
import type { ReferenciasApp } from '../app/referencias'
import { emisorDeVentana, type EmisorEventos } from '../util/emisorEventos'
import { saveProfilesMutable } from '../profiles/store'
import type { PerfilesVivos, Profile } from '../profiles/types'
import { loadWorkspaceSettings } from '../workspace/workspaceStateStore'
import type { DbController } from '../db/DbController'
import { dbLog } from '../db/dbLog'
import type { ControladorSsh } from '../ssh/ControladorSsh'
import type { EspacioTerminal } from '../ssh/controlador/espacioTerminal'
import { borrarPerfiles, type DepsBorradoCompleto, type DuenoDeCarpeta } from '../profiles/borradoDePerfil'
import type { CandadoDeBorrado } from '../profiles/candadoDeBorrado'
import type { LlegadaDePerfiles } from '../profiles/llegadaDePerfiles'
import { SandboxManager, fijarBaseGestionada } from '../sandbox/SandboxManager'
import { resolveSshSetup, type SshSetup } from '../sandbox/sshSetup'
import { registrarIpcRedSandbox, registrarIpcActualizarAgentes } from '../sandbox/ipc'
import { TerminalController } from '../terminals/TerminalController'
import { registrarIpcTerminal } from '../terminals/ipc'
import { listarProcesosWindows } from '../update/procesosSistema'
import { ConversationsReader } from '../conversations/ConversationsReader'
import { crearTitulosConversacion } from '../conversations/conversationTitles'
import { ServicioConversaciones } from '../conversations/ServicioConversaciones'
import { crearBaseDeCuenta, type BaseDeCuenta } from '../conversations/baseAgente'
import { registrarIpcConversaciones } from '../conversations/ipc'
import { UsageReader } from '../usage/UsageReader'
import { ServicioUso } from '../usage/ServicioUso'
import { registrarIpcUso } from '../usage/ipc'
import { UsageWatcher } from '../usage/UsageWatcher'
import { ContextReader } from '../context/ContextReader'
import { ServicioContexto } from '../context/ServicioContexto'
import { registrarIpcContexto } from '../context/ipc'
import { crearRegistroAnclas, type RegistroAnclas } from '../context/anclaConversacion'
import { HibernationController } from '../hibernate/HibernationController'
import { registrarIpcHibernacion } from '../hibernate/ipc'
import { AgentTerminalController } from './AgentTerminalController'
import { AgentesNativos } from './agentesNativos'
import { ejecutarEnShellNativa } from './ejecutorShell'
import { registrarIpcTerminalAgente, registrarIpcCuentas, registrarIpcAgentesNativos } from './ipc'
import { portapapelesDelSistema } from './adaptadores/portapapeles'
import { fetchTextoConTope } from './adaptadores/redElectron'
import { AccountStore } from './AccountStore'
import { TurnWatcher } from './TurnWatcher'

/** Perfil + proyecto de prueba que usa el bootstrap de sesión (BOOTSTRAP_SESSION). */
const BOOTSTRAP_PROFILE_ID = 'personal'

/** Lo que la composición de las sesiones recibe de `index.ts`. */
export interface DepsSesiones {
  refs: ReferenciasApp
  ipc: IpcMain
  perfiles: PerfilesVivos
  accounts: AccountStore
  dbController: DbController
  /** Las conexiones SSH: la terminal abre sus sesiones y el guardado de perfiles las borra con el perfil. */
  ssh: ControladorSsh
  /** La carpeta del agente de la terminal de cada perfil: el guardado de perfiles la manda a la papelera con el perfil. */
  espacioTerminal: Pick<EspacioTerminal, 'borrar'>
  /** El espacio de datos de cada perfil (`DbController.espacioDatos`): igual que la carpeta de arriba. */
  espacioDatos: DuenoDeCarpeta
  /** El candado del borrado de cada perfil: lo toma el guardado de perfiles y lo esperan sus sesiones al abrirse. */
  borrados: CandadoDeBorrado
  /** La llegada de un perfil recién creado: el guardado de perfiles despierta a quien espera uno nuevo. */
  llegada: Pick<LlegadaDePerfiles, 'cambiaron'>
}

/** Pasa al sandbox los paquetes a hornear: solo marca la imagen como obsoleta, no la rehornea. */
export function aplicarExtrasSandbox(sandbox: SandboxManager | null, settings: WorkspaceSettings): void {
  sandbox?.setExtras(normalizarExtras(settings.paquetesExtraSandbox, settings.sandboxDepsNavegador))
}

/** El bootstrap de sesión usa el proyecto de prueba local junto al contexto de la imagen. */
function bootstrapProjectPath(): string {
  return join(app.getAppPath(), 'docker', 'sandbox', 'proyecto-demo')
}

/** Cuentas de agente: registro y credenciales en `userData`, que sobrevive a actualizar. */
export function crearCuentas(perfiles: PerfilesVivos): AccountStore {
  const accounts = new AccountStore({
    storePath: join(app.getPath('userData'), 'agent-accounts.json'),
    dataRoot: app.getPath('userData')
  })
  accounts.ensureDefaults(perfiles.lista)
  return accounts
}

interface Sandbox {
  sharedSandbox: SandboxManager
  dockerfileDir: string
  sshSetup: SshSetup | null
  emisorSinContenido: EmisorEventos
  touchedProfiles: Set<string>
}

/** El sandbox COMPARTIDO por las dos terminales, con el `.ssh` global y el puente de BD. */
function componerSandbox({ refs, ipc, perfiles, dbController }: DepsSesiones): Sandbox {
  const dockerfileDir = join(app.getAppPath(), 'docker', 'sandbox')
  // `.ssh` global: se montan de solo lectura la carpeta y las hermanas que cite su `config`.
  const sshDir = join(os.homedir(), '.ssh')
  const sshSetup = resolveSshSetup(sshDir)
  console.log(
    `[tessera] ssh global: ${
      sshSetup ? `${sshSetup.mounts.length} carpeta(s) desde ${sshDir}` : `sin .ssh en ${sshDir}`
    }`
  )
  // ANTES de construir el sandbox; en macOS la raíz vive bajo `userData` (ver `sandbox/rutasSandbox.ts`).
  fijarBaseGestionada(app.getPath('userData'))
  const sharedSandbox = new SandboxManager(dockerfileDir, sshSetup)
  sharedSandbox.setDbBridge(
    (profileId) => dbController.prepararBuzonDocker(profileId),
    (profileId) => dbController.olvidarBuzonDocker(profileId)
  )
  refs.sandbox = sharedSandbox
  aplicarExtrasSandbox(refs.sandbox, loadWorkspaceSettings())
  // Estas guardas nunca miraron `webContents`: su emisor va sin comprobarlo.
  const emisorSinContenido = emisorDeVentana(() => refs.ventana, { comprobarContenido: false })
  // El rebuild AUTOMÁTICO de la imagen reusa el canal de progreso de «Actualizar agentes».
  sharedSandbox.setImageBuildLogger((line, fase) =>
    emisorSinContenido.emitir(AGENTS_UPDATE_CHANNELS.PROGRESS, { line, fase })
  )
  sharedSandbox.setAvisoRedHandler((aviso) => emisorSinContenido.emitir(SANDBOX_RED_CHANNELS.AVISO, aviso))
  registrarIpcRedSandbox({ ipc, sandbox: sharedSandbox, perfiles: () => perfiles.lista })
  // Barrido de montajes colgados de un cierre sucio; `ensureContainer` lo espera.
  sharedSandbox.beginStartupSweep()
  return { sharedSandbox, dockerfileDir, sshSetup, emisorSinContenido, touchedProfiles: new Set<string>() }
}

type EntornoHost = (profileId: string, projectHostPath: string, dbConnectionIds: string[]) => Record<string, string>

/** La terminal de abajo. */
function componerTerminal({ refs, ipc, perfiles, dbController, ssh, borrados }: DepsSesiones, sb: Sandbox, hostEnv: EntornoHost): TerminalController {
  const controller = new TerminalController({
    profiles: perfiles.lista,
    eventos: emisorDeVentana(() => refs.ventana),
    dockerfileDir: sb.dockerfileDir,
    bootstrapTarget: { profileId: BOOTSTRAP_PROFILE_ID, projectHostPath: bootstrapProjectPath() },
    sandbox: sb.sharedSandbox,
    touchedProfiles: sb.touchedProfiles,
    getHostEnv: hostEnv,
    getContainerEnv: (perfil, proyecto, ids, buzon) =>
      dbController.entornoContenedor(perfil, proyecto, ids, buzon),
    bindDbSession: (env, sessionId) => dbController.atarSesion(env, sessionId),
    revokeDbSession: (sessionId) => dbController.revocarSesion(sessionId),
    lanzadorSsh: ssh
  })
  refs.terminales = controller
  registrarIpcTerminal({ ipc, terminales: controller, esperarBorrado: (id) => borrados.esperar(id) })
  return controller
}

interface SesionAgente {
  anclasConversacion: RegistroAnclas
  baseDeCuenta: BaseDeCuenta
  agentController: AgentTerminalController
}

/** La terminal del agente, con las anclas de conversación y el vigilante de turnos. */
function componerSesionAgente(deps: DepsSesiones, sb: Sandbox, hostEnv: EntornoHost): SesionAgente {
  const { refs, ipc, perfiles, accounts, dbController } = deps
  // Las escribe el controlador del agente y las lee el ContextReader.
  const anclasConversacion = crearRegistroAnclas()
  const baseDeCuenta = crearBaseDeCuenta(accounts)
  // El fin del turno lo dice el TRANSCRIPT; el vigilante devuelve las marcas al controlador.
  // También las tareas en segundo plano, que vetan la hibernación por inactividad.
  refs.vigilanteTurnos = new TurnWatcher(
    (sessionId, marca) => refs.agentes?.aplicarMarcaTurno(sessionId, marca),
    undefined,
    (sessionId, cambios) => refs.agentes?.aplicarSegundoPlano(sessionId, cambios)
  )
  const agentController = new AgentTerminalController({
    profiles: perfiles.lista,
    sandbox: sb.sharedSandbox,
    accounts,
    eventos: emisorDeVentana(() => refs.ventana),
    portapapeles: portapapelesDelSistema,
    touchedProfiles: sb.touchedProfiles,
    sshSetup: sb.sshSetup,
    anclas: anclasConversacion,
    getAgentBase: baseDeCuenta,
    turnos: refs.vigilanteTurnos,
    getHostEnv: hostEnv,
    getDbBriefing: (profileId, proyecto, ids) => dbController.briefingParaAgente(profileId, proyecto, ids),
    getSshBriefing: (profileId) => deps.ssh.briefingAgente(profileId),
    getContainerEnv: (perfil, proyecto, ids, buzon) =>
      dbController.entornoContenedor(perfil, proyecto, ids, buzon),
    bindDbSession: (env, sessionId) => dbController.atarSesion(env, sessionId),
    revokeDbSession: (sessionId) => dbController.revocarSesion(sessionId),
    // Enlace TARDÍO: el servicio de los agentes nativos nace después y necesita a este controlador.
    sondearVersion: (agente) => (refs.agentesNativos ? refs.agentesNativos.instalada(agente) : Promise.resolve(null)),
    esperarCandado: (agente) => (refs.agentesNativos ? refs.agentesNativos.esperarCandado(agente) : Promise.resolve()),
    alCambiarSesiones: () => refs.agentesNativos?.notificarSesiones(),
    // Solo la leen las pruebas de interfaz: acorta el umbral, no enciende la hibernación.
    inactividadPruebasMs: umbralPruebasDe(process.env.TESSERA_AGENTE_INACTIVIDAD_MS)
  })
  refs.agentes = agentController
  registrarIpcTerminalAgente({ ipc, agentes: agentController, esperarBorrado: (id) => deps.borrados.esperar(id) })
  return { anclasConversacion, baseDeCuenta, agentController }
}

/** Versiones e instalación de los agentes del HOST (solo sesiones nativas). */
function componerAgentesNativos(refs: ReferenciasApp, controladorAgentes: AgentTerminalController): AgentesNativos {
  const enviarAVentana = emisorDeVentana(() => refs.ventana).emitir
  const agentesNativos = new AgentesNativos({
    plataforma: plataformaActual(),
    arch: process.arch,
    ejecutar: ejecutarEnShellNativa,
    fetchTexto: fetchTextoConTope,
    ahora: () => Date.now(),
    // Solo Windows tiene carpetas de paquete que un proceso pueda bloquear.
    listarProcesos: async () => {
      if (!esWindows()) return []
      const r = await listarProcesosWindows({ conLineaComando: true })
      if (!r.ok) throw new Error(r.error)
      return r.procesos
    },
    leerTexto: (ruta) => readFile(ruta, 'utf8'),
    env: process.env,
    homedir: os.homedir(),
    sesiones: () => controladorAgentes.sesionesNativas(),
    detenerVarias: (ids) => controladorAgentes.detenerVarias(ids),
    pidsTessera: (agente) => controladorAgentes.pidsNativos(agente),
    emitirCambio: (estado) => enviarAVentana(AGENTES_NATIVOS_CHANNELS.CAMBIO, estado),
    emitirProgreso: (p) => enviarAVentana(AGENTES_NATIVOS_CHANNELS.PROGRESO, p),
    log: (m) => dbLog('agentes-nativos', m)
  })
  refs.agentesNativos = agentesNativos
  return agentesNativos
}

/** Cuentas, conversaciones, uso de cuenta y contexto de la conversación. */
function componerCuentasYUso({ refs, ipc, accounts }: DepsSesiones, sesion: SesionAgente, emisorSinContenido: EmisorEventos): void {
  // LOGOUT y DELETE cierran antes las sesiones vivas de esa cuenta, en cualquier perfil.
  registrarIpcCuentas({
    ipc,
    cuentas: accounts,
    cerrarSesionesDeCuenta: (id) => refs.agentes?.closeSessionsForAccount(id),
    // `usage` y `usageWatcher` se declaran más abajo: las clausuras los leen al atender.
    olvidarUso: (id) => usage.forget(id),
    soltarVigilanteUso: (id) => usageWatcher.cerrar(id)
  })
  // UNA sola instancia de títulos: dos sobre el mismo archivo se pisarían las escrituras.
  const titulos = crearTitulosConversacion(join(app.getPath('userData'), 'conversation-titles.json'))
  registrarIpcConversaciones({
    ipc,
    conversaciones: new ServicioConversaciones({ lector: new ConversationsReader(), titulos, baseDe: sesion.baseDeCuenta })
  })
  const usage = new UsageReader()
  const contexts = new ContextReader(Date.now, sesion.anclasConversacion)
  // Cambiar de conversación cambia QUÉ se mide: la respuesta cacheada deja de valer.
  sesion.anclasConversacion.onCambio(() => contexts.invalidate())
  // Al terminar un turno el transcript crece: caduca uso y contexto y avisa al panel.
  const usageWatcher = new UsageWatcher((key) => {
    usage.invalidate(key)
    contexts.invalidate()
    emisorSinContenido.emitir(USAGE_CHANNELS.CHANGED, { key } satisfies UsageChanged)
  })
  refs.vigilanteUso = usageWatcher
  registrarIpcContexto({ ipc, contexto: new ServicioContexto({ lector: contexts, baseDe: sesion.baseDeCuenta }) })
  registrarIpcUso({ ipc, uso: new ServicioUso({ lector: usage, vigilante: usageWatcher, baseDe: sesion.baseDeCuenta }) })
}

/**
 * Lo que se borra de un perfil BORRADO, en orden. Primero se cierran las sesiones del perfil que sigan
 * abiertas, SSH incluidas (el renderer ya las cierra al quitarlo; esto cubre la carrera): una SSH viva
 * seguiría usando las claves y el known_hosts que se borran, y un proceso con la carpeta como directorio
 * de trabajo la bloquearía en Windows. Luego su contenedor, su historial de consultas, sus conexiones SSH
 * y las carpetas de sus dos agentes propios (la del agente de la terminal y el espacio de datos), que van
 * a la papelera del sistema: el borrado se deduce de la lista guardada y tiene que poder deshacerse. El
 * historial de las conversaciones vive en la cuenta y no se toca.
 * Con el candado del perfil, y cada paso mira `perfiles.lista` de ESE momento (`profiles/borradoDePerfil.ts`).
 */
function depsDeBorrado(deps: DepsSesiones, sharedSandbox: SandboxManager): DepsBorradoCompleto<Profile> {
  const { refs, perfiles, espacioTerminal, espacioDatos, ssh, borrados } = deps
  return {
    // La lista de cada momento: `SAVE_PROFILES` la reasigna, así que se lee al usarse.
    idsVivos: () => perfiles.lista.map((n) => n.id),
    candado: borrados,
    pararContenedor: (p) => sharedSandbox.stopContainer(p),
    borrarHistorial: async (id) => refs.explorador?.alBorrarPerfil(id),
    borrarConexionesSsh: (id) => ssh.alBorrarPerfil(id),
    cerrarSesiones: (id) => Promise.all([refs.agentes?.closeSessionsForProfile(id), refs.terminales?.closeSessionsForProfile(id, { incluirSsh: true })]),
    // Cada dueño lleva su papelera desde que nace (`shell.trashItem`, en su composición).
    carpetas: [
      ['del agente de la terminal', espacioTerminal],
      ['del espacio de datos', espacioDatos]
    ],
    log: (m) => console.log(m),
    error: (m, err) => console.error(m, err)
  }
}

/** CRUD de perfiles: persiste, re-apunta los controladores y, de los borrados, para su contenedor y borra lo suyo. */
function registrarIpcGuardarPerfiles(deps: DepsSesiones, sharedSandbox: SandboxManager): void {
  const { refs, ipc, perfiles, accounts } = deps
  const borrado = depsDeBorrado(deps, sharedSandbox)
  ipc.handle(IPC_CHANNELS.SAVE_PROFILES, async (_e, next: Profile[]) => {
    saveProfilesMutable(next)
    const removed = perfiles.lista.filter((p) => !next.some((n) => n.id === p.id))
    perfiles.lista = next
    // Quien prepara la carpeta de un perfil recién creado lo esperaba: ya está en la lista.
    deps.llegada.cambiaron()
    refs.terminales?.updateProfiles(next)
    refs.agentes?.updateProfiles(next)
    accounts.ensureDefaults(next) // un perfil nuevo estrena sus cuentas default
    // Sin esperar nada antes: los candados de los borrados se toman aquí, en la misma vuelta.
    await borrarPerfiles(borrado, removed)
  })
}

/** Sandbox, terminales, agentes, cuentas, uso, hibernación y perfiles, en su orden. */
export function componerSesiones(deps: DepsSesiones): AgentesNativos {
  const { ipc, perfiles, dbController } = deps
  const sb = componerSandbox(deps)
  // Entorno extra de las terminales NATIVAS (`tdb` y las bases montadas), recalculado en cada apertura.
  const hostEnvForProfile: EntornoHost = (profileId, projectHostPath, dbConnectionIds) =>
    dbController.entornoHost(profileId, projectHostPath, dbConnectionIds)
  const controller = componerTerminal(deps, sb, hostEnvForProfile)
  const sesion = componerSesionAgente(deps, sb, hostEnvForProfile)
  const agentesNativos = componerAgentesNativos(deps.refs, sesion.agentController)
  componerCuentasYUso(deps, sesion, sb.emisorSinContenido)
  // Rehornea la imagen y recrea los contenedores; los paneles vivos se recuperan solos.
  registrarIpcActualizarAgentes({ ipc, sandbox: sb.sharedSandbox, eventos: sb.emisorSinContenido })
  registrarIpcAgentesNativos({ ipc, nativos: agentesNativos })
  // Hibernación a demanda por perfil: el refcount del sandbox mata el contenedor al caer la última sesión.
  const hibernationController = new HibernationController({
    terminal: controller,
    agent: sesion.agentController,
    sandbox: sb.sharedSandbox,
    getProfile: (id) => perfiles.lista.find((p) => p.id === id)
  })
  registrarIpcHibernacion({ ipc, hibernacion: hibernationController })
  registrarIpcGuardarPerfiles(deps, sb.sharedSandbox)
  return agentesNativos
}
