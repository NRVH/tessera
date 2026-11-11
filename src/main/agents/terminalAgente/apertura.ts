// =============================================================================
// Apertura de una sesión del agente: en el contenedor de su cuenta (cuenta, refcount de la
// credencial ANTES de tocar Docker, contenedor, montajes, memoria del sandbox, línea de
// arranque bajo `env -i`) o nativa en el host (candado de la actualización y shell nativa).
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import { buildAgentLaunchCommand, buildHostAgentLaunchCommand } from '../lineaArranqueAgente'
import { briefingCompuesto } from '../briefingCompuesto'
import { hayCuentasParaDelegar } from '../delegacion/cuentasDelegables'
import { claveSesionAgente } from '../../../shared/db-ipc'
import { escribirBloqueSandbox } from '../sandboxMemory'
import { prepararCapaCompartida } from '../configAgente/configCompartida'
import { contextoEfectivo } from '../../../shared/contexto'
import { AGENTES_DISPONIBLES, type Agente, type Profile } from '../../profiles/types'
import { PREFIJO_DOCKER_NO_DISPONIBLE } from '../../../shared/dockerErrors'
import {
  AGENT_TERMINAL_CHANNELS,
  type AgentDataMessage,
  type AgentExitMessage,
  type AgentOpenRequest,
  type AgentOpenResult
} from '../../../shared/agent-terminal-ipc'
import type { AgentAccount } from '../../../shared/agent-accounts-ipc'
import type { ActivityTracker } from '../agentActivity'
import { crearDetectorEnvio } from '../lineaEnviada'
import { acquireConfigRef, alVerLoginCodex, capasDeSesion, cfgRefKey, contenedorDe, releaseConfigRef, reservarLoginCodex } from './credenciales'
import { crearDetectorLoginCodex } from '../loginCodex'
import { conSitio, mientrasSeAbre } from './cupo'
import { anclarNuevaSesion, emitExit, makeActivityTracker, sondearTrasLanzar } from './turnos'
import { marcarEs, medidasDeProcesoNuevo, motivoSalidaNativa } from './hibernacion'
import { ACTIVITY_BOOT_GRACE_MS, HOST_ACCOUNT_ID, errMsg, esDeVentanaAgente, type NucleoAgente, type OpenAgentSession } from './tipos'
import { abrirManual } from './aperturaManual'
import type { TraspasoPendiente } from '../../traspaso/RegistroTraspasos'
import { txTraspaso } from '../../traspaso/textos'
import { MARCA_TRASPASO_CADUCADO } from '../../../shared/traspaso-ipc'
import { esAgenteManual } from '../../../shared/agentesManuales'

type DatosSesion = Omit<
  OpenAgentSession,
  'detectorEnvio' | 'versionLanzada' | 'lanzamiento' | 'ultimaEsAt' | 'lanzadaEn' | 'segundoPlano'
>

/** Sesión recién lanzada: detector nuevo, primer lanzamiento y versión aún desconocida. */
function sesionNueva(n: NucleoAgente, datos: DatosSesion): OpenAgentSession {
  return {
    ...datos,
    detectorEnvio: crearDetectorEnvio(),
    versionLanzada: null,
    lanzamiento: 1,
    ...medidasDeProcesoNuevo(n)
  }
}

/**
 * Reenvía la salida del pty al renderer y al rastreador de actividad, y apunta la E/S. Con
 * `verLogin` (Codex en contenedor), mira además si Codex empezó un login por navegador.
 */
function suscribirDatos(n: NucleoAgente, sessionId: string, activity: ActivityTracker, verLogin = false): () => void {
  const detector = verLogin ? crearDetectorLoginCodex() : null
  return n.terminals.onData(sessionId, (data) => {
    const payload: AgentDataMessage = { sessionId, data }
    n.eventos.emitir(AGENT_TERMINAL_CHANNELS.DATA, payload)
    activity.onData(data)
    marcarEs(n, sessionId)
    if (detector?.(data)) alVerLoginCodex(n, sessionId)
  })
}

