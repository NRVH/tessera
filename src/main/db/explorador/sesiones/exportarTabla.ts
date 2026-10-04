// =============================================================================
// Exportar una tabla entera: una lectura con cursor vivo en una sesión efímera propia, o por
// páginas en los motores sin cursor vivo. La sesión efímera se suelta siempre, y el cursor
// vivo se cierra siempre al acabar, al cancelar o al fallar.
// Decisiones: docs/decisiones/bd/sesiones-exportar-con-cursor-vivo.md
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import { DB_PAGINA_MAX, type DbColumnaResultado } from '../../../../shared/db-explorador-ipc.ts'
import type { CapacidadesSesion } from '../../../../shared/motores/index.ts'
import { nunca } from '../../../../shared/nunca.ts'
import { dialectoDeMotor, type DialectoSql } from '../../../../shared/sql/dialectosSql.ts'
import {
  type BindsTrabajador,
  esFalloTrabajador,
  type OpcionesEjecucion,
  type ResultadoFilasTrabajador,
  type ResultadoTrabajador
} from '../protocoloTrabajador.ts'
import {
  construirConsultaTabla,
  type ConsultaRejilla,
  detalleDeErrorRejilla,
  esErrorRejilla,
  type ValorClave
} from '../sqlRejilla.ts'
import type { Apertura } from './apertura.ts'
import { AVISO_EXPORTAR_POR_PAGINAS, ErrorGestor } from './errores.ts'
import type { NucleoSesiones } from './NucleoSesiones.ts'
import { capacidades, paginaExportada } from './reglas.ts'
import type { TablaSesion } from './tabla.ts'
import type { ConsumidorPaginas, PeticionTabla, Proceso, Sesion } from './tipos.ts'

/** Lo que recibe la tarea de cola de una exportación de tabla. */
interface LecturaExportacion {
  s: Sesion
  con: DbConnection
  req: PeticionTabla
  consumir: ConsumidorPaginas
  cancelada: () => boolean
  /** Apunta el proceso en que corre, para soltar la sesión efímera aunque se pierda. */
  usar: (p: Proceso) => void
}

/** Una página de la exportación por páginas: la de la rejilla, detrás de `despues` o desde `desde`. */
function consultaDePagina(d: DialectoSql, req: PeticionTabla, despues: ValorClave[] | null, desde: number): ConsultaRejilla {
  const c = construirConsultaTabla({
    dialecto: d,
    objeto: req.objeto,
    where: req.where ?? null,
    orderBy: req.orderBy ?? null,
    ...(req.filtro ? { filtro: req.filtro } : {}),
    ...(req.orden ? { orden: req.orden } : {}),
    pkColumnas: req.pk,
    n: DB_PAGINA_MAX + 1,
    desde,
    // 'keyset' en SQLite y 'offsetFetch' en SQL Server: la de la rejilla.
    forma: capacidades(d).paginado.rejilla,
    ...(req.clave ? { clave: req.clave, despues } : {})
  })
  if (esErrorRejilla(c)) {
    throw new ErrorGestor(c.campo ? 'servidor' : 'interno', c.error, detalleDeErrorRejilla(c))
  }
  return c
}

function opcionesDePagina(soloLectura: boolean, req: PeticionTabla, consulta: ConsultaRejilla): OpcionesEjecucion {
  const opciones: OpcionesEjecucion = {
    proposito: 'usuario',
    maxFilas: DB_PAGINA_MAX,
    candadoRO: soloLectura,
    sinBegin: true,
    comprobarTx: false,
    ...(req.topes ?? {})
  }
  if (consulta.columnasClave) opciones.claveAlFinal = consulta.columnasClave
  return opciones
}

/** Exportación de una tabla entera. */
export class ExportarTabla {
  private readonly n: NucleoSesiones
  private readonly ap: Apertura
  private readonly tabla: TablaSesion

  constructor(n: NucleoSesiones, ap: Apertura, tabla: TablaSesion) {
    this.n = n
    this.ap = ap
    this.tabla = tabla
  }

  /** Exporta la tabla ENTERA con su filtro, en una sesión efímera propia. Lanza `ErrorGestor`. */
  async exportarTabla(
    req: PeticionTabla,
    consumir: ConsumidorPaginas,
    cancelada: () => boolean
  ): Promise<{ aviso?: string }> {
    const con = this.n.conexionOError(req.conexionId)
    const aviso = await this.exportarTablaEfimera(con, dialectoDeMotor(con.motor), req, consumir, cancelada)
    // Una sola lectura (o por clave, sin repetir ni saltar filas): sin aviso. Solo lo lleva
    // la exportación por LIMIT/OFFSET con ORDER BY del usuario.
    return aviso ? { aviso } : {}
  }

