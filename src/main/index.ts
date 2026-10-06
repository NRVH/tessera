// =============================================================================
// Raíz de composición del proceso main: al cargar prepara el proceso (relevo, instancia
// única, blindaje) y en `whenReady` crea adaptadores y servicios por fases, registra los
// `ipc.ts` de cada dominio (todos, de forma síncrona, antes de crear la ventana) y arranca.
// Las bases de datos, las conexiones SSH y las sesiones se componen en el `componer.ts` de `db/`,
// `ssh/` y `agents/`; la fontanería de Electron (ventana, cierre, menú, eventos de `app`) vive en `app/`.
// Decisiones: docs/decisiones/app/arranque-relevo-e-instancia-unica.md, docs/decisiones/app/cierre-ordenado.md
// =============================================================================
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { fijarInfoApp } from './util/infoApp'
import { infoAppElectron } from './util/adaptadores/appElectron'
import { emisorDeVentana } from './util/emisorEventos'
import { arrancarRelevo } from './relevo'
import { registrarIpcPortapapeles } from './clipboard/ipc'
import { portapapelesElectron } from './clipboard/adaptadores/portapapelesElectron'
import { ajustesSesionesDe } from '../shared/ajustesBd'
import { loadProfilesMutable } from './profiles/store'
import type { PerfilesVivos } from './profiles/types'
import { CandadoDeBorrado } from './profiles/candadoDeBorrado'
import { LlegadaDePerfiles } from './profiles/llegadaDePerfiles'
import { loadWorkspaceSettings, proyectosPersistidos } from './workspace/workspaceStateStore'
import { componerBd } from './db/componer'
import { componerSsh } from './ssh/componer'
import { limpiarMemoriaGlobal } from './db/agentMemory'
import { dbLog } from './db/dbLog'
import { aplicarExtrasSandbox, componerSesiones, crearCuentas } from './agents/componer'
import { initAutoUpdate, peticionesUpdate, refrescarPreferenciaUpdate } from './update/AutoUpdate'
import { registrarIpcUpdate } from './update/ipc'
import { sistemaElectron } from './update/adaptadores/sistemaElectron'
import { FileService } from './files/FileService'
import { registrarIpcArchivos } from './files/ipc'
import { escritorioElectron } from './files/adaptadores/escritorioElectron'
import { JarService } from './java/JarService'
import { JavaService } from './java/JavaService'
import { registrarIpcJava } from './java/ipc'
import { ComprimidosService } from './comprimidos/ComprimidosService'
import { registrarIpcComprimidos } from './comprimidos/ipc'
import { SearchService } from './search/SearchService'
import { registrarIpcBusqueda } from './search/ipc'
import { GitService } from './git/GitService'
import { registrarIpcGit } from './git/ipc'
import { confirmarDescarteNativo, confirmarDescarteLoteNativo } from './git/adaptadores/confirmacionesNativas'
import { WorkspaceService } from './workspace/WorkspaceService'
import { registrarIpcEstadoWorkspace, registrarIpcWorkspace } from './workspace/ipc'
import { registrarIpcPerfiles } from './profiles/ipc'
import { registrarIpcShell } from './shell/ipc'
import { sistemaShellElectron } from './shell/adaptadores/sistemaElectron'
import { IntegracionShellService } from './shell/IntegracionShellService'
import { ServicioFinderService } from './shell/ServicioFinderService'
import { crearReferencias } from './app/referencias'
import { blindarProceso, prepararProceso } from './app/proceso'
import { applyOverlayZoom, crearVentana } from './app/ventana'
import { iniciarCierre } from './app/cierre'
import { instalarTemaYMenu, logNativeAbi, prepararArranque } from './app/arranque'
import { registrarActivacion, registrarAperturaMac, registrarEventosDeApp } from './app/eventosApp'
import { esArranqueTrasActualizar } from './app/instanciaUnica'
import { MODO_CAPTURA, runShotMode } from './app/modoCaptura'
import { registrarIpcAcercaDe, registrarIpcEnlacesExternos, registrarIpcFallos } from './app/ipc'

// Lo primero: todo lo que lee rutas o versión de la app lo hace por `util/infoApp`.
fijarInfoApp(infoAppElectron)
const refs = crearReferencias()
// Al cargar el módulo, antes de `whenReady` (ver la decisión del arranque).
const encargoRelevo = prepararProceso(() => refs.ventana)
blindarProceso()

