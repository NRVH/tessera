// =============================================================================
// Resultado de una sentencia de consola: filas, afectadas o hecho, conjuntos extra, errores
// de compilación, el error con su posición y el aviso de DDL al catálogo.
// Decisiones: docs/decisiones/bd/transacciones-perdidas-y-commit-en-camino.md
// =============================================================================

import type {
  DbConjuntoSiguiente,
  DbErrorCompilacion,
  DbErrorSql,
  DbLineaSalida,
  DbRespuesta,
  DbResultadoAfectadas,
  DbResultadoError,
  DbResultadoFilas,
  DbResultadoHecho,
  DbResultadoSentencia,
  DbTiempos
} from '../../../../shared/db-explorador-ipc.ts'
import { descriptorSql } from '../../../../shared/motores/index.ts'
import { nunca } from '../../../../shared/nunca.ts'
import type { DialectoSql } from '../../../../shared/sql/dialectosSql.ts'
import type { Sentencia } from '../../../../shared/sql/divisorSql.ts'
import { offsetDeError, type PosicionServidor } from '../../../../shared/sql/posicionErrorSql.ts'
import type { BindsSalientes } from '../bindsConsola.ts'
import {
  type BindsTrabajador,
  type ConjuntoSiguienteTrabajador,
  type ErrorTrabajador,
  esFalloTrabajador,
  type ResultadoAfectadasTrabajador,
  type ResultadoFilasTrabajador,
  type ResultadoHechoTrabajador,
  type ResultadoTrabajador
} from '../protocoloTrabajador.ts'
import type { ConsultaCatalogo, FilaCatalogo } from '../motores/tipos.ts'
import { mapearErroresCompilacion } from '../consolaSql.ts'
import type { Apertura } from './apertura.ts'
import { errorSql, mensajeDe, mensajePerdida, textoEnDuda } from './errores.ts'
import type { NucleoSesiones } from './NucleoSesiones.ts'
import type { Procesos } from './procesos.ts'
import { avisoRevertida, pagina } from './reglas.ts'
import type { OrigenLector, Proceso, Sesion } from './tipos.ts'

/** Lo que acompaña a cualquier resultado: avisos para la Salida, salida del servidor y conjuntos extra. */
interface ExtrasResultado {
  avisos: string[]
  salida: DbLineaSalida[] | undefined
  siguientes: DbConjuntoSiguiente[] | undefined
}

function resultadoAfectadas(
  st: Sentencia,
  r: ResultadoAfectadasTrabajador,
  tiempos: DbTiempos,
  { avisos, salida, siguientes }: ExtrasResultado
): DbResultadoAfectadas {
  const res: DbResultadoAfectadas = { tipo: 'afectadas', filas: r.filas, comando: r.comando ?? st.verbo, tiempos }
  if (avisos.length) res.avisos = avisos
  if (salida) res.salida = salida
  if (siguientes) res.siguientes = siguientes
  return res
}

/**
 * Oracle: un CREATE de PL/SQL con errores de compilación "funciona" (el objeto existe,
 * INVALID), pero para el usuario es un ✗ con su motivo y la lista de ALL_ERRORS.
 */
function resultadoConAdvertencia(
  advertencia: NonNullable<ResultadoHechoTrabajador['advertencia']>,
  tiempos: DbTiempos,
  salida: DbLineaSalida[] | undefined,
  compilacion: DbErrorCompilacion[] | undefined
): DbResultadoError {
  const error: DbErrorSql = {
    motivo: 'servidor',
    mensaje: `Creado con errores de compilación: ${advertencia.mensaje}`
  }
  if (advertencia.codigo) error.codigo = advertencia.codigo
  // Sin `error.posicion`: las marcas van una por error, en `compilacion`.
  const res: DbResultadoError = { tipo: 'error', error, tiempos }
  if (salida) res.salida = salida
  if (compilacion && compilacion.length > 0) res.compilacion = compilacion
  return res
}

