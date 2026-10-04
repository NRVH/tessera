// =============================================================================
// Árbol y catálogo del explorador: esquemas, bases, resumen, objetos, índice de nombres y «Refrescar».
// Depende de `GestorSesiones` (consultas de catálogo) y `CacheCatalogo`.
// Decisiones: docs/decisiones/bd/explorador-cache-catalogo.md
// =============================================================================

import type {
  DbBasesRespuesta,
  DbConteos,
  DbEsquemasRespuesta,
  DbIndiceNombres,
  DbObjeto,
  DbRespuesta,
  DbTipoObjeto
} from '../../../../shared/db-explorador-ipc.ts'
import type { DbConnection } from '../../../../shared/db-ipc.ts'
import {
  configEfectiva,
  estaVisible,
  normalizarEsquemasVisibles,
  resolverVisibles
} from '../../../../shared/dbEsquemas.ts'
import { descriptorSql, esMotorSql, tieneNivelBases } from '../../../../shared/motores/index.ts'

import { mensajeDeFalloDelRegistro } from '../../registroConexiones.ts'
import {
  type FilaCatalogo,
  mapearBases,
  mapearConteos,
  mapearEsquemaPorDefecto,
  mapearEsquemas,
  mapearNombres,
  mapearNombresPublicos,
  mapearObjetos,
  sqlBases,
  sqlConteos,
  sqlEsquemaPorDefecto,
  sqlEsquemas,
  sqlNombres,
  sqlNombresPublicos,
  sqlObjetos
} from '../catalogoSql.ts'
import { TOPE_INDICE_AUTOCOMPLETADO } from '../limites.ts'

import type { BaseEsquemas, ContextoExplorador } from './tipos.ts'
import {
  claveConBase,
  conBase,
  construir,
  exigir,
  fallo,
  fusionarIndices,
  MAX_IDENT,
  mensajeDe,
  ok
} from './validacion.ts'

/** Árbol y catálogo del explorador: esquemas, bases, resumen, objetos, índice de nombres y «Refrescar». */
export class EsquemasExplorador {
  private readonly c: ContextoExplorador

  constructor(c: ContextoExplorador) {
    this.c = c
  }

  baseEsquemas(conexionId: string, refrescar: boolean, base?: string): Promise<BaseEsquemas> {
    return this.c.cache.memo(
      conexionId,
      claveConBase({ familia: 'esquemas' }, base),
      () =>
        this.c.gestor.catalogo(
          conexionId,
          async (ctx) => {
            const filas = await ctx.consultar(construir(() => sqlEsquemas(ctx.dialecto)))
            const pd = mapearEsquemaPorDefecto(await ctx.consultar(construir(() => sqlEsquemaPorDefecto(ctx.dialecto))))
            return { filas, porDefecto: pd.esquema || ctx.esquema || '', dialecto: ctx.dialecto }
          },
          conBase({ prioridad: 'alta' as const }, base)
        ),
      refrescar
    )
  }

  /** Guarda el "N de M" para pintarlo sin conectar; solo si cambió. */
  private recordarIntrospeccion(con: DbConnection, total: number, porDefecto: string): void {
    const previa = con.introspeccion
    if (previa && previa.totalEsquemas === total && previa.esquemaPorDefecto === porDefecto) return
    try {
      this.c.conexiones.setIntrospeccion(con.id, { totalEsquemas: total, esquemaPorDefecto: porDefecto, en: Date.now() })
      this.c.registro.notificarCambio()
    } catch (e) {
      this.c.log(`no se pudo guardar la introspección de ${con.id}: ${mensajeDe(e)}`)
    }
  }

