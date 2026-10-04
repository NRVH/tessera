// =============================================================================
// Lectores de resultados: la página siguiente (cursor vivo, o re-ejecución atada al esquema y
// a los binds con que nació) y el recuento bajo demanda. Un lector de consola cuyo esquema
// cambió no se re-ejecuta: leería otra tabla.
// Decisiones: docs/decisiones/bd/sesiones-esquema-de-consola.md
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import { DB_PAGINA_MAX, type DbEstadoTx, type DbPagina, type DbRespuesta } from '../../../../shared/db-explorador-ipc.ts'
import type { ClaseSentencia } from '../../../../shared/sql/clasificarSql.ts'
import {
  type BindsTrabajador,
  CODIGO_LECTOR_DESCONOCIDO,
  esFalloTrabajador,
  type OpcionesEjecucion,
  type PeticionSinIdDe,
  type ResultadoFilasTrabajador
} from '../protocoloTrabajador.ts'
import { construirConsultaTabla, construirConteo, type ConsultaRejilla, esErrorRejilla } from '../sqlRejilla.ts'
import type { Apertura } from './apertura.ts'
import { ErrorGestor, MENSAJE_ESQUEMA_CAMBIADO, MENSAJE_NO_RELEIBLE, MENSAJE_SIN_LECTOR } from './errores.ts'
import type { NucleoSesiones } from './NucleoSesiones.ts'
import { capacidades, opcionesDeLecturaEnFlujo, pagina } from './reglas.ts'
import type { Lector, OrigenLector, Proceso, Sesion } from './tipos.ts'

type OrigenConsola = Extract<OrigenLector, { tipo: 'consola' }>
type OrigenTabla = Extract<OrigenLector, { tipo: 'tabla' }>

/** La consulta de «Contar» de un lector. */
interface ConsultaConteo {
  sql: string
  binds: BindsTrabajador | undefined
  /** Re-ejecutar y contar saltando las filas, en vez de envolver en `COUNT(*)`. */
  contarSaltando: boolean
}

/**
 * La consulta de «Contar». En SQL Server la de una consola NO se envuelve en `SELECT COUNT(*)
 * FROM (…)` (una tabla derivada no admite ORDER BY sin TOP/OFFSET, ni un WITH, ni el `;`
 * final): se re-ejecuta tal cual y el trabajador cuenta las filas SALTÁNDOLAS todas.
 */
function consultaDeConteo(s: Sesion, o: OrigenLector): ConsultaConteo {
  if (o.tipo === 'tabla') {
    const c = construirConteo({ dialecto: o.dialecto, objeto: o.objeto, where: o.where, ...(o.filtro ? { filtro: o.filtro } : {}) })
    if (esErrorRejilla(c)) throw new ErrorGestor('interno', c.error)
    return { sql: c.sql, binds: c.binds as BindsTrabajador, contarSaltando: false }
  }
  // Se cuenta RE-EJECUTANDO el texto, también con un cursor de Oracle vivo: en otro
  // esquema contaría otra tabla. El lector sigue (su cursor, si lo hay, es válido).
  if (s.estado.esquema !== o.esquema) throw new ErrorGestor('noReleible', MENSAJE_ESQUEMA_CAMBIADO)
  const contarSaltando = 'cortarAlLlenar' in opcionesDeLecturaEnFlujo(o.dialecto, true)
  // Cada fragmento en su línea: un `--` final del usuario no se come el cierre. Envolver no
  // cambia los marcadores: los mismos nombres (Oracle) y posiciones (PG).
  const sql = contarSaltando ? o.texto : `SELECT COUNT(*) FROM (\n${o.texto}\n) q__`
  return { sql, binds: o.binds, contarSaltando }
}

function opcionesDeRelectura(soloLectura: boolean, maxFilas: number, o: OrigenTabla, c: ConsultaRejilla): OpcionesEjecucion {
  const opciones: OpcionesEjecucion = {
    proposito: 'usuario',
    maxFilas,
    candadoRO: soloLectura,
    sinBegin: true,
    comprobarTx: false,
    ...(o.topes ?? {}),
    ...(o.sinEsperar === true ? { sinEsperar: true } : {})
  }
  if (c.columnasExtraAlFinal) opciones.quitarUltimaColumna = true
  if (c.columnasClave) opciones.claveAlFinal = c.columnasClave
  return opciones
}

