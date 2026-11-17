// =============================================================================
// Preload de Tessera: compone la API de cada dominio y la expone como `window.tessera`.
// Corre con `contextIsolation` y `sandbox`: solo usa `electron` y módulos propios, que Vite
// empaqueta en un único `out/preload/index.js`. La forma de la API la declara `ApiTessera`
// (el renderer la ve por `index.d.ts`); cada dominio vive en su módulo de esta carpeta.
// =============================================================================
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS, type InformeFallo } from '../shared/ipc'
import {
  capacidades as capacidadesDelSistema,
  plataformaActual,
  type CapacidadesPlataforma,
  type Plataforma
} from '../shared/plataforma'
import { ARGUMENTO_ALPHA, type ResumenRenderer } from '../shared/salud'
import { idiomaDeArgumentos, type Idioma } from '../shared/i18n'
import { SALUD_CHANNELS } from '../shared/salud-ipc'
import type { Perfil } from '../main/perfiles/types'
import { CANAL_CLAVES_AGENTE, CANAL_GUARDAR_CLAVES_AGENTE, type ApiClavesAgente } from '../shared/ssh-agente-ipc'
import { type ApiTerminal, type ApiTerminalAgente, terminal, terminalAgente } from './terminales'
import {
  type ApiCuentasAgente,
  type ApiConfigAgente,
  type ApiDocumentosPerfil,
  type ApiContextoGlobal,
  type ApiHibernacion,
  type ApiConversaciones,
  type ApiActualizacionAgentes,
  type ApiAgentesNativos,
  type ApiAgentesManuales,
  type ApiRedContenedor,
  type ApiEstadoDocker,
  type ApiUso,
  type ApiContexto,
  cuentasAgente,
  configAgente,
  documentosPerfil,
  contextoGlobal,
  hibernacion,
  conversaciones,
  actualizacionAgentes,
  agentesNativos,
  agentesManuales,
  redContenedor,
  estadoDocker,
  uso,
  contexto
} from './agentes'
import {
  type ApiBd,
  type ApiBdDocumentos,
  type ApiBdClaves,
  db,
  bdDocumentos,
  bdClaves
} from './bd'
import { type ApiBdExplorador, bdExplorador } from './bdExplorador'
import { type ApiSsh, ssh } from './ssh'
import { type ApiCopiaConfiguracion, copiaConfiguracion } from './copiaConfiguracion'
import { type ApiSftp, sftp } from './sftp'
import {
  type ApiArchivos,
  type ApiPortapapeles,
  type ApiJava,
  type ApiComprimidos,
  type ApiBusqueda,
  files,
  portapapeles,
  java,
  comprimidos,
  busqueda
} from './archivos'
// Incluye la resolución de permisos de hooks vinculada al commit que abrió el diálogo.
import { type ApiGit, git } from './git'
import { type ApiVentanaAgente, ventanaAgente } from './ventanaAgente'
import { type ApiReglas, reglas } from './reglas'
import { type ApiTraspaso, traspaso } from './traspaso'
import { type ApiDelegacion, delegacion } from './delegacion'
import {
  type ApiWorkspace,
  type ApiCierre,
  type ApiActualizacion,
  type ApiInfoApp,
  type ApiIntegracionShell,
  type ApiServicioFinder,
  type ApiEscritorioLinux,
  type ApiZoom,
  workspace,
  cierre,
  actualizacion,
  infoApp,
  integracionShell,
  servicioFinder,
  escritorioLinux,
  zoom
} from './aplicacion'