  async esquemas(conexionId: unknown, refrescar?: unknown, baseDeLaPeticion?: unknown): Promise<DbRespuesta<DbEsquemasRespuesta>> {
    return this.c.seguro(async () => {
      const id = exigir(conexionId, 'conexionId')
      const base = this.c.baseDe(this.c.conexionOError(id), baseDeLaPeticion)
      const datos = await this.baseEsquemas(id, refrescar === true, base)
      const con = this.c.conexionOError(id)
      // La selección de esquemas visibles es de la CONEXIÓN (la misma en cada base).
      const conf = con.esquemas
      const esquemas = mapearEsquemas(datos.dialecto, datos.filas, datos.porDefecto, (e) =>
        estaVisible(conf, e.nombre, datos.porDefecto)
      )
      // Los de una base del nivel «Bases» llevan su base; la insignia «N de M» sin
      // conectar es la de la base de la sesión.
      if (base !== undefined) for (const e of esquemas) e.base = base
      else this.recordarIntrospeccion(con, esquemas.length, datos.porDefecto)
      return ok({
        esquemas,
        porDefecto: datos.porDefecto,
        config: configEfectiva(conf),
        nVisibles: esquemas.filter((e) => e.visible).length
      })
    })
  }

  async fijarEsquemas(conexionId: unknown, config: unknown): Promise<DbRespuesta<DbConnection>> {
    return this.c.seguro(async () => {
      const id = exigir(conexionId, 'conexionId')
      const norm = normalizarEsquemasVisibles(config)
      if (!norm) return fallo('interno', 'La selección de esquemas no es válida.')
      this.c.conexionOError(id)
      let con: DbConnection
      try {
        con = this.c.conexiones.setEsquemasVisibles(id, norm)
      } catch (e) {
        // En el log del main, el original con su ruta (el `cause` que pone el store).
        this.c.log(`fijar esquemas de ${id}: ${mensajeDe(e instanceof Error && e.cause !== undefined ? e.cause : e)}`)
        // El motivo real y no uno genérico: el store dice QUÉ pasó y qué hacer (el registro
        // se editó fuera con la app abierta, no se puede leer, falta espacio…). Desde que
        // sus escrituras son todo o nada, la memoria sigue como estaba y repetir
        // no sirve de nada si no se hace lo que dice. Pero SIN rutas del host: un error de
        // `fs` en crudo las lleva en su `message`, y esto va al renderer
        // (`mensajeDeFalloDelRegistro` es la guarda de la frontera).
        return fallo('interno', `No se pudo guardar la selección de esquemas: ${mensajeDeFalloDelRegistro(e)}`)
      }
      // El índice por esquema sigue valiendo en el main; lo que cambia es la FUSIÓN,
      // que el renderer guarda en su caché: el evento se la invalida (antes de responder).
      this.c.cache.notificar({ conexionId: id, motivo: 'esquemas' })
      this.c.registro.notificarCambio()
      return ok(con)
    })
  }

  /**
   * `DBX_CHANNELS.BASES`: las bases del nivel «Bases» con su «N de M», con la
   * misma forma que los esquemas. Solo en una conexión que lo tiene (`tieneNivelBases`: SQL
   * Server sin base fija); en cualquier otra, error. `porDefecto` es la base en la que abrió la
   * sesión `meta` (la por defecto del login). Una base sin acceso (`HAS_DBACCESS`) o que no
   * está ONLINE sale con `accesible: false`: la interfaz no la despliega.
   */
  async bases(conexionId: unknown, refrescar?: unknown): Promise<DbRespuesta<DbBasesRespuesta>> {
    return this.c.seguro(async () => {
      const id = exigir(conexionId, 'conexionId')
      const con = this.c.conexionOError(id)
      if (!tieneNivelBases(descriptorSql(con.motor), con)) {
        return fallo('interno', 'Esta conexión no tiene nivel «Bases»: trabaja en una sola base.')
      }
      const datos = await this.c.cache.memo(
        id,
        { familia: 'bases' },
        () =>
          this.c.gestor.catalogo(
            id,
            async (ctx) => ({ filas: await ctx.consultar(construir(() => sqlBases(ctx.dialecto))), porDefecto: ctx.esquema ?? '' }),
            { prioridad: 'alta' }
          ),
        refrescar === true
      )
      const conf = this.c.conexionOError(id).bases
      const bases = mapearBases(datos.filas, datos.porDefecto, (nombre) => estaVisible(conf, nombre, datos.porDefecto))
      return ok({
        bases,
        porDefecto: datos.porDefecto,
        config: configEfectiva(conf),
        nVisibles: bases.filter((b) => b.visible).length
      })
    })
  }

