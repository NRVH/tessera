// =============================================================================
// Composición de las sesiones, parte de la raíz de composición de la app: el sandbox compartido,
// la terminal de abajo, la del agente con sus anclas y su vigilante de turnos, los agentes
// nativos, cuentas, conversaciones (y `tctx buscar`), uso, contexto, «Continuar en…», hibernación y el guardado de perfiles, con
// sus `ipc.ts`. Lo llama `src/main/index.ts` con las referencias, `ipcMain` y lo ya compuesto.
// =============================================================================
import { app, BrowserWindow, shell, webContents, type IpcMain } from 'electron'
import { hijaDirectaALaPapelera } from '../util/carpetaDePerfil'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { esWindows, plataformaActual } from '../../shared/plataforma'
import { IPC_CHANNELS } from '../../shared/ipc'
import type { AjustesWorkspace } from '../../shared/workspace-state-ipc'
import { normalizarExtras } from '../../shared/sandboxExtras'
import { umbralPruebasDe } from '../../shared/ajustesAgente'
import { AGENTS_UPDATE_CHANNELS, type ProgresoActualizacionAgentes } from '../../shared/agents-update-ipc'
import { AGENTES_NATIVOS_CHANNELS } from '../../shared/agentes-nativos-ipc'
import { SANDBOX_RED_CHANNELS } from '../../shared/sandbox-red-ipc'
import { SANDBOX_ESTADO_CHANNELS } from '../../shared/sandbox-estado-ipc'
import { USAGE_CHANNELS, type CambioUso } from '../../shared/usage-ipc'
import type { ReferenciasApp } from '../app/referencias'
import { emisorATodas, emisorDeVentana, emisorPorSesion, type EmisorEventos } from '../util/emisorEventos'
import { carpetaVentanaAgente } from '../util/carpetaVentanaAgente'
import { guardarPerfilesEditables } from '../perfiles/store'
import type { PerfilesVivos, Perfil } from '../perfiles/types'
import { cargarAjustesWorkspace } from '../workspace/almacenEstadoWorkspace'
import type { ControladorBd } from '../db/ControladorBd'
import { registroBd } from '../db/registroBd'
import type { ControladorSsh } from '../ssh/ControladorSsh'
import { lanzadaPorElArnes } from '../../shared/arnesE2e'
import { VigilanteMemoria } from './vigilanteMemoria'
import type { EspacioTerminal } from '../ssh/controlador/espacioTerminal'
import type { PropuestasReglas } from '../reglas/propuestasReglas'
import type { ContextoGlobal } from '../../shared/contexto'
import { borrarPerfiles, type DepsBorradoCompleto, type DuenoDeCarpeta } from '../perfiles/borradoDePerfil'
import { BorradosPendientes, borrarPorOrden, listaAGuardar, terminarBorradosPendientes } from '../perfiles/ordenDeBorrado'
import type { CandadoDeBorrado } from '../perfiles/candadoDeBorrado'
import type { LlegadaDePerfiles } from '../perfiles/llegadaDePerfiles'
import { GestorSandbox, fijarBaseGestionada } from '../sandbox/GestorSandbox'
import { conservarPermisosSsh } from '../ssh/agente/permisos'
import { registrarIpcRedSandbox, registrarIpcActualizarAgentes } from '../sandbox/ipc'
import { crearRegistroLecturaImagen, leerEstadoAgentesDocker } from '../sandbox/estadoImagenAgentes'
import { ControladorTerminal } from '../terminales/ControladorTerminal'
import { registrarIpcTerminal } from '../terminales/ipc'
import type { FilaProceso } from '../terminales/terminalesEnMarcha'
import { tablaDeProcesosConTty } from '../terminales/adaptadores/pty'
import { listarProcesosWindows } from '../actualizacion/procesosSistema'
import { LectorConversaciones } from '../conversaciones/LectorConversaciones'
import { crearTitulosConversacion } from '../conversaciones/titulosConversacion'
import { ServicioConversaciones } from '../conversaciones/ServicioConversaciones'
import { crearBaseDeCuenta, crearBaseDeCuentaDeLectura, type BaseDeCuenta } from '../conversaciones/baseAgente'
import { registrarIpcConversaciones } from '../conversaciones/ipc'
import { LectorUso } from '../uso/LectorUso'
import { ServicioUso } from '../uso/ServicioUso'
import { registrarIpcUso } from '../uso/ipc'
import { VigilanteUso } from '../uso/VigilanteUso'
import { LectorContexto } from '../contextoConversacion/LectorContexto'
import { ServicioContexto } from '../contextoConversacion/ServicioContexto'
import { registrarIpcContexto } from '../contextoConversacion/ipc'
import { crearRegistroAnclas, type RegistroAnclas } from '../contextoConversacion/anclaConversacion'
import { ControladorHibernacion } from '../hibernacion/ControladorHibernacion'
import { registrarIpcHibernacion } from '../hibernacion/ipc'
import { ControladorTerminalAgente } from './ControladorTerminalAgente'
import { AgentesNativos } from './agentesNativos'
import { ejecutarEnShellNativa } from './ejecutorShell'
import { crearSondaOpcion } from './sondaOpcionCli'
import { OPCION_FOTO } from './lineaArranqueAgente'
import { registrarIpcAgentesManuales } from './manuales/ipc'
import { registrarIpcTerminalAgente, registrarIpcCuentas, registrarIpcAgentesNativos, registrarIpcConfigAgente } from './ipc'
import { capasCompartidasDe, crearConfigAgente, raizCompartida } from './configAgente/creacion'
import type { OperacionConfigTctx } from './configAgente/operacionConfigTctx'
import { portapapelesDelSistema } from './adaptadores/portapapeles'
import { traerTextoConTope } from './adaptadores/redElectron'
import { AlmacenCuentas } from './AlmacenCuentas'
import { nombreVisibleCuenta } from './textos'
import { VigilanteTurno } from './VigilanteTurno'
import { ejecutarGit } from '../git/adaptadores/procesoGit'
import type { RegistroTraspasos } from '../traspaso/RegistroTraspasos'
import { ServicioTraspaso } from '../traspaso/ServicioTraspaso'
import { registrarIpcTraspaso } from '../traspaso/ipc'
import type { OperacionBuscarHistorial } from '../historial/operacionBuscar'
import type { OperacionDelegacion } from './delegacion/operacionDelegacion'
import { registrarIpcDelegacion } from './delegacion/ipc'
import { crearRegistroTareas } from './delegacion/registroTareas'
import { DELEGACION_CHANNELS } from '../../shared/delegacion-ipc'
import { TOPES_DEFECTO, buscarEnHistorial } from '../historial/buscarHistorial'

