// =============================================================================
// Exportar una consulta de consola y leer el valor completo de una celda, en la sesión que
// ve su transacción; la consulta se valida antes de pedir dónde guardar.
// Decisiones: docs/decisiones/bd/sesiones-exportar-con-cursor-vivo.md
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import { DB_CONSOLA_MAX_BYTES, DB_PAGINA_MAX, type DbBinds, type DbRespuesta } from '../../../../shared/db-explorador-ipc.ts'
import { dialectoDeMotor, type DialectoSql } from '../../../../shared/sql/dialectosSql.ts'
import { dividirSentencias, type Sentencia } from '../../../../shared/sql/divisorSql.ts'
import { permitidaEnSoloLectura } from '../../../../shared/sql/clasificarSql.ts'
import { txInicialDePeticion } from '../../../../shared/ajustesBd.ts'
import type { BindsSalientes } from '../bindsConsola.ts'
import type { OpcionesEjecucion, PeticionSinIdDe, ResultadoFilasTrabajador } from '../protocoloTrabajador.ts'
import type { Apertura } from './apertura.ts'
import { ErrorGestor, MENSAJE_ESQUEMA_CAMBIADO, MENSAJE_EXPORTAR_NO_RELEIBLE } from './errores.ts'
import type { ExportarTabla } from './exportarTabla.ts'
import type { NucleoSesiones } from './NucleoSesiones.ts'
import { bindsDeSentencia, capacidades, opcionesDeLecturaEnFlujo, paginaExportada } from './reglas.ts'
import type { ConsumidorPaginas, PeticionValor, RefConsola, Sesion, TopesLectura } from './tipos.ts'

/** Exportación de una consulta de consola y lectura del valor completo de una celda. */
export class ExportarConsulta {
  private readonly n: NucleoSesiones
  private readonly ap: Apertura
  private readonly expTabla: ExportarTabla

  constructor(n: NucleoSesiones, ap: Apertura, expTabla: ExportarTabla) {
    this.n = n
    this.ap = ap
    this.expTabla = expTabla
  }

  /**
   * Lee UNA celda entera (SQL y binds de `valorCelda.ts`): LOB hasta `DB_VALOR_MAX` y binario
   * como hex con el mismo tope; devuelve la lectura cruda. La de una pestaña de tabla, en
   * `datos`; la de un resultado de consola, en la sesión de ESA consola, la única que ve su
   * transacción sin confirmar (en `datos` una fila recién insertada «no existiría»).
   */
  async leerValor(req: PeticionValor): Promise<DbRespuesta<ResultadoFilasTrabajador>> {
    let donde: { con: DbConnection; s: Sesion }
    try {
      donde = this.sesionDeValor(req)
    } catch (e) {
      return this.ap.respuestaDeFallo(e)
    }
    const { con, s } = donde
    const deConsola = s.rol === 'consola'
    try {
      const valor = await s.cola.correr(
        () => this.correrValor(s, con, req, deConsola),
        // En la consola pasa por delante de un «más» o un «Contar» que esperen: es lo
        // que el usuario está mirando (el visor lo pide al abrirse).
        deConsola ? { prioridad: 'alta' } : {}
      )
      return { ok: true, valor }
    } catch (e) {
      return this.ap.respuestaDeFallo(e)
    }
  }

  /** La sesión donde se lee la celda: la de su consola, o `datos` para la pestaña de tabla. */
  private sesionDeValor(req: PeticionValor): { con: DbConnection; s: Sesion } {
    if (req.consola) {
      if (req.consola.conexionId !== req.conexionId) throw new ErrorGestor('interno', 'Esa consola no es de esta conexión.')
      const con = this.n.conexionDeConsola(req.consola)
      const s = this.n.sesionDe(
        { rol: 'consola', perfilId: req.consola.perfilId, consolaId: req.consola.consolaId },
        con,
        txInicialDePeticion(req.consola.txInicial)
      )
      // Al instante, sin encolarse: esperaría detrás de su sentencia o del cursor
      // vivo de una exportación, y el visor se quedaría «cargando» sin saber por qué.
      if (s.operacionUsuario !== null) throw new ErrorGestor('ocupada', 'La consola está ejecutando.')
      return { con, s }
    }
    const con = this.n.conexionOError(req.conexionId)
    return { con, s: this.n.sesionDe({ rol: 'datos', conexionId: con.id }, con) }
  }