  /** `DBX_CHANNELS.FIJAR_BASES`: guarda las bases visibles (como `fijarEsquemas`). */
  async fijarBases(conexionId: unknown, config: unknown): Promise<DbRespuesta<DbConnection>> {
    return this.c.seguro(async () => {
      const id = exigir(conexionId, 'conexionId')
      const norm = normalizarEsquemasVisibles(config)
      if (!norm) return fallo('interno', 'La selección de bases no es válida.')
      const actual = this.c.conexionOError(id)
      if (!tieneNivelBases(descriptorSql(actual.motor), actual)) {
        return fallo('interno', 'Esta conexión no tiene nivel «Bases»: trabaja en una sola base.')
      }
      const fijar = this.c.conexiones.setBasesVisibles
      if (typeof fijar !== 'function') return fallo('interno', 'Esta versión del registro de conexiones no guarda las bases visibles.')
      let con: DbConnection
      try {
        con = fijar.call(this.c.conexiones, id, norm)
      } catch (e) {
        this.c.log(`fijar bases de ${id}: ${mensajeDe(e instanceof Error && e.cause !== undefined ? e.cause : e)}`)
        // Sin rutas del host, como en `fijarEsquemas`.
        return fallo('interno', `No se pudo guardar la selección de bases: ${mensajeDeFalloDelRegistro(e)}`)
      }
      this.c.cache.notificar({ conexionId: id, motivo: 'esquemas' })
      this.c.registro.notificarCambio()
      return ok(con)
    })
  }

  async resumen(conexionId: unknown, esquema: unknown, refrescar?: unknown, baseDeLaPeticion?: unknown): Promise<DbRespuesta<DbConteos>> {
    return this.c.seguro(async () => {
      const id = exigir(conexionId, 'conexionId')
      const esq = exigir(esquema, 'esquema')
      const base = this.c.baseDe(this.c.conexionOError(id), baseDeLaPeticion)
      const conteos = await this.c.cache.memo(
        id,
        claveConBase({ familia: 'conteos', esquema: esq }, base),
        () =>
          this.c.gestor.catalogo(
            id,
            async (ctx) =>
              mapearConteos(ctx.dialecto.motor, await ctx.consultar(construir(() => sqlConteos(ctx.dialecto, esq)))),
            conBase({ prioridad: 'alta' as const }, base)
          ),
        refrescar === true
      )
      return ok(conteos)
    })
  }

  async objetos(
    conexionId: unknown,
    esquema: unknown,
    tipo: unknown,
    refrescar?: unknown,
    baseDeLaPeticion?: unknown
  ): Promise<DbRespuesta<DbObjeto[]>> {
    return this.c.seguro(async () => {
      const id = exigir(conexionId, 'conexionId')
      const esq = exigir(esquema, 'esquema')
      const con = this.c.conexionOError(id)
      const t = tipo as DbTipoObjeto
      // Por `descriptor()`, que lanza «Motor desconocido» (no un TypeError) con uno que no conoce.
      if (descriptorSql(con.motor).catalogo.carpetas.indexOf(t) < 0) return fallo('interno', 'Ese tipo de objeto no existe en este motor.')
      const base = this.c.baseDe(con, baseDeLaPeticion)
      const objetos = await this.c.cache.memo(
        id,
        claveConBase({ familia: 'objetos', esquema: esq, resto: [t] }, base),
        () =>
          this.c.gestor.catalogo(
            id,
            async (ctx) => mapearObjetos(esq, t, await ctx.consultar(construir(() => sqlObjetos(ctx.dialecto, esq, t)))),
            conBase({ prioridad: 'alta' as const }, base)
          ),
        refrescar === true
      )
      // Cada objeto de una base del nivel «Bases» lleva su base (copia: lo guardado
      // en la caché no se toca).
      return ok(base === undefined ? objetos : objetos.map((o) => ({ ...o, base })))
    })
  }

