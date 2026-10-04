// =============================================================================
// Valor completo de una celda y exportación a archivo (origen filas, consulta o tabla).
// Valida el origen antes de abrir el diálogo de guardar; la escritura vive en `exportacion.ts`.
// Decisiones: docs/decisiones/bd/sesiones-exportar-con-cursor-vivo.md
// =============================================================================

import type { BrowserWindow } from 'electron'

import {
  DB_CONSOLA_MAX_BYTES,
  DB_PAGINA_MAX,
  type DbBinds,
  type DbCelda,
  type DbColumnaInfo,
  type DbErrorSql,
  type DbExportado,
  type DbFormatoFilas,
  type DbRefObjeto,
  type DbRespuesta,
  type DbTxModo,
  type DbValor,
  TIPOS_CON_DATOS
} from '../../../../shared/db-explorador-ipc.ts'
import type { DbMotor } from '../../../../shared/db-ipc.ts'
import { descriptorSql, esMotor } from '../../../../shared/motores/index.ts'
import { dialectoDeMotor } from '../../../../shared/sql/dialectosSql.ts'

import { filasDePagina, type OpcionesDialogoGuardar, type ProductorExportacion } from '../exportacion.ts'
import { ErrorGestor, MENSAJE_FILA_DESAPARECIDA, type RefConsola } from '../GestorSesiones.ts'
import { construirConsultaTabla, detalleDeErrorRejilla, esErrorRejilla } from '../sqlRejilla.ts'
import { columnasClave, construirConsultaValor, esErrorValor, valorDeLectura } from '../valorCelda.ts'

import type { ConsolaExplorador } from './consola.ts'
import type { ObjetosExplorador } from './objetos.ts'
import type { TablaExplorador } from './tabla.ts'
import type { ContextoExplorador } from './tipos.ts'
import {
  columnasExportables,
  esCelda,
  esObjeto,
  exigir,
  fallo,
  filtroYOrden,
  FORMATOS,
  MAX_FRAGMENTO,
  MAX_IDENT,
  ok,
  opcional,
  TOPES_EXPORTACION,
  TOPES_VALOR
} from './validacion.ts'

/** Lo que pide `valor`, ya validado. */
interface PedidoValor {
  id: string
  objeto: DbRefObjeto
  columna: string
  clave: DbCelda[]
  consola?: RefConsola
}

/**
 * La consulta que relee la celda por la PK del catálogo: las columnas de la clave salen de allí, del
 * renderer solo los valores. Un fallo si la columna pedida no existe o no se puede construir.
 */
function consultaDeValor(
  motor: DbMotor,
  destino: DbRefObjeto,
  columna: string,
  columnas: DbColumnaInfo[],
  pk: string[],
  clave: DbCelda[]
): { sql: string; binds: string[] } | { ok: false; error: DbErrorSql } {
  if (!columnas.some((c) => c.nombre === columna)) {
    return fallo('interno', `La columna ${columna} no existe en ${destino.esquema}.${destino.nombre}.`)
  }
  const d = dialectoDeMotor(motor)
  const c = construirConsultaValor({
    dialecto: d,
    esquema: destino.esquema,
    nombre: destino.nombre,
    columna,
    pk: columnasClave(pk, columnas, d),
    clave,
    ...(destino.base ? { base: destino.base } : {})
  })
  return esErrorValor(c) ? fallo('interno', c.error) : c
}

/** Valor completo de una celda y exportación a archivo (origen filas, consulta o tabla). */
export class ExportarExplorador {
  private readonly c: ContextoExplorador
  private readonly catalogo: ObjetosExplorador
  private readonly pestana: TablaExplorador
  private readonly sesionConsola: ConsolaExplorador

  constructor(c: ContextoExplorador, catalogo: ObjetosExplorador, pestana: TablaExplorador, sesionConsola: ConsolaExplorador) {
    this.c = c
    this.catalogo = catalogo
    this.pestana = pestana
    this.sesionConsola = sesionConsola
  }

