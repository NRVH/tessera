// =============================================================================
// Pestaña de tabla en la sesión `datos`: primera página, su lector y el error del servidor
// situado en el fragmento del usuario (WHERE, ORDER BY o condición del filtro guiado).
// Decisiones: docs/decisiones/bd/sesiones-por-motor.md
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import {
  DB_PAGINA_MAX,
  type DbErrorSql,
  type DbRespuesta,
  type DbResultadoError,
  type DbResultadoFilas,
  type DbTiempos
} from '../../../../shared/db-explorador-ipc.ts'
import { dialectoDeMotor, type DialectoSql } from '../../../../shared/sql/dialectosSql.ts'
import {
  type BindsTrabajador,
  esFalloTrabajador,
  type ErrorTrabajador,
  type OpcionesEjecucion,
  type ResultadoFilasTrabajador,
  type ResultadoTrabajador
} from '../protocoloTrabajador.ts'
import {
  campoDeColumnaInexistente,
  campoDeErrorEnLinea,
  campoDeErrorEnPuntosDeCodigo,
  construirConsultaTabla,
  type ConsultaRejilla,
  detalleDeErrorRejilla,
  esErrorRejilla
} from '../sqlRejilla.ts'
import { motorExplorador } from '../motores/index.ts'
import type { Apertura } from './apertura.ts'
import { avisoSinOrden, ErrorGestor, errorSql, mensajePerdida, ubicarError } from './errores.ts'
import type { NucleoSesiones } from './NucleoSesiones.ts'
import type { Procesos } from './procesos.ts'
import { capacidades, pagina, TIEMPOS_CERO } from './reglas.ts'
import { txSesiones } from './textosSesiones.ts'
import type { OrigenLector, PeticionTabla, Proceso, Sesion } from './tipos.ts'

function opcionesDeTabla(soloLectura: boolean, req: PeticionTabla): OpcionesEjecucion {
  return {
    proposito: 'usuario',
    maxFilas: req.maxFilas,
    candadoRO: soloLectura,
    sinBegin: true,
    comprobarTx: false,
    ...(req.topes ?? {}),
    // SQL Server: «Leer sin esperar», solo si se pidió.
    ...(req.sinEsperar === true ? { sinEsperar: true } : {})
  }
}

/** El origen del lector de la pestaña: «más», Contar y exportar repiten EXACTAMENTE la misma consulta. */
function origenDeTabla(d: DialectoSql, req: PeticionTabla, consulta: ConsultaRejilla, r: ResultadoFilasTrabajador): OrigenLector {
  return {
    tipo: 'tabla',
    dialecto: d,
    objeto: req.objeto,
    where: req.where ?? null,
    orderBy: req.orderBy ?? null,
    ...(req.filtro ? { filtro: req.filtro } : {}),
    ...(req.orden ? { orden: req.orden } : {}),
    pk: req.pk.slice(),
    ...(req.topes ? { topes: req.topes } : {}),
    ...(req.rowid === true ? { rowid: true as const } : {}),
    ...(req.aliasRowid !== undefined ? { aliasRowid: req.aliasRowid } : {}),
    ...(consulta.columnasClave ? { clave: req.clave ?? null, despues: r.ultimaClave ?? null } : {}),
    ...(req.sinEsperar === true ? { sinEsperar: true as const } : {})
  }
}

/** Lectura de la pestaña de tabla. */
export class TablaSesion {
  private readonly n: NucleoSesiones
  private readonly proc: Procesos
  private readonly ap: Apertura

  constructor(n: NucleoSesiones, proc: Procesos, ap: Apertura) {
    this.n = n
    this.proc = proc
    this.ap = ap
  }

