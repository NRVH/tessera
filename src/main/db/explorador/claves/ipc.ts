// =============================================================================
// Canales `KV_CHANNELS` (motores de claves: Redis): el único sitio de su dominio que conoce `ipcMain`.
// Cada handler pasa la petición a `ControladorClaves` y nunca lanza. Solo lo importa `src/main/db/componer.ts` (y las pruebas).
// Decisiones: docs/decisiones/bd/claves-controlador.md
// =============================================================================

import type { IpcMain } from 'electron'
import { KV_CHANNELS } from '../../../../shared/db-claves-ipc.ts'
import { INTERNO } from '../documentos/validacionPeticion.ts'
import type { ControladorClaves, OperacionClaves } from './ControladorClaves.ts'

/** Lo que necesita `registrarIpcClaves`: el `ipcMain` (solo `handle`) y el controlador. */
export interface DependenciasIpcClaves {
  ipc: Pick<IpcMain, 'handle'>
  controlador: ControladorClaves
}

/** Registra los canales de claves, en el mismo orden de siempre. */
export function registrarIpcClaves({ ipc, controlador }: DependenciasIpcClaves): void {
  const K = KV_CHANNELS
  /** Handler que NUNCA lanza: si algo se escapa, «Error interno…» (como en el explorador SQL). */
  const h = (canal: string, op: OperacionClaves): void => {
    ipc.handle(canal, async (_e, req: unknown) => {
      try {
        return await controlador.atender(op, req)
      } catch (err) {
        controlador.log(`${canal}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200))
        return INTERNO
      }
    })
  }

  h(K.BASES, 'BASES')
  h(K.ESCANEAR, 'ESCANEAR')
  h(K.VALOR, 'VALOR')
  h(K.CONSOLA_EJECUTAR, 'CONSOLA_EJECUTAR')
}