/** Lo que la composición de las sesiones recibe de `index.ts`. */
export interface DependenciasSesiones {
  refs: ReferenciasApp
  ipc: IpcMain
  perfiles: PerfilesVivos
  cuentas: AlmacenCuentas
  controladorBd: ControladorBd
  /** Las conexiones SSH: la terminal abre sus sesiones y el guardado de perfiles las borra con el perfil. */
  ssh: ControladorSsh
  /** La carpeta del agente de la terminal de cada perfil: el guardado de perfiles la manda a la papelera con el perfil. */
  espacioTerminal: Pick<EspacioTerminal, 'borrar'>
  /** El espacio de datos de cada perfil (`ControladorBd.espacioDatos`): igual que la carpeta de arriba. */
  espacioDatos: DuenoDeCarpeta
  /** Las propuestas de reglas pendientes: el borrado de un perfil quita la suya y cada guardado resuelve las aceptadas. */
  propuestasReglas: Pick<PropuestasReglas, 'borrarPerfil' | 'alGuardarPerfiles'>
  /** El candado del borrado de cada perfil: lo toma el guardado de perfiles y lo esperan sus sesiones al abrirse. */
  borrados: CandadoDeBorrado
  /** La llegada de un perfil recién creado: el guardado de perfiles despierta a quien espera uno nuevo. */
  llegada: Pick<LlegadaDePerfiles, 'cambiaron'>
  /** Los traspasos de «Continuar en…»: los prepara su servicio, los toma la apertura y los lee `tctx traspaso`. */
  traspasos: RegistroTraspasos
  /** `tctx buscar`, ya registrada en el puente: aquí recibe las sesiones, las cuentas y el lector del historial. */
  buscarHistorial: Pick<OperacionBuscarHistorial, 'conectar'>
  /** `tctx config`, ya registrada en el puente: aquí recibe las sesiones, el servicio y las propuestas. */
  operacionConfigTctx: Pick<OperacionConfigTctx, 'conectar'>
  /** El contexto global de los agentes, vigente: lo lleva el aviso de arranque de cada sesión. */
  contextoGlobal: () => ContextoGlobal
  /** `tctx cuentas`, `delegar` y `tarea`, ya registradas en el puente: aquí reciben el servicio y las sesiones. */
  delegacion: Pick<OperacionDelegacion, 'conectar'>
}

/** Pasa al sandbox los paquetes a hornear: solo marca la imagen como obsoleta, no la rehornea. */
export function aplicarExtrasSandbox(sandbox: GestorSandbox | null, ajustes: AjustesWorkspace): void {
  sandbox?.fijarExtras(normalizarExtras(ajustes.paquetesExtraSandbox, ajustes.sandboxDepsNavegador))
}

