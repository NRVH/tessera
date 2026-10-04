// =============================================================================
// Apertura y arranque de operaciones: abrir la sesión dentro de su tarea de cola, marcarla
// ocupada, sondear la transacción tras un error y traducir los fallos a `ErrorGestor`.
// Decisiones: docs/decisiones/bd/sesiones-procesos-y-autoridad.md
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import type { DbErrorSql, DbEstadoTx } from '../../../../shared/db-explorador-ipc.ts'
import { esErrorCola } from '../colaSesion.ts'
import { MENSAJES, tieneTxPendiente } from '../maquinaSesion.ts'
import { MAX_CONSOLAS_VIVAS_POR_CONEXION, TIMEOUT_SQL_META_MS } from '../limites.ts'
import { esFalloTrabajador, type PeticionSinIdDe, type RespuestasPorOp } from '../protocoloTrabajador.ts'
import { ErrorGestor, mensajeDe, mensajePerdida, motivoDeClase, motivoDeRechazo, textoError } from './errores.ts'
import type { EsquemaConsola } from './esquemaConsola.ts'
import type { NucleoSesiones } from './NucleoSesiones.ts'
import type { Procesos } from './procesos.ts'
import { abierta, aConexionTrabajador, listaConProcesoVivo, rechazoDe } from './reglas.ts'
import type { Proceso, Sesion } from './tipos.ts'

/** Abre sesiones y arranca operaciones dentro de su tarea de cola. */
export class Apertura {
  private readonly n: NucleoSesiones
  private readonly proc: Procesos
  private readonly esq: EsquemaConsola

  constructor(n: NucleoSesiones, proc: Procesos, esq: EsquemaConsola) {
    this.n = n
    this.proc = proc
    this.esq = esq
  }

  /** Límite de consolas vivas por conexión: expulsa la ociosa más vieja o falla. */
  private hacerSitioConsola(s: Sesion): void {
    const vivas = this.n.sesionesDeConexion(s.conexionId).filter((x) => x !== s && x.rol === 'consola' && abierta(x))
    if (vivas.length < MAX_CONSOLAS_VIVAS_POR_CONEXION) return
    const victima = vivas
      .filter(
        (x) =>
          x.estado.fase === 'lista' && x.cola.vacia() && x.operacionUsuario === null && !tieneTxPendiente(x.estado)
      )
      .sort((a, b) => a.estado.ultimoUso - b.estado.ultimoUso)[0]
    if (!victima) {
      throw new ErrorGestor(
        'limite',
        `Hay ${MAX_CONSOLAS_VIVAS_POR_CONEXION} consolas con sesión abierta en esta conexión y todas están ocupadas o con transacciones pendientes.`
      )
    }
    const ef = this.n.aplicar(victima, { tipo: 'cierre', ahora: this.n.ahora(), motivo: 'expulsada' })
    this.n.efectosSincronos(victima, ef)
  }

  /** Abre la sesión si hace falta. Corre DENTRO de una tarea de su cola. */
  private async asegurarAbierta(s: Sesion): Promise<void> {
    if (listaConProcesoVivo(s)) return
    // `lista` sin proceso vivo: el proceso se fue sin que lo viéramos. Es una pérdida.
    if (s.estado.fase === 'lista') this.n.perder(s, true)
    if (this.n.estaCerrando()) throw new ErrorGestor('interno', 'Tessera se está cerrando.')
    const con = this.n.conexionOError(s.conexionId)
    const secreto = this.n.secretoDe(con)
    const archivo = this.n.archivoDe(con)
    if (s.rol === 'consola') this.hacerSitioConsola(s)
    // Una sola lectura para la máquina y para el trabajador: los dos con el MISMO valor.
    const soloLectura = this.n.ro(con)
    const ef = this.n.aplicar(s, { tipo: 'abrir', ahora: this.n.ahora(), soloLectura })
    if (!ef.some((e) => e.tipo === 'abrirSesion')) {
      if (s.estado.fase === 'lista') return
      throw new ErrorGestor('ocupada', MENSAJES.ocupada)
    }
    this.n.efectosSincronos(s, ef)
    let p: Proceso
    try {
      p = await this.proc.procesoPara(con, s)
    } catch (e) {
      this.n.aplicar(s, { tipo: 'errorAbrir', ahora: this.n.ahora() })
      throw this.aErrorGestor(e)
    }
    s.proceso = p
    p.ultimoUso = this.n.ahora()
    p.sinSesionesDesde = null
    this.n.log(`abrir ${s.rol} de ${con.id} en el proceso #${p.id}`)
    let respuesta: RespuestasPorOp['abrir']
    try {
      respuesta = await p.trabajador.enviar<'abrir'>(this.peticionAbrir(s, con, archivo, secreto, soloLectura))
    } catch (e) {
      throw this.falloAlAbrir(s, p, e)
    }
    s.driver = { modo: respuesta.modo, driverId: respuesta.driverId, version: respuesta.version }
    if (respuesta.driverId) p.driverId = respuesta.driverId
    let esquema = respuesta.esquema
    if (s.rol === 'consola') {
      s.esquemaConexion = respuesta.esquema
      // El esquema elegido en la consola se vuelve a aplicar ANTES de darla por
      // abierta: el selector no llega a ver el de la conexión entre medias.
      esquema = await this.esq.reaplicarEsquema(s, p, con, respuesta.esquema)
    }
    const ef2 = this.n.aplicar(s, { tipo: 'abierta', ahora: this.n.ahora(), esquema })
    if (ef2.some((e) => e.tipo === 'cerrarSesion')) {
      // Se cerró (o se perdió) mientras abría: la sesión recién abierta es huérfana.
      this.n.enviarCerrarEn(p, s.idTrabajador)
      if (s.proceso === p) s.proceso = null
      throw new ErrorGestor('interno', 'La sesión se cerró mientras se abría.')
    }
    this.avisarAlAbrir(con.id, respuesta.driverId)
  }