/** La cuenta pedida o la predeterminada del (perfil, agente); nunca la de otro perfil. */
function resolverCuenta(n: NucleoAgente, profile: Profile, agente: Agente, req: AgentOpenRequest): AgentAccount {
  const account = req.accountId ? n.accounts.get(req.accountId) : n.accounts.defaultFor(profile.id, agente)
  if (!account) throw new Error(`Cuenta de agente desconocida: «${req.accountId}».`)
  if (account.agente !== agente) {
    throw new Error(`La cuenta «${account.id}» no es del agente «${agente}».`)
  }
  if (account.global !== true && account.profileId !== profile.id) {
    throw new Error(`La cuenta «${account.id}» no pertenece al perfil «${profile.id}».`)
  }
  return account
}

/**
 * Una petición de una ventana de agente, impuesta por el main: siempre nativa, en la carpeta del
 * usuario y sin bases, pida lo que pida el renderer.
 */
function peticionDeVentana(n: NucleoAgente, req: AgentOpenRequest): AgentOpenRequest {
  return { ...req, mode: 'host', projectHostPath: n.carpetaVentana(), dbConnectionIds: [], accountId: undefined }
}

/**
 * Abre una sesión de agente y la apunta a la ventana que la pidió. El dueño se fija en la misma
 * tanda de microtareas en que la sesión entra en el mapa, antes de que el pty entregue nada.
 */
export async function abrir(n: NucleoAgente, req: AgentOpenRequest, ventana?: number): Promise<AgentOpenResult> {
  const pedida = esDeVentanaAgente(req.profileId) ? peticionDeVentana(n, req) : req
  const res = await abrirSinDueno(n, pedida)
  const open = n.sessions.get(res.sessionId)
  if (open && ventana !== undefined) open.ventana = ventana
  return res
}

/**
 * Abre una sesión de agente. En contenedor, el refcount de la credencial se toma antes
 * del primer `await` de Docker y se devuelve (desmontando si era la última) si falla.
 */
async function abrirSinDueno(n: NucleoAgente, req: AgentOpenRequest): Promise<AgentOpenResult> {
  const profile = n.profiles.get(req.profileId)
  if (!profile) throw new Error(`Perfil desconocido: «${req.profileId}».`)
  if (esAgenteManual(req.agente)) return abrirManual(n, profile, req)
  const agente = req.agente as Agente
  if (!AGENTES_DISPONIBLES.includes(agente)) {
    throw new Error(`Agente desconocido: «${agente}».`)
  }
  if (req.mode === 'host') return abrirNativo(n, profile, agente, req)

  const account = resolverCuenta(n, profile, agente, req)
  n.log(`open() perfil=${profile.id} agente=${agente} cuenta=${account.id} proyecto=${req.projectHostPath}`)

  // Antes de tocar Docker: si otra cuenta está iniciando sesión en Codex, esta no se abre.
  const login = reservarLoginCodex(n, profile, agente, account)
  const cfgKey = cfgRefKey(profile.id, agente, account.id)
  acquireConfigRef(n.configRefs, cfgKey)
  try {
    const res = await mientrasSeAbre(contenedorDe(profile, agente, account.id).id, () => abrirEnContenedor(n, profile, agente, account, req))
    login?.asignar(res.sessionId)
    return res
  } catch (err) {
    login?.soltar()
    if (releaseConfigRef(n.configRefs, cfgKey)) {
      try {
        await n.sandbox.unmountAgentConfig(contenedorDe(profile, agente, account.id), agente, account.id)
      } catch (unmountErr) {
        n.log(`open() rollback unmountAgentConfig error: ${errMsg(unmountErr)}`)
      }
    }
    throw err
  }
}

/**
 * El contenedor de la cuenta, el proyecto, la credencial montada y la memoria del sandbox que el CLI lee al arrancar.
 * También lo usa una tarea delegada (`agents/delegacion/`), que corre en el mismo contenedor que la pestaña.
 */
