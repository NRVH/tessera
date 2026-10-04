// =============================================================================
// Precarga de claves ajenas: cuando una consola se queda quieta un segundo, pide las
// FKs de las tablas de la sentencia del último cambio (solo las que existen, hasta
// `MAX_TABLAS_PRECARGA`), para que el `JOIN ` siguiente ya las tenga aunque la red
// tarde más que el tope del proveedor. Vigila MODELOS de consola, no editores.
// Puro salvo por los temporizadores, que se inyectan (el test los controla).
// Decisiones: docs/decisiones/bd/ui-autocompletado-fks-y-estrella.md
// =============================================================================

import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import { dividirSentencias, sentenciaEnCursor, type Sentencia } from '../../../../../shared/sql/divisorSql.ts'
import { mismoNombre } from '../../../../../shared/sql/identificadoresSql.ts'
import { tokenizar } from '../../../../../shared/sql/lexicoSql.ts'
import type { CacheMetaBd } from '../cacheMetaBd.ts'
import { analisisDe, type ModeloAnalizable } from './analisisModelo.ts'
import { CatalogoAutocompletado, type MemoriaFallos } from './catalogoAutocompletado.ts'
import { referencias, type RefTabla } from './contextoSql.ts'
import { esUriDeConsola, rutaDeModelo, type RutaConsola } from './enrutadorConsolas.ts'
import { esquemaDeRef } from './sugerenciasSql.ts'

/** Cuánto tiene que estar quieta la consola para precargar. */
export const PAUSA_PRECARGA_MS = 1000
/** Tope de tablas por pausa. */
export const MAX_TABLAS_PRECARGA = 8
/** Por encima de esto no se analiza (el mismo tope que el autocompletado). */
const MAX_TEXTO_PRECARGA = 2 * 1024 * 1024

/** Un cambio del modelo (lo cumple `IModelContentChange`). */
export interface CambioModelo {
  rangeOffset: number
  text: string
}

/** Un evento de cambio del modelo (lo cumple `IModelContentChangedEvent`). */
export interface EventoCambioModelo {
  changes: readonly CambioModelo[]
  /** `setValue`: el texto entero se sustituyó (la primera carga desde el disco). */
  isFlush?: boolean
}

/** Lo que la precarga usa de un modelo (lo cumple `editor.ITextModel`). */
export interface ModeloVigilable extends ModeloAnalizable {
  readonly uri: { toString(): string }
  isDisposed(): boolean
  getValueLength(): number
  onDidChangeContent(cb: (e: EventoCambioModelo) => void): { dispose(): void }
  onWillDispose(cb: () => void): { dispose(): void }
}

/** Las tablas que nombra la sentencia bajo `offset` (sin CTE ni DUAL). */
export function tablasDeSentencia(
  texto: string,
  offset: number,
  d: DialectoSql,
  sentencias?: readonly Sentencia[]
): RefTabla[] {
  const s = sentenciaEnCursor(sentencias ?? dividirSentencias(texto, d), texto, offset)
  if (!s) return []
  return referencias(tokenizar(texto, d, s.desde, s.hasta), d, texto)
}

export interface OpcionesPrecarga {
  cache: () => CacheMetaBd
  ruta?: (uri: string) => RutaConsola | null
  fallos?: MemoriaFallos
  pausaMs?: number
  programar?: (fn: () => void, ms: number) => unknown
  cancelar?: (h: unknown) => void
}

/**
 * Pide las FKs de las tablas de la sentencia bajo `offset` que existen y aún no están
 * en caché. Devuelve cuántas pidió (para el test). Nunca rechaza. `sentencias`, si
 * llegan, son las de `texto` ya partidas (`analisisDe`): sin ellas se parte aquí.
 */