function resultadoHecho(
  st: Sentencia,
  r: ResultadoHechoTrabajador,
  tiempos: DbTiempos,
  { avisos, salida, siguientes }: ExtrasResultado,
  compilacion: DbErrorCompilacion[] | undefined
): DbResultadoHecho {
  const res: DbResultadoHecho = { tipo: 'hecho', comando: r.comando ?? st.verbo, tiempos }
  if (avisos.length) res.avisos = avisos
  if (salida) res.salida = salida
  // Compiló, pero con avisos (PLSQL_WARNINGS): ✓ con su lista.
  if (compilacion && compilacion.length > 0) res.compilacion = compilacion
  if (siguientes) res.siguientes = siguientes
  return res
}

/**
 * El error del servidor de una sentencia con todo lo que el trabajador sabe de dónde cayó:
 * sin `offsetCp` (un DO, una función SQL) se marca con la consulta interna o la «line N».
 */
function errorSituado(st: Sentencia, et: ErrorTrabajador, d: DialectoSql): DbErrorSql {
  const error = errorSql(et)
  const ps: PosicionServidor = { offsetCp: et.offsetCp ?? null, mensaje: et.mensaje }
  if (et.consultaInterna !== undefined) ps.consultaInterna = et.consultaInterna
  // `offsetInternoCp` es base 0 y `posicionInterna` base 1, como la de PG.
  if (et.offsetInternoCp !== undefined) ps.posicionInterna = et.offsetInternoCp + 1
  if (et.donde !== undefined) ps.donde = et.donde
  // SQL Server: la línea (sin columna) y el objeto donde ocurrió.
  if (et.linea !== undefined) ps.linea = et.linea
  if (et.objeto !== undefined) ps.objeto = et.objeto
  const pos = offsetDeError(st, ps, d)
  if (pos !== null) error.posicion = pos
  if (et.objeto !== undefined) error.objeto = et.objeto
  if (et.revertidaPorServidor && st.clase !== 'tx') error.mensaje += `\n${avisoRevertida(d, et.revertidaPorServidor)}`
  return error
}

/** Sesión perdida con la sentencia en vuelo; con una confirmación en camino, «no se sabe si se aplicó». */
function errorDePerdida(et: ErrorTrabajador, enDuda: Sesion['commitEnCamino']): DbErrorSql {
  const caida = et.codigo === 'TESSERA-PROCESO'
  const mensaje = enDuda ? `${textoEnDuda(enDuda, caida)}${et.mensaje ? ` (${et.mensaje})` : ''}` : mensajePerdida(et)
  const error: DbErrorSql = { motivo: 'sesionPerdida', mensaje }
  if (et.codigo) error.codigo = et.codigo
  return error
}

/** Convierte la respuesta del trabajador al resultado de una sentencia de consola. */
export class ResultadoSentencia {
  private readonly n: NucleoSesiones
  private readonly proc: Procesos
  private readonly ap: Apertura

  constructor(n: NucleoSesiones, proc: Procesos, ap: Apertura) {
    this.n = n
    this.proc = proc
    this.ap = ap
  }

  /**
   * Los errores de compilación de la unidad recién creada, con la consulta `c` de su motor
   * (`sqlErroresCompilacion`; Oracle, ALL_ERRORS). undefined si no se pudo leer (el ✓/✗
   * manda).
   */
  async leerCompilacion(s: Sesion, p: Proceso, c: ConsultaCatalogo, st: Sentencia): Promise<DbErrorCompilacion[] | undefined> {
    try {
      const r = await p.trabajador.enviar<'ejecutar'>({
        op: 'ejecutar',
        sesion: s.idTrabajador,
        sql: c.sql,
        binds: c.binds as BindsTrabajador,
        opciones: { proposito: 'catalogo', maxFilas: 1000, candadoRO: false, sinBegin: true, comprobarTx: false }
      })
      if (r.tipo !== 'filas') return undefined
      return mapearErroresCompilacion(st, JSON.parse(r.filasJson) as FilaCatalogo[])
    } catch (e) {
      this.n.log(`leer ALL_ERRORS falló: ${esFalloTrabajador(e) ? (e.error.codigo ?? e.error.clase) : 'error'}`)
      return undefined
    }
  }