export async function prepararContenedor(
  n: NucleoAgente,
  profile: Profile,
  agente: Agente,
  account: AgentAccount,
  req: AgentOpenRequest
): Promise<{ projectHostPath: string; configContainerPath: string; conCapa: boolean }> {
  const docker = await n.sandbox.asegurarDocker()
  if (!docker.ok) throw new Error(`${PREFIJO_DOCKER_NO_DISPONIBLE}\n${docker.detalle}`)

  const destino = contenedorDe(profile, agente, account.id)
  await conSitio(n, destino, req.cupo, () => n.sandbox.ensureContainer(destino))

  const mount = await n.sandbox.addProject(destino, req.projectHostPath)

  const hostConfigDir = n.accounts.hostDirFor(account)
  const cfgMount = await n.sandbox.mountAgentConfig(destino, agente, account.id, hostConfigDir)
  n.log(`mountAgentConfig OK -> ${agente}/${account.id} => ${cfgMount.containerPath} (host=${hostConfigDir})`)

  // Antes de que arranque el CLI: lee su configuración al empezar.
  const conCapa = agente === 'claude-code' || agente === 'codex' ? await prepararCapaCompartida(hostConfigDir, agente, capasDeSesion(n, profile, agente, account.id), (m) => n.log(m)) : false

  // Las capacidades se preguntan al contenedor vivo (su imagen), no a los ajustes.
  const caps = await n.sandbox.capacidades(destino)
  escribirBloqueSandbox(
    hostConfigDir,
    agente,
    {
      puedeInstalar: caps.puedeInstalar,
      horneados: caps.extras.apt,
      depsNavegador: caps.extras.depsNavegador
    },
    (m) => n.log(m)
  )
  return { projectHostPath: mount.projectHostPath, configContainerPath: cfgMount.containerPath, conCapa }
}

/**
 * El de bases tal cual delante y, detrás, el de SSH (también en Docker hay `tssh`, por el buzón del puente) y
 * el contexto (reglas globales y del perfil, documentos), que se lee del perfil vivo y del global al abrir.
 */
function avisoDeArranque(
  n: NucleoAgente,
  profile: Profile,
  projectHostPath: string,
  dbIds: string[],
  traspaso: TraspasoPendiente | null,
  enContenedor: boolean
): string | null {
  return briefingCompuesto({
    bd: n.getDbBriefing(profile.id, projectHostPath, dbIds),
    ssh: n.getSshBriefing(profile.id),
    contexto: contextoEfectivo(profile, n.contextoGlobal()),
    historial: true,
    traspaso: traspaso?.aviso ?? null,
    enContenedor,
    // Solo delega una sesión nativa, y solo hay a quién si el perfil tiene una cuenta de Docker con sesión.
    delegacion: !enContenedor && hayCuentasParaDelegar(n.accounts, profile.id)
  })
}

/**
 * Toma el traspaso de «Continuar en…» de esta apertura, si la petición lo trae. Uno que no existe, que caducó,
 * que ya tomó otra apertura o que es de otra apertura falla: abrir un chat sin él dejaría al usuario sin el
 * trabajo que pidió continuar, y sin saberlo.
 */
function traspasoDe(n: NucleoAgente, profile: Profile, agente: Agente, req: AgentOpenRequest): TraspasoPendiente | null {
  if (!req.traspasoId || !n.traspasos) return null
  const t = n.traspasos.reservar(req.traspasoId, { profileId: profile.id, projectHostPath: req.projectHostPath, agente })
  if (!t) throw new Error(`${MARCA_TRASPASO_CADUCADO}: ${txTraspaso().caducado}`)
  return t
}

/** Corre lo que crea la sesión; si falla, el traspaso vuelve a estar pendiente para el reintento. */
async function devolviendoSiFalla<T>(n: NucleoAgente, req: AgentOpenRequest, traspaso: TraspasoPendiente | null, crear: () => Promise<T> | T): Promise<T> {
  try {
    return await crear()
  } catch (err) {
    if (traspaso && req.traspasoId) n.traspasos?.devolver(req.traspasoId)
    throw err
  }
}

