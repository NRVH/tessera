// =============================================================================
// «Enviar» de la rejilla SQL: todo o nada en una sesión efímera propia, espera de bloqueos
// acotada antes de escribir, una fila por DML y el Stop mirado antes del COMMIT.
// Las sentencias las construye el controlador (`edicionRejilla.ts`); aquí solo se ejecutan.
// Decisiones: docs/decisiones/bd/transacciones-enviar-todo-o-nada.md
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import { mismoArchivo } from '../../rutaArchivoBd.ts'
import type { DbErrorSql, DbRespuesta, DbResultadoEnvio, DbTiempos } from '../../../../shared/db-explorador-ipc.ts'
import { dialectoDeMotor, type DialectoSql } from '../../../../shared/sql/dialectosSql.ts'
import {
  type BindsEnvio,
  esEsperaDeBloqueo,
  esOcupadaSinEspera,
  type LoteBloqueo,
  loteDeBloqueo,
  lotesDeBloqueo,
  mensajeFalloCommit,
  mensajeFilaBloqueada,
  mensajeFilas,
  MOTIVO_SOLO_LECTURA,
  notaSinCulpable,
  primerCulpable,
  type SentenciaEnvio,
  sqlEsperaBloqueoTransaccion
} from '../edicionRejilla.ts'
import { exigeConfirmacion, mensajeProduccion } from '../produccion.ts'
import { MENSAJES, tieneTxPendiente } from '../maquinaSesion.ts'
import { esFalloTrabajador, type FalloTrabajador, type ResultadoTrabajador } from '../protocoloTrabajador.ts'
import { motorExplorador } from '../motores/index.ts'
import type { Apertura } from './apertura.ts'
import { ErrorGestor, errorSql } from './errores.ts'
import type { NucleoSesiones } from './NucleoSesiones.ts'
import { esperaPorArchivo, leerCabeceraArchivo } from './reglas.ts'
import type { PeticionEnvio, Proceso, Sesion } from './tipos.ts'

/** Lo que comparten las fases de un envío: su sesión, su proceso y cómo revertir o fallar. */
interface PasosEnvio {
  s: Sesion
  p: Proceso
  d: DialectoSql
  req: PeticionEnvio
  clave: string
  tiempos: () => DbTiempos
  revertir: () => Promise<void>
  enviarSql: (sql: string, binds: BindsEnvio, esDml: boolean) => Promise<ResultadoTrabajador>
  fallo: (i: number, tipo: SentenciaEnvio['tipo'], e: unknown, nota?: string) => Promise<DbResultadoEnvio>
  detenido: (i: number) => Promise<DbResultadoEnvio>
}

/** Un viaje antes de los cambios y qué responder si falla. */
interface PasoPrevio {
  sql: string
  binds: BindsEnvio
  /** El índice que se da por detenido si llega un Stop antes de este paso; null = no se mira. */
  stop: number | null
  fallo: (e: unknown) => Promise<DbResultadoEnvio>
}

/** Las filas que tocó un DML, según la forma de su respuesta. */
function filasTocadas(r: ResultadoTrabajador): number {
  return r.tipo === 'afectadas' ? r.filas : r.tipo === 'filas' ? (r.afectadas ?? r.nFilas) : 0
}

/** Un cambio que no tocó EXACTAMENTE una fila: se revierte y se señala ese cambio. */
function errorDeFilas(filas: number, tipo: SentenciaEnvio['tipo']): DbErrorSql {
  return { motivo: 'servidor', codigo: 'TESSERA-FILAS', mensaje: mensajeFilas(filas, tipo) }
}

/** Una consola con una transacción viva (las efímeras no cuentan: acaban solas). */
function consolaConTransaccion(s: Sesion): boolean {
  return !s.eliminada && !s.interna && s.rol === 'consola' && s.ref.rol === 'consola' && s.estado.tx !== 'ninguna'
}

/** «Enviar» de la rejilla SQL. */
export class EnvioRejilla {
  private readonly n: NucleoSesiones
  private readonly ap: Apertura

  constructor(n: NucleoSesiones, ap: Apertura) {
    this.n = n
    this.ap = ap
  }