/** Cuentas de agente: registro y credenciales en `userData`, que sobrevive a actualizar. */
export function crearCuentas(perfiles: PerfilesVivos): AlmacenCuentas {
  const cuentas = new AlmacenCuentas({
    rutaAlmacen: join(app.getPath('userData'), 'agent-accounts.json'),
    raizDatos: app.getPath('userData')
  })
  cuentas.asegurarPredeterminadas(perfiles.lista)
  return cuentas
}

interface Sandbox {
  sharedSandbox: GestorSandbox
  emisorSinContenido: EmisorEventos
}

/** El sandbox de los agentes: las firmas SSH y las bases se sirven por el buzón. */
function componerSandbox({ refs, ipc, perfiles, controladorBd }: DependenciasSesiones): Sandbox {
  const dirDockerfile = join(app.getAppPath(), 'docker', 'sandbox')
  // ANTES de construir el sandbox; en macOS la raíz vive bajo `userData` (ver `sandbox/rutasSandbox.ts`).
  // Bajo el arnés de pruebas, la imagen de pruebas: la del usuario que comparte el Docker no se toca.
  fijarBaseGestionada(app.getPath('userData'), !lanzadaPorElArnes(process.argv))
  const sharedSandbox = new GestorSandbox(dirDockerfile)
  sharedSandbox.fijarPuenteDb(
    (perfilId) => controladorBd.prepararBuzonDocker(perfilId),
    (perfilId) => controladorBd.olvidarBuzonDocker(perfilId)
  )
  refs.sandbox = sharedSandbox
  aplicarExtrasSandbox(refs.sandbox, cargarAjustesWorkspace())
  // Estas guardas nunca miraron `webContents`: su emisor va sin comprobarlo.
  const emisorSinContenido = emisorDeVentana(() => refs.ventana, { comprobarContenido: false })
  // El rebuild AUTOMÁTICO de la imagen reusa el canal de progreso de «Actualizar agentes».
  sharedSandbox.fijarRegistroConstruccionImagen((linea, fase) =>
    emisorSinContenido.emitir(AGENTS_UPDATE_CHANNELS.PROGRESS, { line: linea, fase } satisfies ProgresoActualizacionAgentes)
  )
  sharedSandbox.fijarManejadorAvisoRed((aviso) => emisorSinContenido.emitir(SANDBOX_RED_CHANNELS.AVISO, aviso))
  sharedSandbox.fijarManejadorEstadoDocker((estado) => emisorSinContenido.emitir(SANDBOX_ESTADO_CHANNELS.DOCKER, estado))
  registrarIpcRedSandbox({ ipc, sandbox: sharedSandbox, perfiles: () => perfiles.lista })
  // Las capas de los agentes manuales de cada perfil: el registro es del main y sobrevive a actualizar.
  sharedSandbox.usarRegistroCapas(join(app.getPath('userData'), 'capas-perfil.json'))
  registrarIpcAgentesManuales({
    ipc,
    sandbox: sharedSandbox,
    perfiles: () => perfiles.lista,
    ejecutar: ejecutarEnShellNativa,
    emisor: emisorSinContenido,
    sesionConContexto: (id) => refs.agentes?.sesionConContexto(id) ?? null
  })
  // Barrido de montajes colgados de un cierre sucio; `ensureContainer` lo espera. Bajo el
  // arnés de pruebas no se barren los heredados: pueden ser de la Tessera abierta del usuario.
  sharedSandbox.iniciarBarridoArranque(!lanzadaPorElArnes(process.argv))
  return { sharedSandbox, emisorSinContenido }
}

type EntornoHost = (perfilId: string, rutaHostProyecto: string, conexionDbIds: string[]) => Record<string, string>

/**
 * La tabla de procesos de la plataforma, o null si no se pudo leer. En Windows solo trae los
 * shells y sus hijos directos; en macOS y Linux, la tabla entera con el grupo de cada tty.
 */
async function tablaProcesosDelSistema(pidsShell: readonly number[]): Promise<FilaProceso[] | null> {
  if (!esWindows()) return tablaDeProcesosConTty()
  const r = await listarProcesosWindows({ topeMs: 5000, soloPids: pidsShell })
  return r.ok ? r.procesos : null
}

