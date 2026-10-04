// =============================================================================
// Gramática local en el main: el parser de verdad (`libpg-query`), cargado la primera vez que
// hace falta, detrás de `CONSOLA_SINTAXIS`. Se parsea sentencia a sentencia cediendo el hilo
// cada `PORCION_MS`. El reparto (por qué en el main, cómo se sitúa el error) está en
// `shared/sql/sintaxisSql.ts`. Neutral respecto a Electron: la prueba lo carga con `node`.
// Decisiones: docs/decisiones/bd/motores-sintaxis-local.md
// =============================================================================

import type { DbRespuesta, DbValidarSintaxis } from '../../shared/db-explorador-ipc.ts'
import type { GramaticaLocal } from '../../shared/sql/dialectosSql.ts'
import {
  TOPE_TEXTO_SINTAXIS,
  TOPE_TEXTOS_SINTAXIS,
  TOPE_TOTAL_SINTAXIS,
  type VeredictoSintaxis
} from '../../shared/sql/sintaxisSql.ts'

/** Lo que se usa de `libpg-query`. */
interface ParserPg {
  loadModule(): Promise<void>
  parseSync(sql: string): unknown
}

/** Lo que trae un `SqlError` de libpg-query. */
interface ErrorConDetalles {
  message: string
  sqlDetails?: { cursorPosition?: number }
}

/** Cada cuánto se cede el hilo mientras se parsea un lote. */
const PORCION_MS = 8

export interface OpcionesSintaxisLocal {
  log?: (linea: string) => void
  /** Solo para las pruebas: sustituye la carga del parser. */
  cargarParser?: () => Promise<ParserPg>
}

async function cargarLibpgQuery(): Promise<ParserPg> {
  const m = (await import('libpg-query')) as unknown as ParserPg & { default?: ParserPg }
  const p: ParserPg = typeof m.parseSync === 'function' ? m : (m.default as ParserPg)
  await p.loadModule()
  return p
}

/**
 * Cómo se carga el parser de cada gramática. Exhaustiva sobre `GramaticaLocal`, y la petición
 * se valida contra sus claves. La clase lleva UNA carga porque hoy hay una sola gramática: la
 * segunda tendrá que llevar una por gramática (un `Map` con esta misma tabla).
 */
const CARGADORES: Readonly<Record<GramaticaLocal, () => Promise<ParserPg>>> = {
  postgres: cargarLibpgQuery
}

function esErrorDeParser(e: unknown): e is ErrorConDetalles {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as ErrorConDetalles).message === 'string' &&
    typeof (e as ErrorConDetalles).sqlDetails === 'object' &&
    (e as ErrorConDetalles).sqlDetails !== null
  )
}

/** ¿Un abort del runtime de emscripten (el módulo ya no sirve), y no un error de ese texto? */
function esAbortDelRuntime(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  return e.name === 'RuntimeError' || /^Aborted\(/.test(e.message)
}

function cederHilo(): Promise<void> {
  return new Promise((r) => setImmediate(r))
}

function fallo(motivo: 'interno' | 'limite', mensaje: string): { ok: false; error: { motivo: typeof motivo; mensaje: string } } {
  return { ok: false, error: { motivo, mensaje } }
}

/** Valida la forma y los topes de la petición; devuelve los textos o el fallo. */
function textosDe(req: unknown): string[] | ReturnType<typeof fallo> {
  const r = (typeof req === 'object' && req !== null ? req : {}) as Partial<DbValidarSintaxis>
  // Una gramática nueva en `GramaticaLocal` no compila hasta que diga aquí cómo se carga.
  if (typeof r.gramatica !== 'string' || !Object.prototype.hasOwnProperty.call(CARGADORES, r.gramatica)) {
    return fallo('interno', 'Gramática desconocida.')
  }
  const textos = r.textos
  if (!Array.isArray(textos) || textos.some((t) => typeof t !== 'string')) {
    return fallo('interno', 'Petición de sintaxis mal formada.')
  }
  if (textos.length > TOPE_TEXTOS_SINTAXIS) return fallo('limite', 'Demasiadas sentencias para validarlas a la vez.')
  let total = 0
  for (const t of textos as string[]) total += t.length
  if (total > TOPE_TOTAL_SINTAXIS) return fallo('limite', 'Demasiado texto para validarlo a la vez.')
  return textos as string[]
}

export class SintaxisLocal {
  private carga: Promise<ParserPg> | null = null
  /** No cargó, o el runtime del WASM abortó: no se vuelve a usar (ver el ADR). */
  private roto = false

  private readonly opciones: OpcionesSintaxisLocal

  constructor(opciones: OpcionesSintaxisLocal = {}) {
    this.opciones = opciones
  }

  private cargar(): Promise<ParserPg> {
    if (this.carga === null) {
      const cargar = this.opciones.cargarParser ?? CARGADORES.postgres
      const p = cargar()
      this.carga = p
      p.catch((err: unknown) => {
        // Sin reintento: se marca roto y se dice una vez.
        this.roto = true
        this.opciones.log?.(`sintaxis: no cargó el parser: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`)
      })
    }
    return this.carga
  }

  /** El veredicto de UN texto: `null` si no lo hay (demasiado largo, parser roto o fallo de ese texto). */
  private veredicto(parser: ParserPg, texto: string): VeredictoSintaxis {
    if (texto.length > TOPE_TEXTO_SINTAXIS) return null
    if (texto.trim() === '') return { ok: true }
    // Tras un `await` el parser pudo romperse (un abort en otra petición).
    if (this.roto) return null
    try {
      parser.parseSync(texto)
      return { ok: true }
    } catch (e) {
      if (esErrorDeParser(e)) {
        const pos = e.sqlDetails?.cursorPosition
        return { ok: false, mensaje: e.message, offsetCp: typeof pos === 'number' && pos >= 0 ? pos : 0 }
      }
      if (esAbortDelRuntime(e)) {
        this.opciones.log?.(`sintaxis: el parser abortó y queda roto: ${String((e as Error).message).slice(0, 200)}`)
        this.roto = true
      }
      // Cualquier otro: un fallo de ESTE texto (sin veredicto); el parser sigue sirviendo a los demás.
      return null
    }
  }

  /** `CONSOLA_SINTAXIS`. Nunca lanza. */
  async validar(req: unknown): Promise<DbRespuesta<VeredictoSintaxis[]>> {
    const textos = textosDe(req)
    if (!Array.isArray(textos)) return textos

    if (this.roto) return fallo('interno', 'La gramática local dejó de responder; vuelve al reiniciar Tessera.')
    let parser: ParserPg
    try {
      parser = await this.cargar()
    } catch {
      return fallo('interno', 'No se pudo cargar la gramática local.')
    }

    const salida: VeredictoSintaxis[] = []
    let porcion = Date.now()
    for (const texto of textos) {
      if (Date.now() - porcion >= PORCION_MS) {
        await cederHilo()
        porcion = Date.now()
      }
      salida.push(this.veredicto(parser, texto))
    }
    return { ok: true, valor: salida }
  }
}
