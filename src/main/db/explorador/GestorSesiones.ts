// =============================================================================
// Gestor de sesiones SQL del explorador (main, sin electron): fachada con la API pública.
// El estado vive en `sesiones/NucleoSesiones.ts` y cada operación en su módulo de `sesiones/`;
// aquí solo se construyen en capas y se delega sin añadir turnos (`return` a secas).
// Lo usan `ExploradorController`, `gestorFamilia`, documentos, claves y `exportacion.ts`.
// Decisiones: docs/decisiones/bd/sesiones-procesos-y-autoridad.md
// =============================================================================

import type { DbConnection } from '../../../shared/db-ipc.ts'
import type {
  DbBinds,
  DbCancelar,
  DbEjecutarConsola,
  DbEstadoSesion,
  DbEstadoTx,
  DbExplicar,
  DbPagina,
  DbPlan,
  DbRefSesion,
  DbResolucionBloque,
  DbResolverTx,
  DbRespuesta,
  DbResultadoEnvio,
  DbResultadoError,
  DbResultadoFilas,
  DbResultadoSentencia,
  DbTxModo
} from '../../../shared/db-explorador-ipc.ts'
import type { DialectoSql } from '../../../shared/sql/dialectosSql.ts'
import type { Sentencia } from '../../../shared/sql/divisorSql.ts'
import { type AjustesSesionesBd, sanearAjustesSesiones } from '../../../shared/ajustesBd.ts'
import type { BindsSalientes } from './bindsConsola.ts'
import type { PrioridadCola } from './colaSesion.ts'
import type { ResultadoFilasTrabajador } from './protocoloTrabajador.ts'
import { Apertura } from './sesiones/apertura.ts'
import { CatalogoSesion } from './sesiones/catalogo.ts'
import { CicloDeVida } from './sesiones/cicloDeVida.ts'
import { ConexionSesiones } from './sesiones/conexion.ts'
import { ConsolaSesion } from './sesiones/consola.ts'
import { EnvioRejilla } from './sesiones/envio.ts'
import { EsquemaConsola } from './sesiones/esquemaConsola.ts'
import { ExplicarSesion } from './sesiones/explicar.ts'
import { ExportarConsulta } from './sesiones/exportarConsulta.ts'
import { ExportarTabla } from './sesiones/exportarTabla.ts'
import { LectoresSesion } from './sesiones/lectores.ts'
import { NucleoSesiones } from './sesiones/NucleoSesiones.ts'
import { Procesos } from './sesiones/procesos.ts'
import { ResultadoSentencia } from './sesiones/resultadoSentencia.ts'
import { TablaSesion } from './sesiones/tabla.ts'
import type {
  ConsumidorPaginas,
  ContextoCatalogo,
  DependenciasGestor,
  PeticionEnvio,
  PeticionTabla,
  PeticionValor,
  RefConsola,
  ResolucionTodas,
  TopesLectura
} from './sesiones/tipos.ts'
import { Transacciones } from './sesiones/transacciones.ts'

export type {
  TrabajadorGestor,
  RefConsola,
  ContextoCatalogo,
  TopesLectura,
  PeticionTabla,
  ErrorResolucion
} from './sesiones/tipos.ts'
export {
  MENSAJE_FILA_DESAPARECIDA,
  MENSAJE_DETENIDA,
  ErrorGestor,
  motivoDeClase,
  MENSAJE_SIN_LECTOR,
  MENSAJE_ESQUEMA_CAMBIADO
} from './sesiones/errores.ts'
export { versionMayor, esperar } from './sesiones/reglas.ts'

/** Sesiones SQL del explorador: procesos por conexión, consolas, lectores, exportar y «Enviar». */
export class GestorSesiones {
  private readonly n: NucleoSesiones
  private readonly lec: LectoresSesion
  private readonly cat: CatalogoSesion
  private readonly tabla: TablaSesion
  private readonly consola: ConsolaSesion
  private readonly expl: ExplicarSesion
  private readonly tx: Transacciones
  private readonly expTabla: ExportarTabla
  private readonly expConsulta: ExportarConsulta
  private readonly envio: EnvioRejilla
  private readonly conexion: ConexionSesiones
  private readonly ciclo: CicloDeVida