/** La terminal de abajo. */
function componerTerminal({ refs, ipc, perfiles, controladorBd, ssh, borrados }: DependenciasSesiones, hostEnv: EntornoHost): ControladorTerminal {
  const controlador = new ControladorTerminal({
    perfiles: perfiles.lista,
    eventos: emisorDeVentana(() => refs.ventana),
    obtenerEntornoHost: hostEnv,
    vincularSesionDb: (env, sesionId) => controladorBd.atarSesion(env, sesionId),
    // Con su token se va quien vigila sus tareas delegadas: se cancelan.
    revocarSesionDb: (sesionId) => {
      controladorBd.revocarSesion(sesionId)
      refs.agentes?.alCerrarOrigenDelegacion(sesionId)
    },
    lanzadorSsh: ssh,
    tablaProcesos: tablaProcesosDelSistema
  })
  refs.terminales = controlador
  registrarIpcTerminal({ ipc, terminales: controlador, esperarBorrado: (id) => borrados.esperar(id) })
  return controlador
}

interface SesionAgente {
  anclasConversacion: RegistroAnclas
  baseDeCuenta: BaseDeCuenta
  controladorAgente: ControladorTerminalAgente
}

/**
 * El vigilante de la memoria del equipo, ya midiendo. `TESSERA_E2E_POCA_MEMORIA` (`1` o `0`) fija la
 * respuesta, solo con la marca del arnés de interfaz.
 */
function crearVigilanteMemoria(): VigilanteMemoria {
  const forzada = lanzadaPorElArnes(process.argv) ? process.env.TESSERA_E2E_POCA_MEMORIA : undefined
  const vigilante = new VigilanteMemoria({
    plataforma: plataformaActual(),
    log: (m) => registroBd('hibernar', m),
    ...(forzada === '1' || forzada === '0' ? { forzada: forzada === '1' } : {})
  })
  vigilante.iniciar()
  return vigilante
}

/** La terminal del agente, con las anclas de conversación y el vigilante de turnos. */
function componerSesionAgente(deps: DependenciasSesiones, sb: Sandbox, hostEnv: EntornoHost): SesionAgente {
  const { refs, ipc, perfiles, cuentas, controladorBd } = deps
  // Las escribe el controlador del agente y las lee el LectorContexto.
  const anclasConversacion = crearRegistroAnclas()
  const baseDeCuenta = crearBaseDeCuenta(cuentas)
  // El fin del turno lo dice el TRANSCRIPT; el vigilante devuelve las marcas al controlador.
  // También las tareas en segundo plano, que vetan la hibernación por inactividad.
  refs.vigilanteTurnos = new VigilanteTurno(
    (sesionId, marca) => refs.agentes?.aplicarMarcaTurno(sesionId, marca),
    undefined,
    (sesionId, cambios) => refs.agentes?.aplicarSegundoPlano(sesionId, cambios)
  )
  // La salida de cada sesión va a la ventana que la abrió: la principal o una ventana de agente.
  const eventos = emisorPorSesion(emisorDeVentana(() => refs.ventana), (sesionId) => {
    const ventana = refs.agentes?.ventanaDe(sesionId)
    if (ventana === undefined || ventana === null) return 'sin-dueno'
    return webContents.fromId(ventana) ?? null
  })
  const memoria = crearVigilanteMemoria()
  const controladorAgente = new ControladorTerminalAgente({
    // A disco: lo que hacen las sesiones y las tareas delegadas en Docker es lo que explica un fallo después.
    log: (m) => registroBd('agentes', m),
    pocaMemoria: () => memoria.pocaMemoria(),
    perfiles: perfiles.lista,
    sandbox: sb.sharedSandbox,
    cuentas,
    eventos,
    carpetaVentana: () => carpetaVentanaAgente(),
    portapapeles: portapapelesDelSistema,
    anclas: anclasConversacion,
    obtenerBaseAgente: baseDeCuenta,
    turnos: refs.vigilanteTurnos,
    obtenerEntornoHost: hostEnv,
    obtenerAvisoBd: (perfilId, proyecto, ids) => controladorBd.briefingParaAgente(perfilId, proyecto, ids),
    obtenerAvisoSsh: (perfilId) => deps.ssh.briefingAgente(perfilId),
    obtenerEntornoContenedor: (perfil, proyecto, ids, buzon) =>
      controladorBd.entornoContenedor(perfil, proyecto, ids, buzon),
    vincularSesionDb: (env, sesionId) => controladorBd.atarSesion(env, sesionId),
    revocarSesionDb: (sesionId) => {
      controladorBd.revocarSesion(sesionId)
      refs.agentes?.alCerrarOrigenDelegacion(sesionId)
    },
    // Enlace TARDÍO: el servicio de los agentes nativos nace después y necesita a este controlador.
    sondearVersion: (agente) => (refs.agentesNativos ? refs.agentesNativos.instalada(agente) : Promise.resolve(null)),
    esperarCandado: (agente) => (refs.agentesNativos ? refs.agentesNativos.esperarCandado(agente) : Promise.resolve()),
    alCambiarSesiones: () => refs.agentesNativos?.notificarSesiones(),
    // Solo la leen las pruebas de interfaz: acorta el umbral, no enciende la hibernación.
    inactividadPruebasMs: umbralPruebasDe(process.env.TESSERA_AGENTE_INACTIVIDAD_MS),
    rutaRegistroParadas: join(app.getPath('userData'), 'logs', 'paradas-contenedores.jsonl'),
    traspasos: deps.traspasos,
    capasCompartidas: (perfil, agente) => capasCompartidasDe(app.getPath('userData'), perfil, agente),
    contextoGlobal: deps.contextoGlobal,
    admiteFotoNativa: crearSondaOpcion({ orden: 'claude --help', opcion: OPCION_FOTO, ejecutar: ejecutarEnShellNativa })
  })
  refs.agentes = controladorAgente
  registrarIpcTerminalAgente({ ipc, agentes: controladorAgente, esperarBorrado: (id) => deps.borrados.esperar(id) })
  return { anclasConversacion, baseDeCuenta, controladorAgente }
}

