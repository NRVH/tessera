// =============================================================================
// Composición de las bases de datos, parte de la raíz de composición de la app: conexiones,
// registro y drivers (`DbController`), el explorador con sus familias de documentos y claves,
// sus `ipc.ts` y el barrido de inactividad. Lo llama `src/main/index.ts` con las referencias,
// `ipcMain` y los perfiles vivos; lo de Electron se inyecta aquí.
// Decisiones: docs/decisiones/bd/conexiones-edicion-y-ganchos.md
// =============================================================================
import { app, BrowserWindow, dialog, shell, type IpcMain } from 'electron'
import { basename, join } from 'node:path'
import { plataformaActual } from '../../shared/plataforma'
import { ajustesSesionesDe } from '../../shared/ajustesBd'
import { DBX_CHANNELS } from '../../shared/db-explorador-ipc'
import { elegirConDialogo, guardarConDialogo } from '../util/adaptadores/dialogosNativos'
import { escritorioDelSistema } from '../util/adaptadores/escritorio'
import { emisorDeVentana, type EmisorEventos } from '../util/emisorEventos'
import type { ReferenciasApp } from '../app/referencias'
import type { PerfilesVivos } from '../profiles/types'
import { loadWorkspaceSettings } from '../workspace/workspaceStateStore'
import { ConnectionStore } from './ConnectionStore'
import { cifradoDelSistema } from './adaptadores/cifradoSistema'
import { DriverManager } from './DriverManager'
import { DbController } from './DbController'
import { registrarIpcBd } from './ipc'
import { ExploradorController } from './explorador/ExploradorController'
import { registrarIpcExplorador } from './explorador/ipc'
import { ControladorDocumentos } from './explorador/documentos/ControladorDocumentos'
import { GestorDocumentos } from './explorador/documentos/GestorDocumentos'
import { registrarIpcDocumentos } from './explorador/documentos/ipc'
import { ProcesoTrabajador } from './explorador/ProcesoTrabajador'
import { ControladorClaves } from './explorador/claves/ControladorClaves'
import { GestorClaves } from './explorador/claves/GestorClaves'
import { registrarIpcClaves } from './explorador/claves/ipc'
import { BARRIDO_MS } from './explorador/limites'
import { dbLog } from './dbLog'

/** Lo que la composición de BD recibe de `index.ts`. */
export interface DepsBd {
  refs: ReferenciasApp
  ipc: IpcMain
  perfiles: PerfilesVivos
}

/** Conexiones de BD; las de perfiles borrados se podan sin cortar el arranque si falla. */
function crearConexionesBd(perfiles: PerfilesVivos): ConnectionStore {
  const dbConnections = new ConnectionStore({
    storePath: join(app.getPath('userData'), 'db-connections.json'),
    cifrado: cifradoDelSistema
  })
  try {
    dbConnections.pruneProfiles(new Set(perfiles.lista.map((p) => p.id)))
  } catch (err) {
    console.error('[db] no se pudieron podar las conexiones de perfiles borrados:', err)
  }
  return dbConnections
}

/** Registro de conexiones y drivers. Los ganchos del explorador llegan con `conectarExplorador`. */
function crearDbController({ refs, perfiles }: DepsBd, dbConnections: ConnectionStore): DbController {
  const dbDrivers = new DriverManager({
    userDataDir: app.getPath('userData'),
    onProgress: (p) => dbController.sendDriverProgress(p),
    log: (m) => dbLog('drivers', m)
  })
  const dbController: DbController = new DbController({
    connections: dbConnections,
    drivers: dbDrivers,
    userDataDir: app.getPath('userData'),
    appDir: app.getAppPath(),
    eventos: emisorDeVentana(() => refs.ventana, { comprobarContenido: false }),
    // La ventana se lee al abrir cada diálogo.
    dialogos: {
      elegir: (dialogo, opciones, donde) => elegirConDialogo(dialogo, opciones, { ...donde, ventana: refs.ventana }),
      guardar: (dialogo, nombre, opciones, donde) =>
        guardarConDialogo(dialogo, nombre, opciones, { ...donde, ventana: refs.ventana })
    },
    // Regenera el CLAUDE.md del espacio de datos del perfil tras cada cambio.
    onChanged: (profileId) => {
      const perfil = perfiles.lista.find((p) => p.id === profileId)
      if (perfil) dbController.refreshWorkspaceContext(perfil.id, perfil.nombre)
    },
    // Solo archivos de la contenedora del explorador (`FileService`, que nace después).
    contenedoraAnclada: () => refs.archivos?.raizAnclada() ?? null,
    log: (m) => dbLog('ctrl', m)
  })
  return dbController
}