  /**
   * Aplica los cambios de la rejilla TODO O NADA. Solo lectura y producción sin `confirmado`
   * se rechazan sin abrir nada (segunda barrera: el controlador ya lo miró). `ok:false` = no
   * se envió nada; lo que llegó al servidor viaja como `DbResultadoEnvio` en un `ok:true`,
   * también el error, para que la rejilla señale la fila.
   */
  async enviarCambios(req: PeticionEnvio): Promise<DbRespuesta<DbResultadoEnvio>> {
    let con: DbConnection
    try {
      con = this.n.conexionOError(req.conexionId)
    } catch (e) {
      return this.ap.respuestaDeFallo(e)
    }
    if (this.n.ro(con)) {
      // El MISMO texto que el controlador y que la identidad 'ninguna' (uno solo).
      return { ok: false, error: { motivo: 'soloLectura', mensaje: MOTIVO_SOLO_LECTURA } }
    }
    if (exigeConfirmacion(con, this.n.ro(con), req.confirmado)) {
      return { ok: false, error: { motivo: 'produccion', mensaje: mensajeProduccion(con.alias, 'enviar') } }
    }
    if (!Array.isArray(req.sentencias) || req.sentencias.length === 0) {
      return { ok: false, error: { motivo: 'interno', mensaje: 'No hay cambios que enviar.' } }
    }
    // Síncrono a propósito: el envío se encola en el MISMO turno en que llega (un Stop de la
    // preparación lo encuentra en la cola). Solo se espera —el nombre de la consola— cuando
    // ya se sabe que NO se envía nada.
    const bloqueo = this.sesionQueBloqueaElArchivo(con)
    if (bloqueo !== null) return { ok: false, error: { motivo: 'txPendiente', mensaje: await this.mensajeDeBloqueo(bloqueo) } }
    const d = dialectoDeMotor(con.motor)
    let s: Sesion
    try {
      s = this.n.sesionEdicion(con, req.peticionId)
    } catch (e) {
      return this.ap.respuestaDeFallo(e)
    }
    let usado: Proceso | null = null
    try {
      const valor = await s.cola.correr(
        () =>
          this.correrEnvio(s, d, req, (p) => {
            usado = p
          }),
        { clave: req.peticionId }
      )
      return { ok: true, valor }
    } catch (e) {
      return this.ap.respuestaDeFallo(e)
    } finally {
      this.n.soltarSesionEfimera(s, usado)
    }
  }

  /**
   * En un motor que bloquea el ARCHIVO entero al escribir (SQLite): la consola de Tessera con
   * una transacción sobre el MISMO archivo que haría esperar al envío, o null. Con cambios
   * pendientes siempre; si solo leyó, según diga el motor por la cabecera del archivo
   * (`lectorBloquea`). SÍNCRONO: el envío que no está bloqueado se encola en el mismo turno.
   */
  private sesionQueBloqueaElArchivo(con: DbConnection): { s: Sesion; otra: DbConnection } | null {
    const espera = esperaPorArchivo(con.motor)
    if (espera === null || !this.n.deps.rutaArchivo) return null
    const ruta = this.rutaGuardada(con.id)
    if (!ruta) return null
    // La cabecera se lee UNA vez y solo si hace falta.
    let lectorBloquea: boolean | null = null
    const bloqueaUnLector = (): boolean => {
      if (lectorBloquea === null) {
        let cabecera: Uint8Array | null
        try {
          cabecera = (this.n.deps.leerCabecera ?? leerCabeceraArchivo)(ruta)
        } catch {
          cabecera = null
        }
        lectorBloquea = espera.lectorBloquea(cabecera)
      }
      return lectorBloquea
    }
    for (const s of this.n.sesiones()) {
      if (!consolaConTransaccion(s)) continue
      const otra = this.n.deps.conexion(s.conexionId)
      if (!otra || esperaPorArchivo(otra.motor) === null) continue
      const suya = this.rutaGuardada(otra.id)
      if (!suya || !mismoArchivo(suya, ruta)) continue
      if (tieneTxPendiente(s.estado) || bloqueaUnLector()) return { s, otra }
    }
    return null
  }