export async function precargarFks(
  texto: string,
  offset: number,
  ruta: RutaConsola,
  cache: CacheMetaBd,
  fallos?: MemoriaFallos,
  sentencias?: readonly Sentencia[]
): Promise<number> {
  const d = ruta.dialecto
  const fuente = new CatalogoAutocompletado(cache, ruta, fallos)
  await fuente.cargarBase()
  const tareas: Array<Promise<void>> = []
  const vistas = new Set<string>()
  for (const ref of tablasDeSentencia(texto, offset, d, sentencias)) {
    if (tareas.length >= MAX_TABLAS_PRECARGA) break
    // Por enlace (`emp@remota`): las FKs del catálogo serían las de la EMP local.
    if (ref.remota) continue
    const e = esquemaDeRef(ref, fuente, d)
    if (e === null) continue
    const clave = e + '.' + ref.nombre
    if (vistas.has(clave)) continue
    vistas.add(clave)
    // `'PUBLIC'` a pelo y sin mirar el motor, a propósito: con el pseudo-esquema del
    // descriptor, un esquema de PG llamado literalmente "PUBLIC" dejaría de dar `existe`.
    const existe =
      ref.esquema !== null ||
      e === 'PUBLIC' ||
      fuente.objetos(e).some((o) => mismoNombre(o.nombre, ref.nombre, d))
    // Las obsoletas (un DDL de la conexión) también: es justo la pausa para recargarlas.
    if (!existe || (fuente.fks(e, ref.nombre) !== null && !fuente.obsoleto('fks', e, ref.nombre))) continue
    tareas.push(fuente.cargarFksDe(e, ref.nombre))
  }
  await Promise.all(tareas)
  return tareas.length
}

/** Vigila los modelos de consola y precarga en cada pausa. */
export class PrecargaFks {
  private readonly op: OpcionesPrecarga
  private readonly vigilados = new WeakSet<object>()

  constructor(op: OpcionesPrecarga) {
    this.op = op
  }

  /** Empieza a vigilar `modelo` si es de una consola. Idempotente. */
  vigilar(modelo: ModeloVigilable): void {
    if (this.vigilados.has(modelo) || !esUriDeConsola(modelo.uri.toString())) return
    this.vigilados.add(modelo)
    const programar = this.op.programar ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms))
    const cancelar = this.op.cancelar ?? ((h: unknown): void => clearTimeout(h as ReturnType<typeof setTimeout>))
    let pendiente: unknown = null
    let offset = 0
    const cambios = modelo.onDidChangeContent((e) => {
      // Lo pendiente se cancela ANTES de mirar si es un flush: tras un `setValue`, su
      // offset sería de otro texto.
      if (pendiente !== null) cancelar(pendiente)
      pendiente = null
      // Un flush (`setValue`: la primera carga de la consola desde el disco) no es
      // nadie escribiendo, y precargar al ABRIR está descartado (ver el ADR).
      if (e.isFlush) return
      const c = e.changes[0]
      if (c) offset = c.rangeOffset + c.text.length
      pendiente = programar(() => {
        pendiente = null
        this.alPausar(modelo, offset)
      }, this.op.pausaMs ?? PAUSA_PRECARGA_MS)
    })
    const baja = modelo.onWillDispose(() => {
      if (pendiente !== null) cancelar(pendiente)
      pendiente = null
      cambios.dispose()
      baja.dispose()
    })
  }

  private alPausar(modelo: ModeloVigilable, offset: number): void {
    if (modelo.isDisposed() || modelo.getValueLength() > MAX_TEXTO_PRECARGA) return
    const ruta = (this.op.ruta ?? rutaDeModelo)(modelo.uri.toString())
    if (!ruta) return
    // La división de esta versión, si ya la hizo el completado (ver `analisisModelo.ts`).
    const { texto, sentencias } = analisisDe(modelo, ruta.dialecto)
    void precargarFks(texto, Math.min(offset, texto.length), ruta, this.op.cache(), this.op.fallos, sentencias).catch(
      () => undefined
    )
  }
}
