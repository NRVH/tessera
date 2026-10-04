// =============================================================================
// Ejecutar una sentencia de consola: la autoridad del main (partir otra vez, formato, solo
// lectura impuesta, producción, parámetros) y las opciones del trabajador; una ejecución de
// usuario por consola y el historial de lo que llegó al servidor.
// Decisiones: docs/decisiones/bd/sesiones-procesos-y-autoridad.md
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import {
  DB_CONSOLA_MAX_BYTES,
  DB_PAGINA_MAX,
  type DbEjecutarConsola,
  type DbEntradaHistorial,
  type DbErrorSql,
  type DbRespuesta,
  type DbResultadoSentencia
} from '../../../../shared/db-explorador-ipc.ts'
import { dialectoDeMotor, type DialectoSql } from '../../../../shared/sql/dialectosSql.ts'
import { dividirSentencias, type Sentencia } from '../../../../shared/sql/divisorSql.ts'
import { formatoFijadoPorTessera, PARAMETRO_USE, permitidaEnSoloLectura } from '../../../../shared/sql/clasificarSql.ts'
import { plsqlConCommitEscrito, requiereConfirmacionProduccion } from '../../../../shared/sql/produccionSql.ts'
import { txInicialDePeticion } from '../../../../shared/ajustesBd.ts'
import { exigeConfirmacion, mensajeProduccion } from '../produccion.ts'
import type { BindsSalientes } from '../bindsConsola.ts'
import { confirmaEnVuelo, type ConfirmacionEnVuelo } from '../maquinaSesion.ts'
import type { OpcionesEjecucion, PeticionSinIdDe, ResultadoTrabajador } from '../protocoloTrabajador.ts'
import { reaplicarTrasTx, sqlErroresCompilacion } from '../consolaSql.ts'
import type { Apertura } from './apertura.ts'
import { mensajeDe } from './errores.ts'
import type { EsquemaConsola } from './esquemaConsola.ts'
import type { NucleoSesiones } from './NucleoSesiones.ts'
import {
  bindsDeSentencia,
  capacidades,
  CLASES_CON_SALIDA_ORACLE,
  opcionesDeLecturaEnFlujo,
  RELEER_ESQUEMA,
  sesionFueraDelCandado
} from './reglas.ts'
import type { ResultadoSentencia } from './resultadoSentencia.ts'
import type { Proceso, Sesion } from './tipos.ts'

type BindsValidos = Extract<ReturnType<typeof bindsDeSentencia>, { ok: true }>

/** Filas devueltas (la primera página) o afectadas; un RETURNING cuenta las afectadas. */
function filasDeResultado(r: ResultadoTrabajador): number | undefined {
  return r.tipo === 'filas' ? (r.afectadas ?? r.nFilas) : r.tipo === 'afectadas' ? r.filas : undefined
}

/** Ejecución de una sentencia de consola. */
export class ConsolaSesion {
  private readonly n: NucleoSesiones
  private readonly esq: EsquemaConsola
  private readonly ap: Apertura
  private readonly res: ResultadoSentencia

  constructor(n: NucleoSesiones, esq: EsquemaConsola, ap: Apertura, res: ResultadoSentencia) {
    this.n = n
    this.esq = esq
    this.ap = ap
    this.res = res
  }

