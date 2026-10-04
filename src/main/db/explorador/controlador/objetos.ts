// =============================================================================
// Detalle de un objeto del catálogo: columnas, clave primaria, sinónimos, fuente, DDL y claves ajenas.
// Depende de `GestorSesiones` (consultas de catálogo) y `CacheCatalogo`; el SQL lo pone el catálogo de cada motor.
// Decisiones: docs/decisiones/bd/explorador-cache-catalogo.md
// =============================================================================

import type {
  DbColumnaInfo,
  DbDetalle,
  DbFuente,
  DbRefObjeto,
  DbRelacionesFk,
  DbRespuesta
} from '../../../../shared/db-explorador-ipc.ts'
import { descriptorSql } from '../../../../shared/motores/index.ts'

import {
  aplicarPosicionesPk,
  type DialectoCatalogo,
  mapearClavePrimaria,
  mapearColumnas,
  mapearFuente,
  mapearIndices,
  mapearRestricciones,
  mapearSinonimo,
  sqlClavePrimaria,
  sqlColumnas,
  sqlFuente,
  sqlIndices,
  sqlResolverSinonimo,
  sqlRestricciones,
  sqlTipoDeObjeto
} from '../catalogoSql.ts'
import { ErrorGestor } from '../GestorSesiones.ts'
import { soloMotoresCon } from '../motores/filasCatalogo.ts'
import { motorExplorador } from '../motores/index.ts'

import type { ContextoExplorador } from './tipos.ts'
import {
  claveConBase,
  conBase,
  construir,
  exigir,
  fallo,
  lectorDe,
  ok,
  PARTES_DETALLE
} from './validacion.ts'

/** Detalle de un objeto del catálogo: columnas, clave primaria, sinónimos, fuente, DDL y claves ajenas. */
export class ObjetosExplorador {
  private readonly c: ContextoExplorador

  constructor(c: ContextoExplorador) {
    this.c = c
  }

  async detalle(conexionId: unknown, objeto: unknown, partes: unknown): Promise<DbRespuesta<DbDetalle>> {
    return this.c.seguro(async () => {
      const id = exigir(conexionId, 'conexionId')
      const ref = this.c.refObjeto(objeto, id)
      const pedidas = Array.isArray(partes) ? PARTES_DETALLE.filter((p) => partes.indexOf(p) >= 0) : []
      if (pedidas.length === 0) return fallo('interno', 'Petición inválida: «partes».')
      const detalle: DbDetalle = {}
      for (const parte of pedidas) {
        const clave = claveConBase({ familia: 'detalle' as const, esquema: ref.esquema, resto: [ref.nombre, parte] }, ref.base)
        if (parte === 'columnas') {
          detalle.columnas = await this.columnasDe(id, ref)
        } else if (parte === 'indices') {
          detalle.indices = await this.c.cache.memo(id, clave, () =>
            this.c.gestor.catalogo(
              id,
              async (ctx) =>
                mapearIndices(
                  ctx.dialecto.motor,
                  await ctx.consultar(construir(() => sqlIndices(ctx.dialecto, ref.esquema, ref.nombre)))
                ),
              conBase({ prioridad: 'alta' as const }, ref.base)
            )
          )
        } else {
          detalle.restricciones = await this.c.cache.memo(id, clave, () =>
            this.c.gestor.catalogo(
              id,
              async (ctx) =>
                mapearRestricciones(
                  ctx.dialecto.motor,
                  await ctx.consultar(construir(() => sqlRestricciones(ctx.dialecto, ref.esquema, ref.nombre)))
                ),
              conBase({ prioridad: 'alta' as const }, ref.base)
            )
          )
        }
      }
      return ok(detalle)
    })
  }

  /** Columnas de una tabla o vista con su posición en la PK (la misma entrada que `detalle`). */
  columnasDe(conexionId: string, ref: DbRefObjeto): Promise<DbColumnaInfo[]> {
    const clave = claveConBase({ familia: 'detalle' as const, esquema: ref.esquema, resto: [ref.nombre, 'columnas'] }, ref.base)
    return this.c.cache.memo(conexionId, clave, () =>
      this.c.gestor.catalogo(
        conexionId,
        async (ctx) => {
          const filas = await ctx.consultar(construir(() => sqlColumnas(ctx.dialecto, ref.esquema, ref.nombre)))
          const columnas = mapearColumnas(ctx.dialecto.motor, filas)
          // En Oracle la consulta de columnas no trae la PK: va aparte (`pkEnColumnas`).
          if (motorExplorador(ctx.dialecto.motor).catalogo.pkEnColumnas) return columnas
          const pk = mapearClavePrimaria(
            await ctx.consultar(construir(() => sqlClavePrimaria(ctx.dialecto, ref.esquema, ref.nombre)))
          )
          return aplicarPosicionesPk(columnas, pk)
        },
        conBase({ prioridad: 'alta' as const }, ref.base)
      )
    )
  }