/** Gestores de las familias de documentos (MongoDB) y claves (Redis): un proceso de sesión por conexión. */
function crearGestoresBd(
  dbController: DbController,
  dbConnections: ConnectionStore,
  emisorVentana: EmisorEventos
): { gestorDocumentos: GestorDocumentos; gestorClaves: GestorClaves } {
  const gestorDocumentos = new GestorDocumentos({
    lanzar: (con) =>
      new ProcesoTrabajador({
        rutaScript: join(dbController.tdbScriptDir(), 'sesion.cjs'),
        log: (l) => dbLog('documentos', `[${con.id.slice(0, 8)}] ${l}`)
      }),
    conexion: (id) => dbConnections.get(id),
    secreto: (id) => dbConnections.secretOf(id),
    ctxDrivers: () => dbController.ctxDrivers(),
    emitirSesion: (estado) => emisorVentana.emitir(DBX_CHANNELS.EV_SESION, estado),
    alAbrir: (id) => {
      if (dbConnections.marcarVerificada(id, null)) dbController.notificarCambio()
    },
    log: (m) => dbLog('documentos', m)
  })
  const gestorClaves = new GestorClaves({
    lanzar: (con) =>
      new ProcesoTrabajador({
        rutaScript: join(dbController.tdbScriptDir(), 'sesion.cjs'),
        log: (l) => dbLog('claves', `[${con.id.slice(0, 8)}] ${l}`)
      }),
    conexion: (id) => dbConnections.get(id),
    secreto: (id) => dbConnections.secretOf(id),
    ctxDrivers: () => dbController.ctxDrivers(),
    emitirSesion: (estado) => emisorVentana.emitir(DBX_CHANNELS.EV_SESION, estado),
    alAbrir: (id) => {
      if (dbConnections.marcarVerificada(id, null)) dbController.notificarCambio()
    },
    log: (m) => dbLog('claves', m)
  })
  return { gestorDocumentos, gestorClaves }
}

/** Explorador de BD con lo de Electron inyectado (diálogos, papelera, ventana), y sus canales. */
function crearExploradorBd(
  { refs, ipc, perfiles }: DepsBd,
  dbConnections: ConnectionStore,
  dbController: DbController
): ExploradorController {
  // Los dos gestores emiten con la guarda completa (ventana y `webContents` vivos).
  const emisorVentana = emisorDeVentana(() => refs.ventana)
  const { gestorDocumentos, gestorClaves } = crearGestoresBd(dbController, dbConnections, emisorVentana)
  const escritorio = escritorioDelSistema()
  const explorador: ExploradorController = new ExploradorController({
    conexiones: dbConnections,
    registro: dbController,
    perfilVivo: (id) => perfiles.lista.some((p) => p.id === id),
    nombrePerfil: (id) => perfiles.lista.find((p) => p.id === id)?.nombre ?? null,
    papelera: (ruta) => shell.trashItem(ruta),
    plataforma: plataformaActual(),
    getWindow: () => refs.ventana,
    mostrarMensaje: (win, opciones) =>
      win && !win.isDestroyed() ? dialog.showMessageBox(win, opciones) : dialog.showMessageBox(opciones),
    // Por el envoltorio de todos los diálogos, que decide la carpeta; del explorador solo el NOMBRE.
    guardarArchivo: (win, opciones) =>
      guardarConDialogo(
        'exportar-bd',
        basename(opciones.defaultPath ?? 'exportacion'),
        opciones,
        { ventana: win && !win.isDestroyed() ? win : null, despues: [app.getPath('downloads')] }
      ),
    mostrarEnCarpeta: (ruta) => escritorio.revelarEnCarpeta(ruta),
    ventanaDe: (emisor) => BrowserWindow.fromWebContents(emisor),
    // Historial PRIVADO de Tessera: lo de `conexiones/<perfil>/` lo lee el agente.
    dirHistorial: join(app.getPath('userData'), 'db-historial'),
    documentos: gestorDocumentos,
    claves: gestorClaves,
    log: (m) => dbLog('explorador', m)
  })
  registrarIpcExplorador({ ipc, explorador })
  refs.explorador = explorador
  registrarIpcDocumentos({
    ipc,
    controlador: new ControladorDocumentos({ conexiones: dbConnections, gestor: gestorDocumentos, log: (m) => dbLog('documentos', m) })
  })
  registrarIpcClaves({
    ipc,
    controlador: new ControladorClaves({ conexiones: dbConnections, gestor: gestorClaves, log: (m) => dbLog('claves', m) })
  })
  return explorador
}

/** Bases de datos: conexiones, registro, explorador y sus familias, y el barrido de inactividad. */
export function componerBd(deps: DepsBd): DbController {
  const dbConnections = crearConexionesBd(deps.perfiles)
  const dbController = crearDbController(deps, dbConnections)
  registrarIpcBd({ ipc: deps.ipc, bd: dbController })
  deps.refs.bd = dbController
  const exploradorBd = crearExploradorBd(deps, dbConnections, dbController)
  // Cada uno necesita al otro: el registro recibe los ganchos en cuanto el explorador existe.
  dbController.conectarExplorador(exploradorBd)
  // Los ajustes del archivo al arrancar; cada cambio llega por SAVE_SETTINGS.
  exploradorBd.fijarAjustes(ajustesSesionesDe(loadWorkspaceSettings()))
  void exploradorBd.podarHistorial(deps.perfiles.lista.map((p) => p.id))
  // Cierra sesiones ociosas (nunca con una transacción pendiente). `unref`: no retiene la app.
  setInterval(() => exploradorBd.barrer(), BARRIDO_MS).unref()
  return dbController
}