/** Versiones e instalación de los agentes del HOST (solo sesiones nativas). */
function componerAgentesNativos(refs: ReferenciasApp, controladorAgentes: ControladorTerminalAgente): AgentesNativos {
  const enviarAVentana = emisorDeVentana(() => refs.ventana).emitir
  const agentesNativos = new AgentesNativos({
    plataforma: plataformaActual(),
    arquitectura: process.arch,
    ejecutar: ejecutarEnShellNativa,
    traerTexto: traerTextoConTope,
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
    dirPersonal: os.homedir(),
    sesiones: () => controladorAgentes.sesionesNativas(),
    detenerVarias: (ids) => controladorAgentes.detenerVarias(ids),
    pidsTessera: (agente) => controladorAgentes.pidsNativos(agente),
    emitirCambio: (estado) => enviarAVentana(AGENTES_NATIVOS_CHANNELS.CAMBIO, estado),
    emitirProgreso: (p) => enviarAVentana(AGENTES_NATIVOS_CHANNELS.PROGRESO, p),
    log: (m) => registroBd('agentes-nativos', m)
  })
  refs.agentesNativos = agentesNativos
  return agentesNativos
}

/** Cuentas, conversaciones (y su búsqueda), uso de cuenta y contexto de la conversación; devuelve el lector del contexto. */
function componerCuentasYUso(deps: DependenciasSesiones, sesion: SesionAgente, aTodas: EmisorEventos): LectorContexto {
  const { refs, ipc, cuentas, buscarHistorial, operacionConfigTctx, perfiles } = deps
  // LOGOUT y DELETE cierran antes las sesiones vivas de esa cuenta, en cualquier perfil.
  registrarIpcCuentas({
    ipc,
    cuentas,
    cerrarSesionesDeCuenta: (id) => refs.agentes?.cerrarSesionesDeCuenta(id),
    cerrarSesionesDeAgente: (perfilId, agente) => refs.agentes?.cerrarSesionesDeAgente(perfilId, agente),
    // `lectorUso` y `vigilanteUso` se declaran más abajo: las clausuras los leen al atender.
    olvidarUso: (id) => lectorUso.olvidar(id),
    soltarVigilanteUso: (id) => vigilanteUso.cerrar(id)
  })
  const sesionesDe = (agente: 'claude-code' | 'codex', cuentaId: string | null): number => refs.agentes?.contarSesionesDeConfig(agente, cuentaId) ?? 0
  const sesionAgente = (id: string): ReturnType<ControladorTerminalAgente['sesionParaHistorial']> => sesion.controladorAgente.sesionParaHistorial(id)
  const config = crearConfigAgente({ datosUsuario: app.getPath('userData'), cuentas, perfiles, sesionesDe, operacionConfigTctx, sesionAgente, eventos: aTodas, log: (m) => registroBd('config-agente', m) })
  registrarIpcConfigAgente({ ipc, ...config })
  // UNA sola instancia de títulos: dos sobre el mismo archivo se pisarían las escrituras.
  const titulos = crearTitulosConversacion(join(app.getPath('userData'), 'conversation-titles.json'))
  // Uno para el panel y la búsqueda: comparten la caché de resúmenes.
  const lector = new LectorConversaciones()
  registrarIpcConversaciones({
    ipc,
    conversaciones: new ServicioConversaciones({ lector, titulos, baseDe: sesion.baseDeCuenta })
  })
  buscarHistorial.conectar({
    sesionAgente: (id) => sesion.controladorAgente.sesionParaHistorial(id),
    cuentasDelPerfil: (perfilId, agente) => cuentas.disponibles(perfilId, agente).map((c) => ({ id: c.id, nombre: nombreVisibleCuenta(c) })),
    cuenta: (id) => {
      const c = cuentas.obtener(id)
      return c ? { profileId: c.profileId, agente: c.agente, nombre: nombreVisibleCuenta(c) } : null
    },
    baseDe: crearBaseDeCuentaDeLectura(cuentas),
    buscar: (fuentes, proyecto, consulta, max) =>
      buscarEnHistorial(fuentes, proyecto, consulta, { ...TOPES_DEFECTO, max }, {
        resumenDe: (archivo, agente) => lector.resumenDe(archivo, agente),
        tituloPropio: (agente, id) => titulos.obtenerTituloPropio(agente, id),
        log: (m) => registroBd('historial', m)
      }),
    log: (m) => registroBd('historial', m)
  })
  const lectorUso = new LectorUso()
  const lectorContexto = new LectorContexto(Date.now, sesion.anclasConversacion)
  // Cambiar de conversación cambia QUÉ se mide: la respuesta cacheada deja de valer.
  sesion.anclasConversacion.onCambio(() => lectorContexto.invalidate())
  // Al terminar un turno el transcript crece: caduca uso y contexto y avisa al panel.
  // A todas las ventanas (`aTodas`): el pie de una ventana de agente pinta el uso de la misma cuenta nativa.
  const vigilanteUso = new VigilanteUso((clave) => {
    lectorUso.invalidate(clave)
    lectorContexto.invalidate()
    aTodas.emitir(USAGE_CHANNELS.CHANGED, { clave } satisfies CambioUso)
  })
  refs.vigilanteUso = vigilanteUso
  registrarIpcContexto({ ipc, contexto: new ServicioContexto({ lector: lectorContexto, baseDe: sesion.baseDeCuenta }) })
  const uso = new ServicioUso({ lector: lectorUso, vigilante: vigilanteUso, baseDe: sesion.baseDeCuenta })
  registrarIpcUso({ ipc, uso })
  componerDelegacion(deps, sesion, uso, aTodas)
  return lectorContexto
}

