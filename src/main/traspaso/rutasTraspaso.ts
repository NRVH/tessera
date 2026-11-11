// =============================================================================
// Dónde deja Tessera la copia de un transcript para que el CLI de destino lo reanude, qué hacer si ya hay
// uno con ese id (también cuando el usuario elige con cuál seguir) y la frase del aviso de arranque cuando las
// rutas del proyecto cambian de un modo a otro.
// Puro: lo usa `ServicioTraspaso` y lo prueba `test-traspaso.mts`.
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import { normalizarNombre, normalizarRuta } from '../conversations/slugProyecto.ts'

/** Los agentes que pueden ser origen o destino de un traspaso. */
export type AgenteTraspaso = 'claude-code' | 'codex'

/** Dónde corre una sesión: en el equipo o en el contenedor de su cuenta. */
export type ModoTraspaso = 'nativo' | 'docker'

/**
 * La carpeta de `projects/` en la que Claude Code busca las conversaciones de un `cwd`: la ruta con todo
 * lo que no es `[A-Za-z0-9]` cambiado por `-` (también las letras con tilde).
 */
export function carpetaProyectoClaude(cwd: string): string {
  return normalizarNombre(cwd)
}

/**
 * Hasta dónde se sabe dónde pone Claude Code la carpeta: un nombre de archivo no pasa de 255 caracteres, así que
 * con rutas más largas la acorta de una forma que no es un contrato conocido. Por encima, no se copia.
 */
export const MAX_CARPETA_CLAUDE = 200

/** ¿Se puede calcular con certeza la carpeta de Claude Code de ese `cwd`? */
export function carpetaClaudeConocida(cwd: string): boolean {
  return carpetaProyectoClaude(cwd).length <= MAX_CARPETA_CLAUDE
}

/**
 * Los tramos, relativos a la carpeta de la cuenta de destino, donde va la copia del transcript principal.
 * Claude Code lo busca por la carpeta del `cwd` desde el que se lanza; Codex, por su id bajo `sessions/`, así
 * que conserva la ruta que tenía en la cuenta de origen (`relOrigen`, con su nombre y su compresión).
 */
export function tramosDestino(agente: AgenteTraspaso, o: { cwdDestino: string; id: string; relOrigen: readonly string[] }): string[] {
  if (agente === 'codex') return [...o.relOrigen]
  return ['projects', carpetaProyectoClaude(o.cwdDestino), `${o.id}.jsonl`]
}

/** Cómo está el destino de un archivo frente a su origen. */
export type EstadoDestino = 'falta' | 'igual' | 'prefijo' | 'distinto'

/** Un archivo a copiar con lo que hay ya en su destino. */
export interface ArchivoACopiar {
  origen: string
  destino: string
  estado: EstadoDestino
  /** Cuántos bytes del origen se copian (hasta su última línea completa); sin él, todo el archivo. */
  bytes?: number
}

/** Lo que se copia, o el archivo que lo impide. */
export type PlanCopia = { ok: true; copiar: ArchivoACopiar[] } | { ok: false; conflicto: string }

/**
 * Decide la copia entera antes de escribir nada. Uno igual no se toca; uno que es el principio del de origen
 * es la misma conversación que siguió en el origen y se pone al día sin perder nada; uno distinto es otra
 * historia con el mismo id en la cuenta de destino y no se pisa: la copia no se hace.
 */
export function planCopia(archivos: readonly ArchivoACopiar[]): PlanCopia {
  const distinto = archivos.find((a) => a.estado === 'distinto')
  if (distinto) return { ok: false, conflicto: distinto.destino }
  return { ok: true, copiar: archivos.filter((a) => a.estado === 'falta' || a.estado === 'prefijo') }
}

/**
 * Lo que se hace con una divergencia ya elegida. Con la de destino no se copia nada. Con la de origen, lo distinto
 * del destino se aparta (no se borra) y se copia en su lugar; lo igual no se toca.
 */
export function resolverDivergencia(archivos: readonly ArchivoACopiar[], eleccion: 'origen' | 'destino'): { apartar: string[]; copiar: ArchivoACopiar[] } {
  if (eleccion === 'destino') return { apartar: [], copiar: [] }
  return {
    apartar: archivos.filter((a) => a.estado === 'distinto').map((a) => a.destino),
    copiar: archivos.filter((a) => a.estado !== 'igual').map((a) => (a.estado === 'distinto' ? { ...a, estado: 'falta' as const } : a))
  }
}

/** A dónde se aparta una copia: con otra extensión el CLI no la lista ni la reanuda, y la fecha la distingue. */
export function nombreApartado(ruta: string, fecha: Date): string {
  const dos = (n: number): string => String(n).padStart(2, '0')
  const sello = `${fecha.getFullYear()}${dos(fecha.getMonth() + 1)}${dos(fecha.getDate())}-${dos(fecha.getHours())}${dos(fecha.getMinutes())}${dos(fecha.getSeconds())}`
  return `${ruta}.aparte-${sello}`
}

/**
 * La frase del aviso de arranque cuando la conversación se empezó con el proyecto en otra ruta (nativo frente
 * a `/workspace/<carpeta>`), o `null` si la ruta es la misma o no se sabe la de origen. Es para el agente.
 */
export function fraseRutas(o: { modoOrigen: ModoTraspaso; cwdOrigen: string | null; cwdDestino: string }): string | null {
  if (!o.cwdOrigen || normalizarRuta(o.cwdOrigen) === normalizarRuta(o.cwdDestino)) return null
  const de = o.modoOrigen === 'docker' ? 'Docker' : 'tu equipo (fuera de Docker)'
  return `Esta conversación viene de ${de}: las rutas \`${o.cwdOrigen}\` corresponden ahora a \`${o.cwdDestino}\`.`
}
