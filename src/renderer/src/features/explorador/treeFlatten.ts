// =============================================================================
// treeFlatten: aplana el árbol de archivos visible a una lista lineal de filas con su
// profundidad, para virtualizarlo. Las carpetas con cadena cargada salen compactadas
// («com/ejemplo/app» en una fila) y la expansión se indexa por la ruta de la hoja.
// Sin React ni DOM; los imports de valor llevan extensión porque lo carga
// `test-tree-flatten.mts` con `node`.
// =============================================================================

import { esRutaVirtual } from '../../../../shared/jarPath.ts'
import type { FileEntry } from '../../../../shared/files-ipc.ts'

/**
 * Cadena de carpetas compactada: `segments` son las carpetas fusionadas en una fila
 * ("com/ejemplo/app") y `children` el contenido de la ÚLTIMA (la hoja). Un archivo o
 * carpeta sin compactar tiene un solo segmento.
 */
export interface ChainInfo {
  segments: FileEntry[]
  children: FileEntry[]
}

/** Una fila del árbol aplanado: un nodo (archivo/carpeta) o un placeholder de estado. */
export type FlatRow =
  | {
      kind: 'node'
      /** Clave estable y única de la fila (ruta de la hoja para carpetas; del archivo si no). */
      key: string
      /** Primer segmento de la cadena (la identidad arrastrable / el `entry` original). */
      entry: FileEntry
      /** Cadena compactada (o [entry] si archivo / aún sin cargar). */
      segments: FileEntry[]
      /** Última carpeta de la cadena: sobre ella operan abrir/crear/menú/drop. */
      leaf: FileEntry
      depth: number
      /**
       * ¿Es una carpeta REAL del disco? Sigue significando exactamente eso, ni más
       * ni menos: de él dependen el icono de carpeta, "Nueva carpeta", ser destino
       * de un drop y NO tener letra de git. Un .jar es expandible pero NO es `isDir`.
       */
      isDir: boolean
      /** Archivo contenedor (.jar/.war/…): se expande, pero sigue siendo un archivo. */
      esContenedor: boolean
      /** La fila vive DENTRO de un contenedor: no existe en el disco. */
      esVirtual: boolean
      isExpanded: boolean
    }
  | {
      kind: 'placeholder'
      key: string
      variant: 'loading' | 'empty' | 'error'
      message?: string
      depth: number
    }

export interface FlattenInput {
  roots: FileEntry[]
  /** Cadenas compactadas ya cargadas, por ruta del primer segmento. */
  chains: Map<string, ChainInfo>
  /** Carpetas expandidas, por ruta de la HOJA. */
  expanded: Set<string>
  /** Errores de listado, por ruta del primer segmento. */
  errors: Map<string, string>
}

/** Aplana el árbol visible a filas en orden de pintado. Pura y determinista. */
export function flattenTree({ roots, chains, expanded, errors }: FlattenInput): FlatRow[] {
  const out: FlatRow[] = []
  walk(roots, 0)
  return out

  function walk(entries: FileEntry[], depth: number): void {
    for (const entry of entries) {
      const esContenedor = entry.contenedor != null
      const esVirtual = esRutaVirtual(entry.path)
      // Un archivo NORMAL es una hoja. Un CONTENEDOR es un archivo que además se
      // expande: por eso la condición no es `kind !== 'dir'` a secas. Sin esto el
      // .jar nunca sale con chevron, aunque el main sepa listar su contenido.
      if (entry.kind !== 'dir' && !esContenedor) {
        out.push({
          kind: 'node',
          key: entry.path,
          entry,
          segments: [entry],
          leaf: entry,
          depth,
          isDir: false,
          esContenedor: false,
          esVirtual,
          isExpanded: false
        })
        continue
      }
      const chain = chains.get(entry.path)
      // Un contenedor NUNCA se fusiona con su primer paquete: es su propia fila,
      // Los paquetes de dentro sí se compactan entre ellos.
      const segments = esContenedor ? [entry] : (chain?.segments ?? [entry])
      const leaf = segments[segments.length - 1]
      const isExpanded = expanded.has(leaf.path)
      out.push({
        kind: 'node',
        key: leaf.path,
        entry,
        segments,
        leaf,
        depth,
        isDir: entry.kind === 'dir',
        esContenedor,
        esVirtual,
        isExpanded
      })
      if (!isExpanded) continue

      const err = errors.get(entry.path)
      if (err) {
        out.push({ kind: 'placeholder', key: `${entry.path}::error`, variant: 'error', message: err, depth: depth + 1 })
      } else if (!chain) {
        out.push({ kind: 'placeholder', key: `${entry.path}::loading`, variant: 'loading', depth: depth + 1 })
      } else if (chain.children.length === 0) {
        out.push({ kind: 'placeholder', key: `${entry.path}::empty`, variant: 'empty', depth: depth + 1 })
      } else {
        walk(chain.children, depth + 1)
      }
    }
  }
}

/**
 * ¿La fila necesita su cadena cargada? Una carpeta siempre (su etiqueta compactada la
 * necesita antes de pintarse); un contenedor solo expandido, para no leer decenas de .jar
 * cerrados. Es el MISMO criterio para la carga perezosa y para el refresco.
 */
export function necesitaCadena(row: FlatRow): row is Extract<FlatRow, { kind: 'node' }> {
  return row.kind === 'node' && (row.isDir || (row.esContenedor && row.isExpanded))
}

/**
 * Entradas cuya cadena re-lista un refresco, por ruta del primer segmento. Se devuelve la
 * entrada de la fila y no una carpeta sintética: un contenedor re-listado como carpeta se
 * compactaría con su primer paquete y perdería sus hijos.
 */
export function entradasConCadena(rows: readonly FlatRow[]): Map<string, FileEntry> {
  const out = new Map<string, FileEntry>()
  for (const r of rows) if (necesitaCadena(r)) out.set(r.entry.path, r.entry)
  return out
}

/**
 * Quita del caché las cadenas que el refresco no va a re-listar (ramas colapsadas). Las que
 * se re-listan se quedan mientras llega la nueva: si cayeran, sus filas desaparecerían un
 * instante y la poda de la selección se llevaría lo que el usuario tenía seleccionado.
 */
export function podarCadenas(
  chains: ReadonlyMap<string, ChainInfo>,
  vivas: ReadonlyMap<string, unknown>
): Map<string, ChainInfo> {
  const next = new Map<string, ChainInfo>()
  for (const [k, v] of chains) if (vivas.has(k)) next.set(k, v)
  return next
}
