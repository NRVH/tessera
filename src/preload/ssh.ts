// =============================================================================
// Preload: las conexiones SSH de los perfiles y sus grupos. Una función por canal, cada una con
// el objeto de petición del contrato tal cual, y la suscripción al aviso de cambio. De un archivo
// de clave SOLTADO, la ruta la saca aquí `webUtils` y va directa al main: el renderer no la ve.
// Canales y formas: src/shared/ssh-ipc.ts. La sesión en la terminal se abre con `terminal.openSsh`.
// =============================================================================
import { ipcRenderer, webUtils } from 'electron'
import {
  SSH_CHANNELS,
  type SshAviso,
  type SshBorrarConexion,
  type SshBorrarGrupo,
  type SshClaveElegida,
  type SshClaveSoltada,
  type SshConexion,
  type SshConexionBorrada,
  type SshConexionInput,
  type SshBorrarConexiones,
  type SshConexionesBorradas,
  type SshConexionesMovidas,
  type SshCrearGrupo,
  type SshDuplicarConexion,
  type SshMoverConexiones,
  type SshEditarConexion,
  type SshElegirClave,
  type SshEntorno,
  type SshEspacioAsegurar,
  type SshEspacioRutas,
  type SshEspacioTerminal,
  type SshExportacionOpenSsh,
  type SshExportarOpenSsh,
  type SshGrupo,
  type SshGrupoBorrado,
  type SshImportarOpenSsh,
  type SshLecturaOpenSsh,
  type SshListaConexiones,
  type SshOlvidarHuella,
  type SshPreguntaAskpass,
  type SshPreguntaRetirada,
  type SshProbar,
  type SshRenombrarGrupo,
  type SshRespuestaAskpass,
  type SshResultadoPrueba
} from '../shared/ssh-ipc'

/**
 * Conexiones SSH, privadas de su perfil. El renderer nunca recibe un secreto ni una ruta del host:
 * `listar` trae las de TODOS los perfiles y el renderer filtra.
 */
export interface SshApi {
  listar: () => Promise<SshListaConexiones>
  crear: (input: SshConexionInput) => Promise<SshConexion>
  editar: (req: SshEditarConexion) => Promise<SshConexion>
  borrar: (req: SshBorrarConexion) => Promise<SshConexionBorrada>
  /** Borra varias conexiones del perfil de una vez. */
  borrarVarias: (req: SshBorrarConexiones) => Promise<SshConexionesBorradas>
  /** Pasa varias conexiones del perfil a un grupo (o a «Sin grupo») de una vez. */
  mover: (req: SshMoverConexiones) => Promise<SshConexionesMovidas>
  /** Copia la conexión con otro nombre («… (1)», «… (2)»…), con su clave y su secreto guardado; devuelve la copia. */
  duplicar: (req: SshDuplicarConexion) => Promise<SshConexion>
  crearGrupo: (req: SshCrearGrupo) => Promise<SshGrupo>
  renombrarGrupo: (req: SshRenombrarGrupo) => Promise<SshGrupo>
  /** Las conexiones del grupo pasan a «Sin grupo». */
  borrarGrupo: (req: SshBorrarGrupo) => Promise<SshGrupoBorrado>
  /** Si hay cliente SSH y de dónde sale. */
  entorno: () => Promise<SshEntorno>
  /** Diálogo nativo para elegir el archivo de clave; el main guarda una copia protegida. `null` si se cancela. */
  elegirClave: (req: SshElegirClave) => Promise<SshClaveElegida | null>
  /**
   * Un archivo SOLTADO sobre el campo de la clave, para una conexión del perfil (como `elegirClave`).
   * La ruta la saca AQUÍ `webUtils.getPathForFile` (el renderer aislado no la ve) y va directa al main.
   */
  claveSoltada: (req: SshElegirClave, archivo: File) => Promise<SshClaveElegida>
  /** Diálogo nativo (en el main) para elegir un `config` de OpenSSH y lo que trae cada `Host`, sin dar de alta nada. `null` si se cancela. */
  leerOpenSsh: (req: SshImportarOpenSsh) => Promise<SshLecturaOpenSsh | null>
  /** Diálogo nativo de guardar (en el main) y escribe un `config` de OpenSSH con esas conexiones y sus claves. `null` si se cancela. */
  exportarOpenSsh: (req: SshExportarOpenSsh) => Promise<SshExportacionOpenSsh | null>
  /** Prueba la conexión GUARDADA: lo que tardó y la huella del servidor, o el motivo (sin rutas). */
  probar: (req: SshProbar) => Promise<SshResultadoPrueba>
  /** Olvida las huellas guardadas del servidor de una conexión. */
  olvidarHuella: (req: SshOlvidarHuella) => Promise<void>
  /** Prepara la carpeta del agente de la terminal del perfil (la crea y siembra su contexto) y la devuelve. */
  asegurarEspacio: (req: SshEspacioAsegurar) => Promise<SshEspacioTerminal>
  /** La carpeta del agente de la terminal de cada perfil, sin crearla. */
  rutasEspacio: (req: SshEspacioRutas) => Promise<Record<string, string>>
  /** El registro cambió (alta, edición, baja, grupos, una huella): toca volver a `listar`. Devuelve la baja. */
  onCambio: (cb: () => void) => () => void
  /** Una pestaña SSH no usará la contraseña guardada, y por qué. Devuelve la baja. */
  onAviso: (cb: (aviso: SshAviso) => void) => () => void
  /** ssh pregunta algo que contesta el usuario (un código, la contraseña tras un rechazo). Devuelve la baja. */
  onPreguntaAskpass: (cb: (pregunta: SshPreguntaAskpass) => void) => () => void
  /** Esa pregunta ya no espera respuesta. Devuelve la baja. */
  onPreguntaRetirada: (cb: (retirada: SshPreguntaRetirada) => void) => () => void
  /** La respuesta del usuario a una pregunta, o `null` si cancela. No se guarda. */
  responderAskpass: (req: SshRespuestaAskpass) => Promise<void>
}