  private async correrValor(s: Sesion, con: DbConnection, req: PeticionValor, deConsola: boolean): Promise<ResultadoFilasTrabajador> {
    const p = await this.ap.empezar(s, null)
    let ok = false
    try {
      const opciones: OpcionesEjecucion = {
        proposito: 'usuario',
        maxFilas: 1,
        candadoRO: this.n.ro(con),
        // Releer nunca abre un BEGIN; dentro de una tx la ve igual.
        sinBegin: true,
        comprobarTx: false,
        ...req.topes
      }
      // En la consola, con SU modo, como al exportar la consulta.
      if (deConsola) opciones.txManual = this.n.manual(s, con)
      const r = await p.trabajador.enviar<'ejecutar'>({
        op: 'ejecutar',
        sesion: s.idTrabajador,
        sql: req.sql,
        binds: req.binds,
        opciones
      })
      this.n.marcarExpulsados(r)
      if (r.tipo !== 'filas') throw new ErrorGestor('interno', 'La lectura del valor no devolvió filas.')
      // Con la PK no puede haber dos filas; si el trabajador dejó un cursor, fuera.
      if (r.lector) {
        await p.trabajador
          .enviar<'cerrarLector'>({ op: 'cerrarLector', sesion: s.idTrabajador, lector: r.lector })
          .catch(() => undefined)
      }
      ok = true
      return r
    } catch (e) {
      this.ap.tratarFallo(s, p, e)
      throw this.ap.aErrorGestor(e)
    } finally {
      if (s.estado.fase === 'ocupada') this.n.terminar(s, { clase: 'consulta', ok })
    }
  }

  /**
   * ¿Se puede volver a ejecutar este texto para exportarlo? Exactamente UNA sentencia,
   * de clase `consulta` y PURA (sin nextval/setval: repetirla cambiaría datos), y con
   * la guardia de solo lectura. Lanza `ErrorGestor` (`noReleible`, `soloLectura`); sin
   * efectos, para validar antes de abrir el diálogo de guardar.
   */
  validarExportacionConsulta(
    ref: RefConsola,
    sql: string,
    esquema?: string | null,
    bindsCrudos?: DbBinds
  ): { con: DbConnection; d: DialectoSql; st: Sentencia; binds: BindsSalientes | undefined } {
    const con = this.n.conexionDeConsola(ref)
    const d = dialectoDeMotor(con.motor)
    if (typeof sql !== 'string' || sql.length > DB_CONSOLA_MAX_BYTES) {
      throw new ErrorGestor('limite', 'La consulta es demasiado grande.')
    }
    const partes = dividirSentencias(sql, d)
    if (partes.length !== 1 || partes[0].clase !== 'consulta' || !partes[0].consultaPura) {
      throw new ErrorGestor('noReleible', MENSAJE_EXPORTAR_NO_RELEIBLE)
    }
    const st = partes[0]
    if (this.n.ro(con)) {
      const permiso = permitidaEnSoloLectura(st, d)
      if (!permiso.ok) throw new ErrorGestor('soloLectura', permiso.motivo)
    }
    // Los parámetros con los que se ejecutó: sin ellos, re-ejecutar fallaría.
    const b = bindsDeSentencia(st, d, bindsCrudos)
    if (!b.ok) {
      const { mensaje, motivo, ...extra } = b.error
      throw new ErrorGestor(motivo, mensaje, extra)
    }
    // Antes del diálogo: que no pida dónde guardar para acabar diciendo «ocupada».
    const s = this.n.sesionDeConsola(ref.perfilId, ref.consolaId)
    if (s && !s.eliminada && s.operacionUsuario !== null) throw new ErrorGestor('ocupada', 'La consola está ejecutando.')
    // Y en otro esquema exportaría otra tabla: el renderer cae a lo ya cargado.
    if (s && !s.eliminada && this.exportaEnOtroEsquema(s, esquema)) throw new ErrorGestor('noReleible', MENSAJE_ESQUEMA_CAMBIADO)
    return { con, d, st, binds: b.binds }
  }

  /**
   * ¿Volver a ejecutar para exportar leería en otro esquema que el que vio el renderer
   * al ejecutar? Solo si los dos se conocen: el del renderer es una aproximación en la
   * primera sentencia, y un falso positivo solo cae a exportar lo cargado.
   */
  private exportaEnOtroEsquema(s: Sesion, esquema: string | null | undefined): boolean {
    return typeof esquema === 'string' && s.estado.esquema !== null && s.estado.esquema !== esquema
  }