/** La sesión ya existe: el traspaso se gasta y lo que leerá `tctx traspaso` queda atado a ella. */
function consumirTraspaso(n: NucleoAgente, req: AgentOpenRequest, traspaso: TraspasoPendiente | null, sessionId: string): void {
  if (traspaso && req.traspasoId) n.traspasos?.consumir(req.traspasoId, claveSesionAgente(sessionId))
}

/** La línea de arranque en el contenedor, con el aviso (y el primer mensaje del traspaso, si lo hay). */
function lineaEnContenedor(
  n: NucleoAgente,
  profile: Profile,
  agente: Agente,
  req: AgentOpenRequest,
  o: { configPath: string; conCapa: boolean; extraEnv: Record<string, string>; traspaso: TraspasoPendiente | null }
): string {
  const aviso = avisoDeArranque(n, profile, req.projectHostPath, req.dbConnectionIds ?? [], o.traspaso, true)
  return buildAgentLaunchCommand(n.binaries[agente], agente, o.configPath, req.resumeSessionId, o.extraEnv, aviso, o.traspaso?.promptInicial, o.conCapa)
}

async function abrirEnContenedor(
  n: NucleoAgente,
  profile: Profile,
  agente: Agente,
  account: AgentAccount,
  req: AgentOpenRequest
): Promise<AgentOpenResult> {
  const preparado = await prepararContenedor(n, profile, agente, account, req)
  const destino = contenedorDe(profile, agente, account.id)
  // Antes de `launch`: la línea corre bajo `env -i` y tiene que llevar estas variables dentro.
  const extraEnv = n.getContainerEnv(profile.id, req.projectHostPath, req.dbConnectionIds ?? [], n.sandbox.dbBridgeContainerPath)
  const traspaso = traspasoDe(n, profile, agente, req)
  const session = await devolviendoSiFalla(n, req, traspaso, () => {
    const launch = lineaEnContenedor(n, profile, agente, req, { configPath: preparado.configContainerPath, conCapa: preparado.conCapa, extraEnv, traspaso })
    return n.terminals.createSession(destino, { project: req.projectHostPath, launch, extraEnv, tamano: req.tamano })
  })
  n.bindDbSession(extraEnv, claveSesionAgente(session.id))
  consumirTraspaso(n, req, traspaso, session.id)
  // Refcount del contenedor con clave `agent:` para no chocar con la terminal de abajo.
  n.sandbox.retainSession(destino.id, claveSesionAgente(session.id))
  n.log(`createSession OK -> id=${session.id} cwd=${session.workspacePath}`)

  const activity = makeActivityTracker(n, session.id, profile.id, req.projectHostPath, agente)
  activity.suppress(ACTIVITY_BOOT_GRACE_MS)
  const unsubData = suscribirDatos(n, session.id, activity, agente === 'codex')
  const unsubExit = n.terminals.onExit(session.id, (exitCode) => {
    // Cierra el turno en silencio: una muerte no es novedad que revisar.
    activity.finish()
    void emitExit(n, destino, session.id, exitCode)
  })

  const clave = anclarNuevaSesion(n, session.id, agente, account.id, false, req.projectHostPath, req.resumeSessionId)
  n.sessions.set(
    session.id,
    sesionNueva(n, {
      sessionId: session.id,
      profileId: profile.id,
      agente,
      accountId: account.id,
      projectHostPath: req.projectHostPath,
      host: false,
      resumeSessionId: req.resumeSessionId,
      ...(traspaso?.aviso ? { avisoTraspaso: traspaso.aviso } : {}),
      claveAncla: clave,
      manual: null,
      activity,
      unsubData,
      unsubExit
    })
  )

  return {
    sessionId: session.id,
    profileId: profile.id,
    agente,
    accountId: account.id,
    projectHostPath: preparado.projectHostPath,
    workspacePath: session.workspacePath,
    configContainerPath: preparado.configContainerPath
  }
}