  constructor(deps: DependenciasGestor) {
    // En capas, sin ciclos: cada operación recibe el núcleo y las de debajo.
    this.n = new NucleoSesiones(deps)
    const proc = new Procesos(this.n)
    const esq = new EsquemaConsola(this.n)
    const ap = new Apertura(this.n, proc, esq)
    const res = new ResultadoSentencia(this.n, proc, ap)
    this.lec = new LectoresSesion(this.n, ap)
    this.cat = new CatalogoSesion(this.n, ap)
    this.tabla = new TablaSesion(this.n, proc, ap)
    this.consola = new ConsolaSesion(this.n, esq, ap, res)
    this.expl = new ExplicarSesion(this.n, ap)
    this.tx = new Transacciones(this.n, proc, esq, ap)
    this.expTabla = new ExportarTabla(this.n, ap, this.tabla)
    this.expConsulta = new ExportarConsulta(this.n, ap, this.expTabla)
    this.envio = new EnvioRejilla(this.n, ap)
    this.conexion = new ConexionSesiones(this.n, proc, this.tx)
    this.ciclo = new CicloDeVida(this.n, proc, this.tx)
  }

  /**
   * Fija los ajustes del usuario, re-saneados con la regla compartida (`sanearAjustesSesiones`)
   * por lo que rompería al gestor en silencio (un umbral NaN, un modo que no existe). No lanza.
   */
  fijarAjustes(a: AjustesSesionesBd): void {
    this.n.fijarAjustes(sanearAjustesSesiones(a))
  }

  /** Corre `fn` como UNA tarea de la cola de `meta`; tras una pérdida se reintenta una vez. */
  catalogo<T>(conexionId: string, fn: (ctx: ContextoCatalogo) => Promise<T>, op?: { prioridad?: PrioridadCola; clave?: string; base?: string }): Promise<T> {
    return this.cat.catalogo(conexionId, fn, op)
  }

  /** Primera página de una pestaña de tabla, en la sesión `datos`. */
  leerTabla(req: PeticionTabla): Promise<DbRespuesta<DbResultadoFilas | DbResultadoError>> {
    return this.tabla.leerTabla(req)
  }

  /** Siguiente página de un lector (cursor vivo, o re-ejecución si es releíble). */
  leerMas(id: string, maxFilas: number, peticionId?: string): Promise<DbRespuesta<DbPagina>> {
    return this.lec.leerMas(id, maxFilas, peticionId)
  }

  /** COUNT(*) bajo demanda, en la sesión del lector. */
  contar(id: string, peticionId: string): Promise<DbRespuesta<number>> {
    return this.lec.contar(id, peticionId)
  }

  /** Suelta un lector (pestaña de resultado sustituida o cerrada). Nunca falla. */
  cerrarLector(id: string): Promise<void> {
    return this.n.cerrarLector(id)
  }

  /** Ejecuta UNA sentencia de consola, que el main vuelve a partir y a validar. */
  ejecutarConsola(req: DbEjecutarConsola & { conexionId: string }): Promise<DbRespuesta<DbResultadoSentencia>> {
    return this.consola.ejecutarConsola(req)
  }

  /** El plan de UNA sentencia de consola, sin ejecutarla. */
  explicar(req: DbExplicar & { conexionId: string }): Promise<DbRespuesta<DbPlan>> {
    return this.expl.explicar(req)
  }

  /** Commit / Rollback de una consola (el COMMIT en producción exige `confirmado`). */
  txConsola(ref: RefConsola, accion: DbResolverTx, confirmado?: boolean): Promise<DbRespuesta<DbEstadoSesion>> {
    return this.tx.txConsola(ref, accion, confirmado)
  }

  /** Cambia el modo de transacción (Manual -> Auto con tx viva exige `resolver`). */
  modoTx(ref: RefConsola, modo: DbTxModo, resolver?: DbResolverTx): Promise<DbRespuesta<DbEstadoSesion>> {
    return this.tx.modoTx(ref, modo, resolver)
  }

  /** Estado de la sesión de una consola; null si todavía no tiene. */
  estadoConsola(perfilId: string, consolaId: string): DbEstadoSesion | null {
    return this.tx.estadoConsola(perfilId, consolaId)
  }

  /** Cierra la sesión de una consola y olvida su estado (modo incluido). */
  cerrarSesionConsola(perfilId: string, consolaId: string, resolver?: DbResolverTx): Promise<DbRespuesta<void>> {
    return this.tx.cerrarSesionConsola(perfilId, consolaId, resolver)
  }

  /** Fija el esquema de una consola (`null` = el de la conexión); `anterior` es al que se vuelve. */
  fijarEsquemaConsola(ref: RefConsola, esquema: string | null, anterior?: string | null): Promise<DbRespuesta<DbEstadoSesion>> {
    return this.tx.fijarEsquemaConsola(ref, esquema, anterior)
  }

  /** Lee UNA celda entera, en la sesión que ve su transacción. */
  leerValor(req: PeticionValor): Promise<DbRespuesta<ResultadoFilasTrabajador>> {
    return this.expConsulta.leerValor(req)
  }

