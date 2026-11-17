// =============================================================================
// Registro de los canales `DB_CHANNELS` (conexiones, archivos, drivers y espacio de datos).
// Único sitio del dominio con `ipcMain`: cada handler delega en un método de `ControladorBd`.
// Solo lo importa `src/main/db/componer.ts` (frontera F3).
// =============================================================================
import type { IpcMain } from 'electron'
import {
  DB_CHANNELS,
  type DbBorrarConexion,
  type DatosEntradaConexionBd,
  type PeticionMontarArchivoBd,
  type PeticionListarConexiones,
  type PeticionArchivoSoltadoBd,
  type PeticionAsegurarEspacioBd,
  type PeticionEditarConexion,
  type PeticionElegirArchivoBd,
  type PeticionInstalarControlador,
  type PeticionProbarConexion,
  type PeticionReordenarConexiones,
  type PeticionRutasEspaciosBd,
  type PeticionUsarControlador,
  type PeticionFijarAmbitoBd
} from '../../shared/db-ipc.ts'
import type { ControladorBd } from './ControladorBd.ts'
import type { CandadoDeBorrado } from '../perfiles/candadoDeBorrado.ts'
import type { LlegadaDePerfiles } from '../perfiles/llegadaDePerfiles.ts'
import { txDb } from './textosDb.ts'

/** Lo que `registrarIpcBd` necesita: el `ipcMain` y el controlador al que delegar. */
export interface DependenciasIpcBd {
  ipc: Pick<IpcMain, 'handle'>
  bd: ControladorBd
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
   * espera, con tope, a que llegue (`perfiles/llegadaDePerfiles.ts`) y luego decide la guarda de siempre.
   */
  llegada?: Pick<LlegadaDePerfiles, 'esperar'>
}

/** Lo que hace `WORKSPACE_ENSURE`, ya tras el candado: con la lista de perfiles de ese momento. */
function asegurarEspacio(
  bd: Pick<ControladorBd, 'asegurarEspacio'>,
  req: PeticionAsegurarEspacioBd,
  perfiles: DependenciasIpcBd['perfiles']
): ReturnType<ControladorBd['asegurarEspacio']> {
  if (!perfiles) return bd.asegurarEspacio(req.profileId, req.nombrePerfil)
  const perfil = perfiles().find((p) => p.id === req?.profileId)
  if (!perfil) throw new Error(txDb().conexion.perfilNoExiste)
  return bd.asegurarEspacio(perfil.id, perfil.nombre)
}

/** Registra los 19 canales de `DB_CHANNELS`, en el mismo orden de siempre. */
export function registrarIpcBd({ ipc, bd, borrados, perfiles, llegada }: DependenciasIpcBd): void {
  ipc.handle(DB_CHANNELS.LIST, (_e, req: PeticionListarConexiones) => bd.listar(req.profileId))
  ipc.handle(DB_CHANNELS.LIST_COMPLETA, (_e, req: PeticionListarConexiones) => bd.listarCompleta(req.profileId))
  ipc.handle(DB_CHANNELS.SET_SCOPE, (_e, req: PeticionFijarAmbitoBd) => {
    bd.fijarAmbito(req.profileId, req.projectHostPath, Array.isArray(req.ids) ? req.ids : [])
  })
  ipc.handle(DB_CHANNELS.CREATE, (_e, entrada: DatosEntradaConexionBd) => bd.crearConexion(entrada))
  ipc.handle(DB_CHANNELS.UPDATE, (_e, req: PeticionEditarConexion) => bd.editarConexion(req))
  ipc.handle(DB_CHANNELS.DELETE, (_e, req: DbBorrarConexion) => bd.borrarConexion(req))
  ipc.handle(DB_CHANNELS.REORDER, (_e, req: PeticionReordenarConexiones) => bd.reordenarConexiones(req))
  ipc.handle(DB_CHANNELS.TEST, (_e, req: PeticionProbarConexion) => bd.probar(req.id))

  ipc.handle(DB_CHANNELS.ARCHIVO_ELEGIR, (_e, req: PeticionElegirArchivoBd) => bd.elegirArchivo(req))
  ipc.handle(DB_CHANNELS.ARCHIVO_CREAR, (_e, req: PeticionElegirArchivoBd) => bd.crearArchivo(req))
  ipc.handle(DB_CHANNELS.ARCHIVO_SOLTADO, (_e, req: PeticionArchivoSoltadoBd) => bd.archivoSoltado(req))
  ipc.handle(DB_CHANNELS.ARCHIVO_MONTAR, (_e, req: PeticionMontarArchivoBd) => bd.montarArchivo(req))
  ipc.handle(DB_CHANNELS.ARCHIVO_CONEXION, (_e, req: PeticionMontarArchivoBd) => bd.conexionDeArchivo(req))

  ipc.handle(DB_CHANNELS.DRIVERS_LIST, () => bd.estadoDrivers())
  ipc.handle(DB_CHANNELS.DRIVERS_INSTALL, (_e, req: PeticionInstalarControlador) => bd.instalarDriver(req.packId))
  ipc.handle(DB_CHANNELS.DRIVERS_USE_EXISTING, (_e, req: PeticionUsarControlador) =>
    bd.usarClienteExistente(req.packId, req.ruta)
  )
  ipc.handle(DB_CHANNELS.DRIVERS_PICK_FOLDER, () => bd.elegirCarpetaDriver())

  ipc.handle(DB_CHANNELS.WORKSPACE_ENSURE, (_e, req: PeticionAsegurarEspacioBd) => {
    const asegurar = (): ReturnType<ControladorBd['asegurarEspacio']> => asegurarEspacio(bd, req, perfiles)
    const trasElCandado = (): ReturnType<typeof asegurar> | Promise<ReturnType<typeof asegurar>> =>
      borrados && typeof req?.profileId === 'string' ? borrados.trasElBorrado(req.profileId, asegurar) : asegurar()
    // Fuera del candado: esperar la llegada no debe retrasar el borrado de otro perfil con ese id.
    return llegada ? llegada.esperar(req?.profileId).then(trasElCandado) : trasElCandado()
  })
  ipc.handle(DB_CHANNELS.WORKSPACE_PATHS, (_e, req: PeticionRutasEspaciosBd) => bd.rutasEspacios(req.perfilIds ?? []))
}
