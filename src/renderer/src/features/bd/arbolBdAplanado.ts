// =============================================================================
// arbolBdAplanado — aplana el árbol de BD a filas en orden de pintado: cada conexión monta
// su árbol según la familia de su motor, y se recorre abriendo lo expandido o, con búsqueda,
// solo lo que coincide y sus antepasados (forzados abiertos sin tocar `expandidos`).
// Puro y determinista; lo reexporta `arbolBd.ts`.
// Decisiones: docs/decisiones/bd/ui-arbol-modelo.md
// =============================================================================

import { descriptor } from '../../../../shared/motores/index.ts'
import { nunca } from '../../../../shared/nunca.ts'
import { SEP } from './arbolBdClaves.ts'
import { coincidenciaDe, normalizarBusqueda } from './arbolBdReglas.ts'
import { crearContexto, type ContextoArbol, type EstadoHijos, type Nodo } from './arbolBdNodo.ts'
import { nodoConexionSql } from './arbolBdNodosSql.ts'
import { nodoConexionClaves, nodoConexionDocumentos } from './arbolBdNodosFamilias.ts'
import type { DbConnection } from '../../../../shared/db-ipc.ts'
import type { Coincidencia, EntradaArbolBd, FilaBd, FilaPlaceholder } from './arbolBdTipos.ts'

/** Aplana el árbol visible a filas en orden de pintado. Pura y determinista. */
export function aplanarArbolBd(e: EntradaArbolBd): FilaBd[] {
  const ctx = crearContexto(e)
  const raices = e.conexiones.map((c) => nodoConexion(ctx, c))
  const filtro = normalizarBusqueda(e.filtro)
  const out: FilaBd[] = []
  if (filtro === '') {
    for (const n of raices) emitir(n, e.expandidos, out)
  } else {
    for (const n of raices) {
      const filas = filtrar(n, filtro)
      if (filas) for (const f of filas) out.push(f)
    }
  }
  return out
}

/** La conexión, por la familia de su motor. */
function nodoConexion(ctx: ContextoArbol, c: DbConnection): Nodo {
  const d = descriptor(c.motor)
  switch (d.familia) {
    case 'sql':
      return nodoConexionSql(ctx, c, d)
    case 'documentos':
      return nodoConexionDocumentos(ctx, c, d)
    case 'claves':
      return nodoConexionClaves(ctx, c, d)
    default:
      return nunca(d, 'nodoConexion')
  }
}

/** Recorrido normal: la fila, y si está expandida, sus hijos y el marcador de detrás. */
function emitir(n: Nodo, expandidos: ReadonlySet<string>, out: FilaBd[]): void {
  const expandida = n.contenedor && expandidos.has(n.base.key)
  out.push(n.contenedor ? ({ ...n.base, expandida } as FilaBd) : n.base)
  if (!expandida) return
  const h = n.hijos()
  for (const hijo of h.nodos) emitir(hijo, expandidos, out)
  const estado = h.estado ?? (h.nodos.length === 0 ? { variante: 'empty' as const, mensaje: 'Vacío' } : null)
  if (estado) out.push(placeholder(n.base, estado))
}

/** Búsqueda: la fila si coincide o si algún descendiente cargado coincide; null si ninguno. */
function filtrar(n: Nodo, f: string): FilaBd[] | null {
  const coincidencia = n.etiqueta === null ? null : coincidenciaDe(n.etiqueta, f)
  const hijas: FilaBd[] = []
  if (n.contenedor) {
    for (const hijo of n.hijos().nodos) {
      const r = filtrar(hijo, f)
      if (r) for (const x of r) hijas.push(x)
    }
  }
  if (coincidencia === null && hijas.length === 0) return null
  const marcas: { expandida?: boolean; forzada?: true; coincidencia?: Coincidencia } = {}
  if (n.contenedor) marcas.expandida = hijas.length > 0
  if (hijas.length > 0) marcas.forzada = true
  if (coincidencia !== null) marcas.coincidencia = coincidencia
  return [{ ...n.base, ...marcas } as FilaBd, ...hijas]
}

function placeholder(padre: FilaBd, estado: EstadoHijos): FilaPlaceholder {
  const base = { key: `${padre.key}${SEP}~${estado.variante}`, depth: padre.depth + 1, padre: padre.key }
  if (estado.variante === 'loading') {
    return { kind: 'placeholder', variante: 'loading', ...base, mensaje: 'Cargando…', carga: estado.carga }
  }
  if (estado.variante === 'empty') {
    return { kind: 'placeholder', variante: 'empty', ...base, mensaje: estado.mensaje }
  }
  const fila: FilaPlaceholder = {
    kind: 'placeholder',
    variante: 'error',
    ...base,
    mensaje: estado.error.mensaje,
    reintentar: estado.carga,
    motivo: estado.error.motivo
  }
  if (estado.error.requiereDriver) fila.requiereDriver = estado.error.requiereDriver
  return fila
}
