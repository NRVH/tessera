// =============================================================================
// Composición de las conexiones SSH, parte de la raíz de composición de la app: el registro en `userData`
// (con el cifrado del sistema), las carpetas de huellas y de claves, las claves importadas, el programa de
// contraseñas y `tssh` (sobre el puente de `tdb`, con sus atajos en `bin/s<N>`), el controlador y sus
// canales, y la carpeta del agente de la terminal. Lo llama `src/main/index.ts` entre las bases de datos y
// las sesiones; la terminal recibe el controlador como `LanzadorSshTerminal`.
// Decisiones: docs/decisiones/ssh/registro-y-claves.md, docs/decisiones/ssh/askpass-y-secretos.md,
// docs/decisiones/agentes/agente-de-la-terminal.md, docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
import { app, shell, type IpcMain } from 'electron'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { ReferenciasApp } from '../app/referencias'
import type { PerfilesVivos } from '../profiles/types'
import type { CandadoDeBorrado } from '../profiles/candadoDeBorrado'
import type { LlegadaDePerfiles } from '../profiles/llegadaDePerfiles'
import { cifradoDelSistema } from '../db/adaptadores/cifradoSistema'
import type { PuertaPuente } from '../db/dbBridge'
import type { PuertaBuzon } from '../db/dockerBridge'
import { dbLog } from '../db/dbLog'
import { plataformaActual, type Plataforma } from '../../shared/plataforma'
import { elegirConDialogo } from '../util/adaptadores/dialogosNativos'
import { emisorDeVentana } from '../util/emisorEventos'
import { escribirArchivosDeAtajo } from '../util/escrituraAtajos'
import { escribirLanzadorAskpass } from './adaptadores/lanzadorAskpass'
import { asegurarCarpetaProtegida, ejecutarCorto, escribirClaveProtegida } from './adaptadores/permisosClave'
import { crearRegistroTssh } from './adaptadores/registroTssh'
import { generarAtajosTssh } from './atajosTssh'
import { admiteBinarioDePrueba, resolverBinariosSsh, type BinariosSsh } from './binariosSsh'
import { ConexionesSsh } from './ConexionesSsh'
import { ControladorSsh } from './ControladorSsh'
import { AskpassSsh } from './controlador/askpassSsh'
import { ejecutorTssh, programaTssh } from './controlador/buzonTssh'
import { ClavesImportadas } from './controlador/clavesImportadas'
import { EspacioTerminal, emisorQueRegenera, espacioParaIpc } from './controlador/espacioTerminal'
import { PuenteTssh } from './controlador/puenteTssh'
import { registrarIpcSsh } from './ipc'
import { registrarIpcSftp } from './sftp/ipc'
import { SesionesSftp } from './sftp/SesionesSftp'
import { lanzadorAskpassSh, rutaGuionAskpass, rutaProgramaAskpass } from './programaAskpass'

/** Lo que la composición de SSH recibe de `index.ts`. */
export interface DepsSsh {
  refs: ReferenciasApp
  ipc: IpcMain
  perfiles: PerfilesVivos
  /** El puente de `tdb`: el programa de contraseñas registra en él `ssh.askpass`, y `tssh` sus operaciones. */
  puente: PuertaPuente | null
  /** El buzón de Docker del puente: `tssh` registra en él su programa para los proyectos en modo Docker. */
  buzon: PuertaBuzon | null
  /** La carpeta de los atajos de `tdb` (`bin/s<N>`), donde van también los de `tssh`. */
  binDir: string
  /** El candado del borrado de cada perfil: preparar la carpeta del agente de la terminal lo espera. */
  borrados: CandadoDeBorrado
  /** La llegada de un perfil recién creado: preparar su carpeta espera, con tope, al guardado que lo trae. */
  llegada: LlegadaDePerfiles
}

