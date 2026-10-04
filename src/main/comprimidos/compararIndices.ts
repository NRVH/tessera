// =============================================================================
// Dos directorios centrales de ZIP, restados. PURO: no toca disco, no infla nada, no sabe de git
// ni de IPC. El oráculo es el CRC32 más el tamaño que cada entrada ya trae en el índice: un jar
// recompilado sin cambios da la lista vacía. Los registros de directorio no se comparan y los
// nombres duplicados se desempatan en la misma dirección que `leerIndice`.
// Decisiones: docs/decisiones/comprimidos/diff-de-contenedores.md
// =============================================================================

import type { IndiceZip } from '../java/zipRandom.ts'
import type { EntradaComparada } from '../../shared/comprimidos-ipc.ts'
import { esComprimido } from '../../shared/comprimidos.ts'

/**
 * Tope de entradas CAMBIADAS que se devuelven. Del orden del tope de entradas del
 * índice (200.000) dividido por diez: una lista de más de veinte mil filas ya no
 * se lee, se filtra. Pasarse marca `truncado` y el pane lo dice — un recorte
 * silencioso se leería como "no cambió nada más".
 */
export const MAX_ENTRADAS_CAMBIADAS = 20_000

export interface ResultadoComparacion {
  entradas: EntradaComparada[]
  /** Entradas presentes en los dos lados con el mismo CRC y tamaño. */
  iguales: number
  truncado: boolean
}

/** Índice por nombre, saltándose los registros de directorio. Gana la PRIMERA
 *  aparición, igual que en `leerIndice` (ver cabecera). */
function porNombre(indice: IndiceZip | null): Map<string, { tamano: number; crc32: number }> {
  const mapa = new Map<string, { tamano: number; crc32: number }>()
  if (indice === null) return mapa
  for (const e of indice.entradas) {
    if (e.esDir) continue
    if (mapa.has(e.nombre)) continue
    mapa.set(e.nombre, { tamano: e.tamano, crc32: e.crc32 })
  }
  return mapa
}

/**
 * Resta los dos índices y devuelve SÓLO lo que cambió.
 *
 * Un lado a `null` es un contenedor que no existe en esa revisión (el alta o el
 * borrado del propio .jar): entonces todo es alta o todo es borrado, que es
 * exactamente lo que hay que enseñar y no un error.
 */
export function compararIndices(
  antes: IndiceZip | null,
  despues: IndiceZip | null
): ResultadoComparacion {
  const mapaAntes = porNombre(antes)
  const mapaDespues = porNombre(despues)

  const nombres = new Set<string>([...mapaAntes.keys(), ...mapaDespues.keys()])
  const cambiadas: EntradaComparada[] = []
  let iguales = 0

  for (const nombre of nombres) {
    const a = mapaAntes.get(nombre)
    const d = mapaDespues.get(nombre)

    if (a !== undefined && d !== undefined) {
      if (a.crc32 === d.crc32 && a.tamano === d.tamano) {
        iguales++
        continue
      }
      cambiadas.push({
        nombre,
        estado: 'M',
        tamanoAntes: a.tamano,
        tamanoDespues: d.tamano,
        contenedor: esComprimido(nombre)
      })
      continue
    }

    if (d !== undefined) {
      cambiadas.push({
        nombre,
        estado: 'A',
        tamanoAntes: 0,
        tamanoDespues: d.tamano,
        contenedor: esComprimido(nombre)
      })
      continue
    }

    cambiadas.push({
      nombre,
      estado: 'D',
      tamanoAntes: (a as { tamano: number }).tamano,
      tamanoDespues: 0,
      contenedor: esComprimido(nombre)
    })
  }

  // Orden estable por nombre. El árbol vuelve a ordenar para pintar (carpetas
  // primero), pero una respuesta de IPC que cambia de orden entre llamadas
  // idénticas es imposible de comparar en un test y confunde en un log.
  cambiadas.sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'))

  const truncado = cambiadas.length > MAX_ENTRADAS_CAMBIADAS
  return {
    entradas: truncado ? cambiadas.slice(0, MAX_ENTRADAS_CAMBIADAS) : cambiadas,
    iguales,
    truncado
  }
}
