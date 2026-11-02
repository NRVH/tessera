// =============================================================================
// Forma de un artículo de Tessera Academy y de sus destinos («articulo/ancla»). Puro: sin
// React ni DOM, lo prueba `test-academy.mts`. El título de cada artículo vive en el índice
// (`indice.ts`), que es también lo que el buscador de Configuración recorre.
// Decisiones: docs/decisiones/configuracion/tessera-academy.md
// =============================================================================

import type { Plataforma } from '../../../../shared/plataforma'

/** Un bloque del cuerpo; el texto admite el marcado de `marcado.ts`. */
export type Bloque =
  | string
  | { readonly p: string; readonly soloEn?: readonly Plataforma[] }
  | { readonly lista: readonly string[]; readonly soloEn?: readonly Plataforma[] }
  | { readonly pasos: readonly string[]; readonly soloEn?: readonly Plataforma[] }
  | { readonly nota: string; readonly soloEn?: readonly Plataforma[] }
  | { readonly captura: string; readonly alt: string; readonly soloEn?: readonly Plataforma[] }

export interface Seccion {
  /** Lo que va tras la barra en un destino; único dentro del artículo. */
  readonly ancla: string
  readonly titulo: string
  readonly bloques: readonly Bloque[]
}

export interface Articulo {
  /** Una o dos frases bajo el título: qué resuelve el artículo. */
  readonly resumen: string
  readonly secciones: readonly Seccion[]
}

/** Un destino ya partido: el artículo y, si lo hay, la sección. */
export interface Destino {
  readonly articulo: string
  readonly ancla: string | null
}

/** «articulo» o «articulo/ancla». */
export function partirDestino(destino: string): Destino {
  const i = destino.indexOf('/')
  return i < 0
    ? { articulo: destino, ancla: null }
    : { articulo: destino.slice(0, i), ancla: destino.slice(i + 1) || null }
}

/** El tipo del bloque, para pintarlo y para comparar la forma de los dos idiomas. */
export function tipoDeBloque(b: Bloque): 'p' | 'lista' | 'pasos' | 'nota' | 'captura' {
  if (typeof b === 'string' || 'p' in b) return 'p'
  if ('lista' in b) return 'lista'
  if ('pasos' in b) return 'pasos'
  if ('nota' in b) return 'nota'
  return 'captura'
}

/** Las plataformas donde se enseña el bloque; `null` = en todas. */
export function plataformasDe(b: Bloque): readonly Plataforma[] | null {
  return typeof b === 'string' ? null : (b.soloEn ?? null)
}

/** ¿Se enseña el bloque en esta plataforma? */
export function seVeEn(b: Bloque, plataforma: Plataforma): boolean {
  const solo = plataformasDe(b)
  return solo === null || solo.includes(plataforma)
}

/** Todos los textos con marcado de un bloque, en orden. */
export function textosDe(b: Bloque): readonly string[] {
  if (typeof b === 'string') return [b]
  if ('p' in b) return [b.p]
  if ('lista' in b) return b.lista
  if ('pasos' in b) return b.pasos
  if ('nota' in b) return [b.nota]
  return [b.alt]
}