/** Las tareas delegadas: su servicio en el controlador de los agentes, `tctx` por el puente y el indicador por IPC. */
function componerDelegacion({ ipc, delegacion }: DependenciasSesiones, sesion: SesionAgente, uso: ServicioUso, aTodas: EmisorEventos): void {
  const servicio = sesion.controladorAgente.crearDelegacion({
    uso: async (agente, cuentaId) => {
      const s = await uso.leer({ agente, accountId: cuentaId, mode: 'container' })
      return s.windows.map((w) => ({ etiqueta: w.etiqueta, porcentaje: w.porcentaje, ...(w.restablecimientoEn !== undefined ? { reinicio: w.restablecimientoEn } : {}) }))
    },
    emitir: (tareas) => aTodas.emitir(DELEGACION_CHANNELS.CAMBIO, tareas),
    // La misma clave que usa el renderer para las bases montadas de un proyecto (`claveDestinoEditor`).
    montajesDe: (perfilId, proyecto) => cargarAjustesWorkspace().dbMountsByProject?.[`${perfilId}|${proyecto}`] ?? [],
    registro: crearRegistroTareas(join(app.getPath('userData'), 'tareas-delegadas.json'))
  })
  delegacion.conectar({
    servicio,
    sesionAgente: (id) => {
      const s = sesion.controladorAgente.sesionParaHistorial(id)
      return s ? { profileId: s.profileId, host: s.host } : null
    }
  })
  registrarIpcDelegacion({ ipc, servicio })
}

/**
 * «Continuar en…»: su servicio con las sesiones del agente, las carpetas de las cuentas y git en el equipo. La
 * conversación que no sepa el ancla la aprende el lector del contexto, el mismo que alimenta el anillo.
 */
function componerTraspaso({ ipc, cuentas, traspasos }: DependenciasSesiones, sesion: SesionAgente, lectorContexto: LectorContexto): void {
  const servicio = new ServicioTraspaso({
    origenDe: (id) => sesion.controladorAgente.origenDeTraspaso(id),
    aprenderConversacion: async (o) => {
      const base = sesion.baseDeCuenta(o.agente, o.cuentaId, o.host)
      if (!base) return
      lectorContexto.invalidate()
      await lectorContexto.leer(base, o.agente, o.rutaHostProyecto)
    },
    baseDe: (agente, cuentaId, host) => sesion.baseDeCuenta(agente, cuentaId, host),
    rutaEnContenedor: (perfilId, agente, cuentaId, proyecto) => sesion.controladorAgente.rutaEnContenedor(perfilId, agente, cuentaId, proyecto),
    cuenta: (id, perfilId, agente) => {
      const c = cuentas.obtener(id)
      return c && (c.global === true || c.profileId === perfilId) && c.agente === agente ? { nombre: c.nombre } : null
    },
    git: async (args, cwd) => {
      try {
        return (await ejecutarGit(args, cwd)).stdout
      } catch {
        return null
      }
    },
    registro: traspasos,
    log: (m) => registroBd('traspaso', m)
  })
  registrarIpcTraspaso({ ipc, traspaso: servicio })
}

