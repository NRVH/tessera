// =============================================================================
// Operaciones de `KV_CHANNELS` (Redis): valida la conexión y la forma de cada petición, decide la política de la consola
// (con `confirmadoPeligroso`) y se lo da al `GestorClaves`. Sin `electron`: sus canales los registra `ipc.ts`.
// Gemelo de `documentos/ControladorDocumentos.ts`.
// Decisiones: docs/decisiones/bd/claves-controlador.md
// =============================================================================

import {
  KV_CHANNELS,
  type DbKvEjecutar,
  type DbKvEscanear,
  type DbKvPedirBases,
  type DbKvPedirValor,
  type DbKvTipo
} from '../../../../shared/db-claves-ipc.ts'
import { DB_CONSOLA_MAX_BYTES, type DbRespuesta } from '../../../../shared/db-explorador-ipc.ts'
import type { DbConnection } from '../../../../shared/db-ipc.ts'
import { MAX_BASE_CLAVES } from '../../opcionalesConexion.ts'
import { conexionDePeticion, type BuscadorConexiones } from '../familias.ts'
import type { PoliticaClaves } from '../protocoloTrabajador.ts'
import { politicaDe } from '../documentos/ControladorDocumentos.ts'
import { conValidado, esEnteroEn, esNombre, invalida, peticionIdDe, type Validado } from '../documentos/validacionPeticion.ts'
import { sinSoloLecturaImpuesta, type SoloLecturaImpuesta } from '../soloLecturaImpuesta.ts'
import type { GestorClaves } from './GestorClaves.ts'

/** Las operaciones del contrato de claves (las claves de `KV_CHANNELS`). */
export type OperacionClaves = keyof typeof KV_CHANNELS

/** Lo que el controlador usa del gestor (el test lo sustituye por un falso). */
export type GestorClavesAtiende = Pick<GestorClaves, 'bases' | 'escanear' | 'valor' | 'ejecutarConsola'>

export interface OpcionesControladorClaves {
  /** El registro de conexiones (`ConnectionStore`). */
  conexiones: BuscadorConexiones
  gestor: GestorClavesAtiende
  log?: (linea: string) => void
  /** Como en documentos (`OpcionesControladorDocumentos`): ausente, ninguna. */
  soloLecturaImpuesta?: SoloLecturaImpuesta
}

/** Tope del COUNT de una vuelta de SCAN (una pista para el servidor; 10 000 es holgado). */
export const MAX_CUENTA_SCAN = 10_000
/** Tope de elementos de un trozo del visor. */
export const MAX_CUANTOS_VALOR = 10_000
/** Tope del patrón de MATCH. */
const MAX_PATRON = 64 * 1024
/**
 * Tope de la clave en base64 (4 MiB ≈ 3 MiB de clave). Redis admite claves de 512 MB, pero
 * una clave así no se explora a mano, y el IPC no es sitio para ella.
 */
const MAX_CLAVE_BASE64 = 4 * 1024 * 1024
/** Tope de `desde` (un cursor de HSCAN, un índice o un id de stream). */
const MAX_DESDE = 256
/** Los tipos por los que se puede filtrar un SCAN (`otro` no es un tipo del servidor). */
const TIPOS_SCAN: readonly DbKvTipo[] = ['string', 'hash', 'list', 'set', 'zset', 'stream', 'json']

/** ¿Es base64 estándar bien formado (con su relleno)? '' también: Redis admite la clave vacía. */
export function esBase64(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_CLAVE_BASE64 && v.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(v)
}

/** La política de la consola de claves: la de documentos más la confirmación de lo peligroso. */
export function politicaClavesDe(
  con: Pick<DbConnection, 'entorno'>,
  soloLectura: boolean,
  confirmado: unknown,
  confirmadoPeligroso: unknown
): PoliticaClaves {
  return { ...politicaDe(con, soloLectura, confirmado), confirmadoPeligroso: confirmadoPeligroso === true }
}

export class ControladorClaves {
  // Campo explícito (no propiedad de parámetro): ver `ControladorDocumentos`.
  private readonly o: OpcionesControladorClaves

  constructor(o: OpcionesControladorClaves) {
    this.o = o
  }

  /** La solo lectura impuesta (ver `soloLecturaImpuesta.ts`); en el producto, ninguna. */
  private ro(con: DbConnection): boolean {
    return (this.o.soloLecturaImpuesta ?? sinSoloLecturaImpuesta)(con)
  }

  /**
   * El PUNTO ÚNICO de las operaciones (ver la cabecera): valida la conexión y la forma,
   * decide la política y se lo da al gestor.
   */
  async atender(op: OperacionClaves, req: unknown): Promise<DbRespuesta<unknown>> {
    const v = conexionDePeticion(req, this.o.conexiones, 'claves')
    if (!v.ok) return v
    const con = v.con
    const r = req as Record<string, unknown>
    const g = this.o.gestor
    switch (op) {
      case 'BASES':
        return g.bases({ conexionId: con.id } satisfies DbKvPedirBases)
      case 'ESCANEAR':
        return conValidado(this.validarEscanear(r), (p) => g.escanear(p))
      case 'VALOR':
        return conValidado(this.validarValor(r), (p) => g.valor(p))
      case 'CONSOLA_EJECUTAR':
        return conValidado(this.validarEjecutar(r), (p) =>
          g.ejecutarConsola(p, politicaClavesDe(con, this.ro(con), p.confirmado, p.confirmadoPeligroso))
        )
    }
  }

