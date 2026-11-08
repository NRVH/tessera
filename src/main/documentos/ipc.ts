// =============================================================================
// Canales de los documentos de referencia del perfil: el diálogo para elegir una carpeta y el resumen de
// las elegidas para la pantalla de Configuración. Lo registra `reglas/componer.ts`.
// Decisiones: docs/decisiones/agentes/documentos-del-perfil.md
// =============================================================================

import type { BrowserWindow, IpcMain } from 'electron'
import { elegirConDialogo } from '../util/adaptadores/dialogosNativos'
import { DOCUMENTOS_CHANNELS, type ResumenCarpetaDocumentos } from '../../shared/documentos-ipc'
import { normalizarCarpetasDocumentos } from '../../shared/documentosPerfil'
import { listarDocumentos } from './documentosPerfil'

export function registrarIpcDocumentos(deps: { ipc: Pick<IpcMain, 'handle'>; ventana: () => BrowserWindow | null; titulo: () => string }): void {
  const { ipc } = deps
  ipc.handle(DOCUMENTOS_CHANNELS.ELEGIR_CARPETA, async () => {
    const r = await elegirConDialogo('documentos-perfil', { properties: ['openDirectory'], title: deps.titulo() }, { ventana: deps.ventana() })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  ipc.handle(DOCUMENTOS_CHANNELS.RESUMEN, async (_e, carpetas: unknown): Promise<ResumenCarpetaDocumentos[]> => {
    const lista = normalizarCarpetasDocumentos(Array.isArray(carpetas) ? carpetas : [])
    return Promise.all(
      lista.map(async (carpeta) => {
        const l = await listarDocumentos([carpeta])
        return { carpeta, existe: l.noDisponibles.length === 0, documentos: l.documentos.length }
      })
    )
  })
}