export const ssh: SshApi = {
  listar: () => ipcRenderer.invoke(SSH_CHANNELS.LISTAR),
  crear: (input) => ipcRenderer.invoke(SSH_CHANNELS.CREAR, input),
  editar: (req) => ipcRenderer.invoke(SSH_CHANNELS.EDITAR, req),
  borrar: (req) => ipcRenderer.invoke(SSH_CHANNELS.BORRAR, req),
  borrarVarias: (req) => ipcRenderer.invoke(SSH_CHANNELS.BORRAR_VARIAS, req),
  mover: (req) => ipcRenderer.invoke(SSH_CHANNELS.MOVER, req),
  duplicar: (req) => ipcRenderer.invoke(SSH_CHANNELS.DUPLICAR, req),
  crearGrupo: (req) => ipcRenderer.invoke(SSH_CHANNELS.GRUPO_CREAR, req),
  renombrarGrupo: (req) => ipcRenderer.invoke(SSH_CHANNELS.GRUPO_RENOMBRAR, req),
  borrarGrupo: (req) => ipcRenderer.invoke(SSH_CHANNELS.GRUPO_BORRAR, req),
  entorno: () => ipcRenderer.invoke(SSH_CHANNELS.ENTORNO),
  elegirClave: (req) => ipcRenderer.invoke(SSH_CHANNELS.CLAVE_ELEGIR, req),
  claveSoltada: (req, archivo) => {
    // '' = no es un archivo del disco (un File construido en la página): el main lo rechaza con su mensaje.
    const peticion: SshClaveSoltada = { profileId: req.profileId, ruta: webUtils.getPathForFile(archivo) }
    return ipcRenderer.invoke(SSH_CHANNELS.CLAVE_SOLTADA, peticion)
  },
  leerOpenSsh: (req) => ipcRenderer.invoke(SSH_CHANNELS.IMPORTAR_OPENSSH, req),
  exportarOpenSsh: (req) => ipcRenderer.invoke(SSH_CHANNELS.EXPORTAR_OPENSSH, req),
  probar: (req) => ipcRenderer.invoke(SSH_CHANNELS.PROBAR, req),
  olvidarHuella: (req) => ipcRenderer.invoke(SSH_CHANNELS.HUELLA_OLVIDAR, req),
  asegurarEspacio: (req) => ipcRenderer.invoke(SSH_CHANNELS.ESPACIO_ASEGURAR, req),
  rutasEspacio: (req) => ipcRenderer.invoke(SSH_CHANNELS.ESPACIO_RUTAS, req),
  onCambio: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on(SSH_CHANNELS.CAMBIO, listener)
    return () => ipcRenderer.removeListener(SSH_CHANNELS.CAMBIO, listener)
  },
  onAviso: (cb) => {
    const listener = (_e: unknown, aviso: SshAviso): void => cb(aviso)
    ipcRenderer.on(SSH_CHANNELS.AVISO, listener)
    return () => ipcRenderer.removeListener(SSH_CHANNELS.AVISO, listener)
  },
  onPreguntaAskpass: (cb) => {
    const listener = (_e: unknown, pregunta: SshPreguntaAskpass): void => cb(pregunta)
    ipcRenderer.on(SSH_CHANNELS.ASKPASS_PREGUNTA, listener)
    return () => ipcRenderer.removeListener(SSH_CHANNELS.ASKPASS_PREGUNTA, listener)
  },
  onPreguntaRetirada: (cb) => {
    const listener = (_e: unknown, retirada: SshPreguntaRetirada): void => cb(retirada)
    ipcRenderer.on(SSH_CHANNELS.ASKPASS_RETIRAR, listener)
    return () => ipcRenderer.removeListener(SSH_CHANNELS.ASKPASS_RETIRAR, listener)
  },
  responderAskpass: (req) => ipcRenderer.invoke(SSH_CHANNELS.ASKPASS_RESPONDER, req)
}
