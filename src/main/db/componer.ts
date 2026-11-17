// =============================================================================
// Composición de las bases de datos, parte de la raíz de composición de la app: conexiones,
// registro y drivers (`ControladorBd`), el explorador con sus familias de documentos y claves,
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
import type { PerfilesVivos } from '../perfiles/types'
import type { CandadoDeBorrado } from '../perfiles/candadoDeBorrado'
import type { LlegadaDePerfiles } from '../perfiles/llegadaDePerfiles'
import { cargarAjustesWorkspace } from '../workspace/almacenEstadoWorkspace'
import { AlmacenConexiones } from './AlmacenConexiones'
import { cifradoDelSistema } from './adaptadores/cifradoSistema'
import { guardarTextoDeUsuario } from './adaptadores/guardarTextoUsuario'
import { GestorDrivers } from './GestorDrivers'
import { ControladorBd } from './ControladorBd'
import { registrarIpcBd } from './ipc'
import { ControladorExplorador } from './explorador/ControladorExplorador'
import { sanearNombreArchivo } from './explorador/AlmacenConsolas'
import { registrarIpcExplorador } from './explorador/ipc'
import { ControladorDocumentos } from './explorador/documentos/ControladorDocumentos'
import { GestorDocumentos } from './explorador/documentos/GestorDocumentos'
import { registrarIpcDocumentos } from './explorador/documentos/ipc'
import { ProcesoTrabajador } from './explorador/ProcesoTrabajador'
import { ControladorClaves } from './explorador/claves/ControladorClaves'
import { GestorClaves } from './explorador/claves/GestorClaves'
import { registrarIpcClaves } from './explorador/claves/ipc'
import { BARRIDO_MS } from './explorador/limites'
import { registroBd } from './registroBd'

/** Lo que la composición de BD recibe de `index.ts`. */
export interface DepsBd {
  refs: ReferenciasApp
  ipc: IpcMain
  perfiles: PerfilesVivos
  /** El candado del borrado de cada perfil: preparar el espacio de datos lo espera. */
  borrados: CandadoDeBorrado
  /** La llegada de un perfil recién creado: preparar su espacio espera, con tope, al guardado que lo trae. */
  llegada: LlegadaDePerfiles
}

/**
 * Conexiones de BD. No se podan por la lista de perfiles: lo de un perfil solo se borra con su orden
 * de borrado (`perfiles/borradoDePerfil.ts`).
 */
function crearConexionesBd(): AlmacenConexiones {
  return new AlmacenConexiones({
    rutaAlmacen: join(app.getPath('userData'), 'db-connections.json'),
    cifrado: cifradoDelSistema
  })
}

/** Registro de conexiones y drivers. Los ganchos del explorador llegan con `conectarExplorador`. */
function crearControladorBd({ refs, perfiles }: DepsBd, conexionesBd: AlmacenConexiones): ControladorBd {
  const dbDrivers = new GestorDrivers({
    dirDatosUsuario: app.getPath('userData'),
    onProgreso: (p) => controladorBd.enviarProgresoDriver(p),
    log: (m) => registroBd('drivers', m)
  })
  const controladorBd: ControladorBd = new ControladorBd({
    conexiones: conexionesBd,
    drivers: dbDrivers,
    dirDatosUsuario: app.getPath('userData'),
    dirApp: app.getAppPath(),
    eventos: emisorDeVentana(() => refs.ventana, { comprobarContenido: false }),
    // La ventana se lee al abrir cada diálogo.
    dialogos: {
      elegir: (dialogo, opciones, donde) => elegirConDialogo(dialogo, opciones, { ...donde, ventana: refs.ventana }),
      guardar: (dialogo, nombre, opciones, donde) =>
        guardarConDialogo(dialogo, nombre, opciones, { ...donde, ventana: refs.ventana })
    },
    // El espacio de datos de un perfil borrado va a la papelera, nunca en firme.
    papelera: (ruta) => shell.trashItem(ruta),
    // Regenera el CLAUDE.md del espacio de datos del perfil tras cada cambio.
    onCambio: (perfilId) => {
      const perfil = perfiles.lista.find((p) => p.id === perfilId)
      if (perfil) controladorBd.refrescarContextoEspacio(perfil.id, perfil.nombre)
    },
    // Solo archivos de la contenedora del explorador (`ServicioArchivos`, que nace después).
    contenedoraAnclada: () => refs.archivos?.raizAnclada() ?? null,
    log: (m) => registroBd('ctrl', m)
  })
  return controladorBd
}

/** Gestores de las familias de documentos (MongoDB) y claves (Redis): un proceso de sesión por conexión. */
function crearGestoresBd(
  controladorBd: ControladorBd,
  conexionesBd: AlmacenConexiones,
  emisorVentana: EmisorEventos,
  inactividadConsolaMs: () => number | undefined
): { gestorDocumentos: GestorDocumentos; gestorClaves: GestorClaves } {
  const gestorDocumentos = new GestorDocumentos({
    inactividadConsolaMs,
    lanzar: (con) =>
      new ProcesoTrabajador({
        rutaScript: join(controladorBd.dirScriptTdb(), 'sesion.cjs'),
        log: (l) => registroBd('documentos', `[${con.id.slice(0, 8)}] ${l}`)
      }),
    conexion: (id) => conexionesBd.obtener(id),
    secreto: (id) => conexionesBd.secretoDe(id),
    ctxDrivers: () => controladorBd.ctxDrivers(),
    tunel: (con) => controladorBd.tunelDe(con),
    emitirSesion: (estado) => emisorVentana.emitir(DBX_CHANNELS.EV_SESION, estado),
    alAbrir: (id) => {
      if (conexionesBd.marcarVerificada(id, null)) controladorBd.notificarCambio()
    },
    log: (m) => registroBd('documentos', m)
  })
  const gestorClaves = new GestorClaves({
    inactividadConsolaMs,
    lanzar: (con) =>
      new ProcesoTrabajador({
        rutaScript: join(controladorBd.dirScriptTdb(), 'sesion.cjs'),
        log: (l) => registroBd('claves', `[${con.id.slice(0, 8)}] ${l}`)
      }),
    conexion: (id) => conexionesBd.obtener(id),
    secreto: (id) => conexionesBd.secretoDe(id),
    ctxDrivers: () => controladorBd.ctxDrivers(),
    tunel: (con) => controladorBd.tunelDe(con),
    emitirSesion: (estado) => emisorVentana.emitir(DBX_CHANNELS.EV_SESION, estado),
    alAbrir: (id) => {
      if (conexionesBd.marcarVerificada(id, null)) controladorBd.notificarCambio()
    },
    log: (m) => registroBd('claves', m)
  })
  return { gestorDocumentos, gestorClaves }
}