/** El registro, sin cortar el arranque si la poda de perfiles borrados falla. */
function crearConexionesSsh(userData: string, perfiles: PerfilesVivos): ConexionesSsh {
  const dirHuellas = join(userData, 'ssh', 'huellas')
  // ssh no crea la carpeta de `UserKnownHostsFile`: sin ella, `accept-new` no guarda ninguna huella.
  try {
    mkdirSync(dirHuellas, { recursive: true })
  } catch (err) {
    console.error('[ssh] no se pudo crear la carpeta de huellas:', err)
  }
  const conexiones = new ConexionesSsh({
    storePath: join(userData, 'ssh-connections.json'),
    dirHuellas,
    dirClaves: join(userData, 'ssh', 'claves'),
    cifrado: cifradoDelSistema,
    log: (m) => dbLog('ssh', m)
  })
  try {
    conexiones.podarPerfiles(new Set(perfiles.lista.map((p) => p.id)))
  } catch (err) {
    console.error('[ssh] no se pudieron podar las conexiones de perfiles borrados:', err)
  }
  return conexiones
}

/**
 * Las claves importadas: el diálogo anclado a la ventana y los permisos de este sistema. Al salir se
 * borran las provisionales de la sesión.
 */
function crearClavesImportadas(userData: string, refs: ReferenciasApp): ClavesImportadas {
  const plataforma = plataformaActual()
  const claves = new ClavesImportadas({
    dir: join(userData, 'ssh', 'claves'),
    plataforma,
    elegirArchivo: (opciones, candidatas) => elegirConDialogo('clave-ssh', opciones, { ventana: refs.ventana, ...candidatas }),
    sshKeygen: () => resolverBinariosSsh({ plataforma }).sshKeygen,
    permisos: {
      asegurarCarpeta: (dir) => asegurarCarpetaProtegida(dir, plataforma),
      escribirProtegida: (ruta, texto) => escribirClaveProtegida(ruta, texto, plataforma)
    },
    ejecutar: ejecutarCorto,
    log: (m) => dbLog('ssh', m)
  })
  // Al arrancar solo se barren copias provisionales caducadas: las claves guardadas no se tocan nunca.
  void claves.barrerCaducadas()
  // `cierre.ts` sale con `app.exit`, que se salta `will-quit`; el `exit` del proceso sí llega.
  process.once('exit', () => claves.alSalir())
  return claves
}

/**
 * El programa de contraseñas de esta plataforma. Windows: el `.exe` que dejó el build (si falta, las
 * contraseñas se teclean). macOS y demás: su lanzador `sh`, reescrito aquí en cada arranque; si no se
 * puede, se retira el viejo para no lanzar uno de otra instalación.
 */
function prepararProgramaAskpass(userData: string, plataforma: Plataforma): string {
  const appDir = app.getAppPath()
  const programa = rutaProgramaAskpass(plataforma, { appDir, userData })
  if (plataforma === 'windows') {
    if (!existsSync(programa)) dbLog('ssh', 'falta out/askpass/tessera-askpass.exe: las contraseñas guardadas se teclearán')
    return programa
  }
  try {
    const guion = rutaGuionAskpass(plataforma, appDir)
    if (!existsSync(guion)) throw new Error('falta src/askpass/askpass.cjs')
    escribirLanzadorAskpass(programa, lanzadorAskpassSh(process.execPath, guion))
  } catch (err) {
    dbLog('ssh', `no se pudo preparar el programa de contraseñas (se teclearán): ${err instanceof Error ? err.message : String(err)}`)
    rmSync(programa, { force: true })
  }
  return programa
}

/** El programa de contraseñas sobre el puente; sin puente no contesta nada y las contraseñas se teclean. */
function crearAskpass(conexiones: ConexionesSsh, programa: string, puente: PuertaPuente | null): AskpassSsh {
  return new AskpassSsh({
    puerta: puente,
    conexion: (id) => conexiones.conexion(id),
    secretoDe: (id) => conexiones.secretoDe(id),
    rutaClave: (id) => conexiones.rutaClave(id),
    programa,
    existe: existsSync,
    exe: process.execPath,
    plataforma: plataformaActual(),
    log: (m) => dbLog('ssh', m)
  })
}