  /** La ruta guardada de una conexión de archivo, o null: una ruta ilegible no bloquea nada. */
  private rutaGuardada(id: string): string | null {
    try {
      return this.n.deps.rutaArchivo?.(id) ?? null
    } catch {
      return null
    }
  }

  /** El mensaje de `sesionQueBloqueaElArchivo`: qué consola, qué tiene y qué hacer. */
  private async mensajeDeBloqueo(b: { s: Sesion; otra: DbConnection }): Promise<string> {
    let nombre: string | null = null
    try {
      nombre = this.n.deps.nombreConsola && b.s.ref.rol === 'consola' ? await this.n.deps.nombreConsola(b.s.ref.perfilId, b.s.ref.consolaId) : null
    } catch {
      nombre = null
    }
    const quien = nombre ? `La consola «${nombre}» (${b.otra.alias})` : `Una consola de «${b.otra.alias}»`
    const que = tieneTxPendiente(b.s.estado) ? 'tiene cambios sin confirmar' : 'tiene una transacción abierta'
    return `${quien} ${que} en este mismo archivo, y mientras tanto el archivo entero queda bloqueado para escribir. Confírmala o revírtela en esa consola y vuelve a enviar.`
  }

  /**
   * La tarea de la cola del envío, en este orden: pasos previos (base, candado por lotes, tope
   * de espera) → cambios, cada uno tocando EXACTAMENTE una fila → Stop antes del COMMIT →
   * COMMIT. Cada viaje al trabajador se espera AQUÍ, en el cuerpo: repartirlos en funciones
   * `async` encadenadas sumaría turnos entre una respuesta y el siguiente envío, y cambiaría el
   * orden frente a las otras sesiones. Solo lo que no viaja sale a funciones síncronas. La
   * sesión se termina SIEMPRE, pase lo que pase.
   */
  private async correrEnvio(s: Sesion, d: DialectoSql, req: PeticionEnvio, usar: (p: Proceso) => void): Promise<DbResultadoEnvio> {
    const clave = req.peticionId
    const t0 = Date.now()
    try {
      // Si no abre (o un Stop llega antes), lanza: `ok:false`, no se envió nada.
      const p = await this.ap.empezar(s, clave)
      usar(p)
      const pe = this.pasosEnvio(s, p, d, req, clave, t0)
      try {
        for (const paso of this.pasosPrevios(pe)) {
          if (paso.stop !== null && s.cancelada === clave) return await pe.detenido(paso.stop)
          try {
            await pe.enviarSql(paso.sql, paso.binds, false)
          } catch (e) {
            return await paso.fallo(e)
          }
        }
        for (let i = 0; i < req.sentencias.length; i++) {
          if (s.cancelada === clave) return await pe.detenido(i)
          const st = req.sentencias[i]
          let r: ResultadoTrabajador
          try {
            r = await pe.enviarSql(st.sql, st.binds, true)
          } catch (e) {
            return await pe.fallo(i, st.tipo, e)
          }
          const filas = filasTocadas(r)
          if (filas !== 1) {
            await pe.revertir()
            return { tipo: 'error', indice: i, filas, error: errorDeFilas(filas, st.tipo), tiempos: pe.tiempos() }
          }
        }
        // Un Stop con la ÚLTIMA sentencia en vuelo, que el trabajador ya no alcanzó: el COMMIT aún
        // no salió, así que ROLLBACK y 'cancelada' en el índice de esa última (nunca -1, que es un
        // COMMIT fallido). Un Stop con el COMMIT en camino no lo interrumpe: nunca se corta un `tx`.
        if (s.cancelada === clave) return await pe.detenido(req.sentencias.length - 1)
        try {
          await p.trabajador.enviar<'tx'>({ op: 'tx', sesion: s.idTrabajador, accion: 'commit' })
        } catch (e) {
          this.ap.tratarFallo(s, p, e)
          await pe.revertir()
          return { tipo: 'error', indice: -1, error: this.errorDeCommit(e), tiempos: pe.tiempos() }
        }
        return { tipo: 'hecho', cambios: req.sentencias.length, tiempos: pe.tiempos() }
      } finally {
        if (s.estado.fase === 'ocupada') this.n.terminar(s, { clase: 'dml', ok: true, tx: 'ninguna' })
      }
    } finally {
      if (s.cancelada === clave) s.cancelada = null
    }
  }