/** «Abrir con Tessera»: la cola de aperturas y quien escribe el menú del sistema. */
function componerIntegracionSistema(): void {
  const sistema = sistemaShellElectron()
  // Se siembra con lo persistido: sin saber qué había no sabría qué borrar.
  const s = loadWorkspaceSettings()
  const integracionShell = new IntegracionShellService({
    inicial: {
      carpetas: s.menuWindowsCarpetas,
      archivos: s.menuWindowsArchivos,
      extensiones: s.menuWindowsExtensiones
    },
    sistema
  })
  // La acción rápida del Finder: su estado es el disco, no los ajustes (el usuario puede borrarla).
  const servicioFinder = new ServicioFinderService({ sistema })
  // Los canales se registran aunque la cola ya tenga rutas desde la carga del módulo.
  registrarIpcShell({
    ipc: ipcMain,
    getWindow: () => refs.ventana,
    persistidos: proyectosPersistidos,
    integracionShell,
    servicioFinder
  })
  // Si Tessera cambió de carpeta, el menú apuntaría a un .exe que ya no existe. No se espera.
  void integracionShell.reconciliar()
  // En macOS la ruta del .app cambia sola; solo REESCRIBE lo ya instalado, nunca lo crea.
  void servicioFinder.reconciliar()
}

/** `workspace-state.json`: el esqueleto de pestañas y los ajustes globales (canal hermano). */
function componerEstadoWorkspace(): void {
  registrarIpcEstadoWorkspace({
    ipc: ipcMain,
    alGuardarAjustes: (settings, emisor) => {
      // Este canal llega por TODOS los caminos por los que cambian los ajustes: por eso avisa a
      // la actualización, al sandbox, al explorador de BD (saneado otra vez) y al overlay del zoom.
      refrescarPreferenciaUpdate()
      aplicarExtrasSandbox(refs.sandbox, settings)
      refs.explorador?.fijarAjustes(ajustesSesionesDe(settings))
      // Después de guardar y con try/catch: un overlay fallido no puede hacer mentir al guardado.
      // La ventana, la del emisor.
      try {
        const win = BrowserWindow.fromWebContents(emisor)
        if (win) applyOverlayZoom(win, settings.zoomLevel)
      } catch (err) {
        console.error('[chrome] no se pudo realinear el overlay con el zoom:', err)
      }
    }
  })
}

/** Explorador de archivos, jar/java, búsqueda, git, comprimidos y proyecto activo. */
function componerArchivos(): void {
  // Sin proyecto activo hasta el primer setActiveProject; el renderer solo ve rutas relativas.
  const files = new FileService({ getWindow: () => refs.ventana, escritorio: escritorioElectron() })
  refs.archivos = files
  // Los .jar/.war se navegan por `files:listDir` de siempre: sin canales propios.
  const jar = new JarService()
  refs.jar = jar
  files.setJarService(jar)
  const java = new JavaService({
    jar,
    resolver: (rel) => files.resolveProyecto(rel),
    rutaDatos: app.getPath('userData'),
    dirMotores: join(app.getAppPath(), 'vendor', 'java')
  })
  refs.java = java
  registrarIpcJava({ ipc: ipcMain, java })
  registrarIpcArchivos({ ipc: ipcMain, files })
  // La raíz y el ámbito pasan por la misma guarda anti-traversal en cada búsqueda.
  const search = new SearchService({
    getWindow: () => refs.ventana,
    resolverEnProyecto: (rel: string) => files.resolveProyecto(rel)
  })
  refs.busqueda = search
  registrarIpcBusqueda({ ipc: ipcMain, search })
  registrarIpcEnlacesExternos({ ipc: ipcMain })
  // Sin los diálogos inyectados, descartar un archivo nuevo diría siempre «cancelado».
  const git = new GitService({
    eventos: emisorDeVentana(() => refs.ventana, { comprobarContenido: false }),
    confirmDiscard: confirmarDescarteNativo,
    confirmDiscardMany: confirmarDescarteLoteNativo
  })
  registrarIpcGit({ ipc: ipcMain, git })
  // Necesita a git (los bytes de cada revisión) y al descompilador del visor de clases.
  const comprimidos = new ComprimidosService({
    git,
    decompiler: java.descompilador,
    resolver: (rel) => files.resolveProyecto(rel)
  })
  refs.comprimidos = comprimidos
  registrarIpcComprimidos({ ipc: ipcMain, comprimidos })
  const workspace = new WorkspaceService({
    getWindow: () => refs.ventana,
    fileService: files,
    gitService: git
  })
  registrarIpcWorkspace({ ipc: ipcMain, workspace })
}

