// =============================================================================
// IPC de las propuestas de reglas del perfil: obtener la pendiente de un perfil, los perfiles con una y
// descartarla o anotar que se resuelva al guardarse sus reglas. Único sitio con `ipcMain` del dominio; valida la petición y delega en el almacén. Solo lo
// importa `src/main/reglas/componer.ts`.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================
import type { IpcMain } from 'electron'
import { REGLAS_CHANNELS, type PeticionDescartarPropuesta, type PropuestaReglas, type PeticionResolverAlGuardar } from '../../shared/reglas-ipc.ts'
import type { PropuestasReglas } from './propuestasReglas.ts'

/** Registra los canales de `REGLAS_CHANNELS` que se piden (el aviso lo emite `componer.ts`). */
export function registrarIpcReglas(deps: {
  ipc: Pick<IpcMain, 'handle'>
  propuestas: Pick<PropuestasReglas, 'obtener' | 'pendientes' | 'descartar' | 'resolverAlGuardar' | 'alGuardarPerfiles'>
  /** Los perfiles que hay (y guardados) AHORA: una aceptación cuyas reglas ya son las vigentes se resuelve al momento. */
  perfiles: () => ReadonlyArray<{ id: string; reglas?: string }>
}): void {
  const { ipc, propuestas } = deps
  ipc.handle(REGLAS_CHANNELS.OBTENER, (_e, perfilId: unknown): PropuestaReglas | null => {
    if (typeof perfilId !== 'string') throw new Error('obtenerPropuesta: se esperaba el id del perfil.')
    return propuestas.obtener(perfilId)
  })
  ipc.handle(REGLAS_CHANNELS.PENDIENTES, (): string[] => propuestas.pendientes())
  ipc.handle(REGLAS_CHANNELS.DESCARTAR, (_e, req: unknown): boolean => {
    const r = req as Partial<PeticionDescartarPropuesta> | null
    if (!r || typeof r.perfilId !== 'string' || (r.en !== undefined && typeof r.en !== 'number')) {
      throw new Error('descartarPropuesta: se esperaba { perfilId, en? }.')
    }
    return propuestas.descartar(r.perfilId, r.en)
  })
  ipc.handle(REGLAS_CHANNELS.RESOLVER_AL_GUARDAR, (_e, req: unknown): void => {
    const r = req as Partial<PeticionResolverAlGuardar> | null
    if (!r || typeof r.perfilId !== 'string' || typeof r.en !== 'number' || typeof r.texto !== 'string') {
      throw new Error('resolverAlGuardar: se esperaba { perfilId, en, texto }.')
    }
    propuestas.resolverAlGuardar(r.perfilId, r.en, r.texto)
    // Si las reglas guardadas ya son esas (no cambió nada que guardar), no habrá otro guardado que espere.
    propuestas.alGuardarPerfiles(deps.perfiles())
  })
}