  // --- Validación de la forma (la conexión ya está validada) -----------------------------

  private validarEscanear(r: Record<string, unknown>): Validado<DbKvEscanear> {
    if (!esEnteroEn(r.base, 0, MAX_BASE_CLAVES)) return invalida('«base» tiene que ser un entero entre 0 y ' + MAX_BASE_CLAVES)
    if (typeof r.patron !== 'string' || r.patron.length > MAX_PATRON) return invalida('«patron» no es un texto válido')
    if (typeof r.cursor !== 'string' || !/^\d{1,20}$/.test(r.cursor)) return invalida('«cursor» no es válido')
    if (!esEnteroEn(r.cuenta, 1, MAX_CUENTA_SCAN)) return invalida('«cuenta» fuera de rango')
    if (r.tipo !== undefined && !TIPOS_SCAN.includes(r.tipo as DbKvTipo)) return invalida('«tipo» no es un tipo de clave válido')
    const peticionId = peticionIdDe(r)
    if (peticionId === null) return invalida('«peticionId» no es válido')
    const p: DbKvEscanear = { conexionId: r.conexionId as string, base: r.base, patron: r.patron, cursor: r.cursor, cuenta: r.cuenta }
    if (r.tipo !== undefined) p.tipo = r.tipo as DbKvTipo
    if (peticionId !== undefined) p.peticionId = peticionId
    return { ok: true, valor: p }
  }

  private validarValor(r: Record<string, unknown>): Validado<DbKvPedirValor> {
    if (!esEnteroEn(r.base, 0, MAX_BASE_CLAVES)) return invalida('«base» tiene que ser un entero entre 0 y ' + MAX_BASE_CLAVES)
    const clave = r.clave
    if (clave === null || typeof clave !== 'object' || !esBase64((clave as Record<string, unknown>).base64)) {
      return invalida('«clave» tiene que llevar sus bytes en base64')
    }
    if (r.desde !== undefined && (typeof r.desde !== 'string' || r.desde.length > MAX_DESDE)) return invalida('«desde» no es válido')
    if (r.cuantos !== undefined && !esEnteroEn(r.cuantos, 1, MAX_CUANTOS_VALOR)) return invalida('«cuantos» fuera de rango')
    const peticionId = peticionIdDe(r)
    if (peticionId === null) return invalida('«peticionId» no es válido')
    // Solo los bytes: el texto que traiga la clave lo pintó el renderer y no se usa.
    const p: DbKvPedirValor = { conexionId: r.conexionId as string, base: r.base, clave: { base64: (clave as { base64: string }).base64 } }
    if (r.desde !== undefined) p.desde = r.desde as string
    if (r.cuantos !== undefined) p.cuantos = r.cuantos as number
    if (peticionId !== undefined) p.peticionId = peticionId
    return { ok: true, valor: p }
  }

  private validarEjecutar(r: Record<string, unknown>): Validado<DbKvEjecutar> {
    if (!esNombre(r.perfilId)) return invalida('falta «perfilId»')
    if (!esNombre(r.consolaId)) return invalida('falta «consolaId»')
    if (!esEnteroEn(r.base, 0, MAX_BASE_CLAVES)) return invalida('«base» tiene que ser un entero entre 0 y ' + MAX_BASE_CLAVES)
    if (typeof r.texto !== 'string' || r.texto.length > DB_CONSOLA_MAX_BYTES || r.texto.trim() === '') return invalida('falta el comando')
    if (!esEnteroEn(r.desplazamiento, 0, DB_CONSOLA_MAX_BYTES)) return invalida('«desplazamiento» fuera de rango')
    for (const k of ['confirmado', 'confirmadoPeligroso'] as const) {
      if (r[k] !== undefined && typeof r[k] !== 'boolean') return invalida(`«${k}» no es booleano`)
    }
    const peticionId = peticionIdDe(r)
    if (peticionId === null) return invalida('«peticionId» no es válido')
    const p: DbKvEjecutar = {
      perfilId: r.perfilId,
      consolaId: r.consolaId,
      conexionId: r.conexionId as string,
      base: r.base,
      texto: r.texto,
      desplazamiento: r.desplazamiento
    }
    if (r.confirmado === true) p.confirmado = true
    if (r.confirmadoPeligroso === true) p.confirmadoPeligroso = true
    if (peticionId !== undefined) p.peticionId = peticionId
    return { ok: true, valor: p }
  }

  /** Escribe una línea en el registro, si se le dio uno. */
  log(linea: string): void {
    this.o.log?.(linea)
  }
}