  /** Opciones del trabajador para una sentencia de consola (la autoridad es el main). */
  private opcionesSentencia(s: Sesion, con: DbConnection, d: DialectoSql, st: Sentencia, maxFilas: number): OpcionesEjecucion {
    const cap = capacidades(d)
    return {
      proposito: 'usuario',
      maxFilas,
      candadoRO: this.n.ro(con),
      // La lista blanca de SET en PG va FUERA del envoltorio (`envoltorioRollback`): el
      // ROLLBACK la desharía.
      fueraDeEnvoltorio: this.n.ro(con) && sesionFueraDelCandado(cap.candadoSoloLectura) && st.clase === 'sesion',
      txManual: this.n.manual(s, con),
      sinBegin: st.clase === 'tx' || st.noTransaccional,
      esDml: st.clase === 'dml',
      comprobarTx: true,
      // PG (`esquemaTransaccional`): un ROLLBACK (clase tx) deshace un SET search_path hecho
      // dentro de la tx. SQL Server: un USE dentro de una unidad que se ejecuta junta
      // (`USE ventas⏎SELECT …`, clase `consulta`) también mueve la base, y la clase final no
      // lo dice: lo dicen sus parámetros de sesión.
      leerEsquema:
        RELEER_ESQUEMA.indexOf(st.clase) >= 0 ||
        (cap.esquemaTransaccional && st.clase === 'tx') ||
        (st.sesion !== null && st.sesion.parametros.indexOf(PARAMETRO_USE) >= 0),
      refijarFormatos: st.clase === 'plsql' || st.clase === 'rutina',
      // PG (`salidaServidorSiempre`): los NOTICE llegan sin viaje; Oracle, solo en esas clases.
      salidaServidor: cap.salidaServidorSiempre || CLASES_CON_SALIDA_ORACLE.indexOf(st.clase) >= 0,
      // SQL Server: la lectura en flujo; en los demás motores, nada.
      ...opcionesDeLecturaEnFlujo(d, st.consultaPura, st.consultaPura && st.masTrasLasFilas !== true)
    }
  }