const crearVentanaPrincipal = (): BrowserWindow =>
  crearVentana({
    cerrando: () => refs.cerrando,
    pedirCierre: () => void iniciarCierre(refs),
    soltarSesionesHuerfanas: () => {
      void refs.terminales?.closeAllSessions()
      void refs.agentes?.closeAllSessions()
    }
  })

/** `whenReady`: compone la app por fases, registra TODO antes de crear la ventana y arranca. */
async function arrancar(): Promise<void> {
  // El relevo no es Tessera: sale por aquí sin registrar una sola línea del arranque normal.
  if (encargoRelevo !== null) {
    void arrancarRelevo(encargoRelevo)
    return
  }
  await prepararArranque()
  registrarIpcFallos({ ipc: ipcMain })
  instalarTemaYMenu()
  const perfiles: PerfilesVivos = { lista: loadProfilesMutable() }
  console.log(`[tessera] ${perfiles.lista.length} perfiles cargados: ${perfiles.lista.map((p) => p.nombre).join(', ')}`)
  // Uno para toda la app: lo toma el borrado de un perfil y lo espera lo que lo recrea (BD, SSH, sesiones).
  const borrados = new CandadoDeBorrado()
  // Uno para toda la app: lo despierta el guardado de perfiles y lo espera lo que prepara un perfil recién creado.
  const llegada = new LlegadaDePerfiles(() => perfiles.lista.map((p) => p.id))
  // Lo que reciben las tres composiciones de dominio (BD, SSH y sesiones).
  const comun = { refs, ipc: ipcMain, perfiles, borrados, llegada }
  const accounts = crearCuentas(perfiles)
  const dbController = componerBd(comun)
  // Antes de las sesiones: la terminal abre las conexiones SSH con este controlador.
  const ssh = componerSsh({ ...comun, puente: dbController.puertaPuente, buzon: dbController.puertaBuzon, binDir: dbController.binDir })
  // Retira el bloque que la primera versión dejaba en la memoria GLOBAL del agente. Idempotente.
  limpiarMemoriaGlobal((m) => dbLog('migracion', m))
  logNativeAbi()
  registrarIpcPerfiles({ ipc: ipcMain, perfiles: () => perfiles.lista })
  registrarIpcAcercaDe({ ipc: ipcMain })
  registrarIpcPortapapeles({
    ipc: ipcMain,
    portapapeles: portapapelesElectron(),
    archivos: () => refs.archivos
  })
  componerIntegracionSistema()
  componerEstadoWorkspace()
  componerArchivos()
  const agentesNativos = componerSesiones({
    ...comun,
    accounts,
    dbController,
    ssh: ssh.controlador,
    espacioTerminal: ssh.espacio,
    espacioDatos: dbController.espacioDatos
  })

  refs.ventana = crearVentanaPrincipal()
  if (MODO_CAPTURA) {
    console.log('[shot] TESSERA_SHOT=1 -> capturaré layout + zoom de la UI real y saldré.')
    runShotMode(refs.ventana)
  } else {
    // Descarga en segundo plano; «Reiniciar» va al MISMO cierre ordenado, que instala al final.
    // Los canales van ANTES de sembrar y cablear: un fallo ahí no deja al renderer sin ellos.
    registrarIpcUpdate(ipcMain, peticionesUpdate)
    initAutoUpdate({
      sistema: sistemaElectron({
        leerAplicarAlCerrar: () => loadWorkspaceSettings().aplicarUpdateAlCerrar,
        esArranqueTrasActualizar
      }),
      getWindow: () => refs.ventana,
      onInstallRequested: () => void iniciarCierre(refs)
    })
    // El foco se cuelga de `app`: la ventana puede recrearse y sus oyentes morirían con ella.
    agentesNativos.start()
    app.on('browser-window-focus', () => agentesNativos.alRecuperarFoco())
  }
  registrarActivacion(refs, crearVentanaPrincipal)
  // Al final del arranque: la ventana de un `open-file` en frío ya la creó `arrancar`.
  registrarAperturaMac(refs, crearVentanaPrincipal)
}

app.whenReady().then(arrancar)
registrarEventosDeApp(refs, encargoRelevo !== null, () => void iniciarCierre(refs))