  /**
   * Exporta UNA consulta de la consola volviéndola a ejecutar en SU sesión (ve su
   * transacción), como UNA operación de la consola: `ocupada` para lo demás mientras
   * dura, Stop con el `peticionId`. Un solo cursor que sigue abierto entre lecturas —el
   * `resultSet` de Oracle, o el cursor vivo de PG (`mantenerCursor`)— y que se cierra
   * SIEMPRE al acabar, al cancelar o al fallar. Nunca re-ejecuta por páginas.
   */
  async exportarConsulta(
    req: RefConsola & { sql: string; peticionId: string; topes: TopesLectura; esquema?: string | null; binds?: DbBinds },
    consumir: ConsumidorPaginas,
    cancelada: () => boolean
  ): Promise<void> {
    const { con, d, st, binds } = this.validarExportacionConsulta(req, req.sql, req.esquema, req.binds)
    const s = this.n.sesionDe({ rol: 'consola', perfilId: req.perfilId, consolaId: req.consolaId }, con, txInicialDePeticion(req.txInicial))
    // Otra vez aquí: entre la validación y este punto estuvo el diálogo de guardar.
    if (s.operacionUsuario !== null) throw new ErrorGestor('ocupada', 'La consola está ejecutando.')
    s.operacionUsuario = `exportar:${req.peticionId}`
    try {
      await s.cola.correr(() => this.correrExportacionConsulta(s, con, d, st, req, consumir, cancelada, binds), {
        clave: req.peticionId,
        prioridad: 'alta'
      })
    } catch (e) {
      throw this.ap.aErrorGestor(e)
    } finally {
      s.operacionUsuario = null
    }
  }

  private async correrExportacionConsulta(
    s: Sesion,
    con: DbConnection,
    d: DialectoSql,
    st: Sentencia,
    req: { peticionId: string; topes: TopesLectura; esquema?: string | null },
    consumir: ConsumidorPaginas,
    cancelada: () => boolean,
    binds?: BindsSalientes
  ): Promise<void> {
    try {
      const p = await this.ap.empezar(s, req.peticionId)
      let ok = false
      try {
        // Otra vez, ya con la sesión abierta: si estaba cerrada, `empezar` acaba de
        // reabrirla en el elegido, que puede no ser el esquema de un SET a mano de antes.
        if (this.exportaEnOtroEsquema(s, req.esquema)) throw new ErrorGestor('noReleible', MENSAJE_ESQUEMA_CAMBIADO)
        const opciones: OpcionesEjecucion = {
          proposito: 'usuario',
          maxFilas: DB_PAGINA_MAX,
          candadoRO: this.n.ro(con),
          txManual: this.n.manual(s, con),
          // Releer nunca abre un BEGIN; dentro de una tx la ve igual.
          sinBegin: true,
          comprobarTx: false,
          lector: this.n.nuevoIdLector(),
          ...req.topes,
          // SQL Server: una consulta pura corta cada página al llenarla.
          ...opcionesDeLecturaEnFlujo(d, true)
        }
        if (capacidades(d).mantenerCursor) opciones.mantenerCursor = true
        const peticion: PeticionSinIdDe<'ejecutar'> = { op: 'ejecutar', sesion: s.idTrabajador, sql: st.texto, opciones }
        if (binds !== undefined) peticion.binds = binds
        const r = await p.trabajador.enviar<'ejecutar'>(peticion)
        this.n.marcarExpulsados(r)
        if (r.tipo !== 'filas') throw new ErrorGestor('noReleible', MENSAJE_EXPORTAR_NO_RELEIBLE)
        const cap = capacidades(d)
        if (!cap.mantenerCursor && !cap.lectorPorId) {
          // Un motor SIN cursor vivo (SQLite): por páginas, re-ejecutando con
          // `saltarFilas` (la consulta es pura: lo exige `validarExportacionConsulta`), como el
          // «más» de la consola. Un cursor vivo retendría el bloqueo del archivo.
          await consumir(paginaExportada(r.columnas, r.filasJson, r.recortes))
          let hayMas = r.hayMas && r.nFilas > 0
          let saltar = r.nFilas
          while (hayMas) {
            if (cancelada()) throw new ErrorGestor('cancelada', 'Exportación cancelada.')
            const siguiente = await p.trabajador.enviar<'ejecutar'>({
              ...peticion,
              opciones: { ...opciones, saltarFilas: saltar }
            })
            if (siguiente.tipo !== 'filas') throw new ErrorGestor('noReleible', MENSAJE_EXPORTAR_NO_RELEIBLE)
            await consumir(paginaExportada(r.columnas, siguiente.filasJson, siguiente.recortes))
            saltar += siguiente.nFilas
            hayMas = siguiente.hayMas && siguiente.nFilas > 0
          }
        } else await this.expTabla.volcarCursorVivo(s, p, r, consumir, cancelada)
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
}
