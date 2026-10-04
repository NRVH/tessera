// =============================================================================
// Archivos de consola y operaciones comunes a todas las familias de motor: cancelar, forzar, desconectar y sesiones.
// Delega en los gestores de documentos y de claves lo que es suyo.
// Decisiones: docs/decisiones/bd/explorador-stop-en-preparacion.md
// =============================================================================

import { existsSync } from 'node:fs'

import type {
  DbCancelar,
  DbConsolaInfo,
  DbConsolaTexto,
  DbEscrituraConsola,
  DbEstadoSesion,
  DbResolucionBloque,
  DbRespuesta
} from '../../../../shared/db-explorador-ipc.ts'
import {
  descriptor,
  esDeClaves,
  esDeDocumentos,
  esMotor,
  extensionConsola
} from '../../../../shared/motores/index.ts'

import { respuestaConsolas } from '../ConsolasStore.ts'
import { falloTodaviaNo } from '../familias.ts'

import type { ConsolaExplorador } from './consola.ts'
import type { ContextoExplorador } from './tipos.ts'
import { esObjeto, exigir, fallo, mensajeDe, ok, resolverOpcional } from './validacion.ts'

/** Archivos de consola y operaciones comunes a todas las familias de motor: cancelar, forzar, desconectar y sesiones. */
export class ArchivosConsola {
  private readonly c: ContextoExplorador
  private readonly sesionConsola: ConsolaExplorador

  constructor(c: ContextoExplorador, sesionConsola: ConsolaExplorador) {
    this.c = c
    this.sesionConsola = sesionConsola
  }

  cancelar(req: unknown): void {
    if (!esObjeto(req)) return
    if (req.rol === 'consola') this.cancelarConsola(req)
    else if (req.rol === 'datos') this.cancelarDatos(req)
    else if (req.rol === 'exportacion') this.cancelarExportacion(req)
  }

  /** Una consola de MongoDB o de Redis usa su `ejecucionId` como `peticionId`: cada gestor ignora lo que no es suyo. */
  private cancelarConsola(req: Record<string, unknown>): void {
    if (typeof req.perfilId !== 'string' || typeof req.consolaId !== 'string' || typeof req.ejecucionId !== 'string') return
    const c: DbCancelar = { rol: 'consola', perfilId: req.perfilId, consolaId: req.consolaId, ejecucionId: req.ejecucionId }
    this.c.gestor.cancelar(c)
    this.c.opciones.documentos?.cancelar(c)
    this.c.opciones.claves?.cancelar(c)
  }

  /** Lo que el main aún PREPARA no está en el gestor: se apunta (`enPreparacion`) y la operación no llega a encolarse. */
  private cancelarDatos(req: Record<string, unknown>): void {
    if (typeof req.conexionId !== 'string' || typeof req.peticionId !== 'string') return
    this.c.estado.detenerPreparacion(req.conexionId, req.peticionId)
    this.c.gestor.cancelar({ rol: 'datos', conexionId: req.conexionId, peticionId: req.peticionId })
    this.c.opciones.documentos?.cancelar({ rol: 'datos', conexionId: req.conexionId, peticionId: req.peticionId })
    this.c.opciones.claves?.cancelar({ rol: 'datos', conexionId: req.conexionId, peticionId: req.peticionId })
  }

  /** El exportador para el bucle entre páginas (y mientras se prepara o con el diálogo abierto); el gestor, la lectura en vuelo. */
  private cancelarExportacion(req: Record<string, unknown>): void {
    if (typeof req.peticionId !== 'string' || !req.peticionId) return
    if (this.c.exportador.cancelar(req.peticionId)) {
      this.c.gestor.cancelar({ rol: 'exportacion', peticionId: req.peticionId })
    }
  }

  forzar(conexionId: unknown, consola?: unknown): void {
    if (typeof conexionId !== 'string' || !conexionId) return
    // `consola`: en un motor con un proceso por consola (SQLite), solo el de esa
    // consola; lo decide el gestor (ver `GestorSesiones.forzar`).
    const c = consola as { perfilId?: unknown; consolaId?: unknown } | null | undefined
    const ref =
      c && typeof c === 'object' && typeof c.perfilId === 'string' && c.perfilId && typeof c.consolaId === 'string' && c.consolaId
        ? { perfilId: c.perfilId, consolaId: c.consolaId }
        : undefined
    this.c.gestor.forzar(conexionId, ref)
    // El proceso de documentos de esa conexión, si lo hay (uno por conexión).
    this.c.opciones.documentos?.forzar(conexionId)
    this.c.opciones.claves?.forzar(conexionId)
  }

  /** Con «Confirmar», las fallidas se revierten y vuelven en `revertidasFallidas` (ver el gestor). */
  async desconectar(conexionId: unknown, resolver?: unknown): Promise<DbRespuesta<DbResolucionBloque>> {
    return this.c.seguro(async () => {
      const id = exigir(conexionId, 'conexionId')
      // Una conexión de documentos no tiene transacciones que resolver:
      // se cierran sus sesiones y su proceso en el gestor de documentos.
      const con = this.c.conexiones.get(id)
      const docs = this.c.opciones.documentos
      if (docs && con && esMotor(con.motor) && esDeDocumentos(descriptor(con.motor))) {
        await docs.desconectar(id)
        return ok({})
      }
      // Lo mismo con una de claves, en su gestor.
      const kv = this.c.opciones.claves
      if (kv && con && esMotor(con.motor) && esDeClaves(descriptor(con.motor))) {
        await kv.desconectar(id)
        return ok({})
      }
      return this.c.gestor.desconectar(id, resolverOpcional(resolver))
    })
  }

