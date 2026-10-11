// =============================================================================
// La base en la que nace una consola nueva abierta desde un nodo (una base, una colección, una
// clave) y la memoria de la base elegida en las consolas de documentos y de claves. Lógica pura:
// la usan los estados de esas consolas y `useBdApp` al crear una.
// =============================================================================

import { nunca } from '../../../../../shared/nunca.ts'

/**
 * Dónde nace la consola. SQL: su esquema (en SQL Server, la base), que guarda el main.
 * Documentos y claves: su base, que vive aquí, en la consola.
 */
export type BaseConsolaNueva =
  | { familia: 'sql'; esquema: string }
  | { familia: 'documentos'; base: string }
  | { familia: 'claves'; indice: number }

/** «Abrir consola» desde un pane: con un texto inicial y la base en la que nace. */
export type AbrirConsolaEn = (conexionId: string, textoInicial?: string, base?: BaseConsolaNueva) => void

/** La base de cada consola de documentos, en memoria (sobrevive a un remontaje, no a reiniciar). Clave: `claveBaseConsola`. */
export const basesConsolaDocs = new Map<string, string | null>()

/** La base de cada consola de claves, en memoria. Clave: `claveBaseConsola`. */
export const basesConsolaClaves = new Map<string, number>()

export function claveBaseConsola(perfilId: string, consolaId: string): string {
  return `${perfilId}\u0000${consolaId}`
}

/** El esquema que se pide al main al crear la consola: solo el de SQL. */
export function esquemaAlCrear(b: BaseConsolaNueva | undefined): string | undefined {
  if (!b) return undefined
  switch (b.familia) {
    case 'sql':
      return b.esquema
    case 'documentos':
    case 'claves':
      return undefined
    default:
      return nunca(b)
  }
}

/** Antes de montar la consola recién creada: la de documentos o claves nace en `b`. */
export function sembrarBaseConsola(perfilId: string, consolaId: string, b: BaseConsolaNueva | undefined): void {
  if (!b) return
  const k = claveBaseConsola(perfilId, consolaId)
  switch (b.familia) {
    case 'sql':
      return
    case 'documentos':
      basesConsolaDocs.set(k, b.base)
      return
    case 'claves':
      basesConsolaClaves.set(k, b.indice)
      return
    default:
      nunca(b)
  }
}