/**
 * Lo que se borra de un perfil BORRADO, en orden. Primero se cierran las sesiones del perfil que sigan
 * abiertas, SSH incluidas (el renderer ya las cierra al quitarlo; esto cubre la carrera): una SSH viva
 * seguiría usando las claves y el known_hosts que se borran, y un proceso con la carpeta como directorio
 * de trabajo la bloquearía en Windows. Luego su contenedor, su historial de consultas, sus conexiones SSH
 * y de bases de datos, su propuesta de reglas, y las carpetas de sus dos agentes propios (la del agente de la terminal y el
 * espacio de datos), que van a la papelera del sistema para poder deshacerse. El historial de las
 * conversaciones vive en la cuenta y no se toca.
 * Con el candado del perfil, y cada paso mira `perfiles.lista` de ESE momento (`perfiles/borradoDePerfil.ts`).
 */
/** La capa de configuración de Docker de cada perfil (`<raíz>/perfiles/<id>`), como dueña de una carpeta del perfil. */
function capaConfigDelPerfil(): DuenoDeCarpeta {
  const base = join(raizCompartida(app.getPath('userData')), 'perfiles')
  return { borrar: (perfilId, idsVivos) => hijaDirectaALaPapelera(base, perfilId, idsVivos, (ruta) => shell.trashItem(ruta)) }
}

function depsDeBorrado(deps: DependenciasSesiones, sharedSandbox: GestorSandbox): DepsBorradoCompleto<Perfil> {
  const { refs, perfiles, espacioTerminal, espacioDatos, ssh, controladorBd, borrados } = deps
  return {
    // La lista de cada momento: el guardado y la orden de borrado la reasignan, así que se lee al usarse.
    idsVivos: () => perfiles.lista.map((n) => n.id),
    candado: borrados,
    // Con el contenedor se va la capa de imagen de sus agentes manuales.
    pararContenedor: async (p) => {
      await sharedSandbox.detenerContenedor(p)
      sharedSandbox.olvidarCapa(p.id)
    },
    borrarHistorial: async (id) => refs.explorador?.alBorrarPerfil(id),
    borrarConexionesSsh: (id) => ssh.alBorrarPerfil(id),
    borrarConexionesBd: (id) => controladorBd.alBorrarPerfil(id),
    borrarPropuestaReglas: (id) => deps.propuestasReglas.borrarPerfil(id),
    cerrarSesiones: (id) => Promise.all([refs.agentes?.cerrarSesionesDePerfil(id), refs.terminales?.cerrarSesionesDePerfil(id, { incluirSsh: true })]),
    // Cada dueño lleva su papelera desde que nace (`shell.trashItem`, en su composición).
    carpetas: [
      ['del agente de la terminal', espacioTerminal],
      ['del espacio de datos', espacioDatos],
      // Puede llevar secretos de servidores MCP: un perfil recreado con el mismo id no debe heredarla.
      ['de la configuración de Docker del perfil', capaConfigDelPerfil()]
    ],
    log: (m) => console.log(m),
    error: (m, err) => console.error(m, err)
  }
}

/**
 * CRUD de perfiles. Guardar persiste y re-apunta los controladores, y nunca borra: a la lista que llega
 * se le devuelven los perfiles que no trae. Lo de un perfil solo se borra con `DELETE_PROFILE`
 * (`perfiles/ordenDeBorrado.ts`), y al arrancar se terminan los borrados que quedaron a medias.
 */