/** Más filas y recuento de un lector. */
export class LectoresSesion {
  private readonly n: NucleoSesiones
  private readonly ap: Apertura

  constructor(n: NucleoSesiones, ap: Apertura) {
    this.n = n
    this.ap = ap
  }

  /** Siguiente página de un lector (cursor vivo, o re-ejecución si es releíble). */
  async leerMas(id: string, maxFilas: number, peticionId?: string): Promise<DbRespuesta<DbPagina>> {
    if (!Number.isInteger(maxFilas) || maxFilas < 1 || maxFilas > DB_PAGINA_MAX) {
      return { ok: false, error: { motivo: 'interno', mensaje: `El tamaño de página tiene que estar entre 1 y ${DB_PAGINA_MAX}.` } }
    }
    const l = this.n.lector(id)
    if (!l) return { ok: false, error: { motivo: 'noReleible', mensaje: MENSAJE_SIN_LECTOR } }
    if (l.origen.tipo === 'consola' && !l.cursor && !l.origen.releible) {
      return { ok: false, error: { motivo: 'noReleible', mensaje: MENSAJE_NO_RELEIBLE } }
    }
    // Con `peticionId`, «más» se detiene como `contar` o la pestaña de tabla: la clave en la
    // cola es lo que `cancelar` busca. Sin clave, una re-ejecución lenta bloquearía la sesión
    // `datos` de toda la conexión.
    const clave = peticionId ? peticionId : null
    try {
      const valor = await l.sesion.cola.correr(() => this.correrMas(l, maxFilas, clave), clave !== null ? { clave } : {})
      return { ok: true, valor }
    } catch (e) {
      return this.ap.respuestaDeFallo(e)
    }
  }

  private async correrMas(l: Lector, maxFilas: number, clave: string | null): Promise<DbPagina> {
    const s = l.sesion
    try {
      if (this.n.lector(l.id) !== l) throw new ErrorGestor('noReleible', MENSAJE_SIN_LECTOR)
      const con = this.n.conexionOError(s.conexionId)
      const p = await this.ap.empezar(s, clave)
      let ok = false
      let tx: DbEstadoTx | undefined
      try {
        l.usadoEn = this.n.ahora()
        const desde = l.desde
        if (l.cursor) {
          try {
            const r = await p.trabajador.enviar<'leer'>({ op: 'leer', sesion: s.idTrabajador, lector: l.cursor, maxFilas })
            ok = true
            return this.avanzar(l, desde, r, r.lector, false)
          } catch (e) {
            // Un Stop (`break()`) hace que el trabajador suelte el cursor: se olvida
            // aquí también, y la página siguiente se re-ejecuta desde `desde`.
            if (esFalloTrabajador(e) && e.error.clase === 'cancelada') l.cursor = null
            // Lo expulsó el LRU del trabajador: se sigue re-ejecutando, si se puede.
            if (!(esFalloTrabajador(e) && e.error.codigo === CODIGO_LECTOR_DESCONOCIDO)) throw e
            l.cursor = null
          }
        }
        const r = await this.reejecutar(l, p, con, maxFilas)
        tx = r.tx
        ok = true
        return this.avanzar(l, desde, r, r.lector, true)
      } catch (e) {
        this.ap.tratarFallo(s, p, e)
        throw this.ap.aErrorGestor(e)
      } finally {
        this.terminarConsulta(s, ok, tx)
      }
    } finally {
      if (clave !== null && s.cancelada === clave) s.cancelada = null
    }
  }

