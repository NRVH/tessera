// =============================================================================
// Canales `DBX_CHANNELS` del explorador de bases de datos: el único sitio de su dominio que conoce `ipcMain`.
// Cada handler pasa la petición a un método de `ExploradorController` y nunca lanza: lo inesperado se registra y
// vuelve como `motivo: 'interno'`, sin rutas del host. Solo lo importa `src/main/db/componer.ts` (y las pruebas).
// Decisiones: docs/decisiones/bd/explorador-controlador.md
// =============================================================================

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { DBX_CHANNELS, type DbErrorSql, type DbEstadoSesion, type DbRespuesta } from '../../../shared/db-explorador-ipc.ts'
import { esObjeto, fallo, mensajeDe } from './controlador/validacion.ts'
import type { ExploradorController } from './ExploradorController.ts'

/** Lo que necesita `registrarIpcExplorador`: el `ipcMain` (solo `handle` y `on`) y el controlador. */
export interface DependenciasIpcExplorador {
  ipc: Pick<IpcMain, 'handle' | 'on'>
  explorador: ExploradorController
}

type Manejador<T> = (req: Record<string, unknown>, e: IpcMainInvokeEvent) => T | Promise<T>
type Registrar = <T>(canal: string, fn: Manejador<T>, porDefecto: () => T) => void
interface Envoltorios {
  h: Registrar
  hSql: Registrar
  explorador: ExploradorController
}

const C = DBX_CHANNELS
const interno = (): DbRespuesta<never> => fallo('interno', 'Error interno del explorador de bases de datos.')
const nada = (): undefined => undefined

/** Registra los canales del explorador, en el mismo orden de siempre. */
export function registrarIpcExplorador({ ipc, explorador }: DependenciasIpcExplorador): void {
  /** Handler que NUNCA lanza: si algo se escapa, `porDefecto`. */
  const h: Registrar = (canal, fn, porDefecto) => {
    ipc.handle(canal, async (e, req: unknown) => {
      try {
        return await fn(esObjeto(req) ? req : {}, e)
      } catch (err) {
        explorador.log(`${canal}: ${mensajeDe(err).slice(0, 200)}`)
        return porDefecto()
      }
    })
  }
  /**
   * Handler de un canal SQL cuya petición nombra la conexión: con una de otra familia (MongoDB,
   * Redis) responde el error clasificado sin entrar. Los canales comunes a todas las familias
   * siguen con `h`: los contratos de documentos y claves los reutilizan.
   */
  const hSql: Registrar = <T>(canal: string, fn: Manejador<T>, porDefecto: () => T): void =>
    h<T | { ok: false; error: DbErrorSql }>(canal, (r, e) => explorador.rechazoOtraFamilia(r) ?? fn(r, e), porDefecto)

  const env = { h, hSql, explorador }
  registrarArbol(env)
  registrarTabla(env)
  registrarConsola(env)
  registrarConexion(env)
  ipc.on(C.CONSOLAS_VACIADAS, () => explorador.alAcuseVaciado())
  ipc.on(C.SIN_ENVIAR, (_e, payload: unknown) => explorador.alSinEnviar(payload))
}

function registrarArbol({ h, hSql, explorador: x }: Envoltorios): void {
  // `base`: la del nivel «Bases» (SQL Server sin base fija), último argumento opcional.
  hSql(C.ESQUEMAS, (r) => x.esquemas(r.conexionId, r.refrescar, r.base), interno)
  hSql(C.FIJAR_ESQUEMAS, (r) => x.fijarEsquemas(r.conexionId, r.config), interno)
  hSql(C.BASES, (r) => x.bases(r.conexionId, r.refrescar), interno)
  hSql(C.FIJAR_BASES, (r) => x.fijarBases(r.conexionId, r.config), interno)
  hSql(C.RESUMEN, (r) => x.resumen(r.conexionId, r.esquema, r.refrescar, r.base), interno)
  hSql(C.OBJETOS, (r) => x.objetos(r.conexionId, r.esquema, r.tipo, r.refrescar, r.base), interno)
  hSql(C.DETALLE, (r) => x.detalle(r.conexionId, r.objeto, r.partes), interno)
  hSql(C.RESOLVER, (r) => x.resolver(r.conexionId, r.esquema, r.nombre, r.base), interno)
  hSql(C.FUENTE, (r) => x.fuente(r.conexionId, r.objeto, r.refrescar), interno)
  hSql(C.FKS, (r) => x.fks(r.conexionId, r.objeto, r.refrescar), interno)
  hSql(C.DDL, (r) => x.ddl(r.conexionId, r.objeto, r.refrescar), interno)
  hSql(C.NOMBRES, (r) => x.nombres(r.conexionId, r.esquemaActual, r.refrescar, r.base), interno)
  hSql(C.NOMBRES_PUBLICOS, (r) => x.nombresPublicos(r.conexionId), interno)
  h(C.REFRESCAR, (r) => x.refrescar(r.conexionId, r.esquema, r.base), nada)
}

