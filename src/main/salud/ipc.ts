// =============================================================================
// El IPC del registro de salud: los resúmenes que manda la ventana van al registro, que los sanea
// y solo los anota si está grabando (solo `ipc.on`: la ventana no espera respuesta); y
// `instrumentarIpc`, que envuelve `ipcMain.handle` para apuntar cada petición en `LlamadasIpc`.
// Decisiones: docs/decisiones/app/registro-de-salud.md
// =============================================================================

import type { IpcMain } from 'electron'
import { SALUD_CHANNELS } from '../../shared/salud-ipc.ts'
import type { LlamadasIpc } from './llamadasIpc.ts'
import type { RegistroSalud } from './RegistroSalud.ts'

export function registrarIpcSalud(deps: { ipc: Pick<IpcMain, 'on'>; registro: () => RegistroSalud | null }): void {
  deps.ipc.on(SALUD_CHANNELS.RENDERER, (_e, resumen: unknown) => deps.registro()?.anotarRenderer(resumen))
  deps.ipc.on(SALUD_CHANNELS.VISIBILIDAD, (_e, evento: unknown) => deps.registro()?.anotarVisibilidad(evento))
}

/**
 * Envuelve `ipc.handle` para que cada petición se apunte en `llamadas` al empezar y al acabar
 * (también si falla). Se llama UNA vez, antes de registrar ningún canal.
 */
export function instrumentarIpc(ipc: Pick<IpcMain, 'handle'>, llamadas: LlamadasIpc, ahora: () => number): void {
  const original = ipc.handle.bind(ipc)
  ipc.handle = (canal, fn) => {
    original(canal, async (...args) => {
      const id = llamadas.empezar(canal, ahora())
      try {
        return await fn(...args)
      } finally {
        llamadas.terminar(id, ahora())
      }
    })
  }
}
