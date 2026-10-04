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
  type OpcionesEjecucion,
  type ResultadoFilasTrabajador,
  type ResultadoTrabajador
} from '../protocoloTrabajador.ts'
import {
  campoDeErrorEnLinea,
  campoDeErrorEnPuntosDeCodigo,
  construirConsultaTabla,
  type ConsultaRejilla,
  detalleDeErrorRejilla,
  esErrorRejilla
} from '../sqlRejilla.ts'
import { motorExplorador } from '../motores/index.ts'
import type { Apertura } from './apertura.ts'
import { AVISO_SIN_ORDEN, ErrorGestor, errorSql, mensajePerdida, ubicarError } from './errores.ts'
import type { NucleoSesiones } from './NucleoSesiones.ts'
import type { Procesos } from './procesos.ts'
import { capacidades, pagina, TIEMPOS_CERO } from './reglas.ts'
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
      return { ok: false, error: { motivo: 'interno', mensaje: `El tamaño de página tiene que estar entre 1 y ${DB_PAGINA_MAX}.` } }
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
      if (r.tipo !== 'filas') throw new ErrorGestor('interno', 'La consulta de la tabla no devolvió filas.')
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
      if (consulta.sinOrdenEstable) res.avisos = [AVISO_SIN_ORDEN]
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
      error.mensaje =
        'La tabla está bloqueada por una transacción sin confirmar (quizá una consola tuya): Reintentar cuando termine, ' +
        `o «Leer sin esperar», que enseña también lo que aún no se ha confirmado. (${et.mensaje})`
      return { tipo: 'error', error, tiempos }
    }
    if (typeof et.offsetCp === 'number') {
      ubicarError(error, campoDeErrorEnPuntosDeCodigo(consulta, et.offsetCp))
    } else if (typeof et.linea === 'number') {
      // SQL Server: solo la LÍNEA; cada fragmento del usuario (y cada condición del filtro
      // guiado) empieza en su propia línea.
      ubicarError(error, campoDeErrorEnLinea(consulta, et.linea))
    }
    return { tipo: 'error', error, tiempos }
  }
}
