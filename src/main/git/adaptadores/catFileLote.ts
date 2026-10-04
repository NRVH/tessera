// =============================================================================
// Parser INCREMENTAL de la salida de `git cat-file --batch`: por revisión, una cabecera
// («<sha> <tipo> <tamaño>» o «<rev> missing») y el contenido crudo. Puro, para que los cortes del
// flujo los decida la prueba y no el sistema operativo. Lo maneja `procesoCatFile`.
// Decisiones: docs/decisiones/git/main-lecturas-y-cache.md
// =============================================================================

/**
 * Un objeto de git leído en CRUDO. `bytes` es null en los dos casos en que no hay
 * nada que entregar: el objeto no existe en esa revisión, o se pasó del tope y se
 * cortó a propósito.
 */
export interface BlobBruto {
  exists: boolean
  bytes: Buffer | null
  size: number
  truncated: boolean
}

/** Qué hacer después de darle un trozo al parser. */
export type EstadoParser =
  /** Faltan respuestas; sigue alimentándolo. */
  | { tipo: 'sigue' }
  /** Están todas las que se pidieron. */
  | { tipo: 'listo' }
  /** El objeto `indice` se pasó del tope: hay que matar el proceso y reanudar. */
  | { tipo: 'cortado'; indice: number }
  /** La salida no se entiende. El proceso ya no sirve. */
  | { tipo: 'error'; mensaje: string }

const NO_EXISTE: BlobBruto = { exists: false, bytes: null, size: 0, truncated: false }

/** Tope de la cabecera: si no aparece su salto de línea en 64 KiB, algo va mal. */
const MAX_CABECERA = 64 * 1024

export class ParserCatFile {
  /** Respuestas completas, en el orden en que las pidió el llamador. */
  readonly resultados: BlobBruto[] = []
  private chunks: Buffer[] = []
  private total = 0
  /** Bytes que faltan del objeto en curso; -1 = tocaría leer una cabecera. */
  private restante = -1
  private terminado = false
  private readonly esperadas: number
  private readonly maxBytes: number

  /**
   * @param esperadas cuántas respuestas se pidieron.
   * @param maxBytes tope por objeto; por encima se marca truncado y se corta.
   *
   * Los campos se asignan a mano y NO con parámetros-propiedad (`constructor(private
   * x)`): el type-stripping de node —con el que corre el test co-ubicado— no los
   * soporta, porque no son sólo tipos que borrar sino código que generar.
   */
  constructor(esperadas: number, maxBytes: number) {
    this.esperadas = esperadas
    this.maxBytes = maxBytes
  }

  /** Alimenta un trozo del stream y dice qué hacer. */
  trozo(buf: Buffer): EstadoParser {
    if (this.terminado) return { tipo: 'listo' }
    this.chunks.push(buf)
    this.total += buf.length
    return this.procesar()
  }

  /**
   * El stream terminó. Si faltan respuestas es un error: NO se devuelve un archivo a
   * medias como si estuviera completo —enseñaría un diff falso sin avisar—.
   */
  fin(): EstadoParser {
    if (this.terminado || this.resultados.length === this.esperadas) return { tipo: 'listo' }
    return {
      tipo: 'error',
      mensaje: `git cat-file: el flujo terminó con ${this.resultados.length} de ${this.esperadas} respuestas`
    }
  }

  /** Une lo acumulado sin copiar cuando ya es un solo trozo. */
  private unir(): Buffer {
    return this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.total)
  }

  private dejar(resto: Buffer): void {
    this.chunks = resto.length > 0 ? [resto] : []
    this.total = resto.length
  }

  /** Avanza mientras haya datos: cada paso devuelve el estado que corta el bucle, o `null` para seguir. */
  private procesar(): EstadoParser {
    for (;;) {
      const estado = this.restante < 0 ? this.pasoCabecera() : this.pasoContenido()
      if (estado !== null) return estado
    }
  }

  /** Fase de cabecera: lee una línea («<sha> <tipo> <tamaño>» o «<rev> missing») del acumulado. */
  private pasoCabecera(): EstadoParser | null {
    if (this.total === 0) return { tipo: 'sigue' }
    let joined = this.unir()
    // Trampa 1: los saltos sueltos que separan dos objetos pueden abrir el trozo.
    let salto = 0
    while (salto < joined.length && joined[salto] === 0x0a) salto++
    if (salto > 0) {
      joined = joined.subarray(salto)
      this.dejar(joined)
      if (joined.length === 0) return { tipo: 'sigue' }
    }
    const nl = joined.indexOf(0x0a)
    if (nl === -1) {
      if (this.total > MAX_CABECERA) {
        return { tipo: 'error', mensaje: 'git cat-file: cabecera sin fin' }
      }
      this.dejar(joined)
      return { tipo: 'sigue' }
    }
    const cabecera = joined.subarray(0, nl).toString('utf8').trim()
    this.dejar(joined.subarray(nl + 1))
    return this.aplicarCabecera(cabecera)
  }

  /** Interpreta una cabecera ya leída: objeto inexistente, tamaño fuera de tope o contenido por leer. */
  private aplicarCabecera(cabecera: string): EstadoParser | null {
    // Objeto inexistente: git emite "<rev> missing" (esperado en altas/borrados).
    if (cabecera.endsWith(' missing')) {
      this.resultados.push(NO_EXISTE)
      return this.resultados.length === this.esperadas ? this.acabar() : null
    }
    const sp = cabecera.lastIndexOf(' ')
    const size = parseInt(cabecera.slice(sp + 1), 10)
    if (!Number.isFinite(size) || size < 0) {
      return { tipo: 'error', mensaje: `git cat-file: cabecera no reconocida "${cabecera}"` }
    }
    if (size > this.maxBytes) {
      this.resultados.push({ exists: true, bytes: null, size, truncated: true })
      this.terminado = true
      return { tipo: 'cortado', indice: this.resultados.length - 1 }
    }
    this.restante = size
    return null
  }

  /** Fase de contenido: no se toca el buffer hasta tenerlo entero (trampa 2). */
  private pasoContenido(): EstadoParser | null {
    if (this.total < this.restante) return { tipo: 'sigue' }
    const joined = this.unir()
    const bytes = joined.subarray(0, this.restante)
    this.dejar(joined.subarray(this.restante))
    this.resultados.push({ exists: true, bytes, size: this.restante, truncated: false })
    this.restante = -1
    return this.resultados.length === this.esperadas ? this.acabar() : null
  }

  private acabar(): EstadoParser {
    this.terminado = true
    return { tipo: 'listo' }
  }
}
