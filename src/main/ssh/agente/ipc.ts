// =============================================================================
// Permisos SSH del perfil: validación del catálogo y guardado confirmado antes de contestar al renderer.
// Expone la consulta y la actualización por IPC para que la interfaz reciba el resultado del guardado.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
import type { IpcMain } from 'electron'
import { CANAL_CLAVES_AGENTE, CANAL_GUARDAR_CLAVES_AGENTE } from '../../../shared/ssh-agente-ipc.ts'
import type { ClaveAgente } from '../../../shared/ssh-agente-ipc.ts'
import { txAgenteSsh } from './textos.ts'

export function registrarIpcAgenteSsh(dependencias: {
  ipc: Pick<IpcMain, 'handle'>
  listar: (perfil: string) => ClaveAgente[] | Promise<ClaveAgente[]>
  guardar: (perfil: string, rutas: string[]) => void
}): void {
  dependencias.ipc.handle(CANAL_CLAVES_AGENTE, (_evento, perfil: string) => dependencias.listar(perfil))
  dependencias.ipc.handle(CANAL_GUARDAR_CLAVES_AGENTE, async (_evento, perfil: string, rutas: unknown) => {
    try {
      if (!Array.isArray(rutas) || rutas.length > 1024 || !rutas.every((ruta) => typeof ruta === 'string')) throw new Error('Rutas incorrectas')
      const conocidas = new Set((await dependencias.listar(perfil)).map((clave) => clave.ruta))
      if (!rutas.every((ruta) => conocidas.has(ruta))) throw new Error('Clave fuera del catálogo')
      dependencias.guardar(perfil, [...new Set(rutas)] as string[])
    } catch { throw new Error(txAgenteSsh().fallo) }
  })
}