  /**
   * Los viajes antes del primer cambio, en orden y sin enviar nada todavía: la base del nivel
   * «Bases» (SQL Server, `USE`; sin Stop antes, como siempre), el candado por lotes de Oracle
   * (sus filas ANTES de ningún DML) y el tope de espera de PG, que va en la transacción con la
   * PRIMERA sentencia y vale para todas. SQL de Tessera, puro: calcularlo antes no cambia nada.
   */
  private pasosPrevios(pe: PasosEnvio): PasoPrevio[] {
    const { req } = pe
    const pasos: PasoPrevio[] = []
    const fijar = req.base === undefined ? null : motorExplorador(pe.d).sesion.sqlFijarEsquema(req.base, null)
    if (fijar !== null) {
      pasos.push({ sql: fijar.sql, binds: fijar.binds as BindsEnvio, stop: null, fallo: (e) => pe.fallo(0, req.sentencias[0]?.tipo ?? 'editar', e) })
    }
    for (const lote of lotesDeBloqueo(pe.d, req.sentencias)) {
      pasos.push({ sql: lote.sql, binds: lote.binds, stop: lote.indices[0], fallo: (e) => this.falloDeLote(pe, lote, e) })
    }
    const tope = sqlEsperaBloqueoTransaccion(pe.d)
    if (tope !== null && req.sentencias.length > 0) {
      pasos.push({ sql: tope, binds: [], stop: 0, fallo: (e) => pe.fallo(0, req.sentencias[0].tipo, e) })
    }
    return pasos
  }

  /**
   * El error de un COMMIT que falló (una restricción DIFERIDA, sin cambio al que culpar). Solo
   * un error del SERVIDOR asegura que no quedó nada; una pérdida con el COMMIT en camino deja
   * la duda, y así lo dice (`mensajeFalloCommit`).
   */
  private errorDeCommit(e: unknown): DbErrorSql {
    const et = esFalloTrabajador(e) ? e.error : null
    const error: DbErrorSql = et ? errorSql(et) : this.ap.aErrorGestor(e).error
    error.mensaje = mensajeFalloCommit(error.mensaje, et ? et.clase : null)
    return error
  }

  private pasosEnvio(s: Sesion, p: Proceso, d: DialectoSql, req: PeticionEnvio, clave: string, t0: number): PasosEnvio {
    let msEjecucion = 0
    const tiempos = (): DbTiempos => ({ totalMs: Date.now() - t0, ejecucionMs: msEjecucion, lecturaMs: 0 })
    const revertir = async (): Promise<void> => {
      if (!p.trabajador.vivo) return
      try {
        await p.trabajador.enviar<'tx'>({ op: 'tx', sesion: s.idTrabajador, accion: 'rollback' })
      } catch {
        // El `cerrar` de la sesión efímera revierte igualmente, y una sesión perdida
        // ya la revirtió el servidor: nada se confirmó.
      }
    }
    // Transacción MANUAL, sin candado (la conexión no es de solo lectura) y sin sonda de tx:
    // el estado lo dice el final. `usuario`: el Stop la interrumpe.
    const enviarSql = async (sql: string, binds: BindsEnvio, esDml: boolean): Promise<ResultadoTrabajador> => {
      const t1 = Date.now()
      try {
        return await p.trabajador.enviar<'ejecutar'>({
          op: 'ejecutar',
          sesion: s.idTrabajador,
          sql,
          binds,
          opciones: { proposito: 'usuario', maxFilas: 1, candadoRO: false, txManual: true, sinBegin: false, esDml, comprobarTx: false }
        })
      } finally {
        msEjecucion += Date.now() - t1
      }
    }
    // Cualquier fallo a media transacción: ROLLBACK y el índice del cambio culpable.
    // `nota`: lo que el mensaje tiene que añadir (un candado que no pudo señalar la fila).
    const fallo = async (i: number, tipo: SentenciaEnvio['tipo'], e: unknown, nota?: string): Promise<DbResultadoEnvio> => {
      this.ap.tratarFallo(s, p, e)
      await revertir()
      const et = esFalloTrabajador(e) ? e.error : null
      let error: DbErrorSql
      if (!et) error = this.ap.aErrorGestor(e).error
      else if (et.clase === 'perdida') {
        error = { motivo: 'sesionPerdida', mensaje: `${MENSAJES.perdidaConTx}: no se aplicó nada.`, ...(et.codigo ? { codigo: et.codigo } : {}) }
      } else if (esEsperaDeBloqueo(d, et.codigo)) {
        // Venció la espera de la fila (`FOR UPDATE WAIT` / `lock_timeout`).
        error = { motivo: 'servidor', mensaje: mensajeFilaBloqueada(tipo), ...(et.codigo ? { codigo: et.codigo } : {}) }
      } else error = errorSql(et)
      if (nota) error.mensaje = `${error.mensaje} ${nota}`
      return { tipo: 'error', indice: i, error, tiempos: tiempos() }
    }
    const detenido = async (i: number): Promise<DbResultadoEnvio> => {
      await revertir()
      return { tipo: 'error', indice: i, error: { motivo: 'cancelada', mensaje: 'Envío detenido: no se aplicó nada.' }, tiempos: tiempos() }
    }
    return { s, p, d, req, clave, tiempos, revertir, enviarSql, fallo, detenido }
  }