  /**
   * El valor ENTERO de una celda, buscando la fila por su PK. Del renderer solo se
   * fían los VALORES de la clave: las columnas de la PK y la pedida salen del
   * catálogo. Vale igual para una pestaña de tabla que para un resultado de consola
   * (el renderer manda `{esquema, nombre, tipo:'tabla'}`), con una diferencia: el de
   * consola trae `consola` y se lee en la sesión de ESA consola, no en `datos`. Cada espera va
   * aquí, en el cuerpo: en funciones `async` aparte sumaría turnos antes de encolar la lectura.
   */
  async valor(req: unknown): Promise<DbRespuesta<DbValor>> {
    return this.c.seguro(async () => {
      const pedido = this.pedidoDeValor(req)
      if ('ok' in pedido) return pedido
      const { id, objeto, columna, clave, consola } = pedido
      // De un resultado de CONSOLA se relee en SU sesión, que ve su transacción sin confirmar;
      // atada a ESTA conexión: el renderer no puede usar una consola para leer por otra.
      if (consola && (await this.sesionConsola.conexionDeConsola(consola.perfilId, consola.consolaId)) !== id) {
        return fallo('interno', 'Esa consola no es de esta conexión.')
      }
      const con = this.c.conexionOError(id)
      let destino: DbRefObjeto = objeto
      if (objeto.tipo === 'sinonimo') {
        const r = await this.catalogo.resolverSinonimo(id, objeto.esquema, objeto.nombre, objeto.base)
        if (r.dblink) return fallo('noReleible', 'Un objeto remoto (@dblink) no tiene una clave primaria que Tessera pueda leer.')
        destino = r.objeto
      }
      const pk = await this.catalogo.clavePrimaria(id, destino)
      if (pk.length === 0) {
        return fallo('noReleible', 'La tabla no tiene clave primaria: no hay forma fiable de volver a encontrar la fila.')
      }
      const c = consultaDeValor(con.motor, destino, columna, await this.catalogo.columnasDe(id, destino), pk, clave)
      if ('ok' in c) return c
      const r = await this.c.gestor.leerValor({ conexionId: id, sql: c.sql, binds: c.binds, topes: TOPES_VALOR, ...(consola ? { consola } : {}) })
      if (!r.ok) return r
      const v = valorDeLectura(r.valor)
      return v === null ? fallo('noReleible', MENSAJE_FILA_DESAPARECIDA) : ok(v)
    })
  }

  /**
   * Lo que pide `valor`, validado en el orden de siempre (lanza como `exigir` y `refObjeto`). La
   * consola, si la hay, sin comprobar aún que es de esta conexión: eso espera al registro.
   */
  private pedidoDeValor(req: unknown): PedidoValor | { ok: false; error: DbErrorSql } {
    if (!esObjeto(req)) return fallo('interno', 'Petición inválida.')
    const id = exigir(req.conexionId, 'conexionId')
    const objeto = this.c.refObjeto(req.objeto, id)
    const columna = exigir(req.columna, 'columna')
    const clave = req.clave
    if (!Array.isArray(clave) || clave.length > 64 || !clave.every(esCelda)) {
      return fallo('interno', 'Petición inválida: «clave».')
    }
    if (TIPOS_CON_DATOS.indexOf(objeto.tipo) < 0) return fallo('interno', 'Ese objeto no tiene datos que enseñar.')
    if (req.consola === undefined) return { id, objeto, columna, clave: clave as DbCelda[] }
    const dato = req.consola
    if (!esObjeto(dato)) return fallo('interno', 'Petición inválida: «consola».')
    const perfilId = exigir(dato.perfilId, 'perfilId')
    const consolaId = exigir(dato.consolaId, 'consolaId')
    // `txInicial`: por si la lectura crea la sesión (`RefConsola.txInicial`).
    const consola: RefConsola = { perfilId, consolaId, conexionId: id, txInicial: dato.txInicial as DbTxModo | undefined }
    return { id, objeto, columna, clave: clave as DbCelda[], consola }
  }