  async leerTabla(req: PeticionTabla): Promise<DbRespuesta<DbResultadoFilas | DbResultadoError>> {
    if (!Number.isInteger(req.maxFilas) || req.maxFilas < 1 || req.maxFilas > DB_PAGINA_MAX) {
      return { ok: false, error: { motivo: 'interno', mensaje: txSesiones().paginaFuera(DB_PAGINA_MAX) } }
    }
    let con: DbConnection
    try {
      con = this.n.conexionOError(req.conexionId)
    } catch (e) {
      return this.ap.respuestaDeFallo(e)
    }
    const d = dialectoDeMotor(con.motor)
    const consulta = construirConsultaTabla({
      dialecto: d,
      objeto: req.objeto,
      where: req.where ?? null,
      orderBy: req.orderBy ?? null,
      // Solo si vienen: sin ellos, la petición de siempre.
      ...(req.filtro ? { filtro: req.filtro } : {}),
      ...(req.orden ? { orden: req.orden } : {}),
      pkColumnas: req.pk,
      n: req.maxFilas + 1,
      desde: 0,
      forma: capacidades(d).paginado.rejilla,
      ...(req.rowid === true ? { rowid: true } : {}),
      // SQLite: solo si el controlador los decidió; Oracle y PG, como siempre.
      ...(req.aliasRowid !== undefined ? { aliasRowid: req.aliasRowid } : {}),
      ...(req.clave ? { clave: req.clave } : {})
    })
    if (esErrorRejilla(consulta)) {
      if (consulta.campo) {
        const error: DbErrorSql = { motivo: 'servidor', mensaje: consulta.error, ...detalleDeErrorRejilla(consulta) }
        return { ok: true, valor: { tipo: 'error', error, tiempos: TIEMPOS_CERO } }
      }
      return { ok: false, error: { motivo: 'interno', mensaje: consulta.error } }
    }
    const s = this.n.sesionDe({ rol: 'datos', conexionId: con.id }, con)
    try {
      const valor = await s.cola.correr(() => this.correrTabla(s, con, d, req, consulta), { clave: req.peticionId })
      return { ok: true, valor }
    } catch (e) {
      return this.ap.respuestaDeFallo(e)
    }
  }

  private async correrTabla(
    s: Sesion,
    con: DbConnection,
    d: DialectoSql,
    req: PeticionTabla,
    consulta: ConsultaRejilla
  ): Promise<DbResultadoFilas | DbResultadoError> {
    const t0 = Date.now()
    try {
      const p = await this.ap.empezar(s, req.peticionId)
      const opciones = opcionesDeTabla(this.n.ro(con), req)
      if (capacidades(d).lectorPorId) opciones.lector = this.n.nuevoIdLector()
      // 'keyset' (SQLite): la clave va al final y el trabajador la devuelve aparte.
      if (consulta.columnasClave) opciones.claveAlFinal = consulta.columnasClave
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
        return this.errorDeTabla(s, p, consulta, e, t0)
      }
      this.n.terminar(s, { clase: 'consulta', ok: true, tx: r.tx })
      this.n.marcarExpulsados(r)
      if (r.tipo !== 'filas') throw new ErrorGestor('interno', txSesiones().tablaSinFilas)
      let lector: string | null = null
      if (r.hayMas) {
        lector = this.n.registrarLector(s, {
          id: r.lector ?? this.n.nuevoIdLector(),
          cursor: r.lector,
          desde: r.nFilas,
          origen: origenDeTabla(d, req, consulta, r)
        })
      }
      const res: DbResultadoFilas = {
        tipo: 'filas',
        columnas: r.columnas,
        pagina: pagina(r, 0),
        lector,
        tiempos: { totalMs: Date.now() - t0, ejecucionMs: r.msEjecucion, lecturaMs: r.msLectura }
      }
      if (consulta.sinOrdenEstable) res.avisos = [avisoSinOrden()]
      return res
    } finally {
      if (s.cancelada === req.peticionId) s.cancelada = null
    }
  }

  errorDeTabla(s: Sesion, p: Proceso, consulta: ConsultaRejilla, e: unknown, t0: number): DbResultadoError {
    const ms = Date.now() - t0
    const tiempos: DbTiempos = { totalMs: ms, ejecucionMs: ms, lecturaMs: 0 }
    if (!esFalloTrabajador(e)) {
      this.n.terminar(s, { clase: 'consulta', ok: false })
      throw this.ap.aErrorGestor(e)
    }
    const et = e.error
    if (et.clase === 'perdida') {
      this.n.perder(s)
      const error: DbErrorSql = { motivo: 'sesionPerdida', mensaje: mensajePerdida(et) }
      if (et.codigo) error.codigo = et.codigo
      return { tipo: 'error', error, tiempos }
    }
    if (et.codigo === 'TESSERA-PLAZO') {
      this.n.perder(s, true)
      this.proc.matarColgado(p)
      return { tipo: 'error', error: errorSql(et), tiempos }
    }
    this.n.terminar(s, { clase: 'consulta', ok: false })
    if (et.clase === 'protocolo' || et.clase === 'ocupada' || et.clase === 'driver') throw this.ap.aErrorGestor(e)
    const error = errorSql(et)
    // SQL Server: una lectura que venció su tope de espera de un bloqueo. La interfaz
    // ofrece «Reintentar» y «Leer sin esperar» (`sinEsperar`). En los demás motores, nunca.
    const motor = this.n.deps.conexion(s.conexionId)?.motor
    if (motor !== undefined && motorExplorador(motor).sesion.esBloqueoAlLeer(et.codigo)) {
      error.motivo = 'bloqueo'
      error.mensaje = txSesiones().tablaBloqueada(et.mensaje)
      return { tipo: 'error', error, tiempos }
    }
    ubicarErrorDeTabla(error, et, consulta, motor)
    return { tipo: 'error', error, tiempos }
  }
}

