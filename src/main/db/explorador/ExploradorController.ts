// =============================================================================
// Fachada del explorador de bases de datos en el main: guarda el estado y las piezas (gestor de sesiones, caché de
// catálogo, consolas, historial, exportador) y expone cada operación de sus módulos de `controlador/`.
// No importa Electron como valor: todo lo nativo llega inyectado por `OpcionesExplorador`. Sus canales los registra `ipc.ts`.
// Decisiones: docs/decisiones/bd/explorador-controlador.md
// =============================================================================

import type { BrowserWindow, WebContents } from 'electron'

import type { DbErrorSql, DbRefObjeto, DbRespuesta } from '../../../shared/db-explorador-ipc.ts'
import type { DbConnection } from '../../../shared/db-ipc.ts'
import { descriptorSql, esMotor, esMotorSql, tieneNivelBases } from '../../../shared/motores/index.ts'

import { emisorDeVentana } from '../../util/emisorEventos.ts'
import { dbLog } from '../dbLog.ts'
import { SintaxisLocal } from '../sintaxisLocal.ts'

import type { CacheCatalogo } from './CacheCatalogo.ts'
import { type ConsolasStore, ErrorConsolas } from './ConsolasStore.ts'
import { ArchivosConsola } from './controlador/archivosConsola.ts'
import { ConsolaExplorador } from './controlador/consola.ts'
import { EsquemasExplorador } from './controlador/esquemas.ts'
import { EstadoExplorador } from './controlador/estado.ts'
import { ExportarExplorador } from './controlador/exportar.ts'
import { ObjetosExplorador } from './controlador/objetos.ts'
import {
  crearCache,
  crearConsolas,
  crearExportador,
  crearGestor,
  crearHistorial
} from './controlador/piezas.ts'
import { SalidaExplorador } from './controlador/salida.ts'
import { TablaExplorador } from './controlador/tabla.ts'
import type {
  ConexionesExplorador,
  ContextoExplorador,
  OpcionesExplorador,
  RegistroExplorador
} from './controlador/tipos.ts'
import {
  esObjeto,
  exigir,
  fallo,
  MAX_IDENT,
  mensajeDe,
  opcional,
  TIPOS_OBJETO
} from './controlador/validacion.ts'
import type { Exportador } from './exportacion.ts'
import { falloTodaviaNo, mensajeTodaviaNo } from './familias.ts'
import { ErrorGestor, type GestorSesiones } from './GestorSesiones.ts'
import type { HistorialStore } from './HistorialStore.ts'

export type {
  ConexionesExplorador,
  GestorClavesDelegado,
  GestorDocumentosDelegado,
  OpcionesExplorador,
  RegistroExplorador
} from './controlador/tipos.ts'
export { fusionarIndices } from './controlador/validacion.ts'

/** Controlador del explorador: cada método público es una operación de un canal `DBX_CHANNELS`. */
export class ExploradorController implements ContextoExplorador {
  readonly gestor: GestorSesiones
  readonly cache: CacheCatalogo
  readonly consolas: ConsolasStore
  readonly exportador: Exportador
  /** Historial de consultas; null si no se le dio carpeta. */
  readonly historial: HistorialStore | null
  readonly opciones: OpcionesExplorador
  readonly conexiones: ConexionesExplorador
  readonly registro: RegistroExplorador
  /** El estado compartido por los módulos, solo accesible por sus métodos. */
  readonly estado = new EstadoExplorador()
  /** La gramática local de la consola; carga perezosa. */
  readonly sintaxis = new SintaxisLocal({ log: (l) => this.log(l) })

  // Módulos por sección, en capas: cada uno recibe los de los que depende.
  private readonly arbol = new EsquemasExplorador(this)
  private readonly catalogo = new ObjetosExplorador(this)
  private readonly pestana = new TablaExplorador(this, this.catalogo)
  private readonly sesionConsola = new ConsolaExplorador(this, this.arbol)
  private readonly exportacion = new ExportarExplorador(this, this.catalogo, this.pestana, this.sesionConsola)
  private readonly archivos = new ArchivosConsola(this, this.sesionConsola)
  private readonly salida = new SalidaExplorador(this, this.pestana)