  /** Termina la operación de lectura si sigue ocupada, con la tx leída si la hay. */
  private terminarConsulta(s: Sesion, ok: boolean, tx: DbEstadoTx | undefined): void {
    if (s.estado.fase === 'ocupada') {
      const ev: { clase: ClaseSentencia; ok: boolean; tx?: DbEstadoTx } = { clase: 'consulta', ok }
      if (tx !== undefined) ev.tx = tx
      this.n.terminar(s, ev)
    }
  }

  /** Síncrono a propósito: devuelve la promesa de la rama, sin un turno de más. */
  private reejecutar(l: Lector, p: Proceso, con: DbConnection, maxFilas: number): Promise<ResultadoFilasTrabajador> {
    const o = l.origen
    if (o.tipo === 'consola') return this.reejecutarConsola(l, o, p, con, maxFilas)
    return this.reejecutarTabla(l, o, p, con, maxFilas)
  }

  private async reejecutarConsola(
    l: Lector,
    o: OrigenConsola,
    p: Proceso,
    con: DbConnection,
    maxFilas: number
  ): Promise<ResultadoFilasTrabajador> {
    const s = l.sesion
    if (!o.releible) throw new ErrorGestor('noReleible', MENSAJE_NO_RELEIBLE)
    if (s.estado.esquema !== o.esquema) {
      // Su texto se resolvería contra OTRO esquema. No hay vuelta: la rejilla ya lo da por
      // cerrado (`lectorCerrado`) con este motivo.
      this.n.olvidarLector(l.id)
      throw new ErrorGestor('noReleible', MENSAJE_ESQUEMA_CAMBIADO)
    }
    const opciones: OpcionesEjecucion = {
      proposito: 'usuario',
      maxFilas,
      candadoRO: this.n.ro(con),
      txManual: this.n.manual(s, con),
      // Releer nunca abre un BEGIN.
      sinBegin: true,
      saltarFilas: l.desde,
      // SQL Server: solo se relee una consulta pura, que puede cortar al llenar.
      ...opcionesDeLecturaEnFlujo(o.dialecto, true)
    }
    if (capacidades(o.dialecto).lectorPorId) opciones.lector = this.n.nuevoIdLector()
    const peticion: PeticionSinIdDe<'ejecutar'> = { op: 'ejecutar', sesion: s.idTrabajador, sql: o.texto, opciones }
    // Los MISMOS binds: re-ejecutar sin ellos fallaría o, peor, leería otras filas.
    if (o.binds !== undefined) peticion.binds = o.binds
    const r = await p.trabajador.enviar<'ejecutar'>(peticion)
    this.n.marcarExpulsados(r)
    if (r.tipo !== 'filas') throw new ErrorGestor('noReleible', MENSAJE_SIN_LECTOR)
    return r
  }

  private async reejecutarTabla(
    l: Lector,
    o: OrigenTabla,
    p: Proceso,
    con: DbConnection,
    maxFilas: number
  ): Promise<ResultadoFilasTrabajador> {
    const s = l.sesion
    const c = construirConsultaTabla({
      dialecto: o.dialecto,
      objeto: o.objeto,
      where: o.where,
      orderBy: o.orderBy,
      // El MISMO filtro y orden que la primera página.
      ...(o.filtro ? { filtro: o.filtro } : {}),
      ...(o.orden ? { orden: o.orden } : {}),
      pkColumnas: o.pk,
      n: maxFilas + 1,
      desde: l.desde,
      forma: capacidades(o.dialecto).paginado.relectura,
      // La misma forma de fila que la primera página: el ROWID oculto, el último.
      ...(o.rowid === true ? { rowid: true } : {}),
      // SQLite: el alias del ROWID y, por clave, detrás de la última fila entregada.
      ...(o.aliasRowid !== undefined ? { aliasRowid: o.aliasRowid } : {}),
      ...(o.clave ? { clave: o.clave, despues: o.despues ?? null } : {})
    })
    if (esErrorRejilla(c)) throw new ErrorGestor('interno', c.error)
    const opciones = opcionesDeRelectura(this.n.ro(con), maxFilas, o, c)
    const r = await p.trabajador.enviar<'ejecutar'>({
      op: 'ejecutar',
      sesion: s.idTrabajador,
      sql: c.sql,
      binds: c.binds as BindsTrabajador,
      opciones
    })
    if (r.tipo !== 'filas') throw new ErrorGestor('noReleible', MENSAJE_SIN_LECTOR)
    // Por clave: la siguiente página va detrás de la última fila de ÉSTA.
    if (c.columnasClave && r.ultimaClave) o.despues = r.ultimaClave
    // ROWNUM ya acota a `n` filas: el cursor que el trabajador dejara abierto solo
    // tendría la fila de más. Se cierra y la siguiente página vuelve a re-ejecutar.
    if (r.lector) {
      try {
        await p.trabajador.enviar<'cerrarLector'>({ op: 'cerrarLector', sesion: s.idTrabajador, lector: r.lector })
      } catch {
        // si no se cerró, lo cerrará su tope LRU o el cierre de la sesión
      }
    }
    return { ...r, lector: null }
  }