  sesiones(): DbEstadoSesion[] {
    return [...this.c.gestor.sesiones(), ...(this.c.opciones.documentos?.sesiones() ?? []), ...(this.c.opciones.claves?.sesiones() ?? [])]
  }

  /** El espacio de datos se crea (con su CLAUDE.md/AGENTS.md) antes de la primera consola. */
  private asegurarEspacio(perfilId: string): void {
    if (!this.c.opciones.perfilVivo(perfilId)) return
    let dir: string
    try {
      dir = this.c.registro.espacioDeDatos(perfilId)
    } catch {
      return
    }
    if (existsSync(dir)) return
    try {
      this.c.registro.ensureWorkspace(perfilId, this.c.opciones.nombrePerfil(perfilId) ?? 'Perfil')
    } catch (e) {
      this.c.log(`no se pudo preparar el espacio de datos de ${perfilId}: ${mensajeDe(e)}`)
    }
  }

  async listarConsolas(perfilId: unknown): Promise<DbRespuesta<DbConsolaInfo[]>> {
    return this.c.seguro(async () => {
      const p = exigir(perfilId, 'perfilId')
      const r = await respuestaConsolas(() => this.c.consolas.listar(p))
      if (r.ok) for (const i of r.valor) this.sesionConsola.recordarConsola(i)
      return r
    })
  }

  async crearConsola(perfilId: unknown, conexionId: unknown): Promise<DbRespuesta<DbConsolaInfo>> {
    return this.c.seguro(async () => {
      const p = exigir(perfilId, 'perfilId')
      const id = exigir(conexionId, 'conexionId')
      const con = this.c.conexiones.get(id)
      if (!con || con.profileId !== p) return fallo('interno', 'La conexión no existe en este perfil.')
      // Una consola SQL es `.sql`; una de MongoDB, `.js` (el lenguaje de
      // mongosh, y así el agente la lee como lo que es); una de Redis, `.redis`
      // (comandos de redis-cli, uno por línea). Un motor sin consola todavía, el «todavía no».
      if (!esMotor(con.motor)) return fallo('interno', `Motor desconocido: "${String(con.motor)}".`)
      const extension = extensionConsola(descriptor(con.motor))
      if (extension === null) return falloTodaviaNo(con.motor)
      this.asegurarEspacio(p)
      const r = await respuestaConsolas(() => this.c.consolas.crear(p, id, extension))
      if (r.ok) this.sesionConsola.recordarConsola(r.valor)
      return r
    })
  }

  async leerConsola(perfilId: unknown, consolaId: unknown): Promise<DbRespuesta<DbConsolaTexto>> {
    return this.c.seguro(async () => {
      const p = exigir(perfilId, 'perfilId')
      const c = exigir(consolaId, 'consolaId')
      return respuestaConsolas(() => this.c.consolas.leer(p, c))
    })
  }

  async escribirConsola(perfilId: unknown, consolaId: unknown, texto: unknown): Promise<DbRespuesta<DbEscrituraConsola>> {
    return this.c.seguro(async () => {
      const p = exigir(perfilId, 'perfilId')
      const c = exigir(consolaId, 'consolaId')
      if (typeof texto !== 'string') return fallo('interno', 'Petición inválida: falta «texto».')
      return respuestaConsolas(() => this.c.consolas.escribir(p, c, texto))
    })
  }

  async renombrarConsola(perfilId: unknown, consolaId: unknown, nombre: unknown): Promise<DbRespuesta<DbConsolaInfo>> {
    return this.c.seguro(async () => {
      const p = exigir(perfilId, 'perfilId')
      const c = exigir(consolaId, 'consolaId')
      return respuestaConsolas(() => this.c.consolas.renombrar(p, c, typeof nombre === 'string' ? nombre : ''))
    })
  }

  /** A la papelera. Con tx pendiente y sin `resolver`, `txPendiente` (el diálogo lo pide). */
  async borrarConsola(perfilId: unknown, consolaId: unknown, resolver?: unknown): Promise<DbRespuesta<void>> {
    return this.c.seguro(async () => {
      const p = exigir(perfilId, 'perfilId')
      const c = exigir(consolaId, 'consolaId')
      const cierre = await this.c.gestor.cerrarSesionConsola(p, c, resolverOpcional(resolver))
      if (!cierre.ok) return cierre
      // Una consola de MongoDB o de Redis no tiene transacción: su
      // sesión se cierra y ya.
      await this.c.opciones.documentos?.cerrarConsola(p, c)
      await this.c.opciones.claves?.cerrarConsola(p, c)
      const r = await respuestaConsolas(() => this.c.consolas.borrar(p, c))
      if (r.ok) {
        this.c.estado.olvidarConsola(p, c)
      }
      return r
    })
  }
}
