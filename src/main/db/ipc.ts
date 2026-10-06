// =============================================================================
// Registro de los canales `DB_CHANNELS` (conexiones, archivos, drivers y espacio de datos).
// Único sitio del dominio con `ipcMain`: cada handler delega en un método de `DbController`.
// Solo lo importa `src/main/db/componer.ts` (frontera F3).
// =============================================================================
import type { IpcMain } from 'electron'
import {
  DB_CHANNELS,
  type DbBorrarConexion,
  type DbConnectionInput,
  type DbMontarArchivoRequest,
  type DbMotor,
  type ListConnectionsRequest,
  type SetScopeRequest
} from '../../shared/db-ipc.ts'
import type { DbController } from './DbController.ts'
import type { CandadoDeBorrado } from '../profiles/candadoDeBorrado.ts'
import type { LlegadaDePerfiles } from '../profiles/llegadaDePerfiles.ts'

/** Lo que `registrarIpcBd` necesita: el `ipcMain` y el controlador al que delegar. */
export interface DependenciasIpcBd {
  ipc: Pick<IpcMain, 'handle'>
  bd: DbController
  /**
   * El candado del borrado de cada perfil: el espacio de datos se prepara cuando no se está borrando un
   * perfil con ese id, o el borrado mandaría a la papelera el recién sembrado del perfil recreado.
   */
  borrados?: Pick<CandadoDeBorrado, 'trasElBorrado'>
  /**
   * Los perfiles vivos del main: el espacio de datos solo se prepara para uno que exista (si no, un perfil
   * recién borrado volvería a tener `conexiones/<id>`), y con el nombre del main, no el del renderer.
   */
  perfiles?: () => ReadonlyArray<{ id: string; nombre: string }>
  /**
   * Un perfil recién creado puede pedir su espacio antes de que llegue el guardado que lo trae: se
   * espera, con tope, a que llegue (`profiles/llegadaDePerfiles.ts`) y luego decide la guarda de siempre.
   */
  llegada?: Pick<LlegadaDePerfiles, 'esperar'>
}

/** Lo que hace `WORKSPACE_ENSURE`, ya tras el candado: con la lista de perfiles de ese momento. */
function asegurarEspacio(
  bd: Pick<DbController, 'ensureWorkspace'>,
  req: { profileId: string; nombrePerfil: string },
  perfiles: DependenciasIpcBd['perfiles']
): ReturnType<DbController['ensureWorkspace']> {
  if (!perfiles) return bd.ensureWorkspace(req.profileId, req.nombrePerfil)
  const perfil = perfiles().find((p) => p.id === req?.profileId)
  if (!perfil) throw new Error('Ese perfil no existe: no se prepara su espacio de datos.')
  return bd.ensureWorkspace(perfil.id, perfil.nombre)
}

/** Registra los 19 canales de `DB_CHANNELS`, en el mismo orden de siempre. */
export function registrarIpcBd({ ipc, bd, borrados, perfiles, llegada }: DependenciasIpcBd): void {
  ipc.handle(DB_CHANNELS.LIST, (_e, req: ListConnectionsRequest) => bd.listar(req.profileId))
  ipc.handle(DB_CHANNELS.LIST_COMPLETA, (_e, req: ListConnectionsRequest) => bd.listarCompleta(req.profileId))
  ipc.handle(DB_CHANNELS.SET_SCOPE, (_e, req: SetScopeRequest) => {
    bd.fijarAmbito(req.profileId, req.projectHostPath, Array.isArray(req.ids) ? req.ids : [])
  })
  ipc.handle(DB_CHANNELS.CREATE, (_e, input: DbConnectionInput) => bd.crearConexion(input))
  ipc.handle(DB_CHANNELS.UPDATE, (_e, req: { id: string; input: DbConnectionInput }) => bd.editarConexion(req))
  ipc.handle(DB_CHANNELS.DELETE, (_e, req: DbBorrarConexion) => bd.borrarConexion(req))
  ipc.handle(DB_CHANNELS.REORDER, (_e, req: { profileId: string; ids: string[] }) => bd.reordenarConexiones(req))
  ipc.handle(DB_CHANNELS.TEST, (_e, req: { id: string }) => bd.test(req.id))

  ipc.handle(DB_CHANNELS.ARCHIVO_ELEGIR, (_e, req: { motor: DbMotor }) => bd.elegirArchivo(req))
  ipc.handle(DB_CHANNELS.ARCHIVO_CREAR, (_e, req: { motor: DbMotor }) => bd.crearArchivo(req))
  ipc.handle(DB_CHANNELS.ARCHIVO_SOLTADO, (_e, req: { motor: DbMotor; ruta: string }) => bd.archivoSoltado(req))
  ipc.handle(DB_CHANNELS.ARCHIVO_MONTAR, (_e, req: DbMontarArchivoRequest) => bd.montarArchivo(req))
  ipc.handle(DB_CHANNELS.ARCHIVO_CONEXION, (_e, req: DbMontarArchivoRequest) => bd.conexionDeArchivo(req))

  ipc.handle(DB_CHANNELS.DRIVERS_LIST, () => bd.driverStatus())
  ipc.handle(DB_CHANNELS.DRIVERS_INSTALL, (_e, req: { packId: string }) => bd.instalarDriver(req.packId))
  ipc.handle(DB_CHANNELS.DRIVERS_USE_EXISTING, (_e, req: { packId: string; ruta: string }) =>
    bd.usarClienteExistente(req.packId, req.ruta)
  )
  ipc.handle(DB_CHANNELS.DRIVERS_PICK_FOLDER, () => bd.elegirCarpetaDriver())

  ipc.handle(DB_CHANNELS.WORKSPACE_ENSURE, (_e, req: { profileId: string; nombrePerfil: string }) => {
    const asegurar = (): ReturnType<DbController['ensureWorkspace']> => asegurarEspacio(bd, req, perfiles)
    const trasElCandado = (): ReturnType<typeof asegurar> | Promise<ReturnType<typeof asegurar>> =>
      borrados && typeof req?.profileId === 'string' ? borrados.trasElBorrado(req.profileId, asegurar) : asegurar()
    // Fuera del candado: esperar la llegada no debe retrasar el borrado de otro perfil con ese id.
    return llegada ? llegada.esperar(req?.profileId).then(trasElCandado) : trasElCandado()
  })
  ipc.handle(DB_CHANNELS.WORKSPACE_PATHS, (_e, req: { profileIds: string[] }) => bd.workspacePaths(req.profileIds ?? []))
}
