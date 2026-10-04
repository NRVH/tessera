// =============================================================================
// arbolBdTeclado — consultas sobre las filas ya aplanadas del árbol de BD: cargas que piden
// sus marcadores, padre de una fila, si se despliega, y qué hace cada tecla (→ despliega,
// ← pliega o sube al padre, Enter/F4 abre, alterna, reintenta o carga más).
// Puro; lo reexporta `arbolBd.ts`.
// Decisiones: docs/decisiones/bd/ui-arbol-modelo.md
// =============================================================================

import { paneDeFila } from './arbolBdPanes.ts'
import type { CargaBd, FilaBd } from './arbolBdTipos.ts'

/** Cargas que las filas piden ahora (una por marcador 'loading'). */
export function cargasPendientes(filas: readonly FilaBd[]): CargaBd[] {
  const out: CargaBd[] = []
  for (const f of filas) if (f.kind === 'placeholder' && f.variante === 'loading' && f.carga) out.push(f.carga)
  return out
}

/** Índice de la fila padre de `filas[i]` (la anterior con menos profundidad), o -1. */
export function indicePadre(filas: readonly FilaBd[], i: number): number {
  if (i <= 0 || i >= filas.length) return -1
  const d = filas[i].depth
  for (let k = i - 1; k >= 0; k--) if (filas[k].depth < d) return k
  return -1
}

/** ¿La fila se puede desplegar? */
export function esContenedor(fila: FilaBd): boolean {
  switch (fila.kind) {
    case 'conexion':
    case 'carpeta-consolas':
    case 'base':
    case 'esquema':
    case 'carpeta':
    case 'carpeta-detalle':
    case 'doc-base':
    case 'kv-base':
    case 'kv-carpeta':
      return true
    case 'objeto':
      return fila.expandible
    default:
      return false
  }
}

function estaExpandida(fila: FilaBd): boolean {
  return 'expandida' in fila && fila.expandida
}

/** `cargarMas`: Enter sobre «Cargar más claves» pide la vuelta siguiente del SCAN. */
export type AccionTeclaBd = 'expandir' | 'plegar' | 'aPadre' | 'abrir' | 'reintentar' | 'cargarMas' | 'nada'

/** ←: pliega un contenedor desplegado (no si lo abrió la búsqueda); si no, sube al padre (en la raíz, nada). */
function accionIzquierda(fila: FilaBd): AccionTeclaBd {
  const forzada = 'forzada' in fila && fila.forzada === true
  if (esContenedor(fila) && estaExpandida(fila) && !forzada) return 'plegar'
  return fila.depth > 0 ? 'aPadre' : 'nada'
}

/** Enter/F4: abre la pestaña si la fila abre algo; si no, carga más, reintenta un error o alterna. */
function accionAbrir(fila: FilaBd): AccionTeclaBd {
  if (paneDeFila(fila) !== null) return 'abrir'
  if (fila.kind === 'kv-mas') return fila.cargando ? 'nada' : 'cargarMas'
  if (fila.kind === 'placeholder') return fila.variante === 'error' && fila.reintentar ? 'reintentar' : 'nada'
  if (esContenedor(fila)) return estaExpandida(fila) ? 'plegar' : 'expandir'
  return 'nada'
}

/**
 * Qué hace una tecla sobre una fila: `dcha` (→) despliega un contenedor plegado y si no, nada;
 * `izq` (←) y `abrir` (Enter/F4, ⌘↓ en Mac), ver `accionIzquierda` y `accionAbrir`.
 */
export function accionTecla(fila: FilaBd, tecla: 'izq' | 'dcha' | 'abrir'): AccionTeclaBd {
  if (tecla === 'dcha') return esContenedor(fila) && !estaExpandida(fila) ? 'expandir' : 'nada'
  if (tecla === 'izq') return accionIzquierda(fila)
  return accionAbrir(fila)
}