/** Las operaciones de `tssh` en el puente, con su registro en `logs/ssh.log`. */
function crearPuenteTssh(
  conexiones: ConexionesSsh,
  askpass: AskpassSsh,
  programa: string,
  binarios: () => BinariosSsh,
  deps: DepsSsh,
  userData: string
): PuenteTssh {
  return new PuenteTssh({
    puerta: deps.puente,
    listar: (profileId) => conexiones.listar(profileId),
    conexion: (id) => conexiones.conexion(id),
    rutaHuellas: (id) => conexiones.rutaHuellas(id),
    rutaClave: (id) => conexiones.rutaClave(id),
    askpass,
    binarios,
    existe: existsSync,
    programaAskpass: programa,
    nombrePerfil: (id) => deps.perfiles.lista.find((p) => p.id === id)?.nombre,
    auditar: crearRegistroTssh(join(userData, 'logs')),
    plataforma: plataformaActual(),
    log: (m) => dbLog('ssh', m)
  })
}

/**
 * Los atajos `tssh` en la carpeta de los de `tdb` (`bin/s<N>`, ya en el PATH de las terminales y los agentes
 * nativos). Se reescriben en cada arranque; si no se puede, `tssh` no existirá y queda en el registro.
 */
function prepararAtajosTssh(binDir: string): void {
  const script = join(app.getAppPath(), 'src', 'tssh', 'tssh.cjs')
  if (!existsSync(script)) dbLog('ssh', 'falta src/tssh/tssh.cjs: el atajo tssh no podrá arrancar')
  try {
    escribirArchivosDeAtajo(binDir, generarAtajosTssh({ exe: process.execPath, script, sello: new Date().toISOString(), env: process.env }))
    dbLog('ssh', `atajos de tssh escritos en ${binDir}`)
  } catch (err) {
    dbLog('ssh', `ERROR al escribir los atajos de tssh en ${binDir}: ${String(err)}`)
  }
}

/**
 * `tssh` en los proyectos en modo Docker: su programa en el buzón del puente, que corre el `tssh` del host con
 * el token de la sesión del contenedor. Sin puente o sin buzón, el contenedor no tiene `tssh`.
 */
function registrarTsshEnBuzon(deps: DepsSsh): void {
  const puente = deps.puente
  if (!puente || !deps.buzon) return
  const dirTssh = join(app.getAppPath(), 'src', 'tssh')
  const plataforma = plataformaActual()
  try {
    deps.buzon.registrarPrograma(
      programaTssh({
        dirTssh,
        plataforma,
        ejecutar: ejecutorTssh({ exe: process.execPath, script: join(dirTssh, 'tssh.cjs'), pipe: () => puente.pipe, plataforma })
      })
    )
  } catch (err) {
    dbLog('ssh', `no se pudo registrar tssh en el buzón de Docker: ${String(err)}`)
  }
}

/**
 * El diálogo de «Importar desde OpenSSH…»: abre en `~/.ssh/config` si existe y si no en lo último elegido
 * o en `~/.ssh`. La ruta se queda en el main.
 */
async function elegirConfigOpenSsh(refs: ReferenciasApp): Promise<string | null> {
  const dirSsh = join(homedir(), '.ssh')
  const config = join(dirSsh, 'config')
  const r = await elegirConDialogo(
    'config-ssh',
    {
      title: 'Elige el archivo de configuración de OpenSSH',
      properties: ['openFile', 'showHiddenFiles'],
      buttonLabel: 'Importar',
      ...(existsSync(config) ? { defaultPath: config } : {})
    },
    { ventana: refs.ventana, despues: [dirSsh] }
  )
  return r.canceled ? null : (r.filePaths[0] ?? null)
}

/**
 * El explorador SFTP: sus sesiones sobre la línea de cada conexión y los diálogos nativos de subir y bajar,
 * anclados a la ventana. Al salir se cierran todas (sin ellas, ssh se queda esperando su entrada).
 */