function registrarIpcGuardarPerfiles(deps: DependenciasSesiones, sharedSandbox: GestorSandbox): void {
  const { refs, ipc, perfiles, cuentas } = deps
  const borrado = depsDeBorrado(deps, sharedSandbox)
  const pendientes = new BorradosPendientes<Perfil>(join(app.getPath('userData'), 'perfiles-borrados.json'), (m) => console.error(m))
  const fijarLista = (siguiente: Perfil[]): void => {
    guardarPerfilesEditables(siguiente)
    perfiles.lista = siguiente
    // Quien prepara la carpeta de un perfil recién creado lo esperaba: ya está en la lista.
    deps.llegada.cambiaron()
    refs.terminales?.actualizarPerfiles(siguiente)
    refs.agentes?.actualizarPerfiles(siguiente)
    cuentas.asegurarPredeterminadas(siguiente) // un perfil nuevo estrena sus cuentas default
  }
  ipc.handle(IPC_CHANNELS.SAVE_PROFILES, (_e, siguiente: Perfil[]) => {
    const { lista, retenidos } = listaAGuardar(perfiles.lista, siguiente)
    for (const p of retenidos) console.error(`[tessera] el guardado no trae el perfil ${p.id}: se conserva (solo se borra con su orden)`)
    fijarLista(conservarPermisosSsh(perfiles.lista, lista))
    // Las reglas aceptadas ya están en disco: solo ahora se quita su propuesta.
    deps.propuestasReglas.alGuardarPerfiles(lista)
  })
  ipc.handle(IPC_CHANNELS.DELETE_PROFILE, async (_e, perfilId: unknown) => {
    if (typeof perfilId !== 'string') throw new Error('deleteProfile: se esperaba el id del perfil.')
    // Sin esperar nada antes: el candado del borrado se toma en la misma vuelta que sale de la lista.
    await borrarPorOrden({ lista: () => perfiles.lista, fijarLista, pendientes, borrar: (ps) => borrarPerfiles(borrado, ps), log: (m) => console.log(m) }, perfilId)
  })
  void terminarBorradosPendientes(pendientes, borrado.idsVivos, (ps) => borrarPerfiles(borrado, ps), (m) => console.log(m)).catch((err: unknown) =>
    console.error('[tessera] no se pudieron terminar los borrados de perfil pendientes:', err)
  )
}

/** Sandbox, terminales, agentes, cuentas, uso, hibernación y perfiles, en su orden. */
export function componerSesiones(deps: DependenciasSesiones): AgentesNativos {
  const { ipc, perfiles, controladorBd } = deps
  const sb = componerSandbox(deps)
  // Entorno extra de las terminales NATIVAS (`tdb` y las bases montadas), recalculado en cada apertura.
  const obtenerEntornoHostDePerfil: EntornoHost = (perfilId, rutaHostProyecto, conexionDbIds) =>
    controladorBd.entornoHost(perfilId, rutaHostProyecto, conexionDbIds)
  const controlador = componerTerminal(deps, obtenerEntornoHostDePerfil)
  const sesion = componerSesionAgente(deps, sb, obtenerEntornoHostDePerfil)
  const agentesNativos = componerAgentesNativos(deps.refs, sesion.controladorAgente)
  const lectorContexto = componerCuentasYUso(deps, sesion, emisorATodas(() => BrowserWindow.getAllWindows()))
  componerTraspaso(deps, sesion, lectorContexto)
  // Rehornea la imagen y recrea los contenedores; los paneles vivos se recuperan solos.
  registrarIpcActualizarAgentes({
    ipc,
    sandbox: sb.sharedSandbox,
    eventos: sb.emisorSinContenido,
    antesDeParar: () => sesion.controladorAgente.pararTareasPorActualizacion(),
    estado: () => {
      const registro = crearRegistroLecturaImagen(join(app.getPath('userData'), 'versiones-imagen-docker.json'))
      return leerEstadoAgentesDocker({
        // Un Docker en marcha pero no compatible también tiene imagen que leer: lo apagado es que el motor no conteste.
        dockerActivo: () => sb.sharedSandbox.checkDocker().then((r) => r.ok || !r.motorCaido),
        idImagen: () => sb.sharedSandbox.idImagenAgentes(),
        versionesImagen: () => sb.sharedSandbox.leerVersionesImagenAgentes(),
        ultimas: () => agentesNativos.ultimasDeNpm(),
        uso: () => ({ ...sesion.controladorAgente.usoDocker(), conCapas: sb.sharedSandbox.hayCapasDePerfil(), extrasVetados: sb.sharedSandbox.extrasVetados() }),
        registro
      })
    }
  })
  registrarIpcAgentesNativos({ ipc, nativos: agentesNativos })
  // Hibernación a demanda por perfil: el refcount del sandbox mata el contenedor al caer la última sesión.
  const controladorHibernacion = new ControladorHibernacion({
    terminal: controlador,
    agente: sesion.controladorAgente,
    sandbox: sb.sharedSandbox,
    obtenerPerfil: (id) => perfiles.lista.find((p) => p.id === id)
  })
  registrarIpcHibernacion({ ipc, hibernacion: controladorHibernacion })
  registrarIpcGuardarPerfiles(deps, sb.sharedSandbox)
  return agentesNativos
}