  // Árbol y catálogo
  readonly esquemas = this.arbol.esquemas.bind(this.arbol)
  readonly fijarEsquemas = this.arbol.fijarEsquemas.bind(this.arbol)
  readonly bases = this.arbol.bases.bind(this.arbol)
  readonly fijarBases = this.arbol.fijarBases.bind(this.arbol)
  readonly resumen = this.arbol.resumen.bind(this.arbol)
  readonly objetos = this.arbol.objetos.bind(this.arbol)
  readonly nombres = this.arbol.nombres.bind(this.arbol)
  readonly nombresPublicos = this.arbol.nombresPublicos.bind(this.arbol)
  readonly refrescar = this.arbol.refrescar.bind(this.arbol)
  readonly detalle = this.catalogo.detalle.bind(this.catalogo)
  readonly resolver = this.catalogo.resolver.bind(this.catalogo)
  readonly fuente = this.catalogo.fuente.bind(this.catalogo)
  readonly ddl = this.catalogo.ddl.bind(this.catalogo)
  readonly fks = this.catalogo.fks.bind(this.catalogo)
  // Pestaña de tabla, lectores, valor y exportación
  readonly abrirTabla = this.pestana.abrirTabla.bind(this.pestana)
  readonly enviarCambios = this.pestana.enviarCambios.bind(this.pestana)
  readonly leerMas = this.pestana.leerMas.bind(this.pestana)
  readonly contar = this.pestana.contar.bind(this.pestana)
  readonly cerrarLector = this.pestana.cerrarLector.bind(this.pestana)
  readonly valor = this.exportacion.valor.bind(this.exportacion)
  readonly exportar = this.exportacion.exportar.bind(this.exportacion)
  readonly revelarExportacion = this.exportacion.revelarExportacion.bind(this.exportacion)
  // Consola SQL e historial
  readonly ejecutar = this.sesionConsola.ejecutar.bind(this.sesionConsola)
  readonly explicar = this.sesionConsola.explicar.bind(this.sesionConsola)
  readonly tx = this.sesionConsola.tx.bind(this.sesionConsola)
  readonly modoTx = this.sesionConsola.modoTx.bind(this.sesionConsola)
  readonly estadoConsola = this.sesionConsola.estadoConsola.bind(this.sesionConsola)
  readonly cerrarSesionConsola = this.sesionConsola.cerrarSesionConsola.bind(this.sesionConsola)
  readonly esquemaConsola = this.sesionConsola.esquemaConsola.bind(this.sesionConsola)
  readonly historialListar = this.sesionConsola.historialListar.bind(this.sesionConsola)
  readonly historialBorrar = this.sesionConsola.historialBorrar.bind(this.sesionConsola)
  // Conexión y archivos de consola
  readonly cancelar = this.archivos.cancelar.bind(this.archivos)
  readonly forzar = this.archivos.forzar.bind(this.archivos)
  readonly desconectar = this.archivos.desconectar.bind(this.archivos)
  readonly sesiones = this.archivos.sesiones.bind(this.archivos)
  readonly listarConsolas = this.archivos.listarConsolas.bind(this.archivos)
  readonly crearConsola = this.archivos.crearConsola.bind(this.archivos)
  readonly leerConsola = this.archivos.leerConsola.bind(this.archivos)
  readonly escribirConsola = this.archivos.escribirConsola.bind(this.archivos)
  readonly renombrarConsola = this.archivos.renombrarConsola.bind(this.archivos)
  readonly borrarConsola = this.archivos.borrarConsola.bind(this.archivos)
  // Ganchos de `DbController` y ciclo de vida
  readonly alCambiarConexion = this.salida.alCambiarConexion.bind(this.salida)
  readonly alBorrarConexion = this.salida.alBorrarConexion.bind(this.salida)
  readonly alOlvidarConexionEnPerfil = this.salida.alOlvidarConexionEnPerfil.bind(this.salida)
  readonly alBorrarPerfil = this.salida.alBorrarPerfil.bind(this.salida)
  readonly podarHistorial = this.salida.podarHistorial.bind(this.salida)
  readonly puedeEditarConexion = this.salida.puedeEditarConexion.bind(this.salida)
  readonly antesDeCambiarDriver = this.salida.antesDeCambiarDriver.bind(this.salida)
  readonly fijarAjustes = this.salida.fijarAjustes.bind(this.salida)
  readonly barrer = this.salida.barrer.bind(this.salida)
  readonly confirmarSalida = this.salida.confirmarSalida.bind(this.salida)
  readonly vaciarConsolas = this.salida.vaciarConsolas.bind(this.salida)
  readonly cerrarTodo = this.salida.cerrarTodo.bind(this.salida)
  readonly reanudarTrasCierreAbortado = this.salida.reanudarTrasCierreAbortado.bind(this.salida)
  readonly alSinEnviar = this.salida.alSinEnviar.bind(this.salida)
  readonly alAcuseVaciado = this.salida.alAcuseVaciado.bind(this.salida)

  constructor(opciones: OpcionesExplorador) {
    this.opciones = opciones
    this.conexiones = opciones.conexiones
    this.registro = opciones.registro
    this.cache = crearCache(this)
    this.consolas = crearConsolas(this)
    this.historial = crearHistorial(this)
    this.gestor = crearGestor(this, this.historial)
    this.exportador = crearExportador(this, (op, ventana) => this.exportacion.dialogoGuardar(op, ventana))
  }

