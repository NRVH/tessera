// =============================================================================
// arbolDocumentos: lo que el árbol de bases de datos decide para una conexión de documentos
// (qué cuelga de la conexión, cómo se ordenan sus colecciones, qué dice cada fila). Puro:
// sin React, DOM ni IPC; lo fija `test-arbol-bd.mts`. Es una hoja: lo importan las piezas de
// `arbolBd.ts` (`arbolBdReglas.ts`, `arbolBdNodosFamilias.ts`) y él solo importa de `shared/`.
// Un VALOR de `arbolBd*` aquí cerraría un ciclo que compila y revienta al cargar.
// =============================================================================

import type { DbDocBase, DbDocColeccion } from '../../../../shared/db-documentos-ipc.ts'
import type { DescriptorDocumentos } from '../../../../shared/motores/index.ts'
import { tieneNivelBases } from '../../../../shared/motores/index.ts'
import { nunca } from '../../../../shared/nunca.ts'

/**
 * Lo que cuelga de una conexión de documentos: el nivel «Bases», o las colecciones de la
 * base que fija la conexión (recortada, como la guarda el main).
 */
export type RaizDocumentos = { nivel: 'bases' } | { nivel: 'colecciones'; base: string }

export function raizDocumentos(d: DescriptorDocumentos, c: { database?: string | null }): RaizDocumentos {
  if (tieneNivelBases(d, c)) return { nivel: 'bases' }
  // Sin nivel «Bases» la conexión fija una base (`tieneNivelBases` lo es justamente por eso).
  return { nivel: 'colecciones', base: (c.database ?? '').trim() }
}

/** Los textos del árbol de documentos que no dependen de los datos. */
export const TEXTOS_DOCUMENTOS = {
  sinBases: 'Ninguna base visible',
  sinColecciones: 'Sin colecciones'
} as const

/**
 * Las bases en el orden del servidor (`listDatabases` ya las da por nombre), sin repetir. Se
 * copia: el aplanador no muta lo que le llega de la caché.
 */
export function ordenarBasesDocumentos(lista: readonly DbDocBase[]): DbDocBase[] {
  const vistas = new Set<string>()
  const out: DbDocBase[] = []
  for (const b of lista) {
    if (vistas.has(b.nombre)) continue
    vistas.add(b.nombre)
    out.push(b)
  }
  return out
}

/**
 * Las colecciones por NOMBRE (orden de diccionario, con los números en su orden natural),
 * mezclando colecciones, vistas y series temporales: se buscan por nombre, y el tipo lo dice
 * la fila. `listCollections` no promete ningún orden.
 */
export function ordenarColecciones(lista: readonly DbDocColeccion[]): DbDocColeccion[] {
  return [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }))
}

/**
 * El dato que acompaña a una colección en su fila: el tipo si no es una colección normal, o
 * los documentos estimados («~1.234»; `estimatedDocumentCount` es de metadatos, de ahí la
 * tilde). null si no hay nada que decir.
 */
export function metaColeccion(c: DbDocColeccion): string | null {
  switch (c.tipo) {
    case 'vista':
      return 'vista'
    case 'serieTemporal':
      return 'serie temporal'
    case 'coleccion':
      return c.documentosEstimados === undefined ? null : `~${c.documentosEstimados.toLocaleString('es-ES')}`
    default:
      return nunca(c.tipo, 'metaColeccion')
  }
}