  /**
   * La tabla entera en UNA lectura con cursor vivo en su sesión efímera. El SQL es el de la
   * pestaña, y un WHERE u ORDER BY que el servidor rechaza vuelve con su campo. PG, con
   * `LIMIT NULL` y `mantenerCursor`; Oracle, en su forma de cursor. Los motores sin cursor vivo
   * van por páginas (`exportarTablaPorPaginas`).
   */
  private async exportarTablaEfimera(
    con: DbConnection,
    d: DialectoSql,
    req: PeticionTabla,
    consumir: ConsumidorPaginas,
    cancelada: () => boolean
  ): Promise<string | undefined> {
    const cap = capacidades(d)
    const forma = cap.paginado.rejilla
    const consulta = construirConsultaTabla({
      dialecto: d,
      objeto: req.objeto,
      where: req.where ?? null,
      orderBy: req.orderBy ?? null,
      ...(req.filtro ? { filtro: req.filtro } : {}),
      ...(req.orden ? { orden: req.orden } : {}),
      pkColumnas: req.pk,
      n: 1,
      desde: 0,
      forma
    })
    if (esErrorRejilla(consulta)) {
      throw new ErrorGestor(consulta.campo ? 'servidor' : 'interno', consulta.error, detalleDeErrorRejilla(consulta))
    }
    // PG: `LIMIT $1 OFFSET $2` con $1 = NULL y $2 = 0, sin límite ni salto (un motor nuevo con
    // 'limitOffset' cuyo LIMIT no acepte NULL se decide aquí). ROWNUM no tiene forma «sin
    // límite»: exportar con ella leería UNA fila y daría el archivo por bueno, así que se rechaza.
    let binds: BindsTrabajador
    switch (forma) {
      case 'limitOffset': {
        // Los binds del filtro guiado van DELANTE: se cambian solo los dos últimos, que son
        // siempre los del LIMIT/OFFSET (`sqlRejilla`).
        const b = consulta.binds as unknown[]
        binds = [...b.slice(0, b.length - 2), null, 0] as BindsTrabajador
        break
      }
      case 'cursor':
        binds = consulta.binds as BindsTrabajador
        break
      case 'rownum':
        throw new ErrorGestor('interno', 'Exportar una tabla necesita leerla sin paginar: la forma ROWNUM no lo permite.')
      case 'keyset':
        // SQLite: un cursor vivo bloquearía a la aplicación dueña del archivo.
        return this.exportarTablaPorPaginas(con, d, req, consumir, cancelada)
      case 'offsetFetch':
        // SQL Server: una petición pausada dejaría bloqueos puestos mientras dura.
        return this.exportarTablaPorPaginas(con, d, req, consumir, cancelada)
      default:
        return nunca(forma, 'exportarTablaEfimera')
    }
    const s = this.n.sesionExportacion(con, req.peticionId)
    let usado: Proceso | null = null
    const usar = (p: Proceso): void => {
      usado = p
    }
    try {
      await s.cola.correr(() => this.leerConCursorVivo({ s, con, req, consumir, cancelada, usar }, cap, consulta, binds), {
        clave: req.peticionId
      })
    } catch (e) {
      throw this.ap.aErrorGestor(e)
    } finally {
      this.n.soltarSesionEfimera(s, usado)
    }
    return undefined
  }

  /** La tarea de cola de `exportarTablaEfimera`: una lectura y su cursor vivo volcado entero. */
  private async leerConCursorVivo(
    { s, con, req, consumir, cancelada, usar }: LecturaExportacion,
    cap: CapacidadesSesion,
    consulta: ConsultaRejilla,
    binds: BindsTrabajador
  ): Promise<void> {
    const t0 = Date.now()
    try {
      const p = await this.ap.empezar(s, req.peticionId)
      usar(p)
      let ok = false
      try {
        const opciones: OpcionesEjecucion = {
          proposito: 'usuario',
          maxFilas: DB_PAGINA_MAX,
          candadoRO: this.n.ro(con),
          sinBegin: true,
          comprobarTx: false,
          // Solo PG (`mantenerCursor`): en Oracle el cursor vivo es el `resultSet` de siempre.
          ...(cap.mantenerCursor ? { mantenerCursor: true } : {}),
          lector: this.n.nuevoIdLector(),
          ...(req.topes ?? {})
        }
        let r: ResultadoTrabajador
        try {
          r = await p.trabajador.enviar<'ejecutar'>({ op: 'ejecutar', sesion: s.idTrabajador, sql: consulta.sql, binds, opciones })
        } catch (e) {
          const fallido = this.tabla.errorDeTabla(s, p, consulta, e, t0)
          throw new ErrorGestor(fallido.error.motivo, fallido.error.mensaje, fallido.error)
        }
        if (r.tipo !== 'filas') throw new ErrorGestor('interno', 'La consulta de la tabla no devolvió filas.')
        await this.volcarCursorVivo(s, p, r, consumir, cancelada)
        ok = true
      } catch (e) {
        this.ap.tratarFallo(s, p, e)
        throw this.ap.aErrorGestor(e)
      } finally {
        if (s.estado.fase === 'ocupada') this.n.terminar(s, { clase: 'consulta', ok })
      }
    } finally {
      if (s.cancelada === req.peticionId) s.cancelada = null
    }
  }