  /** Columnas de la PK (vacío en vistas o tablas sin PK). */
  clavePrimaria(conexionId: string, ref: DbRefObjeto): Promise<string[]> {
    return this.c.cache.memo(conexionId, claveConBase({ familia: 'detalle', esquema: ref.esquema, resto: [ref.nombre, 'pk'] }, ref.base), () =>
      this.c.gestor.catalogo(
        conexionId,
        async (ctx) =>
          mapearClavePrimaria(
            await ctx.consultar(construir(() => sqlClavePrimaria(ctx.dialecto, ref.esquema, ref.nombre)))
          ),
        conBase({ prioridad: 'alta' as const }, ref.base)
      )
    )
  }

  /**
   * Resuelve un sinónimo de Oracle hasta 3 saltos. Un destino remoto (`@dblink`) no
   * se puede preguntar aquí: se devuelve como tabla, con su enlace aparte.
   */
  resolverSinonimo(
    conexionId: string,
    esquema: string,
    nombre: string,
    base?: string
  ): Promise<{ objeto: DbRefObjeto; dblink: string | null }> {
    return this.c.cache.memo(conexionId, claveConBase({ familia: 'resolver', esquema, resto: [nombre] }, base), () =>
      this.c.gestor.catalogo(
        conexionId,
        async (ctx) => {
          // El aviso nombra los motores que SÍ tienen sinónimos, leídos del registro: con los
          // de hoy es «Solo Oracle tiene sinónimos.», al byte; el literal de antes habría
          // mentido en cuanto entrara SQL Server, que también los tiene.
          if (!descriptorSql(ctx.dialecto.motor).catalogo.tieneSinonimos) {
            throw new ErrorGestor('interno', soloMotoresCon('sinónimos', (m) => m.catalogo.tieneSinonimos))
          }
          // El tipo del destino lo lee el catálogo del motor (su mapeador no recibe el motor).
          const catalogo = motorExplorador(ctx.dialecto.motor).catalogo
          let e = esquema
          let n = nombre
          // SQL Server: un sinónimo puede apuntar a OTRA base (nombre de tres
          // partes); el salto siguiente se pregunta en ella. Sin bases, el dialecto de siempre.
          let b = base
          const dialectoEn = (x: string | undefined): DialectoCatalogo => (x === undefined ? ctx.dialecto : { ...ctx.dialecto, base: x })
          for (let salto = 0; salto < 3; salto++) {
            const d0 = dialectoEn(b)
            const destino = mapearSinonimo(await ctx.consultar(construir(() => sqlResolverSinonimo(d0, e, n))))
            if (!destino) {
              throw new ErrorGestor('interno', `No se encontró el sinónimo ${e}.${n}, o no tienes acceso a su destino.`)
            }
            if (destino.dblink) {
              return { objeto: { esquema: destino.esquema, nombre: destino.nombre, tipo: 'tabla' }, dblink: destino.dblink }
            }
            if (destino.base !== undefined) b = destino.base
            const d1 = dialectoEn(b)
            const tipo = catalogo.mapearTipoDeObjeto(
              await ctx.consultar(construir(() => sqlTipoDeObjeto(d1, destino.esquema, destino.nombre)))
            )
            if (!tipo) {
              throw new ErrorGestor('interno', `El destino ${destino.esquema}.${destino.nombre} no existe o no es visible.`)
            }
            if (tipo !== 'sinonimo') {
              const objeto: DbRefObjeto = { esquema: destino.esquema, nombre: destino.nombre, tipo }
              if (b !== undefined) objeto.base = b
              return { objeto, dblink: null }
            }
            e = destino.esquema
            n = destino.nombre
          }
          throw new ErrorGestor('interno', 'El sinónimo encadena más de tres saltos.')
        },
        conBase({ prioridad: 'alta' as const }, base)
      )
    )
  }

  async resolver(conexionId: unknown, esquema: unknown, nombre: unknown, baseDeLaPeticion?: unknown): Promise<DbRespuesta<DbRefObjeto>> {
    return this.c.seguro(async () => {
      const id = exigir(conexionId, 'conexionId')
      const base = this.c.baseDe(this.c.conexionOError(id), baseDeLaPeticion)
      const r = await this.resolverSinonimo(id, exigir(esquema, 'esquema'), exigir(nombre, 'nombre'), base)
      return ok(r.objeto)
    })
  }