  /**
   * Exportar a archivo: valida el origen ANTES de abrir el diálogo (un WHERE roto o
   * una consulta que no se puede repetir no deben pedir antes dónde guardar), abre el
   * diálogo sobre la ventana del emisor y escribe por páginas (ver `exportacion.ts`).
   * `null` = el usuario canceló el diálogo. Stop: `CANCELAR` con rol `exportacion`.
   */
  async exportar(req: unknown, ventana: BrowserWindow | null = null): Promise<DbRespuesta<DbExportado | null>> {
    return this.c.seguro(async () => {
      if (!esObjeto(req)) return fallo('interno', 'Petición inválida.')
      const peticionId = exigir(req.peticionId, 'peticionId', 200)
      const formato = req.formato as DbFormatoFilas
      if (FORMATOS.indexOf(formato) < 0) return fallo('interno', 'Petición inválida: «formato».')
      if (!esMotor(req.motor)) return fallo('interno', 'Petición inválida: «motor».')
      const nombreSugerido = typeof req.nombreSugerido === 'string' ? req.nombreSugerido.slice(0, MAX_IDENT) : ''
      const tablaInsert = opcional(req.tablaInsert, 'tablaInsert', MAX_IDENT * 3)
      if (!esObjeto(req.origen)) return fallo('interno', 'Petición inválida: falta «origen».')
      if (this.c.exportador.enMarcha(peticionId)) return fallo('ocupada', 'Esa exportación ya está en curso.')
      const origen = req.origen
      // El productor se arma DENTRO de la exportación ya apuntada (`preparar`): lee el
      // catálogo (la PK, el sinónimo) y un Stop en ese tramo tiene que valer, o el
      // diálogo de guardar se abriría sobre una pestaña ya cerrada. `exportar` apunta la
      // petición antes de su primer `await`, en este mismo turno.
      const exportado = await this.c.exportador.exportar({
        peticionId,
        formato,
        nombreSugerido,
        motor: req.motor,
        ...(tablaInsert !== undefined ? { tablaInsert } : {}),
        preparar: () => this.productorExportacion(origen, peticionId),
        ventana
      })
      return ok(exportado)
    })
  }

  /** Valida el origen y devuelve quién produce sus páginas. Lanza `ErrorGestor`. */
  private async productorExportacion(o: Record<string, unknown>, peticionId: string): Promise<ProductorExportacion> {
    if (o.tipo === 'filas') return this.productorFilas(o)
    if (o.tipo === 'consulta') return this.productorConsulta(o, peticionId)
    if (o.tipo === 'tabla') return this.productorTabla(o, peticionId)
    throw new ErrorGestor('interno', 'Petición inválida: origen desconocido.')
  }

  /** Origen `filas`: las que el renderer ya tiene, validadas. */
  private productorFilas(o: Record<string, unknown>): ProductorExportacion {
    const columnas = columnasExportables(o.columnas)
    if (!columnas) throw new ErrorGestor('interno', 'Petición inválida: «columnas».')
    if (typeof o.filasJson !== 'string') throw new ErrorGestor('interno', 'Petición inválida: falta «filasJson».')
    const filasJson = o.filasJson
    filasDePagina(filasJson)
    return async (consumir) => {
      await consumir({ columnas, filasJson })
    }
  }

  /** Origen `consulta`: se vuelve a ejecutar en la sesión de su consola. */
  private async productorConsulta(o: Record<string, unknown>, peticionId: string): Promise<ProductorExportacion> {
    const perfilId = exigir(o.perfilId, 'perfilId')
    const consolaId = exigir(o.consolaId, 'consolaId')
    if (typeof o.sql !== 'string' || o.sql.length > DB_CONSOLA_MAX_BYTES) {
      throw new ErrorGestor('interno', 'Petición inválida: «sql».')
    }
    const sql = o.sql
    // El esquema en que se ejecutó (opcional): en otro, la consulta leería otra tabla.
    if (o.esquema !== undefined && o.esquema !== null && (typeof o.esquema !== 'string' || o.esquema.length > MAX_IDENT)) {
      throw new ErrorGestor('interno', 'Petición inválida: «esquema».')
    }
    const esquema = typeof o.esquema === 'string' ? o.esquema : null
    // Los parámetros con los que se ejecutó; el gestor valida su forma y exige los que falten.
    const binds = o.binds as DbBinds | undefined
    const conexionId = await this.sesionConsola.conexionDeConsola(perfilId, consolaId)
    this.c.gestor.validarExportacionConsulta({ perfilId, consolaId, conexionId }, sql, esquema, binds)
    return async (consumir, cancelada) => {
      await this.c.gestor.exportarConsulta(
        // `txInicial`: por si la exportación crea la sesión (`RefConsola.txInicial`).
        {
          perfilId,
          consolaId,
          conexionId,
          txInicial: o.txInicial as DbTxModo | undefined,
          sql,
          peticionId,
          topes: TOPES_EXPORTACION,
          esquema,
          binds
        },
        consumir,
        cancelada
      )
    }
  }

