// =============================================================================
// Un transcript JSONL entero, línea a línea y ya parseado, sin cargarlo: se lee por trozos (un rollout
// comprimido, descomprimido al vuelo) contra un presupuesto de bytes y un reloj compartidos por toda la
// búsqueda. Una línea gigante (una imagen pegada, en base64) se compacta al vuelo como en la cabeza y, si ni
// así cabe, se salta. Lo usa `buscarHistorial.ts`; lo prueba `test-buscar-historial.mts`.
// Decisiones: docs/decisiones/agentes/buscar-en-el-historial.md, docs/decisiones/agentes/conversaciones-cabeza-por-lineas.md
// =============================================================================
import { StringDecoder } from 'node:string_decoder'
import { compactarBase64, corteSinEscapeAMedias, trozosDe } from '../transcripts/cabezaJsonl.ts'
import type { LineaJsonl } from '../util/jsonlCola.ts'

/** Lo que queda de la búsqueda entera: lo comparten todos los archivos que lee. */
export interface Presupuesto {
  /** Bytes del JSONL (tras descomprimir) que aún se pueden leer. */
  bytes: number
  /** Hora (ms) a partir de la cual se deja de leer. */
  limite: number
  ahora: () => number
}

/** Cómo acabó la lectura de un archivo. */
export type FinLectura = 'fin' | 'bytes' | 'tiempo'

const TROZO = 64 * 1024
/** Una línea más larga que esto se va compactando; por debajo, ninguna se toca. */
const UMBRAL_COMPACTAR = 256 * 1024
/** Ni compactada: no es una imagen sino texto (o una salida de herramienta) enorme. Se salta. */
const MAX_LINEA = 4 * 1024 * 1024

interface LineaEnCurso {
  texto: string
  cola: string
  compactando: boolean
  descartando: boolean
}

const vacia = (): LineaEnCurso => ({ texto: '', cola: '', compactando: false, descartando: false })

function anadir(l: LineaEnCurso, parte: string): void {
  if (l.descartando) return
  let pendiente = parte
  if (!l.compactando) {
    if (l.texto.length + parte.length <= UMBRAL_COMPACTAR) {
      l.texto += parte
      return
    }
    // Se compacta desde el principio de la línea, que nunca está a mitad de un escape.
    pendiente = l.texto + parte
    Object.assign(l, { texto: '', compactando: true })
  }
  const junto = l.cola + pendiente
  const corte = corteSinEscapeAMedias(junto)
  l.texto += compactarBase64(junto.slice(0, corte))
  l.cola = junto.slice(corte)
  if (l.texto.length + l.cola.length > MAX_LINEA) Object.assign(l, { texto: '', cola: '', descartando: true })
}

/** La línea terminada, parseada; null si se saltó, está en blanco o no es JSON (a medio escribir). */
function cerrar(l: LineaEnCurso): LineaJsonl | null {
  const texto = l.texto + l.cola
  const saltada = l.descartando
  Object.assign(l, vacia())
  if (saltada || !texto.trim()) return null
  try {
    const v: unknown = JSON.parse(texto)
    return v !== null && typeof v === 'object' ? (v as LineaJsonl) : null
  } catch {
    return null
  }
}

/**
 * Lee `archivo` de principio a fin y da cada línea a `alLinea`. Gasta del
 * presupuesto lo que lee; si se acaba (o la hora), la línea a medias se tira y lo dice. Un fallo de lectura
 * o de descompresión rechaza la promesa.
 */
export async function recorrerLineas(archivo: string, p: Presupuesto, alLinea: (l: LineaJsonl) => void): Promise<FinLectura> {
  if (p.bytes <= 0) return 'bytes'
  if (p.ahora() >= p.limite) return 'tiempo'
  const decodificador = new StringDecoder('utf8')
  const linea = vacia()
  // Un byte más que el presupuesto: si llega, el archivo seguía y la lectura se corta, no termina.
  for await (const buf of trozosDe(archivo, TROZO, p.bytes + 1)) {
    const seguia = buf.length > p.bytes
    const util = seguia ? buf.subarray(0, p.bytes) : buf
    p.bytes -= util.length
    const partes = decodificador.write(util).split('\n')
    for (let i = 0; i < partes.length; i++) {
      anadir(linea, partes[i])
      if (i === partes.length - 1) continue
      const l = cerrar(linea)
      if (l) alLinea(l)
    }
    if (seguia) return 'bytes'
    if (p.ahora() >= p.limite) return 'tiempo'
  }
  anadir(linea, decodificador.end())
  const ultima = cerrar(linea)
  if (ultima) alLinea(ultima)
  return 'fin'
}
