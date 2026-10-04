// =============================================================================
// Explain de una sentencia de consola sin ejecutarla: la operación de la consola que envuelve
// el algoritmo de cada motor (`SesionExplorador.explicar`) y el error con su posición.
// Decisiones: docs/decisiones/bd/sesiones-por-motor.md
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import {
  DB_CONSOLA_MAX_BYTES,
  type DbEstadoTx,
  type DbExplicar,
  type DbPlan,
  type DbRespuesta
} from '../../../../shared/db-explorador-ipc.ts'
import { dialectoDeMotor, type DialectoSql } from '../../../../shared/sql/dialectosSql.ts'
import { dividirSentencias, type Sentencia } from '../../../../shared/sql/divisorSql.ts'
import { motivoNoExplicable } from '../../../../shared/sql/explicarSql.ts'
import type { ParametroSql } from '../../../../shared/sql/parametrosSql.ts'
import { offsetDeError, type PosicionServidor } from '../../../../shared/sql/posicionErrorSql.ts'
import { txInicialDePeticion } from '../../../../shared/ajustesBd.ts'
import type { BindsSalientes } from '../bindsConsola.ts'
import { nuevoIdPlan, offsetEnSentencia } from '../planSql.ts'
import { type ErrorTrabajador, esFalloTrabajador, type PeticionSinIdDe } from '../protocoloTrabajador.ts'
import { motorExplorador } from '../motores/index.ts'
import type { ContextoExplicar } from '../motores/sesion.ts'
import type { Apertura } from './apertura.ts'
import { ErrorGestor, errorSql } from './errores.ts'
import type { NucleoSesiones } from './NucleoSesiones.ts'
import { bindsDeSentencia, capacidades } from './reglas.ts'
import type { Proceso, Sesion } from './tipos.ts'

/**
 * La posición del error del servidor relativa a la sentencia, sin el `prefijo` del EXPLAIN
 * (en SQL Server, la línea es del texto ENVIADO: se le restan las del prefijo).
 */
function posicionEnSentencia(et: ErrorTrabajador, prefijo: string): PosicionServidor {
  const ps: PosicionServidor = { offsetCp: offsetEnSentencia(et.offsetCp, prefijo) ?? null, mensaje: et.mensaje }
  if (et.consultaInterna !== undefined) ps.consultaInterna = et.consultaInterna
  if (et.offsetInternoCp !== undefined) ps.posicionInterna = et.offsetInternoCp + 1
  if (et.donde !== undefined) ps.donde = et.donde
  if (et.linea !== undefined) ps.linea = et.linea - (prefijo.split('\n').length - 1)
  if (et.objeto !== undefined) ps.objeto = et.objeto
  return ps
}

/** Plan de ejecución de una sentencia de consola. */
export class ExplicarSesion {
  private readonly n: NucleoSesiones
  private readonly ap: Apertura

  constructor(n: NucleoSesiones, ap: Apertura) {
    this.n = n
    this.ap = ap
  }