function crearSesionesSftp(controlador: ControladorSsh, refs: ReferenciasApp): SesionesSftp {
  const emisor = emisorDeVentana(() => refs.ventana)
  const sesiones = new SesionesSftp({
    linea: (profileId, conexionId) => controlador.prepararSftp(profileId, conexionId),
    clasificar: (codigo, cola) => controlador.clasificar(codigo, cola),
    elegirCarpetaDescarga: async () => {
      const opciones: Electron.OpenDialogOptions = { title: 'Elige dónde descargar', properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Descargar aquí' }
      const r = await elegirConDialogo('sftp-descarga', opciones, { ventana: refs.ventana })
      return r.canceled ? null : (r.filePaths[0] ?? null)
    },
    elegirParaSubir: async (carpeta) => {
      const opciones: Electron.OpenDialogOptions = carpeta
        ? { title: 'Elige la carpeta que subir', properties: ['openDirectory'], buttonLabel: 'Subir' }
        : { title: 'Elige los archivos que subir', properties: ['openFile', 'multiSelections'], buttonLabel: 'Subir' }
      const r = await elegirConDialogo('sftp-subida', opciones, { ventana: refs.ventana })
      return r.canceled ? null : r.filePaths
    },
    mostrarEnCarpeta: (ruta) => shell.showItemInFolder(ruta),
    emitir: (canal, payload) => emisor.emitir(canal, payload),
    plataforma: plataformaActual(),
    log: (m) => dbLog('ssh', m)
  })
  process.once('exit', () => sesiones.cerrarTodas())
  return sesiones
}

/** Lo que deja compuesto `componerSsh`: el controlador y la carpeta del agente de la terminal (el guardado de perfiles la borra). */
export interface ComposicionSsh {
  controlador: ControladorSsh
  espacio: EspacioTerminal
}

/**
 * Conexiones SSH: registro, claves importadas, programa de contraseñas, controlador, canales, la carpeta del
 * agente de la terminal y `tssh` (sus operaciones en el puente y sus atajos).
 */
export function componerSsh(deps: DepsSsh): ComposicionSsh {
  const { refs, ipc, perfiles, puente } = deps
  const userData = app.getPath('userData')
  const conexiones = crearConexionesSsh(userData, perfiles)
  const programa = prepararProgramaAskpass(userData, plataformaActual())
  const askpass = crearAskpass(conexiones, programa, puente)
  // El cliente SSH, para `tssh` y para el controlador. El ssh de las pruebas (`TESSERA_SSH_BINARIO`)
  // solo vale sin empaquetar o con la marca del arnés e2e.
  const admitePrueba = admiteBinarioDePrueba(app.isPackaged, process.argv)
  const binariosVigentes = (): BinariosSsh => resolverBinariosSsh({ admitePrueba })
  crearPuenteTssh(conexiones, askpass, programa, binariosVigentes, deps, userData)
  prepararAtajosTssh(deps.binDir)
  registrarTsshEnBuzon(deps)
  const espacio = new EspacioTerminal({
    userDataDir: userData,
    listar: (profileId) => conexiones.listar(profileId),
    // La carpeta de un perfil borrado va a la papelera, nunca en firme.
    papelera: (ruta) => shell.trashItem(ruta),
    log: (m) => dbLog('ssh', m)
  })
  const binarios = binariosVigentes()
  dbLog('ssh', `cliente SSH: ${binarios.origen ?? 'ninguno'}`)
  if (binarios.dePrueba && binarios.ssh) {
    dbLog('ssh', `TESSERA_SSH_BINARIO activo: las sesiones SSH lanzan ${basename(binarios.ssh.exe)} (solo pruebas)`)
  }
  if (binarios.pruebaInvalida) dbLog('ssh', 'TESSERA_SSH_BINARIO no tiene la forma {exe, args}: se ignora')
  if (binarios.pruebaIgnorada) dbLog('ssh', 'TESSERA_SSH_BINARIO está puesto y se ignora: la app empaquetada solo lo admite lanzada por el arnés e2e')
  const controlador = new ControladorSsh({
    conexiones,
    eventos: emisorQueRegenera(
      emisorDeVentana(() => refs.ventana),
      () => espacio.refrescar(perfiles.lista),
      (m) => dbLog('ssh', m)
    ),
    claves: crearClavesImportadas(userData, refs),
    elegirConfigOpenSsh: () => elegirConfigOpenSsh(refs),
    askpass,
    ejecutar: ejecutarCorto,
    binarios: binariosVigentes,
    log: (m) => dbLog('ssh', m)
  })
  registrarIpcSsh({ ipc, ssh: controlador, espacio: espacioParaIpc(espacio, () => perfiles.lista, deps.borrados, deps.llegada) })
  registrarIpcSftp(ipc, crearSesionesSftp(controlador, refs))
  return { controlador, espacio }
}
