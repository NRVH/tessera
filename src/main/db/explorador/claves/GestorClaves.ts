// =============================================================================
// Procesos y sesiones de los motores de claves (Redis): árbol, visor de valores y consola (una conexión de Redis por
// consola), sin lectores, y la traducción de errores del trabajador (`errorClaves`).
// Hereda su ciclo de vida de `gestorFamilia.ts`. Sin `electron`: se prueba con un trabajador falso.
// Decisiones: docs/decisiones/bd/claves-controlador.md
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import type { DbErrorSql, DbRespuesta } from '../../../../shared/db-explorador-ipc.ts'
import type {
  DbKvBases,
  DbKvEjecutar,
  DbKvEscanear,
  DbKvPaginaClaves,
  DbKvPedirBases,
  DbKvPedirValor,
  DbKvResultado,
  DbKvValor
} from '../../../../shared/db-claves-ipc.ts'
import { puntosDeCodigoAUtf16 } from '../../../../shared/sql/posicionErrorSql.ts'
import {
  CODIGO_DOCS_PRODUCCION,
  CODIGO_DOCS_SINTAXIS,
  CODIGO_DOCS_SOLO_LECTURA,
  CODIGO_NO_ADMITIDO,
  CODIGO_PELIGROSO,
  type ConexionTrabajador,
  type ErrorTrabajador,
  type PeticionClaves,
  type PoliticaClaves,
  type RespuestasClaves
} from '../protocoloTrabajador.ts'
import { motivoDeClase } from '../GestorSesiones.ts'
import { GestorFamilia, conexionTrabajadorFamilia, type DependenciasGestorFamilia } from '../gestorFamilia.ts'

export type DependenciasGestorClaves = DependenciasGestorFamilia

/** Contexto para ubicar un error de sintaxis de la consola (ver `errorClaves`). */
export interface ContextoErrorClaves {
  /** El comando ENVIADO y su desplazamiento (UTF-16) dentro del texto de la consola. */
  texto?: string
  desplazamiento?: number
}

// --- Funciones puras ---------------------------------------------------------------------

/**
 * La conexión tal como la necesita el trabajador de claves: la común de la familia (con el
 * cifrado EFECTIVO: el de Redis por defecto es sin cifrar) y la base por defecto, si la hay,
 * en su texto de siempre. Sin secreto (va aparte, en `abrir`).
 */
export function aConexionTrabajadorClaves(c: DbConnection): ConexionTrabajador {
  return conexionTrabajadorFamilia(c)
}

/**
 * `ErrorTrabajador` → `DbErrorSql` (ver la cabecera). Pura: el test la fija caso a caso.
 * La posición solo se pone si el trabajador la dio Y se sabe sobre qué comando contarla.
 */
export function errorClaves(et: ErrorTrabajador, ctx: ContextoErrorClaves = {}): DbErrorSql {
  const e: DbErrorSql = { mensaje: et.mensaje, motivo: motivoDeClase(et.clase) }
  if (et.codigo) e.codigo = et.codigo
  switch (et.codigo) {
    case CODIGO_DOCS_PRODUCCION:
      e.motivo = 'produccion'
      break
    case CODIGO_DOCS_SOLO_LECTURA:
      e.motivo = 'soloLectura'
      break
    case CODIGO_PELIGROSO:
      e.motivo = 'peligroso'
      break
    case CODIGO_NO_ADMITIDO:
    case CODIGO_DOCS_SINTAXIS:
      e.motivo = 'servidor'
      break
  }
  if (typeof et.offsetCp === 'number' && Number.isFinite(et.offsetCp) && et.offsetCp >= 0 && typeof ctx.texto === 'string') {
    e.posicion = puntosDeCodigoAUtf16(ctx.texto, et.offsetCp) + (ctx.desplazamiento ?? 0)
  }
  return e
}

// --- El gestor ---------------------------------------------------------------------------

export class GestorClaves extends GestorFamilia<ContextoErrorClaves, PeticionClaves, RespuestasClaves> {
  constructor(deps: DependenciasGestorClaves) {
    super(deps, {
      op: 'claves',
      familia: 'claves',
      etiqueta: 'claves',
      conexionTrabajador: aConexionTrabajadorClaves,
      error: (et, ctx) => errorClaves(et, ctx)
    })
  }

  // --- Operaciones del contrato (validadas por el controlador) -------------------------

  /** `KV_CHANNELS.BASES`: cuántas bases hay y cuáles tienen claves (sesión `meta`). */
  async bases(req: DbKvPedirBases): Promise<DbRespuesta<DbKvBases>> {
    return this.respuesta(() => this.operar(req.conexionId, this.refMeta(req.conexionId), { operacion: 'bases' }, { reintentar: true }))
  }

  /** `KV_CHANNELS.ESCANEAR`: una vuelta de SCAN (sesión `meta`; cancelable por `peticionId`). */
  async escanear(req: DbKvEscanear): Promise<DbRespuesta<DbKvPaginaClaves>> {
    const pet: Extract<PeticionClaves, { operacion: 'escanear' }> = {
      operacion: 'escanear',
      base: req.base,
      patron: req.patron,
      cursor: req.cursor,
      cuenta: req.cuenta
    }
    if (req.tipo !== undefined) pet.tipo = req.tipo
    return this.respuesta(() => this.operar(req.conexionId, this.refMeta(req.conexionId), pet, { clave: req.peticionId, reintentar: true }))
  }

  /** `KV_CHANNELS.VALOR`: el valor de una clave por trozos (sesión `datos`, la del visor). */
  async valor(req: DbKvPedirValor): Promise<DbRespuesta<DbKvValor>> {
    const pet: Extract<PeticionClaves, { operacion: 'valor' }> = { operacion: 'valor', base: req.base, clave: req.clave.base64 }
    if (req.desde !== undefined) pet.desde = req.desde
    if (req.cuantos !== undefined) pet.cuantos = req.cuantos
    return this.respuesta(() =>
      this.operar(req.conexionId, { rol: 'datos', conexionId: req.conexionId }, pet, { clave: req.peticionId, reintentar: true })
    )
  }

  /**
   * `KV_CHANNELS.CONSOLA_EJECUTAR`: UN comando en la sesión de su consola, con la política
   * que decidió el controlador. Sin reintento (ver la cabecera).
   */
  async ejecutarConsola(req: DbKvEjecutar, politica: PoliticaClaves): Promise<DbRespuesta<DbKvResultado>> {
    const ctx: ContextoErrorClaves = { texto: req.texto, desplazamiento: req.desplazamiento }
    return this.respuesta(
      () =>
        this.operar(
          req.conexionId,
          { rol: 'consola', perfilId: req.perfilId, consolaId: req.consolaId },
          { operacion: 'consola', base: req.base, texto: req.texto, politica },
          // La consola usa el `peticionId` como `ejecucionId` de `DbCancelar` (como Mongo).
          { clave: req.peticionId }
        ),
      ctx
    )
  }
}