/** Salida de una sesión nativa: sin contenedor que diagnosticar; si terminó mal con poca memoria, se dice. */
function suscribirSalidaNativa(n: NucleoAgente, sessionId: string, activity: ActivityTracker): () => void {
  return n.terminals.onExit(sessionId, (exitCode) => {
    activity.finish()
    const payload: AgentExitMessage = { sessionId, exitCode, reason: motivoSalidaNativa(n, exitCode) }
    n.eventos.emitir(AGENT_TERMINAL_CHANNELS.EXIT, payload)
    n.log(`agente [NATIVO] EXIT session=${sessionId} exitCode=${exitCode}`)
    n.alCambiarSesiones()
  })
}

/** Sesión nativa del host con la cuenta personal: sin Docker, cuentas ni montajes. */
async function abrirNativo(
  n: NucleoAgente,
  profile: Profile,
  agente: Agente,
  req: AgentOpenRequest
): Promise<AgentOpenResult> {
  const dbIds = req.dbConnectionIds ?? []
  n.log(`open() [NATIVO] perfil=${profile.id} agente=${agente} proyecto=${req.projectHostPath} bd=${dbIds.length}`)
  // El candado va lo primero, antes de acuñar tokens o entornos que la espera envejecería.
  await n.esperarCandado(agente)
  const traspaso = traspasoDe(n, profile, agente, req)
  const { session, extraEnv } = await devolviendoSiFalla(n, req, traspaso, async () => {
    const briefing = avisoDeArranque(n, profile, req.projectHostPath, dbIds, traspaso, false)
    // Solo se sondea al reanudar Claude Code: es lo único que lo necesita.
    const snapshot = agente === 'claude-code' && !!req.resumeSessionId && (await n.admiteSnapshotNativo())
    const launch = buildHostAgentLaunchCommand(n.binaries[agente], agente, req.resumeSessionId, briefing, undefined, traspaso?.promptInicial, snapshot)
    const env = n.getHostEnv(profile.id, req.projectHostPath, dbIds)
    return { extraEnv: env, session: await n.terminals.createSession(profile, { project: req.projectHostPath, launch, host: true, extraEnv: env, tamano: req.tamano }) }
  })
  n.bindDbSession(extraEnv, claveSesionAgente(session.id))
  consumirTraspaso(n, req, traspaso, session.id)
  n.log(`createSession [NATIVO] OK -> id=${session.id} cwd=${session.workspacePath}`)

  const activity = makeActivityTracker(n, session.id, profile.id, req.projectHostPath, agente)
  activity.suppress(ACTIVITY_BOOT_GRACE_MS)
  const unsubData = suscribirDatos(n, session.id, activity)
  const unsubExit = suscribirSalidaNativa(n, session.id, activity)

  const claveHost = anclarNuevaSesion(n, session.id, agente, HOST_ACCOUNT_ID, true, req.projectHostPath, req.resumeSessionId)
  const nueva = sesionNueva(n, {
    sessionId: session.id,
    profileId: profile.id,
    agente,
    accountId: HOST_ACCOUNT_ID,
    projectHostPath: req.projectHostPath,
    host: true,
    resumeSessionId: req.resumeSessionId,
    ...(traspaso?.aviso ? { avisoTraspaso: traspaso.aviso } : {}),
    claveAncla: claveHost,
    manual: null,
    activity,
    unsubData,
    unsubExit
  })
  n.sessions.set(session.id, nueva)
  sondearTrasLanzar(n, nueva)
  n.alCambiarSesiones()

  return {
    sessionId: session.id,
    profileId: profile.id,
    agente,
    accountId: HOST_ACCOUNT_ID,
    projectHostPath: req.projectHostPath,
    workspacePath: session.workspacePath,
    configContainerPath: ''
  }
}
