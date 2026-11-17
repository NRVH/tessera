// =============================================================================
// Registro de los canales IPC de la terminal de la interfaz (`TERMINAL_CHANNELS`).
// Cada handler solo traduce la petición y delega en `ControladorTerminal`.
// Solo lo importa `src/main/agentes/componer.ts`.
// =============================================================================
import type { IpcMain } from 'electron'
import type { ControladorTerminal } from './ControladorTerminal'
import {
  TERMINAL_CHANNELS,
  type PeticionAbrirTerminal,
  type PeticionAbrirSsh,
  type MensajeEscribirTerminal,
  type MensajeRedimensionarTerminal,
  type MensajeControlFlujo,
  type PeticionRecargarTerminal,
  type PeticionCerrarTerminal,
  type PeticionTerminalesEnMarcha
} from '../../shared/terminal-ipc'

/** Registra los cinco `handle` y los tres `on` de la terminal; el orden de registro se conserva. */
export function registrarIpcTerminal(deps: {
  ipc: Pick<IpcMain, 'handle' | 'on'>
  terminales: ControladorTerminal
  /** Espera a que termine el borrado en curso de ese perfil: una sesión abierta a mitad sería del perfil recreado. */
  esperarBorrado?: (perfilId: unknown) => Promise<void>
}): void {
  const { ipc, terminales, esperarBorrado } = deps
  /** `abrir` tras el borrado en curso del perfil de la petición, si hay quien lo espere. */
  const trasBorrado = <T>(req: { perfilId?: unknown } | undefined, abrir: () => T): T | Promise<T> =>
    esperarBorrado ? esperarBorrado(req?.perfilId).then(abrir) : abrir()
  ipc.handle(TERMINAL_CHANNELS.OPEN, (_e, req: PeticionAbrirTerminal) => trasBorrado(req, () => terminales.abrir(req)))
  ipc.on(TERMINAL_CHANNELS.WRITE, (_e, msg: MensajeEscribirTerminal) => terminales.escribir(msg))
  ipc.on(TERMINAL_CHANNELS.RESIZE, (_e, msg: MensajeRedimensionarTerminal) => terminales.redimensionar(msg))
  ipc.on(TERMINAL_CHANNELS.FLOW, (_e, msg: MensajeControlFlujo) => terminales.flujo(msg))
  // Recargar relanza la shell (y en contenedor, lo levanta): espera al borrado del perfil DE LA SESIÓN.
  ipc.handle(TERMINAL_CHANNELS.RELOAD, (_e, req: PeticionRecargarTerminal) =>
    trasBorrado({ perfilId: terminales.perfilDeSesion(req?.sesionId) }, () => terminales.recargar(req.sesionId, req.conexionDbIds))
  )
  ipc.handle(TERMINAL_CHANNELS.CLOSE, (_e, req: PeticionCerrarTerminal) =>
    terminales.cerrar(req.sesionId)
  )
  ipc.handle(TERMINAL_CHANNELS.OPEN_SSH, (_e, req: PeticionAbrirSsh) => trasBorrado(req, () => terminales.abrirSsh(req)))
  ipc.handle(TERMINAL_CHANNELS.EN_MARCHA, (_e, req: PeticionTerminalesEnMarcha | undefined) =>
    terminales.terminalesEnMarcha(req?.perfilId)
  )
}
