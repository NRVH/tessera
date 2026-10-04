// =============================================================================
// Consolas SQL: ejecutar, explicar, transacciones, esquema de la consola e historial de consultas.
// Cada consola está atada a su conexión y a su perfil.
// Decisiones: docs/decisiones/bd/sesiones-esquema-de-consola.md
// =============================================================================

import type {
  DbBinds,
  DbConsolaInfo,
  DbEntradaHistorial,
  DbEstadoSesion,
  DbPlan,
  DbRespuesta,
  DbResultadoSentencia,
  DbTxModo
} from '../../../../shared/db-explorador-ipc.ts'
import { esMotorSql } from '../../../../shared/motores/index.ts'

import { mapearEsquemas } from '../catalogoSql.ts'
import { mensajeTodaviaNo } from '../familias.ts'
import { ErrorGestor } from '../GestorSesiones.ts'

import type { EsquemasExplorador } from './esquemas.ts'
import type { BaseEsquemas, ContextoExplorador } from './tipos.ts'
import {
  esObjeto,
  exigir,
  fallo,
  MAX_FRAGMENTO,
  MAX_IDENT,
  mensajeDe,
  ok,
  opcional,
  resolverOpcional
} from './validacion.ts'

/** Consolas SQL: ejecutar, explicar, transacciones, esquema de la consola e historial de consultas. */
export class ConsolaExplorador {
  private readonly c: ContextoExplorador
  private readonly arbol: EsquemasExplorador

  constructor(c: ContextoExplorador, arbol: EsquemasExplorador) {
    this.c = c
    this.arbol = arbol
  }

  /**
   * La conexión a la que está atada una consola (de `indice.json`, recordada aquí), que además tiene
   * que ser DE SU PERFIL: una consola antigua puede quedar atada a un id cuya conocida es ahora de
   * OTRO perfil, y validar su esquema abriría un proceso con las credenciales del otro. Es la
   * puerta común de todo lo que parte de una consola. Una conexión que ya no existe pasa: cada
   * camino da su propio «ya no existe».
   */
  async conexionDeConsola(perfilId: string, consolaId: string): Promise<string> {
    let c = this.c.estado.conexionDeConsola(perfilId, consolaId)
    if (c === undefined) {
      const lista = await this.c.consolas.listar(perfilId)
      for (const i of lista) this.recordarConsola(i)
      c = this.c.estado.conexionDeConsola(perfilId, consolaId)
    }
    if (c === undefined) throw new ErrorGestor('interno', 'La consola ya no existe.')
    const con = this.c.conexiones.get(c)
    if (con && con.profileId !== perfilId) throw new ErrorGestor('interno', 'La consola no pertenece a este perfil.')
    // Quien pide la conexión de una consola por aquí va a ejecutar SQL: una
    // consola de MongoDB o Redis (sus archivos son comunes) se rechaza con su motivo.
    if (con && !esMotorSql(con.motor)) throw new ErrorGestor('driver', mensajeTodaviaNo(con.motor))
    return c
  }

  /** Recuerda la conexión y el esquema elegido de una consola, tal como dice su índice. */
  recordarConsola(i: DbConsolaInfo): void {
    this.c.estado.recordarConsola(i.perfilId, i.id, i.conexionId, i.esquema)
  }

  /** ¿Existe ese esquema en la conexión? Si no está en la caché, se pregunta otra vez. */
  private async esquemaExiste(conexionId: string, esquema: string): Promise<boolean> {
    const esta = (base: BaseEsquemas): boolean =>
      mapearEsquemas(base.dialecto, base.filas, base.porDefecto).some((e) => !e.pseudo && e.nombre === esquema)
    if (esta(await this.arbol.baseEsquemas(conexionId, false))) return true
    return esta(await this.arbol.baseEsquemas(conexionId, true))
  }