  /** Origen `tabla`: el mismo SQL que la pestaña, validado ANTES del diálogo. */
  private async productorTabla(o: Record<string, unknown>, peticionId: string): Promise<ProductorExportacion> {
    const id = exigir(o.conexionId, 'conexionId')
    const objeto = this.c.refObjeto(o.objeto, id)
    if (TIPOS_CON_DATOS.indexOf(objeto.tipo) < 0) throw new ErrorGestor('interno', 'Ese objeto no tiene datos que exportar.')
    const where = opcional(o.where, 'where', MAX_FRAGMENTO) ?? null
    const orderBy = opcional(o.orderBy, 'orderBy', MAX_FRAGMENTO) ?? null
    // El mismo filtro guiado y orden que la pestaña, validados igual.
    const guiado = filtroYOrden(o.filtro, o.orden)
    const con = this.c.conexionOError(id)
    let destino: DbRefObjeto = objeto
    let dblink: string | null = null
    if (objeto.tipo === 'sinonimo') {
      const r = await this.catalogo.resolverSinonimo(id, objeto.esquema, objeto.nombre, objeto.base)
      destino = r.objeto
      dblink = r.dblink
    }
    const pk = dblink ? [] : await this.catalogo.clavePrimaria(id, destino)
    const d = dialectoDeMotor(con.motor)
    const objetoRejilla = { esquema: destino.esquema, nombre: destino.nombre, dblink, ...(destino.base ? { base: destino.base } : {}) }
    // La forma de paginar sale de la MISMA clave (`d`) con la que `construirConsultaTabla` valida y
    // con la que el gestor exporta: dos claves en una decisión solo coincidirían por casualidad.
    const previa = construirConsultaTabla({
      dialecto: d,
      objeto: objetoRejilla,
      where,
      orderBy,
      ...guiado,
      pkColumnas: pk,
      n: 1,
      desde: 0,
      forma: descriptorSql(d).sesion.paginado.rejilla
    })
    if (esErrorRejilla(previa)) {
      throw new ErrorGestor(previa.campo ? 'servidor' : 'interno', previa.error, detalleDeErrorRejilla(previa))
    }
    // SQLite ('keyset'): la clave con que se exporta por páginas sin repetir ni saltar filas.
    const paginado = await this.pestana.paginadoDe(id, con, destino, pk, dblink !== null)
    return (consumir, cancelada) =>
      this.c.gestor.exportarTabla(
        {
          conexionId: id,
          peticionId,
          objeto: objetoRejilla,
          where,
          orderBy,
          ...guiado,
          pk,
          maxFilas: DB_PAGINA_MAX,
          topes: TOPES_EXPORTACION,
          ...(paginado ? { clave: paginado.clave } : {})
        },
        consumir,
        cancelada
      )
  }

  /** «Mostrar en la carpeta» de una exportación (por su token). */
  revelarExportacion(token: unknown): void {
    if (typeof token === 'string' && token) this.c.exportador.revelar(token)
  }

  async dialogoGuardar(op: OpcionesDialogoGuardar, win: BrowserWindow | null): Promise<string | null> {
    const guardar = this.c.opciones.guardarArchivo
    if (!guardar) throw new ErrorGestor('interno', 'No hay diálogo de guardar en este entorno.')
    const valida = win && !win.isDestroyed() ? win : null
    const r = await guardar(valida, {
      title: op.titulo,
      // Solo el nombre: la carpeta la pone `guardarArchivo` (ver `exportacion.ts`).
      defaultPath: op.nombrePropuesto,
      filters: op.filtros,
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    return r.canceled || !r.filePath ? null : r.filePath
  }
}