  /**
   * EXPLAIN: el plan de UNA sentencia SIN ejecutarla, en la sesión de la
   * consola (ve su esquema y su transacción), por su cola y con su Stop (`cancelar`
   * de consola con `ejecucionId`). Una operación de usuario como `ejecutar`: `ocupada`
   * si la consola ya está en otra.
   *
   * El ALGORITMO de cada motor, con su porqué medido, vive en su sesión
   * (`SesionExplorador.explicar`, en `motores/sesion*.ts`), con el contexto que le da
   * `correrExplicar`. Lo que pide a todos: el plan SIN ejecutar la
   * sentencia y sin estropear la transacción del usuario, con lo que haga falta para eso
   * (un ROLLBACK, un punto de guardado) pedido por el contexto. Aquí queda lo común: abrir
   * y cerrar la operación de la consola, los binds (si el motor exige sus valores,
   * `explainPideValores`, o se rellenan con NULL), la pérdida y el plazo, y la posición
   * del error.
   *
   * Un error del EXPLAIN vuelve como `ok:false` con motivo `servidor` y la posición
   * en la sentencia (el contrato de `DbPlan` no tiene otro sitio), igual que un Stop
   * (`cancelada`). Lo que falle fuera del EXPLAIN (leer el plan, el punto de guardado)
   * vuelve sin posición.
   */
  async explicar(req: DbExplicar & { conexionId: string }): Promise<DbRespuesta<DbPlan>> {
    if (typeof req.sql !== 'string' || req.sql.length > DB_CONSOLA_MAX_BYTES) {
      return { ok: false, error: { motivo: 'limite', mensaje: 'La sentencia es demasiado grande.' } }
    }
    let con: DbConnection
    let s: Sesion
    try {
      con = this.n.conexionDeConsola(req)
      s = this.n.sesionDe({ rol: 'consola', perfilId: req.perfilId, consolaId: req.consolaId }, con, txInicialDePeticion(req.txInicial))
    } catch (e) {
      return this.ap.respuestaDeFallo(e)
    }
    const d = dialectoDeMotor(con.motor)
    const partes = dividirSentencias(req.sql, d)
    if (partes.length !== 1) {
      return {
        ok: false,
        error: {
          motivo: 'interno',
          mensaje: partes.length === 0 ? 'No hay ninguna sentencia que explicar.' : 'Se explica una sola sentencia cada vez.'
        }
      }
    }
    const st = partes[0]
    const motivo = motivoNoExplicable(st)
    if (motivo) return { ok: false, error: { motivo: 'interno', mensaje: motivo } }
    // PG exige los valores (`explainPideValores`); Oracle no los mira (se rellenan con NULL
    // si hace falta).
    const binds = bindsDeSentencia(st, d, req.binds, !capacidades(d).explainPideValores)
    if (!binds.ok) return { ok: false, error: binds.error }
    if (s.operacionUsuario !== null) {
      return { ok: false, error: { motivo: 'ocupada', mensaje: 'La consola ya está ejecutando otra operación.' } }
    }
    s.operacionUsuario = req.ejecucionId
    try {
      return await s.cola.correr(() => this.correrExplicar(s, con, d, st, binds.binds, binds.params, req.ejecucionId), {
        clave: req.ejecucionId,
        prioridad: 'alta'
      })
    } catch (e) {
      return this.ap.respuestaDeFallo(e)
    } finally {
      s.operacionUsuario = null
    }
  }