  async fuente(conexionId: unknown, objeto: unknown, refrescar?: unknown): Promise<DbRespuesta<DbFuente>> {
    return this.c.seguro(async () => {
      const id = exigir(conexionId, 'conexionId')
      const ref = this.c.refObjeto(objeto, id)
      const f = await this.c.cache.memo(
        id,
        claveConBase({ familia: 'fuente', esquema: ref.esquema, resto: [ref.nombre, ref.tipo, ref.firma ?? ''] }, ref.base),
        () =>
          this.c.gestor.catalogo(
            id,
            async (ctx) => mapearFuente(ctx.dialecto, ref, await ctx.consultar(construir(() => sqlFuente(ctx.dialecto, ref)))),
            conBase({ prioridad: 'alta' as const }, ref.base)
          ),
        // Lo mismo que en `ddl`: el Refrescar de la PESTAÑA salta lo guardado de ESTE
        // objeto. Un CREATE OR REPLACE hecho fuera de Tessera no pasa por la
        // invalidación por DDL, y sin esto el botón devolvía el cuerpo viejo.
        refrescar === true
      )
      return ok(f)
    })
  }

  /**
   * «Ver DDL»: una sola parte titulada 'DDL'. Cómo se obtiene es del motor (`catalogo.leerDdl`; los
   * generadores, en `ddlCatalogo.ts`) y se cachea junto a la fuente. `refrescar` es el «Refrescar»
   * de la pestaña: vuelve a pedirlo al servidor y lo guarda, sin invalidar el esquema entero (que
   * repintaría el árbol y repetiría todo lo demás por la VPN para refrescar UN objeto).
   */
  async ddl(conexionId: unknown, objeto: unknown, refrescar?: unknown): Promise<DbRespuesta<DbFuente>> {
    return this.c.seguro(async () => {
      const id = exigir(conexionId, 'conexionId')
      const ref = this.c.refObjeto(objeto, id)
      const con = this.c.conexionOError(id)
      if (!motorExplorador(con.motor).catalogo.tieneDdl(ref.tipo)) {
        return fallo('interno', 'Ese tipo de objeto no tiene DDL en este motor.')
      }
      const f = await this.c.cache.memo(
        id,
        claveConBase({ familia: 'fuente', esquema: ref.esquema, resto: [ref.nombre, ref.tipo, ref.firma ?? '', 'ddl'] }, ref.base),
        () =>
          this.c.gestor.catalogo(
            id,
            // Las consultas, su orden y el repliegue son del motor (`catalogo.leerDdl`).
            (ctx) => motorExplorador(ctx.dialecto.motor).catalogo.leerDdl(lectorDe(ctx), ref),
            conBase({ prioridad: 'alta' as const }, ref.base)
          ),
        // El Refrescar de la PESTAÑA salta lo guardado de ESTE objeto y guarda lo nuevo
        // (ver el docstring): sin él, recibía el texto cacheado.
        refrescar === true
      )
      return ok(f)
    })
  }

  /**
   * FKS: las claves ajenas que salen de la tabla y las que entran en ella, para
   * el autocompletado de `JOIN … ON`. De un sinónimo, las de su destino (es lo que el
   * usuario escribe en el FROM); una vista no tiene. Cacheadas como el detalle y
   * borradas por el DDL de CUALQUIER esquema de la conexión (`FAMILIAS_ENTRE_ESQUEMAS`).
   */
  async fks(conexionId: unknown, objeto: unknown, refrescar?: unknown): Promise<DbRespuesta<DbRelacionesFk>> {
    return this.c.seguro(async () => {
      const id = exigir(conexionId, 'conexionId')
      let ref = this.c.refObjeto(objeto, id)
      if (ref.tipo === 'sinonimo') {
        const r = await this.resolverSinonimo(id, ref.esquema, ref.nombre, ref.base)
        if (r.dblink) return ok({ salientes: [], entrantes: [] })
        ref = r.objeto
      }
      const destino = ref
      const rel = await this.c.cache.memo(
        id,
        claveConBase({ familia: 'fks', esquema: destino.esquema, resto: [destino.nombre] }, destino.base),
        () =>
          this.c.gestor.catalogo(
            id,
            // Las consultas y su orden son del motor (`catalogo.leerFks`). Oracle: tres
            // cortas (restricciones propias, entrantes, columnas; medido: la única con OR
            // tardaba de segundos a minutos). PG: una. Cada una, construida
            // por el `construir` de aquí (`lectorDe`).
            (ctx): Promise<DbRelacionesFk> =>
              motorExplorador(ctx.dialecto.motor).catalogo.leerFks(lectorDe(ctx), destino.esquema, destino.nombre),
            conBase({ prioridad: 'alta' as const }, destino.base)
          ),
        refrescar === true
      )
      return ok(rel)
    })
  }
}