  /** Escribe una línea en el registro; el registro no puede romper lo que registra. */
  log(linea: string): void {
    try {
      if (this.opciones.log) this.opciones.log(linea)
      else dbLog('explorador', linea)
    } catch {
      // el registro no puede romper lo que registra
    }
  }

  /** Emite un evento al renderer (o al `emitir` inyectado en las pruebas). */
  emitir(canal: string, payload?: unknown): void {
    if (this.opciones.emitir) {
      this.opciones.emitir(canal, payload)
      return
    }
    emisorDeVentana(() => this.opciones.getWindow()).emitir(canal, payload)
  }

  /** Cualquier error -> `ok:false` con un mensaje seguro (sin rutas del host). */
  aFallo(e: unknown): { ok: false; error: DbErrorSql } {
    if (e instanceof ErrorGestor) return { ok: false, error: e.error }
    if (e instanceof ErrorConsolas) return fallo(e.codigo === 'tamano' ? 'limite' : 'interno', e.message)
    this.log(`error inesperado: ${mensajeDe(e).slice(0, 200)}`)
    return fallo('interno', 'Error interno del explorador de bases de datos.')
  }

  /** Ejecuta `fn` y convierte lo que lance en una respuesta de error. */
  async seguro<T>(fn: () => Promise<DbRespuesta<T>>): Promise<DbRespuesta<T>> {
    try {
      return await fn()
    } catch (e) {
      return this.aFallo(e)
    }
  }

  /** La conexión SQL con ese id; lanza si no existe o es de otra familia de motor. */
  conexionOError(id: string): DbConnection {
    const con = this.conexiones.get(id)
    if (!con) throw new ErrorGestor('interno', 'La conexión ya no existe.')
    // Todo lo que resuelve la conexión por aquí es SQL: MongoDB o Redis se rechazan con su motivo.
    if (!esMotorSql(con.motor)) throw new ErrorGestor('driver', mensajeTodaviaNo(con.motor))
    return con
  }

  /**
   * El rechazo de una petición SQL que nombra una conexión de otra familia (MongoDB, Redis), o
   * null. Una conexión que no existe pasa: cada camino da su «ya no existe».
   */
  rechazoOtraFamilia(r: Record<string, unknown>): { ok: false; error: DbErrorSql } | null {
    if (typeof r.conexionId !== 'string') return null
    const con = this.conexiones.get(r.conexionId)
    if (!con || !esMotor(con.motor) || esMotorSql(con.motor)) return null
    return falloTodaviaNo(con.motor)
  }

  /** Un `DbRefObjeto` validado; su `base` se comprueba contra la conexión. */
  refObjeto(v: unknown, conexionId: string): DbRefObjeto {
    if (!esObjeto(v)) throw new ErrorGestor('interno', 'Petición inválida: falta «objeto».')
    const tipo = v.tipo as DbRefObjeto['tipo']
    if (TIPOS_OBJETO.indexOf(tipo) < 0) throw new ErrorGestor('interno', 'Petición inválida: tipo de objeto desconocido.')
    const ref: DbRefObjeto = { esquema: exigir(v.esquema, 'esquema'), nombre: exigir(v.nombre, 'nombre'), tipo }
    const firma = opcional(v.firma, 'firma', 4000)
    if (firma !== undefined) ref.firma = firma
    // La base del nivel «Bases», validada contra su conexión. Un objeto sin ella no mira la conexión.
    if (v.base !== undefined && v.base !== null && v.base !== '') {
      const base = this.baseDe(this.conexionOError(conexionId), v.base)
      if (base !== undefined) ref.base = base
    }
    return ref
  }

  /**
   * La base de una petición, validada: solo una conexión con nivel «Bases» (SQL Server sin base
   * fija) la admite; ausente o vacía = la de la sesión.
   */
  baseDe(con: DbConnection, v: unknown): string | undefined {
    const base = opcional(v, 'base', MAX_IDENT)
    if (base === undefined || base === '') return undefined
    if (!tieneNivelBases(descriptorSql(con.motor), con)) {
      throw new ErrorGestor('interno', 'Esta conexión no tiene nivel «Bases»: la petición no puede llevar una base.')
    }
    return base
  }

  /** La ventana de quien envió una petición; cae a la principal si no se sabe o falla. */
  ventanaDelEmisor(emisor: WebContents | undefined): BrowserWindow | null {
    try {
      if (emisor && this.opciones.ventanaDe) return this.opciones.ventanaDe(emisor)
    } catch {
      // cae a la principal
    }
    return this.opciones.getWindow()
  }
}