  private avanzar(
    l: Lector,
    desde: number,
    r: { filasJson: string; nFilas: number; hayMas: boolean; recortes?: Array<[number, number, number]> },
    cursor: string | null,
    reejecutada: boolean
  ): DbPagina {
    l.desde = desde + r.nFilas
    l.cursor = r.hayMas ? cursor : null
    if (!r.hayMas) this.n.olvidarLector(l.id)
    return pagina(r, desde, reejecutada)
  }

  /** COUNT(*) bajo demanda, en la sesión del lector (ve sus propios cambios). */
  async contar(id: string, peticionId: string): Promise<DbRespuesta<number>> {
    const l = this.n.lector(id)
    if (!l) return { ok: false, error: { motivo: 'noReleible', mensaje: MENSAJE_SIN_LECTOR } }
    if (l.origen.tipo === 'consola' && !l.origen.releible) {
      return { ok: false, error: { motivo: 'noReleible', mensaje: MENSAJE_NO_RELEIBLE } }
    }
    try {
      const valor = await l.sesion.cola.correr(() => this.correrContar(l, peticionId), { clave: peticionId })
      return { ok: true, valor }
    } catch (e) {
      return this.ap.respuestaDeFallo(e)
    }
  }

  private async correrContar(l: Lector, peticionId: string): Promise<number> {
    const s = l.sesion
    const con = this.n.conexionOError(s.conexionId)
    const { sql, binds, contarSaltando } = consultaDeConteo(s, l.origen)
    let ok = false
    let tx: DbEstadoTx | undefined
    let p: Proceso | null = null
    try {
      p = await this.ap.empezar(s, peticionId)
      const opciones: OpcionesEjecucion = {
        proposito: 'usuario',
        maxFilas: 1,
        candadoRO: this.n.ro(con),
        txManual: s.rol === 'consola' ? this.n.manual(s, con) : false,
        sinBegin: true,
        comprobarTx: s.rol === 'consola'
      }
      if (contarSaltando) {
        opciones.saltarFilas = Number.MAX_SAFE_INTEGER
        opciones.consultaPura = true
      }
      const peticion: PeticionSinIdDe<'ejecutar'> = { op: 'ejecutar', sesion: s.idTrabajador, sql, opciones }
      if (binds !== undefined) peticion.binds = binds
      const r = await p.trabajador.enviar<'ejecutar'>(peticion)
      tx = r.tx
      if (r.tipo !== 'filas') throw new ErrorGestor('interno', 'El recuento no devolvió filas.')
      const filas = JSON.parse(r.filasJson) as unknown[][]
      const n = contarSaltando ? (r.saltadas ?? r.nFilas) : Number(String(filas[0]?.[0] ?? ''))
      if (!Number.isFinite(n)) throw new ErrorGestor('interno', 'El recuento no devolvió un número.')
      ok = true
      return n
    } catch (e) {
      if (p) this.ap.tratarFallo(s, p, e)
      throw this.ap.aErrorGestor(e)
    } finally {
      this.terminarConsulta(s, ok, tx)
      if (s.cancelada === peticionId) s.cancelada = null
    }
  }
}