/** Sitúa el error en el fragmento del usuario que lo causó, con lo que el servidor diga de dónde. */
function ubicarErrorDeTabla(error: DbErrorSql, et: ErrorTrabajador, consulta: ConsultaRejilla, motor: string | undefined): void {
  // Una columna que no existe se ubica por su NOMBRE: SQL Server da la línea donde empieza la sentencia,
  // y en SQLite la posición que se deduce puede caer en otro fragmento.
  const nombre = columnaInexistenteDe(et, motor)
  const porNombre = nombre ? campoDeColumnaInexistente(consulta, nombre) : null
  if (porNombre) {
    ubicarError(error, porNombre)
  } else if (typeof et.offsetCp === 'number') {
    ubicarError(error, campoDeErrorEnPuntosDeCodigo(consulta, et.offsetCp))
  } else if (typeof et.linea === 'number') {
    // SQL Server: solo la LÍNEA; cada fragmento del usuario (y cada condición del filtro
    // guiado) empieza en su propia línea.
    ubicarError(error, campoDeErrorEnLinea(consulta, et.linea))
  }
}

/** El nombre de la columna que no existe según el error del servidor, o null si el error es otro. */
function columnaInexistenteDe(et: ErrorTrabajador, motor: string | undefined): string | null {
  // SQL Server, 207: «Invalid column name 'X'.» (el nombre, entre comillas simples, en todos los idiomas).
  if (motor === 'sqlserver' && et.codigo === '207') return /'([^']+)'/.exec(et.mensaje)?.[1] ?? null // motor-fijo: el 207 y su texto son de SQL Server
  if (motor !== 'sqlite') return null // motor-fijo: «no such column» es el texto de SQLite; los demás motores no lo necesitan
  // SQLite: «no such column: X», o «main.t.X» si la columna va calificada (lo que Tessera hace siempre).
  const sqlite = /no such column: (.+)$/.exec(et.mensaje)?.[1]
  if (!sqlite) return null
  const partes = sqlite.split('.')
  // Calificada, la columna es lo que sigue a esquema y tabla (y puede llevar puntos).
  return partes.length >= 3 ? partes.slice(2).join('.') : (partes.pop() ?? null)
}