  /**
   * Ejecuta UNA sentencia de consola. `req.sql` es el texto del modelo tal cual; se
   * vuelve a partir aquí y se rechaza si no sale exactamente una.
   */
  async ejecutarConsola(req: DbEjecutarConsola & { conexionId: string }): Promise<DbRespuesta<DbResultadoSentencia>> {
    if (typeof req.sql !== 'string' || req.sql.length > DB_CONSOLA_MAX_BYTES) {
      return { ok: false, error: { motivo: 'limite', mensaje: 'La sentencia es demasiado grande.' } }
    }
    if (!Number.isInteger(req.maxFilas) || req.maxFilas < 1 || req.maxFilas > DB_PAGINA_MAX) {
      return { ok: false, error: { motivo: 'interno', mensaje: `El tamaño de página tiene que estar entre 1 y ${DB_PAGINA_MAX}.` } }
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
    const v = this.validarSentencia(req, con, d)
    if (!v.ok) return v
    const { st, binds } = v
    if (s.operacionUsuario !== null) {
      return { ok: false, error: { motivo: 'ocupada', mensaje: 'La consola ya está ejecutando otra operación.' } }
    }
    s.operacionUsuario = req.ejecucionId
    try {
      return await s.cola.correr(
        async () => {
          // El aviso de los parámetros (SQLite, `avisoChoquesSqlite`) sale con ESTE resultado:
          // `correrSentencia` vacía `avisosPendientes` en él. Se apunta en el turno de la cola
          // (no se lo lleva otra operación que corra antes) y, si la sentencia no llegó a dar
          // resultado (un error), se retira: no puede salir pegado a la siguiente.
          const aviso = binds.aviso
          if (aviso !== undefined) s.avisosPendientes.push(aviso)
          try {
            return await this.correrSentencia(s, con, d, st, req, binds.binds)
          } finally {
            if (aviso !== undefined) {
              const i = s.avisosPendientes.indexOf(aviso)
              if (i >= 0) s.avisosPendientes.splice(i, 1)
            }
          }
        },
        { clave: req.ejecucionId, prioridad: 'alta' }
      )
    } catch (e) {
      return this.ap.respuestaDeFallo(e)
    } finally {
      s.operacionUsuario = null
    }
  }

  /**
   * La autoridad del main sobre el texto, en este orden: exactamente UNA sentencia, ni un
   * comando del cliente ni un formato que fija Tessera, la guardia de solo lectura (SOLO la
   * impuesta), producción sin confirmar y los parámetros sacados del texto que se ENVÍA.
   */
  private validarSentencia(
    req: DbEjecutarConsola,
    con: DbConnection,
    d: DialectoSql
  ): { ok: false; error: DbErrorSql } | { ok: true; st: Sentencia; binds: BindsValidos } {
    const partes = dividirSentencias(req.sql, d)
    if (partes.length !== 1) {
      return {
        ok: false,
        error: {
          motivo: 'interno',
          mensaje:
            partes.length === 0
              ? 'No hay ninguna sentencia que ejecutar.'
              : `El texto contiene ${partes.length} sentencias y se ejecuta una por petición.`
        }
      }
    }
    const st = partes[0]
    if (st.clase === 'cliente') {
      return {
        ok: false,
        error: { motivo: 'interno', mensaje: `«${st.verbo}» es un comando del cliente: no se envía al servidor.` }
      }
    }
    const formato = formatoFijadoPorTessera(st, d)
    if (formato) return { ok: false, error: { motivo: 'interno', mensaje: formato } }
    if (this.n.ro(con)) {
      const permiso = permitidaEnSoloLectura(st, d)
      if (!permiso.ok) return { ok: false, error: { motivo: 'soloLectura', mensaje: permiso.motivo } }
    }
    // Después de la guardia de solo lectura, que manda; qué es escritura lo dice el MISMO
    // módulo que usa el diálogo de la consola.
    if (exigeConfirmacion(con, this.n.ro(con), req.confirmado) && requiereConfirmacionProduccion(st)) {
      return { ok: false, error: { motivo: 'produccion', mensaje: mensajeProduccion(con.alias) } }
    }
    // Un EXEC ya traducido conserva sus binds; si falta alguno no se manda nada.
    const binds = bindsDeSentencia(st, d, req.binds)
    if (!binds.ok) return { ok: false, error: binds.error }
    return { ok: true, st, binds }
  }

  private async correrSentencia(
    s: Sesion,
    con: DbConnection,
    d: DialectoSql,
    st: Sentencia,
    req: DbEjecutarConsola,
    binds?: BindsSalientes
  ): Promise<DbRespuesta<DbResultadoSentencia>> {
    const t0 = Date.now()
    try {
      let p: Proceso
      try {
        p = await this.ap.empezar(s, req.ejecucionId)
      } catch (e) {
        return this.ap.respuestaDeFallo(e)
      }
      // El esquema ANTES de la sentencia (si hubo que reabrir, `empezar` ya reaplicó el
      // elegido): decide si una reversión lo deshizo (ver `reaplicarTrasTx`).
      const esquemaAntes = s.estado.esquema
      const { opciones, peticion } = this.peticionSentencia(s, con, d, st, req.maxFilas, binds)
      // Si la sesión se pierde con esto en vuelo, no se sabe si se aplicó: lo leen
      // `perder`/`alSalirProceso` y `errorDeSentencia`.
      const confirma = this.confirmacionEnCamino(s, con, d, st, opciones)
      if (confirma) s.commitEnCamino = confirma
      let r: ResultadoTrabajador
      try {
        r = await p.trabajador.enviar<'ejecutar'>(peticion)
      } catch (e) {
        const respuesta = await this.res.errorDeSentencia(s, p, d, st, e, t0)
        this.anotarHistorial(s, d, req, st, esquemaAntes, respuesta)
        return respuesta
      } finally {
        delete s.commitEnCamino
      }
      // Tras un CREATE de PL/SQL, sus errores (o avisos) de compilación, en la misma operación
      // y sesión. Si hay algo que leer lo dice el motor (`sqlErroresCompilacion`).
      const consultaCompilacion = r.tipo === 'hecho' ? sqlErroresCompilacion(st, d) : null
      const compilacion = consultaCompilacion !== null ? await this.res.leerCompilacion(s, p, consultaCompilacion, st) : undefined
      let esquema = opciones.leerEsquema && typeof r.esquema === 'string' ? r.esquema : undefined
      // Decidido sin esperar: solo se viaja (y se cede el turno) si hay que reponer el elegido.
      const reponer = this.esquemaAReponer(s, d, st, esquemaAntes, esquema)
      if (reponer !== null) {
        try {
          esquema = (await this.esq.enviarEsquema(s, p, d, reponer)) ?? undefined
        } catch {
          // el siguiente uso lo verá; la sentencia del usuario ya terminó bien
        }
      }
      const ef = this.n.terminar(s, {
        clase: st.clase,
        ok: true,
        tx: r.tx,
        ...(esquema !== undefined ? { esquema } : {})
      })
      const avisos = [...s.avisosPendientes.splice(0), ...(r.avisos ?? []), ...(await this.n.efectos(s, ef))]
      this.n.marcarExpulsados(r)
      if (st.clase === 'ddl') this.res.avisarDdl(s, st)
      const respuesta: DbRespuesta<DbResultadoSentencia> = {
        ok: true,
        valor: this.res.resultadoDeSentencia(s, d, st, r, avisos, t0, compilacion, binds)
      }
      this.anotarHistorial(s, d, req, st, esquemaAntes, respuesta, filasDeResultado(r))
      return respuesta
    } finally {
      if (s.cancelada === req.ejecucionId) s.cancelada = null
    }
  }

  /** Opciones y mensaje de la sentencia. El id del lector se crea aquí, justo antes de enviar. */
  private peticionSentencia(
    s: Sesion,
    con: DbConnection,
    d: DialectoSql,
    st: Sentencia,
    maxFilas: number,
    binds?: BindsSalientes
  ): { opciones: OpcionesEjecucion; peticion: PeticionSinIdDe<'ejecutar'> } {
    const opciones = this.opcionesSentencia(s, con, d, st, maxFilas)
    if (st.devuelveFilas && capacidades(d).lectorPorId) opciones.lector = this.n.nuevoIdLector()
    const peticion: PeticionSinIdDe<'ejecutar'> = { op: 'ejecutar', sesion: s.idTrabajador, sql: st.texto, opciones }
    if (binds !== undefined) peticion.binds = binds
    return { opciones, peticion }
  }

  /**
   * La confirmación que lleva en camino la sentencia (un COMMIT escrito, una escritura en Auto,
   * un DDL de Oracle, un bloque o rutina de Oracle en Manual), o null. En solo lectura nada se
   * confirma: cada sentencia va en su transacción de solo lectura y se revierte.
   */
  private confirmacionEnCamino(
    s: Sesion,
    con: DbConnection,
    d: DialectoSql,
    st: Sentencia,
    opciones: OpcionesEjecucion
  ): ConfirmacionEnVuelo | null {
    return this.n.ro(con)
      ? null
      : confirmaEnVuelo(
          { clase: st.clase, verbo: st.verbo, commitEscrito: plsqlConCommitEscrito(st, d) },
          opciones.txManual === true,
          capacidades(d),
          s.estado.tx
        )
  }

  /**
   * PG: una reversión (ROLLBACK, ABORT, ROLLBACK TO, o el COMMIT de una tx fallida) deshizo el
   * SET del esquema elegido hecho dentro de la tx: devuelve el elegido que hay que volver a poner,
   * o null. Un SET a mano del usuario manda (`reaplicarTrasTx`).
   */
  private esquemaAReponer(
    s: Sesion,
    d: DialectoSql,
    st: Sentencia,
    esquemaAntes: string | null,
    esquema: string | undefined
  ): string | null {
    if (!capacidades(d).esquemaTransaccional || st.clase !== 'tx') return null
    const elegido = this.esq.esquemaElegido(s)
    return reaplicarTrasTx(esquemaAntes, esquema, elegido) ? elegido : null
  }

  /**
   * El historial: SOLO si la sentencia llegó al servidor (`ok:true` en el contrato: resultado,
   * error del servidor, pérdida o Stop). Nunca lanza.
   */
  private anotarHistorial(
    s: Sesion,
    d: DialectoSql,
    req: DbEjecutarConsola,
    st: Sentencia,
    esquemaAntes: string | null,
    respuesta: DbRespuesta<DbResultadoSentencia>,
    filas?: number
  ): void {
    const anotar = this.n.deps.alSentencia
    if (!anotar || !respuesta.ok || s.ref.rol !== 'consola') return
    const v = respuesta.valor
    const e: Omit<DbEntradaHistorial, 'id'> = {
      en: this.n.ahora(),
      perfilId: s.ref.perfilId,
      conexionId: s.conexionId,
      consolaId: s.ref.consolaId,
      // Lo que escribió el usuario (un EXEC sin traducir), sin el `;` ni lo de alrededor.
      sql: req.sql.slice(st.desde, st.hastaContenido),
      resultado: v.tipo !== 'error' ? 'ok' : v.error.motivo === 'cancelada' ? 'cancelada' : 'error',
      ms: v.tiempos.totalMs,
      esquema: esquemaAntes
    }
    if (filas !== undefined) e.filas = filas
    try {
      anotar(e, d)
    } catch (err) {
      this.n.log(`anotar en el historial falló: ${mensajeDe(err)}`)
    }
  }
}