  private async correrExplicar(
    s: Sesion,
    con: DbConnection,
    d: DialectoSql,
    st: Sentencia,
    binds: BindsSalientes | undefined,
    params: readonly ParametroSql[],
    clave: string
  ): Promise<DbRespuesta<DbPlan>> {
    const t0 = Date.now()
    let p: Proceso
    try {
      p = await this.ap.empezar(s, clave)
    } catch (e) {
      if (s.cancelada === clave) s.cancelada = null
      return this.ap.respuestaDeFallo(e)
    }
    let ok = false
    // Lo que el algoritmo del motor deja dicho por el contexto (en un objeto: el compilador
    // no ve las asignaciones dentro de las funciones del contexto y los daría por su valor
    // inicial para siempre). `prefijo`: el texto enviado al que se refiere el offset de un
    // error del servidor, SOLO mientras el EXPLAIN está en vuelo; null = lo que falló no es
    // la sentencia del usuario (el punto de guardado de PG, PLAN_TABLE, DBMS_XPLAN, un
    // rollback), su offset es de OTRO texto y el error va sin posición.
    const vuelo: { prefijo: string | null; tx: DbEstadoTx | undefined } = { prefijo: null, tx: undefined }
    const ctx: ContextoExplicar = {
      texto: st.texto,
      binds,
      conParametros: params.length > 0,
      soloLectura: this.n.ro(con),
      t0,
      estadoTx: () => s.estado.tx,
      txManual: () => this.n.manual(s, con),
      modoDriver: () => s.driver?.modo,
      ejecutar: (sql, opciones, b) => {
        const peticion: PeticionSinIdDe<'ejecutar'> = { op: 'ejecutar', sesion: s.idTrabajador, sql, opciones }
        if (b !== undefined) peticion.binds = b
        return p.trabajador.enviar<'ejecutar'>(peticion)
      },
      accionTx: async (accion) => (await p.trabajador.enviar<'tx'>({ op: 'tx', sesion: s.idTrabajador, accion })).tx,
      prefijo: (x) => {
        vuelo.prefijo = x
      },
      fijarTx: (tx) => {
        vuelo.tx = tx
      },
      nuevoIdPlan: () => nuevoIdPlan(this.n.siguienteIdPlan(), Date.now().toString(36)),
      error: (motivo, mensaje) => new ErrorGestor(motivo, mensaje)
    }
    try {
      // El ALGORITMO es de cada motor (`SesionExplorador.explicar`, en `motores/sesion*.ts`):
      // aquí solo la operación de la consola que lo envuelve.
      const valor = await motorExplorador(con.motor).sesion.explicar(ctx)
      ok = true
      return { ok: true, valor }
    } catch (e) {
      return await this.errorDeExplicar(s, p, con, d, st, e, vuelo.prefijo, (t) => {
        vuelo.tx = t
      })
    } finally {
      const tx = vuelo.tx
      if (s.estado.fase === 'ocupada') this.n.terminar(s, tx !== undefined ? { clase: 'consulta', ok, tx } : { clase: 'consulta', ok })
      if (s.cancelada === clave) s.cancelada = null
    }
  }

  /**
   * Un Explain que falló: la sesión se trata como tras una sentencia (pérdida, proceso
   * colgado, o la transacción releída), se revierte lo que el EXPLAIN hubiera dejado si
   * el motor lo pide (Oracle en solo lectura: `revertirTrasFalloDeExplicar`), y la
   * posición del error se devuelve relativa a la sentencia (sin el prefijo del EXPLAIN).
   * Con `prefijo` null el error no es del EXPLAIN (el punto de guardado, la lectura del
   * plan, un rollback) y va sin posición: su offset es de otro texto y cualquier marca
   * caería en SQL del usuario que no tiene nada que ver.
   */
  private async errorDeExplicar(
    s: Sesion,
    p: Proceso,
    con: DbConnection,
    d: DialectoSql,
    st: Sentencia,
    e: unknown,
    prefijo: string | null,
    fijarTx: (tx: DbEstadoTx) => void
  ): Promise<DbRespuesta<DbPlan>> {
    if (!esFalloTrabajador(e)) return this.ap.respuestaDeFallo(e)
    const et = e.error
    if (et.clase === 'perdida' || et.codigo === 'TESSERA-PLAZO') {
      this.ap.tratarFallo(s, p, e)
      return this.ap.respuestaDeFallo(e)
    }
    // Oracle en solo lectura: el EXPLAIN fue SIN candado tras un ROLLBACK, así que se
    // revierte lo que dejara. PG: el envoltorio o el punto de guardado ya lo aislaron; se
    // relee el estado. Es parte del algoritmo de cada motor (`motores/sesion*.ts`).
    if (motorExplorador(con.motor).sesion.revertirTrasFalloDeExplicar(this.n.ro(con))) {
      try {
        fijarTx((await p.trabajador.enviar<'tx'>({ op: 'tx', sesion: s.idTrabajador, accion: 'rollback' })).tx)
      } catch {
        // el candado de la siguiente sentencia empieza con un ROLLBACK igualmente
      }
    } else {
      const tx = await this.ap.sondaTx(s, p)
      if (tx !== undefined) fijarTx(tx)
    }
    const error = errorSql(et)
    if (et.clase === 'servidor' && prefijo !== null) {
      const pos = offsetDeError(st, posicionEnSentencia(et, prefijo), d)
      if (pos !== null) error.posicion = pos
    }
    return { ok: false, error }
  }
}