  async nombres(
    conexionId: unknown,
    esquemaActual?: unknown,
    refrescar?: unknown,
    baseDeLaPeticion?: unknown
  ): Promise<DbRespuesta<DbIndiceNombres>> {
    return this.c.seguro(async () => {
      const id = exigir(conexionId, 'conexionId')
      const actual = typeof esquemaActual === 'string' && esquemaActual.length > 0 ? esquemaActual : null
      // El índice de UNA base del nivel «Bases» (la de la consola, en SQL Server).
      const bd = this.c.baseDe(this.c.conexionOError(id), baseDeLaPeticion)
      const base = await this.baseEsquemas(id, false, bd)
      const con = this.c.conexionOError(id)
      const reales = mapearEsquemas(base.dialecto, base.filas, base.porDefecto).filter((e) => !e.pseudo)
      const nombresReales = reales.map((e) => e.nombre)
      const sistema = reales.filter((e) => e.sistema).map((e) => e.nombre)
      const visibles = resolverVisibles(con.esquemas, nombresReales, base.porDefecto, sistema)
      if (actual !== null && nombresReales.indexOf(actual) >= 0 && visibles.indexOf(actual) < 0) visibles.push(actual)
      const partes: DbIndiceNombres[] = []
      let total = 0
      for (const esq of visibles) {
        if (total >= TOPE_INDICE_AUTOCOMPLETADO) break
        const parte = await this.c.cache.memo(
          id,
          claveConBase({ familia: 'nombres', esquema: esq }, bd),
          () =>
            this.c.gestor.catalogo(
              id,
              async (ctx) => {
                let filas: FilaCatalogo[] = []
                for (const c of construir(() => sqlNombres(ctx.dialecto, [esq]))) filas = filas.concat(await ctx.consultar(c))
                return mapearNombres(ctx.dialecto.motor, filas, base.porDefecto, TOPE_INDICE_AUTOCOMPLETADO)
              },
              conBase({ prioridad: 'baja' as const }, bd)
            ),
          refrescar === true
        )
        partes.push(parte)
        total += parte.objetos.length
      }
      return ok(
        fusionarIndices(
          visibles,
          partes,
          actual ?? base.porDefecto,
          TOPE_INDICE_AUTOCOMPLETADO,
          partes.length < visibles.length
        )
      )
    })
  }

  async nombresPublicos(conexionId: unknown): Promise<DbRespuesta<string[]>> {
    return this.c.seguro(async () => {
      const id = exigir(conexionId, 'conexionId')
      const con = this.c.conexionOError(id)
      // Los sinónimos públicos cuelgan del pseudo-esquema del motor (Oracle: PUBLIC); sin él, no hay.
      const publico = descriptorSql(con.motor).catalogo.pseudoEsquemaPublico
      if (publico === null) return ok([])
      const lista = await this.c.cache.memo(id, { familia: 'publicos', esquema: publico }, () =>
        this.c.gestor.catalogo(
          id,
          async (ctx) => {
            const c = construir(() => sqlNombresPublicos(ctx.dialecto))
            return c ? mapearNombresPublicos(await ctx.consultar(c)) : []
          },
          { prioridad: 'baja' }
        )
      )
      return ok(lista)
    })
  }

  /**
   * «Refrescar»: invalida y emite `dbx:ev:catalogo` antes de responder. Con `base`,
   * solo lo de esa base del nivel «Bases» (con `esquema`, ese esquema en ella). Una base que
   * la conexión no admite se ignora: refrescar de más nunca es un error.
   */
  refrescar(conexionId: unknown, esquema?: unknown, base?: unknown): void {
    if (typeof conexionId !== 'string' || !conexionId) return
    const b = typeof base === 'string' && base !== '' && base.length <= MAX_IDENT ? base : undefined
    const inv: { esquema?: string; base?: string } = {}
    if (typeof esquema === 'string' && esquema) inv.esquema = esquema
    if (b !== undefined) {
      const con = this.c.conexiones.get(conexionId)
      // Una de otra familia no tiene nivel «Bases» SQL que invalidar.
      if (con && esMotorSql(con.motor) && tieneNivelBases(descriptorSql(con.motor), con)) inv.base = b
    }
    this.c.cache.invalidar(conexionId, { ...inv, motivo: 'refrescar' })
  }
}