  /**
   * Un candado de lote falló. Un error del SERVIDOR es de alguna de sus filas: se busca cuál
   * por bisección con NOWAIT (`primerCulpable`). Una pérdida, un Stop o un plazo son del lote
   * entero y van en su primer cambio.
   */
  private async falloDeLote(pe: PasosEnvio, lote: LoteBloqueo, e: unknown): Promise<DbResultadoEnvio> {
    const { s, d, req, clave, fallo, detenido } = pe
    const i0 = lote.indices[0]
    const et = esFalloTrabajador(e) ? e.error : null
    if (!et || et.clase !== 'servidor' || lote.indices.length === 1) return await fallo(i0, req.sentencias[i0].tipo, e)
    if (s.cancelada === clave) return await detenido(i0)
    let culpable: number | null
    // El error de la ÚLTIMA sonda que falló, que es el de la fila señalada ella sola. En un
    // objeto: el compilador no ve la asignación dentro de la sonda.
    const ultimaSonda: { fallo: FalloTrabajador | null } = { fallo: null }
    try {
      culpable = await primerCulpable(lote.indices, async (sub) => {
        // Un Stop durante la búsqueda la corta: el envío ya no va a salir.
        if (s.cancelada === clave) throw new ErrorGestor('cancelada', 'Envío detenido.')
        const sonda = loteDeBloqueo(d, req.sentencias, sub, 'nowait')
        try {
          await pe.enviarSql(sonda.sql, sonda.binds, false)
          return false
        } catch (e2) {
          if (esFalloTrabajador(e2) && e2.error.clase === 'servidor') {
            ultimaSonda.fallo = e2
            return true
          }
          throw e2
        }
      })
    } catch (e2) {
      if (s.cancelada === clave) return await detenido(i0)
      return await fallo(i0, req.sentencias[i0].tipo, e2)
    }
    if (culpable === null) {
      const ultimo = lote.indices[lote.indices.length - 1]
      return await fallo(i0, req.sentencias[i0].tipo, e, notaSinCulpable(i0, ultimo, esEsperaDeBloqueo(d, et.codigo)))
    }
    // El «ocupada» del NOWAIT es la espera del lote (su código y su mensaje); cualquier otro
    // error de su sonda es de ESA fila.
    const suyo = ultimaSonda.fallo
    const delCulpable = suyo !== null && !esOcupadaSinEspera(d, suyo.error.codigo) ? suyo : e
    return await fallo(culpable, req.sentencias[culpable].tipo, delCulpable)
  }
}