function registrarTabla({ h, hSql, explorador: x }: Envoltorios): void {
  // TABLA_ABRIR, VALOR, DATOS_ENVIAR y EXPORTAR reciben la petición entera.
  hSql(C.TABLA_ABRIR, (r) => x.abrirTabla(r), interno)
  h(C.LECTOR_MAS, (r) => x.leerMas(r.lector, r.maxFilas, r.peticionId), interno)
  h(C.LECTOR_CONTAR, (r) => x.contar(r.lector, r.peticionId), interno)
  h(C.LECTOR_CERRAR, (r) => x.cerrarLector(r.lector), nada)
  hSql(C.VALOR, (r) => x.valor(r), interno)
  hSql(C.DATOS_ENVIAR, (r) => x.enviarCambios(r), interno)
  hSql(C.EXPORTAR, (r, e) => x.exportar(r, x.ventanaDelEmisor(e?.sender)), interno)
  h(C.EXPORTACION_REVELAR, (r) => x.revelarExportacion(r.token), nada)
}

function registrarConsola({ h, explorador: x }: Envoltorios): void {
  // CONSOLA_EJECUTAR, CONSOLA_EXPLAIN y HISTORIAL_LISTAR reciben la petición entera.
  h(C.CONSOLA_EJECUTAR, (r) => x.ejecutar(r), interno)
  h(C.CONSOLA_TX, (r) => x.tx(r.perfilId, r.consolaId, r.accion, r.confirmado, r.txInicial), interno)
  h(C.CONSOLA_MODO_TX, (r) => x.modoTx(r.perfilId, r.consolaId, r.modo, r.resolver, r.txInicial), interno)
  h(C.CONSOLA_ESTADO, (r) => x.estadoConsola(r.perfilId, r.consolaId), () => null)
  h(C.CONSOLA_CERRAR_SESION, (r) => x.cerrarSesionConsola(r.perfilId, r.consolaId, r.resolver), interno)
  h(C.CONSOLA_ESQUEMA, (r) => x.esquemaConsola(r.perfilId, r.consolaId, r.esquema, r.txInicial), interno)
  h(C.CONSOLA_EXPLAIN, (r) => x.explicar(r), interno)
  // Sin conexión ni sesión: solo el analizador local.
  h(C.CONSOLA_SINTAXIS, (r) => x.sintaxis.validar(r), interno)
  // Historial de consultas (privado: fuera del espacio de datos).
  h(C.HISTORIAL_LISTAR, (r) => x.historialListar(r), interno)
  h(C.HISTORIAL_BORRAR, (r) => x.historialBorrar(r.perfilId, r.ids), interno)
}

function registrarConexion({ h, explorador: x }: Envoltorios): void {
  h(C.CANCELAR, (r) => x.cancelar(r), nada)
  h(C.FORZAR, (r) => x.forzar(r.conexionId, r.consola), nada)
  h(C.DESCONECTAR, (r) => x.desconectar(r.conexionId, r.resolver), interno)
  h(C.SESIONES, () => x.sesiones(), (): DbEstadoSesion[] => [])
  h(C.CONSOLAS_LISTAR, (r) => x.listarConsolas(r.perfilId), interno)
  h(C.CONSOLAS_CREAR, (r) => x.crearConsola(r.perfilId, r.conexionId), interno)
  h(C.CONSOLAS_LEER, (r) => x.leerConsola(r.perfilId, r.consolaId), interno)
  h(C.CONSOLAS_ESCRIBIR, (r) => x.escribirConsola(r.perfilId, r.consolaId, r.texto), interno)
  h(C.CONSOLAS_RENOMBRAR, (r) => x.renombrarConsola(r.perfilId, r.consolaId, r.nombre), interno)
  h(C.CONSOLAS_BORRAR, (r) => x.borrarConsola(r.perfilId, r.consolaId, r.resolver), interno)
}
