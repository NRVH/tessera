// =============================================================================
// aplanarArbol: aplana el árbol de archivos visible a una lista lineal de filas con su
// profundidad, para virtualizarlo. Las carpetas con cadena cargada salen compactadas
// («com/ejemplo/app» en una fila) y la expansión se indexa por la ruta de la hoja.
// Sin React ni DOM; los imports de valor llevan extensión porque lo carga
// `test-aplanar-arbol.mts` con `node`.
// =============================================================================

import { esRutaVirtual } from '../../../../shared/jarPath.ts'
import type { EntradaArchivo } from '../../../../shared/archivos-ipc.ts'

/**
 * Cadena de carpetas compactada: `segmentos` son las carpetas fusionadas en una fila
 * ("com/ejemplo/app") y `hijos` el contenido de la ÚLTIMA (la hoja). Un archivo o
 * carpeta sin compactar tiene un solo segmento.
 */
export interface InfoCadena {
  segmentos: EntradaArchivo[]
  hijos: EntradaArchivo[]
}

/** Una fila del árbol aplanado: un nodo (archivo/carpeta) o un placeholder de estado. */
export type FilaAplanada =
  | {
      tipo: 'node'
      /** Clave estable y única de la fila (ruta de la hoja para carpetas; del archivo si no). */
      clave: string
      /** Primer segmento de la cadena (la identidad arrastrable / la `entrada` original). */
      entrada: EntradaArchivo
      /** Cadena compactada (o [entrada] si archivo / aún sin cargar). */
      segmentos: EntradaArchivo[]
      /** Última carpeta de la cadena: sobre ella operan abrir/crear/menú/drop. */
      hoja: EntradaArchivo
      profundidad: number
      /**
       * ¿Es una carpeta REAL del disco? Sigue significando exactamente eso, ni más
       * ni menos: de él dependen el icono de carpeta, "Nueva carpeta", ser destino
       * de un drop y NO tener letra de git. Un .jar es expandible pero NO es `esDir`.
       */
      esDir: boolean
      /** Archivo contenedor (.jar/.war/…): se expande, pero sigue siendo un archivo. */
      esContenedor: boolean
      /** La fila vive DENTRO de un contenedor: no existe en el disco. */
      esVirtual: boolean
      estaExpandida: boolean
    }
  | {
      tipo: 'placeholder'
      clave: string
      variante: 'loading' | 'empty' | 'error'
      mensaje?: string
      profundidad: number
    }

export interface DatosAplanarArbol {
  raices: EntradaArchivo[]
  /** Cadenas compactadas ya cargadas, por ruta del primer segmento. */
  cadenas: Map<string, InfoCadena>
  /** Carpetas expandidas, por ruta de la HOJA. */
  expandidas: Set<string>
  /** Errores de listado, por ruta del primer segmento. */
  errores: Map<string, string>
}

/** Aplana el árbol visible a filas en orden de pintado. Pura y determinista. */
export function aplanarArbol({ raices, cadenas, expandidas, errores }: DatosAplanarArbol): FilaAplanada[] {
  const salida: FilaAplanada[] = []
  recorrer(raices, 0)
  return salida

  function recorrer(entradas: EntradaArchivo[], profundidad: number): void {
    for (const entrada of entradas) {
      const esContenedor = entrada.contenedor != null
      const esVirtual = esRutaVirtual(entrada.ruta)
      // Un archivo NORMAL es una hoja. Un CONTENEDOR es un archivo que además se
      // expande: por eso la condición no es `tipo !== 'dir'` a secas. Sin esto el
      // .jar nunca sale con chevron, aunque el main sepa listar su contenido.
      if (entrada.tipo !== 'dir' && !esContenedor) {
        salida.push({
          tipo: 'node',
          clave: entrada.ruta,
          entrada,
          segmentos: [entrada],
          hoja: entrada,
          profundidad,
          esDir: false,
          esContenedor: false,
          esVirtual,
          estaExpandida: false
        })
        continue
      }
      const cadena = cadenas.get(entrada.ruta)
      // Un contenedor NUNCA se fusiona con su primer paquete: es su propia fila,
      // Los paquetes de dentro sí se compactan entre ellos.
      const segmentos = esContenedor ? [entrada] : (cadena?.segmentos ?? [entrada])
      const hoja = segmentos[segmentos.length - 1]
      const estaExpandida = expandidas.has(hoja.ruta)
      salida.push({
        tipo: 'node',
        clave: hoja.ruta,
        entrada,
        segmentos,
        hoja,
        profundidad,
        esDir: entrada.tipo === 'dir',
        esContenedor,
        esVirtual,
        estaExpandida
      })
      if (!estaExpandida) continue

      const err = errores.get(entrada.ruta)
      if (err) {
        salida.push({ tipo: 'placeholder', clave: `${entrada.ruta}::error`, variante: 'error', mensaje: err, profundidad: profundidad + 1 })
      } else if (!cadena) {
        salida.push({ tipo: 'placeholder', clave: `${entrada.ruta}::loading`, variante: 'loading', profundidad: profundidad + 1 })
      } else if (cadena.hijos.length === 0) {
        salida.push({ tipo: 'placeholder', clave: `${entrada.ruta}::empty`, variante: 'empty', profundidad: profundidad + 1 })
      } else {
        recorrer(cadena.hijos, profundidad + 1)
      }
    }
  }
}

/**
 * ¿La fila necesita su cadena cargada? Una carpeta siempre (su etiqueta compactada la
 * necesita antes de pintarse); un contenedor solo expandido, para no leer decenas de .jar
 * cerrados. Es el MISMO criterio para la carga perezosa y para el refresco.
 */
export function necesitaCadena(fila: FilaAplanada): fila is Extract<FilaAplanada, { tipo: 'node' }> {
  return fila.tipo === 'node' && (fila.esDir || (fila.esContenedor && fila.estaExpandida))
}

/**
 * Entradas cuya cadena re-lista un refresco, por ruta del primer segmento. Se devuelve la
 * entrada de la fila y no una carpeta sintética: un contenedor re-listado como carpeta se
 * compactaría con su primer paquete y perdería sus hijos.
 */
export function entradasConCadena(filas: readonly FilaAplanada[]): Map<string, EntradaArchivo> {
  const salida = new Map<string, EntradaArchivo>()
  for (const r of filas) if (necesitaCadena(r)) salida.set(r.entrada.ruta, r.entrada)
  return salida
}

/**
 * Quita del caché las cadenas que el refresco no va a re-listar (ramas colapsadas). Las que
 * se re-listan se quedan mientras llega la nueva: si cayeran, sus filas desaparecerían un
 * instante y la poda de la selección se llevaría lo que el usuario tenía seleccionado.
 */
export function podarCadenas(
  cadenas: ReadonlyMap<string, InfoCadena>,
  vivas: ReadonlyMap<string, unknown>
): Map<string, InfoCadena> {
  const siguiente = new Map<string, InfoCadena>()
  for (const [k, v] of cadenas) if (vivas.has(k)) siguiente.set(k, v)
  return siguiente
}