  resultadoDeSentencia(
    s: Sesion,
    d: DialectoSql,
    st: Sentencia,
    r: ResultadoTrabajador,
    avisos: string[],
    t0: number,
    compilacion?: DbErrorCompilacion[],
    binds?: BindsSalientes
  ): DbResultadoSentencia {
    const totalMs = Date.now() - t0
    const salida: DbLineaSalida[] | undefined = r.salida && r.salida.length > 0 ? r.salida : undefined
    // SQL Server: la transacción que el servidor revirtió sin pedirlo, salvo que la sentencia
    // fuera ella misma un ROLLBACK (clase `tx`); y los conjuntos EXTRA de un lote o un EXEC.
    if (r.revertidaPorServidor && st.clase !== 'tx') avisos.push(avisoRevertida(d, r.revertidaPorServidor))
    const siguientes = r.siguientes && r.siguientes.length > 0 ? this.conjuntosSiguientes(r.siguientes, st, totalMs) : undefined
    const extras: ExtrasResultado = { avisos, salida, siguientes }
    if (r.tipo === 'filas') return this.resultadoFilas(s, d, st, r, totalMs, extras, binds)
    const tiempos: DbTiempos = { totalMs, ejecucionMs: r.ms, lecturaMs: 0 }
    if (r.tipo === 'afectadas') return resultadoAfectadas(st, r, tiempos, extras)
    if (r.advertencia) return resultadoConAdvertencia(r.advertencia, tiempos, salida, compilacion)
    return resultadoHecho(st, r, tiempos, extras, compilacion)
  }

  private resultadoFilas(
    s: Sesion,
    d: DialectoSql,
    st: Sentencia,
    r: ResultadoFilasTrabajador,
    totalMs: number,
    { avisos, salida, siguientes }: ExtrasResultado,
    binds?: BindsSalientes
  ): DbResultadoFilas {
    const lectorVivo = r.lector !== null
    let lector: string | null = null
    if (r.hayMas) {
      const origen: OrigenLector = {
        tipo: 'consola',
        texto: st.texto,
        releible: st.consultaPura,
        dialecto: d,
        // Ya con el esquema que la sentencia dejó (`terminar` corrió antes).
        esquema: s.estado.esquema
      }
      // «Más» en PG y Contar re-ejecutan: con los MISMOS valores de los parámetros.
      if (binds !== undefined) origen.binds = binds
      lector = this.n.registrarLector(s, { id: r.lector ?? this.n.nuevoIdLector(), cursor: r.lector, desde: r.nFilas, origen })
    }
    const res: DbResultadoFilas = {
      tipo: 'filas',
      columnas: r.columnas,
      pagina: pagina(r, 0),
      lector,
      tiempos: { totalMs, ejecucionMs: r.msEjecucion, lecturaMs: r.msLectura }
    }
    // Más filas sin cursor vivo y sin poder re-ejecutar (RETURNING, nextval…).
    if (r.hayMas && !lectorVivo && !st.consultaPura) res.noReleible = true
    if (typeof r.afectadas === 'number') res.afectadas = r.afectadas
    if (avisos.length) res.avisos = avisos
    if (salida) res.salida = salida
    if (siguientes) res.siguientes = siguientes
    return res
  }

  /**
   * Los conjuntos EXTRA del trabajador como los del contrato: filas SIN
   * lector (no se paginan; si hay más, `hayMas` y el aviso que ya trae) o afectadas. El
   * tiempo total es el de la sentencia: los conjuntos llegan en la misma petición.
   */
  private conjuntosSiguientes(lista: readonly ConjuntoSiguienteTrabajador[], st: Sentencia, totalMs: number): DbConjuntoSiguiente[] {
    return lista.map((c): DbConjuntoSiguiente => {
      if (c.tipo === 'filas') {
        const f: DbConjuntoSiguiente = {
          tipo: 'filas',
          columnas: c.columnas,
          pagina: pagina(c, 0),
          lector: null,
          tiempos: { totalMs, ejecucionMs: c.msEjecucion, lecturaMs: c.msLectura }
        }
        if (c.avisos && c.avisos.length) f.avisos = c.avisos
        return f
      }
      const a: DbConjuntoSiguiente = { tipo: 'afectadas', filas: c.filas, comando: c.comando ?? st.verbo, tiempos: { totalMs, ejecucionMs: c.ms, lecturaMs: 0 } }
      if (c.avisos && c.avisos.length) a.avisos = c.avisos
      return a
    })
  }