/** Explorador de BD con lo de Electron inyectado (diálogos, papelera, ventana), y sus canales. */
function crearExploradorBd(
  { refs, ipc, perfiles }: DepsBd,
  conexionesBd: AlmacenConexiones,
  controladorBd: ControladorBd
): ControladorExplorador {
  // Los dos gestores emiten con la guarda completa (ventana y `webContents` vivos).
  const emisorVentana = emisorDeVentana(() => refs.ventana)
  // El plazo de inactividad de las consolas es el del ajuste del usuario, el mismo que aplica el
  // explorador SQL (que nace después: hasta entonces, el de por defecto).
  const { gestorDocumentos, gestorClaves } = crearGestoresBd(
    controladorBd,
    conexionesBd,
    emisorVentana,
    () => refs.explorador?.ajustesVigentes().inactividadConsolaMs
  )
  const escritorio = escritorioDelSistema()
  const explorador: ControladorExplorador = new ControladorExplorador({
    conexiones: conexionesBd,
    registro: controladorBd,
    perfilVivo: (id) => perfiles.lista.some((p) => p.id === id),
    nombrePerfil: (id) => perfiles.lista.find((p) => p.id === id)?.nombre ?? null,
    papelera: (ruta) => shell.trashItem(ruta),
    plataforma: plataformaActual(),
    ventana: () => refs.ventana,
    mostrarMensaje: (ventana, opciones) =>
      ventana && !ventana.isDestroyed() ? dialog.showMessageBox(ventana, opciones) : dialog.showMessageBox(opciones),
    // Por el envoltorio de todos los diálogos, que decide la carpeta; del explorador solo el NOMBRE.
    guardarArchivo: (ventana, opciones) =>
      guardarConDialogo(
        'exportar-bd',
        basename(opciones.defaultPath ?? 'exportacion'),
        opciones,
        { ventana: ventana && !ventana.isDestroyed() ? ventana : null, despues: [app.getPath('downloads')] }
      ),
    mostrarEnCarpeta: (ruta) => escritorio.revelarEnCarpeta(ruta),
    ventanaDe: (emisor) => BrowserWindow.fromWebContents(emisor),
    // Historial PRIVADO de Tessera: lo de `conexiones/<perfil>/` lo lee el agente.
    dirHistorial: join(app.getPath('userData'), 'db-historial'),
    documentos: gestorDocumentos,
    exportarDocumentos: gestorDocumentos,
    claves: gestorClaves,
    log: (m) => registroBd('explorador', m)
  })
  registrarIpcExplorador({ ipc, explorador })
  refs.explorador = explorador
  registrarIpcDocumentos({
    ipc,
    controlador: new ControladorDocumentos({
      conexiones: conexionesBd,
      gestor: gestorDocumentos,
      alSentencia: (e) => explorador.anotarHistorialDocs(e),
      log: (m) => registroBd('documentos', m)
    })
  })
  registrarIpcClaves({
    ipc,
    controlador: new ControladorClaves({
      conexiones: conexionesBd,
      gestor: gestorClaves,
      alSentencia: (e) => explorador.anotarHistorialClaves(e),
      guardarTexto: (nombre, texto) => guardarTextoDeUsuario(refs.ventana, `${sanearNombreArchivo(nombre, plataformaActual())}.json`, texto),
      log: (m) => registroBd('claves', m)
    })
  })
  return explorador
}

/** Bases de datos: conexiones, registro, explorador y sus familias, y el barrido de inactividad. */
export function componerBd(deps: DepsBd): ControladorBd {
  const conexionesBd = crearConexionesBd()
  const controladorBd = crearControladorBd(deps, conexionesBd)
  registrarIpcBd({ ipc: deps.ipc, bd: controladorBd, borrados: deps.borrados, perfiles: () => deps.perfiles.lista, llegada: deps.llegada })
  deps.refs.bd = controladorBd
  const exploradorBd = crearExploradorBd(deps, conexionesBd, controladorBd)
  // Cada uno necesita al otro: el registro recibe los ganchos en cuanto el explorador existe.
  controladorBd.conectarExplorador(exploradorBd)
  // Los ajustes del archivo al arrancar; cada cambio llega por SAVE_SETTINGS.
  exploradorBd.fijarAjustes(ajustesSesionesDe(cargarAjustesWorkspace()))
  // Cierra sesiones ociosas (nunca con una transacción pendiente). `unref`: no retiene la app.
  setInterval(() => exploradorBd.barrer(), BARRIDO_MS).unref()
  return controladorBd
}
