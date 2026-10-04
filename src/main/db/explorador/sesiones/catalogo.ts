// =============================================================================
// Catálogo en la sesión `meta`: SQL fijo de Tessera, sin candado por sentencia, que se
// reintenta UNA vez tras una pérdida.
// Decisiones: docs/decisiones/bd/sesiones-procesos-y-autoridad.md
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import type { PrioridadCola } from '../colaSesion.ts'
import { type BindsTrabajador, esFalloTrabajador } from '../protocoloTrabajador.ts'
import type { DialectoCatalogo, FilaCatalogo } from '../motores/tipos.ts'
import type { Apertura } from './apertura.ts'
import type { NucleoSesiones } from './NucleoSesiones.ts'
import { MAX_FILAS_CATALOGO, versionMayor } from './reglas.ts'
import type { ContextoCatalogo, Sesion } from './tipos.ts'

/** Consultas de catálogo en la sesión `meta`. */
export class CatalogoSesion {
  private readonly n: NucleoSesiones
  private readonly ap: Apertura

  constructor(n: NucleoSesiones, ap: Apertura) {
    this.n = n
    this.ap = ap
  }

  /**
   * Corre `fn` como UNA tarea de la cola de `meta` (el árbol va con prioridad
   * `alta`, el índice de autocompletado con `baja`). Tras una pérdida de la sesión
   * se reintenta UNA vez: es SQL de Tessera y solo lee. Lanza `ErrorGestor`.
   */
  async catalogo<T>(
    conexionId: string,
    fn: (ctx: ContextoCatalogo) => Promise<T>,
    op: { prioridad?: PrioridadCola; clave?: string; base?: string } = {}
  ): Promise<T> {
    const con = this.n.conexionOError(conexionId)
    const s = this.n.sesionDe({ rol: 'meta', conexionId: con.id }, con)
    for (let intento = 0; ; intento++) {
      try {
        const opciones: { prioridad: PrioridadCola; clave?: string } = { prioridad: op.prioridad ?? 'normal' }
        if (op.clave !== undefined) opciones.clave = op.clave
        return await s.cola.correr(() => this.correrCatalogo(s, con, fn, op.base), opciones)
      } catch (e) {
        const eg = this.ap.aErrorGestor(e)
        if (intento === 0 && eg.reintentable) continue
        throw eg
      }
    }
  }

  private async correrCatalogo<T>(
    s: Sesion,
    con: DbConnection,
    fn: (ctx: ContextoCatalogo) => Promise<T>,
    base?: string
  ): Promise<T> {
    const p = await this.ap.empezar(s, null)
    let ok = false
    try {
      // La BASE del nivel «Bases», si la consulta es de una: va en el
      // dialecto (`DialectoCatalogo.base`) y el catálogo del motor la escribe en el nombre de
      // tres partes. Sin ella, el dialecto de siempre, sin el campo.
      const dialecto: DialectoCatalogo = { motor: con.motor, versionMayor: versionMayor(s.driver?.version, con.motor) }
      if (base !== undefined) dialecto.base = base
      const ctx: ContextoCatalogo = {
        dialecto,
        esquema: s.estado.esquema,
        consultar: async (c) => {
          const r = await p.trabajador.enviar<'ejecutar'>({
            op: 'ejecutar',
            sesion: s.idTrabajador,
            sql: c.sql,
            binds: c.binds as BindsTrabajador,
            opciones: {
              proposito: 'catalogo',
              maxFilas: MAX_FILAS_CATALOGO,
              // SIN candado por sentencia, aunque la conexión sea RO: costaba 1 viaje
              // más por consulta en Oracle y 2 en PG (BEGIN READ ONLY + ROLLBACK), y
              // sobre VPN eso duplica o triplica cada despliegue del árbol, sin
              // proteger nada. Por `meta` solo pasa SQL FIJO de Tessera, con binds y de
              // lectura de diccionario, nunca SQL del usuario. En PG, `meta` conserva
              // el candado de SESIÓN (`default_transaction_read_only`, postgres.cjs),
              // que nada de lo que corre aquí puede quitar; en Oracle va en autoCommit,
              // así que cada SELECT ya lee fresco. `datos` y las consolas SÍ lo llevan:
              // por ellas pasan fragmentos o sentencias del usuario.
              candadoRO: false,
              sinBegin: true,
              comprobarTx: false
            }
          })
          if (r.tipo !== 'filas') return []
          return JSON.parse(r.filasJson) as FilaCatalogo[]
        },
        bloqueTexto: async (sql, binds, salida, tope) => {
          const r = await p.trabajador.enviar<'ejecutar'>({
            op: 'ejecutar',
            sesion: s.idTrabajador,
            sql,
            binds: { ...binds, [salida]: { salida: 'texto', tope } },
            opciones: { proposito: 'catalogo', maxFilas: 1, candadoRO: false, sinBegin: true, comprobarTx: false }
          })
          if (r.tipo !== 'hecho' || !r.salidas) return null
          return r.salidas[salida] ?? null
        }
      }
      const valor = await fn(ctx)
      ok = true
      return valor
    } catch (e) {
      this.ap.tratarFallo(s, p, e)
      const eg = this.ap.aErrorGestor(e)
      if (esFalloTrabajador(e) && e.error.clase === 'perdida') eg.reintentable = true
      throw eg
    } finally {
      if (s.estado.fase === 'ocupada') this.n.terminar(s, { clase: 'consulta', ok, tx: 'ninguna' })
    }
  }
}