  /**
   * Exportar una tabla de un motor SIN cursor vivo, por páginas en su sesión efímera y en una
   * sola tarea de su cola. Por la CLAVE si la hay (sin repetir ni saltar filas aunque alguien
   * escriba entretanto); sin clave o con ORDER BY del usuario, LIMIT/OFFSET, y el aviso lo dice.
   */
  private async exportarTablaPorPaginas(
    con: DbConnection,
    d: DialectoSql,
    req: PeticionTabla,
    consumir: ConsumidorPaginas,
    cancelada: () => boolean
  ): Promise<string | undefined> {
    // Se construye ANTES de abrir nada: un fragmento inválido no llega a pedir sesión.
    const primera = consultaDePagina(d, req, null, 0)
    const s = this.n.sesionExportacion(con, req.peticionId)
    let usado: Proceso | null = null
    const usar = (p: Proceso): void => {
      usado = p
    }
    try {
      await s.cola.correr(() => this.leerPorPaginas({ s, con, req, consumir, cancelada, usar }, d, primera), { clave: req.peticionId })
    } catch (e) {
      throw this.ap.aErrorGestor(e)
    } finally {
      this.n.soltarSesionEfimera(s, usado)
    }
    return primera.columnasClave ? undefined : AVISO_EXPORTAR_POR_PAGINAS
  }

  /** La tarea de cola de `exportarTablaPorPaginas`: pide páginas hasta agotar la tabla. */
  private async leerPorPaginas(
    { s, con, req, consumir, cancelada, usar }: LecturaExportacion,
    d: DialectoSql,
    primera: ConsultaRejilla
  ): Promise<void> {
    const t0 = Date.now()
    try {
      const p = await this.ap.empezar(s, req.peticionId)
      usar(p)
      let ok = false
      try {
        let consulta = primera
        let despues: ValorClave[] | null = null
        let desde = 0
        let columnas: DbColumnaResultado[] | null = null
        for (;;) {
          if (cancelada()) throw new ErrorGestor('cancelada', 'Exportación cancelada.')
          const opciones = opcionesDePagina(this.n.ro(con), req, consulta)
          let r: ResultadoTrabajador
          try {
            r = await p.trabajador.enviar<'ejecutar'>({
              op: 'ejecutar',
              sesion: s.idTrabajador,
              sql: consulta.sql,
              binds: consulta.binds as BindsTrabajador,
              opciones
            })
          } catch (e) {
            const fallido = this.tabla.errorDeTabla(s, p, consulta, e, t0)
            throw new ErrorGestor(fallido.error.motivo, fallido.error.mensaje, fallido.error)
          }
          if (r.tipo !== 'filas') throw new ErrorGestor('interno', 'La consulta de la tabla no devolvió filas.')
          columnas = columnas ?? r.columnas
          await consumir(paginaExportada(columnas, r.filasJson, r.recortes))
          if (!r.hayMas || r.nFilas === 0) break
          if (consulta.columnasClave) {
            if (!r.ultimaClave) throw new ErrorGestor('interno', 'El trabajador no devolvió la clave de la última fila.')
            despues = r.ultimaClave
          } else desde += r.nFilas
          consulta = consultaDePagina(d, req, despues, desde)
        }
        ok = true
      } catch (e) {
        this.ap.tratarFallo(s, p, e)
        throw this.ap.aErrorGestor(e)
      } finally {
        if (s.estado.fase === 'ocupada') this.n.terminar(s, { clase: 'consulta', ok })
      }
    } finally {
      if (s.cancelada === req.peticionId) s.cancelada = null
    }
  }

  /**
   * Vuelca a `consumir` un resultado con CURSOR VIVO: su primera página y después `leer` hasta
   * agotarlo, sin re-ejecutar nada. El cursor se cierra SIEMPRE (un fallo del trabajador en
   * `leer` ya lo soltó). Corre dentro de la operación del llamador, que trata el fallo.
   */
  async volcarCursorVivo(
    s: Sesion,
    p: Proceso,
    r: ResultadoFilasTrabajador,
    consumir: ConsumidorPaginas,
    cancelada: () => boolean
  ): Promise<void> {
    let lector = r.lector
    const columnas = r.columnas
    try {
      await consumir(paginaExportada(columnas, r.filasJson, r.recortes))
      while (lector !== null) {
        if (cancelada()) throw new ErrorGestor('cancelada', 'Exportación cancelada.')
        const pagina = await p.trabajador.enviar<'leer'>({
          op: 'leer',
          sesion: s.idTrabajador,
          lector,
          maxFilas: DB_PAGINA_MAX
        })
        // Agotado o fallido, el trabajador ya lo cerró.
        lector = pagina.lector
        await consumir(paginaExportada(columnas, pagina.filasJson, pagina.recortes))
      }
    } catch (e) {
      // Un fallo del trabajador en `leer` ya soltó el cursor: no hay que cerrarlo.
      if (esFalloTrabajador(e)) lector = null
      throw e
    } finally {
      if (lector !== null && p.trabajador.vivo) {
        try {
          await p.trabajador.enviar<'cerrarLector'>({ op: 'cerrarLector', sesion: s.idTrabajador, lector })
        } catch {
          // se cierra con la sesión
        }
      }
    }
  }
}