  /**
   * Esquema de la consola (`CONSOLA_ESQUEMA`; `null` = el de la conexión). Se valida
   * contra el catálogo (PUBLIC, que es un pseudo-esquema, nunca vale), se aplica en la
   * sesión si está abierta y se guarda en el índice para reaplicarlo al reabrir. El
   * mapa en memoria se fija ANTES de aplicar: una reapertura que se cuele justo detrás
   * ya ve el esquema nuevo. Y mientras tanto `listar` no lo pisa (`esquemaEnVuelo`).
   */
  async esquemaConsola(
    perfilId: unknown,
    consolaId: unknown,
    esquema: unknown,
    txInicial?: unknown
  ): Promise<DbRespuesta<DbEstadoSesion>> {
    return this.c.seguro(async () => {
      const p = exigir(perfilId, 'perfilId')
      const c = exigir(consolaId, 'consolaId')
      if (esquema !== null && (typeof esquema !== 'string' || esquema === '' || esquema.length > MAX_IDENT)) {
        return fallo('interno', 'Petición inválida: «esquema».')
      }
      // Uno a la vez por consola: un segundo borraría la marca del primero o restauraría
      // un `antes` aún sin confirmar. El gestor ya respondía `ocupada` en ese caso.
      // Desde YA, y no solo desde que se toca el mapa: un `listar` que empiece durante
      // `esquemaExiste` y resuelva después también leyó el índice viejo.
      if (!this.c.estado.empezarCambioDeEsquema(p, c)) return fallo('ocupada', 'Ya se está cambiando el esquema de esta consola.')
      try {
        const conexionId = await this.conexionDeConsola(p, c)
        if (esquema !== null && !(await this.esquemaExiste(conexionId, esquema))) {
          return fallo('interno', `El esquema ${esquema} no existe en esta conexión.`)
        }
        const antes = this.c.estado.esquemaDeConsola(p, c)
        this.c.estado.fijarEsquemaDeConsola(p, c, esquema)
        // `txInicial`: si esta consola aún no tiene sesión, fijar el esquema la CREA (ver
        // `RefConsola.txInicial`); el gestor la valida.
        const r = await this.c.gestor.fijarEsquemaConsola(
          { perfilId: p, consolaId: c, conexionId, txInicial: txInicial as DbTxModo | undefined },
          esquema,
          antes ?? null
        )
        if (!r.ok) {
          this.c.estado.fijarEsquemaDeConsola(p, c, antes)
          return r
        }
        try {
          await this.c.consolas.fijarEsquema(p, c, esquema)
        } catch (e) {
          // La sesión ya lo tiene; solo se perdería al reabrirla.
          this.c.log(`no se pudo guardar el esquema de la consola: ${mensajeDe(e)}`)
        }
        return r
      } finally {
        // Ya escrito (o fallido): un `listar` posterior lee el índice nuevo.
        this.c.estado.terminarCambioDeEsquema(p, c)
      }
    })
  }

  async ejecutar(req: unknown): Promise<DbRespuesta<DbResultadoSentencia>> {
    return this.c.seguro(async () => {
      if (!esObjeto(req)) return fallo('interno', 'Petición inválida.')
      const perfilId = exigir(req.perfilId, 'perfilId')
      const consolaId = exigir(req.consolaId, 'consolaId')
      const ejecucionId = exigir(req.ejecucionId, 'ejecucionId', 200)
      if (typeof req.sql !== 'string') return fallo('interno', 'Petición inválida: falta «sql».')
      const maxFilas = typeof req.maxFilas === 'number' ? req.maxFilas : NaN
      const conexionId = await this.conexionDeConsola(perfilId, consolaId)
      // `binds` tal cual: el gestor valida su forma y es la autoridad de qué parámetros hay.
      // `confirmado`: solo `true` cuenta como la confirmación de producción.
      return this.c.gestor.ejecutarConsola({
        perfilId,
        consolaId,
        ejecucionId,
        sql: req.sql,
        maxFilas,
        conexionId,
        binds: req.binds as DbBinds | undefined,
        confirmado: req.confirmado === true,
        // La preferencia de Tx por si esta petición crea la sesión; el
        // gestor la valida y, si no es 'auto' ni 'manual', usa la suya.
        txInicial: req.txInicial as DbTxModo | undefined
      })
    })
  }

  /** CONSOLA_EXPLAIN: el plan sin ejecutar la sentencia (ver `GestorSesiones.explicar`). */
  async explicar(req: unknown): Promise<DbRespuesta<DbPlan>> {
    return this.c.seguro(async () => {
      if (!esObjeto(req)) return fallo('interno', 'Petición inválida.')
      const perfilId = exigir(req.perfilId, 'perfilId')
      const consolaId = exigir(req.consolaId, 'consolaId')
      const ejecucionId = exigir(req.ejecucionId, 'ejecucionId', 200)
      if (typeof req.sql !== 'string') return fallo('interno', 'Petición inválida: falta «sql».')
      const conexionId = await this.conexionDeConsola(perfilId, consolaId)
      return this.c.gestor.explicar({
        perfilId,
        consolaId,
        ejecucionId,
        sql: req.sql,
        conexionId,
        binds: req.binds as DbBinds | undefined,
        txInicial: req.txInicial as DbTxModo | undefined
      })
    })
  }

