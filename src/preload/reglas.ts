// =============================================================================
// Preload: las propuestas de reglas del perfil que dejan los agentes con `tctx proponer`. Solo invoke y
// las suscripciones a los avisos de llegada y de resolución; el almacén vive en el main.
// Canales y formas: src/shared/reglas-ipc.ts.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================
import { ipcRenderer } from 'electron'
import { REGLAS_CHANNELS, type AvisoPropuesta, type PeticionDescartarPropuesta, type PropuestaReglas, type PeticionResolverAlGuardar } from '../shared/reglas-ipc'

/** API de las propuestas de reglas expuesta al renderer. */
export interface ApiReglas {
  /** La propuesta pendiente de un perfil, o `null`. */
  obtenerPropuesta: (perfilId: string) => Promise<PropuestaReglas | null>
  /** Los perfiles con una propuesta pendiente (el aviso de llegada se pierde sin ventana). */
  pendientes: () => Promise<string[]>
  /** Descarta la pendiente de un perfil; con `en`, solo si sigue siendo esa. Devuelve si quitó algo. */
  descartarPropuesta: (req: PeticionDescartarPropuesta) => Promise<boolean>
  /** Ha llegado una propuesta. Devuelve la función que quita la suscripción. */
  alProponer: (cb: (aviso: AvisoPropuesta) => void) => () => void
  /** Anota que la propuesta se quita cuando sus reglas estén guardadas en disco (aceptada o editada). */
  resolverAlGuardar: (req: PeticionResolverAlGuardar) => Promise<void>
  /** Se resolvió una propuesta anotada. Devuelve la función que quita la suscripción. */
  alResolver: (cb: (aviso: AvisoPropuesta) => void) => () => void
}

/** Una suscripción a un aviso del main para un perfil. */
function suscribir(canal: string, cb: (aviso: AvisoPropuesta) => void): () => void {
  const oyente = (_e: Electron.IpcRendererEvent, aviso: AvisoPropuesta): void => cb(aviso)
  ipcRenderer.on(canal, oyente)
  return () => ipcRenderer.removeListener(canal, oyente)
}

export const reglas: ApiReglas = {
  obtenerPropuesta: (perfilId) => ipcRenderer.invoke(REGLAS_CHANNELS.OBTENER, perfilId),
  pendientes: () => ipcRenderer.invoke(REGLAS_CHANNELS.PENDIENTES),
  descartarPropuesta: (req) => ipcRenderer.invoke(REGLAS_CHANNELS.DESCARTAR, req),
  alProponer: (cb) => suscribir(REGLAS_CHANNELS.PROPUESTA, cb),
  resolverAlGuardar: (req) => ipcRenderer.invoke(REGLAS_CHANNELS.RESOLVER_AL_GUARDAR, req),
  alResolver: (cb) => suscribir(REGLAS_CHANNELS.RESUELTA, cb)
}