  async errorDeSentencia(
    s: Sesion,
    p: Proceso,
    d: DialectoSql,
    st: Sentencia,
    e: unknown,
    t0: number
  ): Promise<DbRespuesta<DbResultadoSentencia>> {
    const ms = Date.now() - t0
    const tiempos: DbTiempos = { totalMs: ms, ejecucionMs: ms, lecturaMs: 0 }
    if (!esFalloTrabajador(e)) {
      this.n.terminar(s, { clase: st.clase, ok: false })
      return this.ap.respuestaDeFallo(e)
    }
    const et = e.error
    // Con una confirmación en camino, ni «revirtió» ni nada: no se sabe.
    const enDuda = s.commitEnCamino
    if (et.clase === 'perdida') {
      this.n.perder(s)
      return { ok: true, valor: { tipo: 'error', error: errorDePerdida(et, enDuda), tiempos } }
    }
    if (et.codigo === 'TESSERA-PLAZO') {
      this.n.perder(s, true)
      this.proc.matarColgado(p)
      const error = errorSql(et)
      if (enDuda) error.mensaje = `${textoEnDuda(enDuda, true)} (${error.mensaje})`
      return { ok: true, valor: { tipo: 'error', error, tiempos } }
    }
    // La sesión sigue viva. En PG, un error dentro de una transacción la deja en 'E':
    // se lee el estado real para que la UI ofrezca solo Rollback.
    const tx = await this.ap.sondaTx(s, p)
    this.n.terminar(s, tx !== undefined ? { clase: st.clase, ok: false, tx } : { clase: st.clase, ok: false })
    // Lo que no llegó al servidor es un `ok:false` (contrato).
    if (et.clase === 'protocolo' || et.clase === 'ocupada' || et.clase === 'driver') {
      return { ok: false, error: errorSql(et) }
    }
    const res: DbResultadoError = { tipo: 'error', error: errorSituado(st, et, d), tiempos }
    // Lo que el bloque escribió antes de fallar (o de que lo detuvieran) es lo que lo explica.
    if (et.salida && et.salida.length > 0) res.salida = et.salida
    // Lo que un lote de T-SQL devolvió antes de fallar.
    if (et.anteriores && et.anteriores.length > 0) res.anteriores = this.conjuntosSiguientes(et.anteriores, st, ms)
    return { ok: true, valor: res }
  }

  avisarDdl(s: Sesion, st: Sentencia): void {
    const global = /\b(USER|SCHEMA)\b/.test(st.verbo)
    const esquema = st.esquemaAfectado ?? this.esquemaDeSesionParaDdl(s)
    try {
      this.n.deps.alDdl?.(s.conexionId, esquema, global)
    } catch (e) {
      this.n.log(`alDdl falló: ${mensajeDe(e)}`)
    }
  }

  /**
   * El esquema que invalida un DDL sin esquema escrito: el de la sesión. Salvo en un motor con
   * nivel «Bases» (SQL Server), donde lo que la consola lleva como «esquema» es la BASE
   * (`USE`): no es un esquema del árbol, así que se invalida la conexión entera (null). Un
   * `switch` con `nunca`: un nivel nuevo no compila sin decidirlo.
   */
  private esquemaDeSesionParaDdl(s: Sesion): string | null {
    const con = this.n.deps.conexion(s.conexionId)
    if (!con) return s.estado.esquema
    const nivel = descriptorSql(con.motor).catalogo.nivelBases
    switch (nivel) {
      case 'ninguno':
        return s.estado.esquema
      case 'sinBaseFija':
        return null
      default:
        return nunca(nivel, 'esquemaDeSesionParaDdl')
    }
  }
}
