// =============================================================================
// Dónde dejar en este equipo las conversaciones de Claude Code de un proyecto que llega en la copia: Claude
// Code las guarda bajo la carpeta de la ruta del proyecto, y aquí el proyecto puede estar en otra. Se empareja
// por el nombre de su carpeta con los proyectos abiertos (uno solo aquí y en el origen, o no se cambia) y se
// reescribe el primer tramo de la ruta. La ruta de origen es el `cwd` del transcript, no el nombre de la carpeta, que pierde letras.
// Decisiones: docs/decisiones/configuracion/historial-en-la-copia.md
// =============================================================================

import { basenameSuelto, esRutaDeContenedor, normalizarRuta } from '../conversaciones/slugProyecto.ts'
import { carpetaClaudeConocida, carpetaProyectoClaude } from '../traspaso/rutasTraspaso.ts'

/** Qué hacer con las conversaciones de una carpeta de proyecto que llega. */
export type DestinoProyecto =
  /** Se quedan donde estaban: misma ruta, ruta del contenedor (igual en cualquier equipo) o sin ruta conocida. */
  | { tipo: 'igual' }
  | { tipo: 'cambiada'; carpeta: string }
  /** Se quedan con la ruta de origen, y se dice por qué. */
  | { tipo: 'sinProyecto' | 'varios' | 'variosOrigen' | 'larga'; nombre: string }

/**
 * El destino de las conversaciones de `cwd` frente a las rutas de los proyectos abiertos aquí. `origenes`
 * son todas las rutas de proyecto que trae la copia: si dos distintas se llaman igual, ninguna se reasigna,
 * o las dos acabarían mezcladas en el mismo proyecto de aquí.
 */
export function destinoProyecto(cwd: string | null, proyectos: readonly string[], origenes: readonly string[] = []): DestinoProyecto {
  if (!cwd || esRutaDeContenedor(cwd)) return { tipo: 'igual' }
  const propia = normalizarRuta(cwd)
  if (proyectos.some((p) => normalizarRuta(p) === propia)) return { tipo: 'igual' }
  const nombre = basenameSuelto(cwd)
  const deOrigen = new Set([propia])
  // Las del contenedor no se reasignan nunca: no compiten por el proyecto de aquí.
  for (const o of origenes) if (!esRutaDeContenedor(o) && basenameSuelto(o).toLowerCase() === nombre.toLowerCase()) deOrigen.add(normalizarRuta(o))
  if (deOrigen.size > 1) return { tipo: 'variosOrigen', nombre }
  const mismos = new Map<string, string>()
  for (const p of proyectos) if (basenameSuelto(p).toLowerCase() === nombre.toLowerCase()) mismos.set(normalizarRuta(p), p)
  if (mismos.size === 0) return { tipo: 'sinProyecto', nombre }
  if (mismos.size > 1) return { tipo: 'varios', nombre }
  const ruta = [...mismos.values()][0]
  if (!carpetaClaudeConocida(ruta)) return { tipo: 'larga', nombre }
  return { tipo: 'cambiada', carpeta: carpetaProyectoClaude(ruta) }
}

/** La carpeta de proyecto de una ruta de Claude Code (`projects/<carpeta>/…`), o null si no es de ahí. */
export function carpetaDe(rel: string): string | null {
  const tramos = rel.split('/')
  return tramos[0] === 'projects' && tramos.length >= 3 ? tramos[1] : null
}

/** La ruta con su carpeta de proyecto cambiada por `carpeta`. */
export function conCarpeta(rel: string, carpeta: string): string {
  const tramos = rel.split('/')
  return ['projects', carpeta, ...tramos.slice(2)].join('/')
}