  /** HISTORIAL_LISTAR. Privado de Tessera: nunca toca el espacio de datos. */
  async historialListar(filtro: unknown): Promise<DbRespuesta<DbEntradaHistorial[]>> {
    return this.c.seguro(async () => {
      if (!esObjeto(filtro)) return fallo('interno', 'Petición inválida.')
      const perfilId = exigir(filtro.perfilId, 'perfilId')
      const conexionId = opcional(filtro.conexionId, 'conexionId', MAX_IDENT)
      const texto = opcional(filtro.texto, 'texto', MAX_FRAGMENTO)
      const limite = typeof filtro.limite === 'number' && Number.isFinite(filtro.limite) ? filtro.limite : undefined
      if (!this.c.historial || !this.c.opciones.perfilVivo(perfilId)) return ok([])
      return ok(
        await this.c.historial.listar({
          perfilId,
          ...(conexionId !== undefined ? { conexionId } : {}),
          ...(texto ? { texto } : {}),
          ...(limite !== undefined ? { limite } : {})
        })
      )
    })
  }

  /**
   * HISTORIAL_BORRAR: esas entradas, o TODO el historial del perfil con `ids`
   * EXACTAMENTE null (un `undefined` que llegue por un error del renderer no borra nada).
   */
  async historialBorrar(perfilId: unknown, ids: unknown): Promise<DbRespuesta<void>> {
    return this.c.seguro(async () => {
      const p = exigir(perfilId, 'perfilId')
      let lista: string[] | null
      if (ids === null) lista = null
      else if (Array.isArray(ids) && ids.length <= 100_000 && ids.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 200)) {
        lista = ids as string[]
      } else return fallo('interno', 'Petición inválida: «ids».')
      if (this.c.historial) await this.c.historial.borrar(p, lista)
      return ok(undefined)
    })
  }

  async tx(
    perfilId: unknown,
    consolaId: unknown,
    accion: unknown,
    confirmado?: unknown,
    txInicial?: unknown
  ): Promise<DbRespuesta<DbEstadoSesion>> {
    return this.c.seguro(async () => {
      const p = exigir(perfilId, 'perfilId')
      const c = exigir(consolaId, 'consolaId')
      if (accion !== 'commit' && accion !== 'rollback') return fallo('interno', 'Petición inválida: «accion».')
      const conexionId = await this.conexionDeConsola(p, c)
      // `confirmado`: solo `true` cuenta; en producción, el COMMIT lo exige.
      // `txInicial`: por si la petición crea la sesión (`RefConsola.txInicial`).
      return this.c.gestor.txConsola(
        { perfilId: p, consolaId: c, conexionId, txInicial: txInicial as DbTxModo | undefined },
        accion,
        confirmado === true
      )
    })
  }

  async modoTx(
    perfilId: unknown,
    consolaId: unknown,
    modo: unknown,
    resolver?: unknown,
    txInicial?: unknown
  ): Promise<DbRespuesta<DbEstadoSesion>> {
    return this.c.seguro(async () => {
      const p = exigir(perfilId, 'perfilId')
      const c = exigir(consolaId, 'consolaId')
      if (modo !== 'auto' && modo !== 'manual') return fallo('interno', 'Petición inválida: «modo».')
      const conexionId = await this.conexionDeConsola(p, c)
      return this.c.gestor.modoTx(
        { perfilId: p, consolaId: c, conexionId, txInicial: txInicial as DbTxModo | undefined },
        modo as DbTxModo,
        resolverOpcional(resolver)
      )
    })
  }

  estadoConsola(perfilId: unknown, consolaId: unknown): DbEstadoSesion | null {
    if (typeof perfilId !== 'string' || typeof consolaId !== 'string') return null
    // Sin sesión todavía, null: la barra pinta el modo con el que nacerá sobre la
    // conexión VIVA (ver `GestorSesiones.estadoConsola`).
    return this.c.gestor.estadoConsola(perfilId, consolaId)
  }

  async cerrarSesionConsola(perfilId: unknown, consolaId: unknown, resolver?: unknown): Promise<DbRespuesta<void>> {
    return this.c.seguro(async () => {
      const p = exigir(perfilId, 'perfilId')
      const c = exigir(consolaId, 'consolaId')
      const cierre = await this.c.gestor.cerrarSesionConsola(p, c, resolverOpcional(resolver))
      if (!cierre.ok) return cierre
      // La de una consola de MongoDB vive en el gestor de documentos (sin
      // transacción que resolver): se cierra con sus lectores, como en `borrarConsola`. La de
      // Redis, en el de claves.
      await this.c.opciones.documentos?.cerrarConsola(p, c)
      await this.c.opciones.claves?.cerrarConsola(p, c)
      return cierre
    })
  }
}