  /** Exporta la tabla ENTERA con su filtro, en una sesión efímera propia. Lanza `ErrorGestor`. */
  exportarTabla(req: PeticionTabla, consumir: ConsumidorPaginas, cancelada: () => boolean): Promise<{ aviso?: string }> {
    return this.expTabla.exportarTabla(req, consumir, cancelada)
  }

  /** ¿Se puede volver a ejecutar este texto para exportarlo? Lanza `ErrorGestor`; sin efectos. */
  validarExportacionConsulta(
    ref: RefConsola,
    sql: string,
    esquema?: string | null,
    bindsCrudos?: DbBinds
  ): { con: DbConnection; d: DialectoSql; st: Sentencia; binds: BindsSalientes | undefined } {
    return this.expConsulta.validarExportacionConsulta(ref, sql, esquema, bindsCrudos)
  }

  /** Exporta UNA consulta de consola volviéndola a ejecutar en SU sesión, con un solo cursor. */
  exportarConsulta(
    req: RefConsola & { sql: string; peticionId: string; topes: TopesLectura; esquema?: string | null; binds?: DbBinds },
    consumir: ConsumidorPaginas,
    cancelada: () => boolean
  ): Promise<void> {
    return this.expConsulta.exportarConsulta(req, consumir, cancelada)
  }

  /** «Enviar» de la rejilla: todo o nada en una sesión efímera propia. */
  enviarCambios(req: PeticionEnvio): Promise<DbRespuesta<DbResultadoEnvio>> {
    return this.envio.enviarCambios(req)
  }

  /** Stop. Se ignora si la clave no es la de la operación activa (o en espera). */
  cancelar(req: DbCancelar): void {
    return this.conexion.cancelar(req)
  }

  /** Forzar: mata el proceso de la conexión, o solo el de la consola donde tiene uno propio. */
  forzar(conexionId: string, consola?: { perfilId: string; consolaId: string }): void {
    return this.conexion.forzar(conexionId, consola)
  }

  /** Cierra todas las sesiones y el proceso de una conexión. */
  desconectar(conexionId: string, resolver?: DbResolverTx): Promise<DbRespuesta<DbResolucionBloque>> {
    return this.conexion.desconectar(conexionId, resolver)
  }

  /** Las sesiones que ve el renderer (sin las internas). */
  sesiones(): DbEstadoSesion[] {
    return this.conexion.sesiones()
  }

  /** Barrido periódico: inactividad, conexiones borradas y procesos sin sesiones. */
  barrer(ahora?: number): void {
    return this.ciclo.barrer(ahora)
  }

  /** Sesiones con cambios sin confirmar o una transacción fallida sin resolver. */
  pendientes(): Array<{ ref: DbRefSesion; conexionId: string; tx: DbEstadoTx }> {
    return this.ciclo.pendientes()
  }

  /** ¿Hay alguna transacción pendiente (en esa conexión, si se da)? */
  hayTxPendiente(conexionId?: string): boolean {
    return this.ciclo.hayTxPendiente(conexionId)
  }

  /** Confirma o revierte TODAS las transacciones pendientes (diálogo de salida). */
  resolverTodas(accion: DbResolverTx, plazoMs?: number): Promise<ResolucionTodas> {
    return this.ciclo.resolverTodas(accion, plazoMs)
  }

  /** Cierre de la app: `salir` a cada proceso y, pasado el plazo, SIGKILL. */
  cerrarTodo(plazoMs?: number): Promise<void> {
    return this.ciclo.cerrarTodo(plazoMs)
  }

  /** Deshace el pestillo de `cerrarTodo` cuando el cierre se aborta. */
  reanudarTrasCierreAbortado(): void {
    return this.ciclo.reanudarTrasCierreAbortado()
  }

  /** La conexión se editó: se retiran sus procesos y sus consolas toman el modo que toque. */
  alCambiarConexion(previo: DbConnection, nuevo: DbConnection): void {
    return this.ciclo.alCambiarConexion(previo, nuevo)
  }

  /** La conexión se borró: fuera sus sesiones y su proceso. */
  alBorrarConexion(conexionId: string): void {
    return this.ciclo.alBorrarConexion(conexionId)
  }

  /** Antes de instalar u olvidar un cliente de BD: cierra los procesos que lo tienen cargado. */
  cerrarProcesosDelDriver(packId: string): Promise<void> {
    return this.ciclo.cerrarProcesosDelDriver(packId)
  }

  /** Procesos lanzados que aún no han salido (pruebas y diagnóstico). */
  procesosVivos(): number {
    return this.ciclo.procesosVivos()
  }
}