  /** El mensaje `abrir` del trabajador. El contexto de drivers se pide aquí, justo antes de enviar. */
  private peticionAbrir(
    s: Sesion,
    con: DbConnection,
    archivo: string | null,
    secreto: string,
    soloLectura: boolean
  ): PeticionSinIdDe<'abrir'> {
    return {
      op: 'abrir',
      sesion: s.idTrabajador,
      rol: s.rol,
      conexion: aConexionTrabajador(con, archivo, soloLectura),
      secreto,
      ctx: this.n.deps.ctxDrivers(),
      opciones: {
        timeoutMs: s.rol === 'meta' ? TIMEOUT_SQL_META_MS : 0,
        autoCommit: !(s.rol === 'consola' && s.estado.txModo === 'manual'),
        // Las efímeras (exportar, enviar) se distinguen en `application_name` / MODULE.
        accion: s.accion ?? s.rol
      }
    }
  }

  /** `abrir` falló en el trabajador: la sesión vuelve atrás y un plazo vencido mata el proceso. */
  private falloAlAbrir(s: Sesion, p: Proceso, e: unknown): ErrorGestor {
    if (s.proceso === p) s.proceso = null
    this.n.aplicar(s, { tipo: 'errorAbrir', ahora: this.n.ahora() })
    if (esFalloTrabajador(e) && e.error.codigo === 'TESSERA-PLAZO') this.proc.matarColgado(p)
    return this.aErrorGestor(e)
  }

  private avisarAlAbrir(conexionId: string, driverId: string | null): void {
    try {
      this.n.deps.alAbrir?.(conexionId, driverId)
    } catch (e) {
      this.n.log(`alAbrir falló: ${mensajeDe(e)}`)
    }
  }

  /**
   * Arranque de una operación DENTRO de su tarea de cola: abre si hace falta, marca
   * la sesión ocupada y devuelve el proceso. `clave` es la de Stop (o null).
   */
  async empezar(s: Sesion, clave: string | null): Promise<Proceso> {
    for (let intento = 0; ; intento++) {
      await this.asegurarAbierta(s)
      if (clave !== null && s.cancelada === clave) throw new ErrorGestor('cancelada', 'Operación cancelada.')
      const ef = this.n.aplicar(s, { tipo: 'ejecutar', ahora: this.n.ahora() })
      const r = rechazoDe(ef)
      if (r) {
        // Se perdió entre abrir y ejecutar: una segunda vuelta la reabre.
        if (r.motivo === 'cerrada' && intento === 0) continue
        throw new ErrorGestor(motivoDeRechazo(r.motivo), r.mensaje)
      }
      const p = s.proceso
      if (!p) {
        this.n.perder(s)
        throw new ErrorGestor('sesionPerdida', MENSAJES.perdidaSinTx)
      }
      p.ultimoUso = this.n.ahora()
      s.enTrabajador = clave
      return p
    }
  }

  /** Estado REAL de la tx tras un error (PG: 'E'). undefined si no se pudo leer. */
  async sondaTx(s: Sesion, p: Proceso): Promise<DbEstadoTx | undefined> {
    try {
      return (await p.trabajador.enviar<'tx'>({ op: 'tx', sesion: s.idTrabajador, accion: 'estado' })).tx
    } catch (e) {
      if (esFalloTrabajador(e) && e.error.clase === 'perdida') this.n.perder(s)
      return undefined
    }
  }

  /** Error de una operación cualquiera -> ErrorGestor (mensaje seguro). */
  aErrorGestor(e: unknown): ErrorGestor {
    if (e instanceof ErrorGestor) return e
    if (esErrorCola(e)) return new ErrorGestor('cancelada', e.message)
    if (esFalloTrabajador(e)) {
      const et = e.error
      if (et.clase === 'perdida') return new ErrorGestor('sesionPerdida', mensajePerdida(et), et.codigo ? { codigo: et.codigo } : {})
      const eg = new ErrorGestor(motivoDeClase(et.clase), textoError(et))
      if (et.codigo) eg.error.codigo = et.codigo
      if (et.requiereDriver) eg.error.requiereDriver = et.requiereDriver
      return eg
    }
    // Recortado: un fallo de JSON.parse, por ejemplo, cita un trozo de las filas.
    this.n.log(`error interno: ${mensajeDe(e).slice(0, 200)}`)
    return new ErrorGestor('interno', 'Error interno del explorador de bases de datos.')
  }

  respuestaDeFallo(e: unknown): { ok: false; error: DbErrorSql } {
    return { ok: false, error: this.aErrorGestor(e).error }
  }

  /** Fallo del trabajador dentro de una operación: pérdida y cuelgue se tratan aquí. */
  tratarFallo(s: Sesion, p: Proceso, e: unknown): void {
    if (!esFalloTrabajador(e)) return
    if (e.error.clase === 'perdida') this.n.perder(s)
    else if (e.error.codigo === 'TESSERA-PLAZO') {
      this.n.perder(s, true)
      this.proc.matarColgado(p)
    }
  }
}