export interface ApiTessera {
  clavesAgente: ApiClavesAgente
  obtenerPerfiles: () => Promise<Perfil[]>
  /** Persiste el arreglo COMPLETO de perfiles (alta/nombre/orden/color). Nunca borra uno que falte. */
  guardarPerfiles: (perfiles: Perfil[]) => Promise<void>
  /** El usuario borró el perfil: el main lo quita de la lista y borra lo suyo. */
  deleteProfile: (perfilId: string) => Promise<void>
  /** Abre una URL http(s)/mailto en el navegador del sistema (enlaces de la terminal). */
  abrirExterno: (url: string) => Promise<void>
  /**
   * Ruta absoluta en disco de un `File` del DOM (copiado del explorador o arrastrado
   * a la terminal). Vía moderna de Electron (`File.path` está deprecado); vive en el
   * preload porque `webUtils` no existe en el renderer aislado. Devuelve '' si el
   * File no tiene respaldo en disco (p. ej. un screenshot en memoria).
   */
  obtenerRutaArchivo: (archivo: File) => string
  /** Reporta un error GLOBAL del renderer al crash-log del main (best-effort, sin respuesta). */
  informarFallo: (informe: InformeFallo) => void
  /**
   * En qué sistema corre Tessera. SÍNCRONO y no un `invoke`, a diferencia de todo lo
   * demás de esta API, por una razón concreta: el hueco de los botones de la ventana
   * está a la DERECHA en Windows (Window Controls Overlay) y a la IZQUIERDA en macOS
   * (el semáforo), y esa decisión la toma el CSS en el primer pintado. Resuelta por
   * IPC, el primer fotograma se dibujaría con el hueco en el lado equivocado y se
   * vería saltar. `process.platform` está disponible en el preload aun con
   * `sandbox: true`, así que no hace falta cruzar al main para saberlo.
   */
  plataforma: Plataforma
  /**
   * Lo que Tessera SABE HACER en este sistema. La UI lo consulta para no ofrecer
   * controles que no puede cumplir (ver `shared/plataforma.ts`): en Mac no hay
   * categoría "Windows" en Configuración porque el registro no existe, y el botón
   * "Instalar ahora" del update no aparece si el .app no puede auto-instalarse.
   * Síncrono por el mismo motivo que `plataforma`: decide qué se MONTA, no qué se
   * rellena después.
   */
  capacidades: CapacidadesPlataforma
  /**
   * ¿Es una versión alpha? El main lo avisa con un argumento de la ventana (`ARGUMENTO_ALPHA`),
   * que el preload lee de `process.argv`. Síncrono por el mismo motivo que `plataforma`: decide
   * qué filas de Configuración se montan (el registro de salud no existe en la pública).
   */
  esAlpha: boolean
  /**
   * El idioma de la interfaz, ya resuelto por el main (`ARGUMENTO_IDIOMA`). Síncrono por lo mismo
   * que `plataforma`: lo fija `util/idiomaArranque` antes de que ningún módulo lea un texto.
   */
  idioma: Idioma
  /** Registro de salud (solo alpha): lo que la ventana cuenta de sí misma. El main sanea y decide si anota. */
  salud: {
    informarLento: (resumen: ResumenRenderer) => void
    informarVisibilidad: (evento: 'tapada' | 'a-la-vista') => void
  }
  terminal: ApiTerminal
  terminalAgente: ApiTerminalAgente
  cuentasAgente: ApiCuentasAgente
  configAgente: ApiConfigAgente
  documentosPerfil: ApiDocumentosPerfil
  contextoGlobal: ApiContextoGlobal
  db: ApiBd
  bdExplorador: ApiBdExplorador
  bdDocumentos: ApiBdDocumentos
  bdClaves: ApiBdClaves
  ssh: ApiSsh
  sftp: ApiSftp
  files: ApiArchivos
  git: ApiGit
  workspace: ApiWorkspace
  hibernacion: ApiHibernacion
  cierre: ApiCierre
  actualizacion: ApiActualizacion
  infoApp: ApiInfoApp
  integracionShell: ApiIntegracionShell
  servicioFinder: ApiServicioFinder
  escritorioLinux: ApiEscritorioLinux
  zoom: ApiZoom
  portapapeles: ApiPortapapeles
  conversaciones: ApiConversaciones
  actualizacionAgentes: ApiActualizacionAgentes
  agentesNativos: ApiAgentesNativos
  agentesManuales: ApiAgentesManuales
  redContenedor: ApiRedContenedor
  estadoDocker: ApiEstadoDocker
  uso: ApiUso
  contexto: ApiContexto
  java: ApiJava
  comprimidos: ApiComprimidos
  busqueda: ApiBusqueda
  copiaConfiguracion: ApiCopiaConfiguracion
  ventanaAgente: ApiVentanaAgente
  reglas: ApiReglas
  traspaso: ApiTraspaso
  delegacion: ApiDelegacion
}

const api: ApiTessera = {
  obtenerPerfiles: () => ipcRenderer.invoke(IPC_CHANNELS.GET_PROFILES),
  guardarPerfiles: (perfiles) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_PROFILES, perfiles),
  clavesAgente: {
    listar: (perfil) => ipcRenderer.invoke(CANAL_CLAVES_AGENTE, perfil),
    guardar: (perfil, rutas) => ipcRenderer.invoke(CANAL_GUARDAR_CLAVES_AGENTE, perfil, rutas)
  },
  deleteProfile: (perfilId) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_PROFILE, perfilId),
  abrirExterno: (url) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL_URL, url),
  obtenerRutaArchivo: (archivo) => webUtils.getPathForFile(archivo),
  informarFallo: (informe) => ipcRenderer.send(IPC_CHANNELS.REPORT_CRASH, informe),
  // Se evalúan UNA vez, al construir la API: ni la plataforma ni sus capacidades
  // cambian durante la vida del proceso, y así lo que cruza el puente son dos valores
  // planos y congelados en vez de funciones que el renderer podría llamar en un bucle
  // de render.
  plataforma: plataformaActual(),
  capacidades: capacidadesDelSistema(),
  esAlpha: process.argv.includes(ARGUMENTO_ALPHA),
  idioma: idiomaDeArgumentos(process.argv),
  salud: {
    informarLento: (resumen) => ipcRenderer.send(SALUD_CHANNELS.RENDERER, resumen),
    informarVisibilidad: (evento) => ipcRenderer.send(SALUD_CHANNELS.VISIBILIDAD, evento)
  },
  terminal,
  terminalAgente,
  cuentasAgente,
  configAgente,
  documentosPerfil,
  contextoGlobal,
  db,
  bdExplorador,
  bdDocumentos,
  bdClaves,
  ssh,
  sftp,
  files,
  git,
  workspace,
  hibernacion,
  cierre,
  actualizacion,
  infoApp,
  integracionShell,
  servicioFinder,
  escritorioLinux,
  zoom,
  portapapeles,
  conversaciones,
  actualizacionAgentes,
  agentesNativos,
  agentesManuales,
  redContenedor,
  estadoDocker,
  uso,
  contexto,
  java,
  comprimidos,
  busqueda,
  copiaConfiguracion,
  ventanaAgente,
  reglas,
  traspaso,
  delegacion
}

if (!process.contextIsolated) {
  throw new Error('contextIsolation debe estar habilitado para exponer la API de Tessera.')
}

contextBridge.exposeInMainWorld('tessera', api)
