// =============================================================================
// Canales `DOCS_CHANNELS` (motores de documentos: MongoDB): el único sitio de su dominio que conoce `ipcMain`.
// Cada handler pasa la petición a `ControladorDocumentos` y nunca lanza. Solo lo importa `src/main/db/componer.ts` (y las pruebas).
// Decisiones: docs/decisiones/bd/documentos-controlador.md
// =============================================================================

import type { IpcMain } from 'electron'
import { DOCS_CHANNELS } from '../../../../shared/db-documentos-ipc.ts'
import type { DbRespuesta } from '../../../../shared/db-explorador-ipc.ts'
import type { ControladorDocumentos } from './ControladorDocumentos.ts'
import { INTERNO } from './validacionPeticion.ts'

/** Lo que necesita `registrarIpcDocumentos`: el `ipcMain` (solo `handle`) y el controlador. */
export interface DependenciasIpcDocumentos {
  ipc: Pick<IpcMain, 'handle'>
  controlador: ControladorDocumentos
}

/** Registra los canales de documentos, en el mismo orden de siempre. */
export function registrarIpcDocumentos({ ipc, controlador }: DependenciasIpcDocumentos): void {
  const D = DOCS_CHANNELS
  /** Handler que NUNCA lanza: si algo se escapa, `porDefecto` (como en el explorador SQL). */
  const h = <T>(canal: string, fn: (req: unknown) => Promise<T>, porDefecto: () => T): void => {
    ipc.handle(canal, async (_e, req: unknown) => {
      try {
        return await fn(req)
      } catch (err) {
        controlador.log(`${canal}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200))
        return porDefecto()
      }
    })
  }
  const interno = (): DbRespuesta<never> => INTERNO
  const nada = (): undefined => undefined

  h(D.BASES, (r) => controlador.atender('BASES', r), interno)
  h(D.COLECCIONES, (r) => controlador.atender('COLECCIONES', r), interno)
  h(D.DETALLE, (r) => controlador.atender('DETALLE', r), interno)
  h(D.CONSULTAR, (r) => controlador.atender('CONSULTAR', r), interno)
  h(D.LECTOR_MAS, (r) => controlador.leerMas(r), interno)
  h(D.LECTOR_CERRAR, (r) => controlador.cerrarLector(r), nada)
  h(D.CONSOLA_EJECUTAR, (r) => controlador.atender('CONSOLA_EJECUTAR', r), interno)
  h(D.ENVIAR, (r) => controlador.atender('ENVIAR', r), interno)
}
