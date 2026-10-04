// =============================================================================
// Quién tiene abierta la carpeta de un CLI que se va a reinstalar (solo Windows, donde un
// ejecutable vivo impide sustituirla): los procesos bajo alguna raíz del paquete que no
// descienden de las sesiones de Tessera que el flujo va a parar. Puro: recibe la tabla
// de procesos (`update/procesosSistema.ts`). Fuera de Windows devuelve siempre [].
// Decisiones: docs/decisiones/agentes/nativos-bloqueadores-windows.md
// =============================================================================

import type { ProcesoBloqueador } from '../../shared/agentes-nativos-ipc.ts'
import type { Plataforma } from '../../shared/plataforma.ts'
import type { ProcesoSistema } from '../update/procesosSistema.ts'

/** Más profundo que esto no hay árbol real de procesos; es la guarda de último recurso. */
const PROFUNDIDAD_MAXIMA = 64

/** Ruta de Windows comparable: barras invertidas, minúsculas y sin barras finales. */
export function normalizarRutaWindows(ruta: string): string {
  return ruta.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/**
 * ¿Desciende `pid` (o ES) de alguno de `ancestros`? Recorre la cadena de padres DENTRO
 * de la tabla: se corta donde el padre no está (huérfano), al repetir un pid (ciclo,
 * incluido el `0 → 0` del proceso inactivo del sistema) o al pasar la profundidad máxima.
 */
export function desciendeDe(
  pid: number,
  padreDe: ReadonlyMap<number, number | null>,
  ancestros: ReadonlySet<number>
): boolean {
  const vistos = new Set<number>()
  let actual: number | null | undefined = pid
  while (actual != null && !vistos.has(actual) && vistos.size < PROFUNDIDAD_MAXIMA) {
    if (ancestros.has(actual)) return true
    vistos.add(actual)
    actual = padreDe.get(actual)
  }
  return false
}

/** ¿Es la línea de comandos del demonio compartido de Codex (`codex app-server`)? */
export function esDemonioCodex(lineaComando: string | undefined): boolean {
  return typeof lineaComando === 'string' && /(^|[\s"'])app-server(\s|$|["'])/.test(lineaComando)
}

/**
 * Los procesos ajenos a Tessera que tienen algo abierto bajo alguna de `raices` y harían
 * fallar la reinstalación. Cada raíz se compara con barra final (un hermano `codexfoo` no
 * casa), sin distinguir mayúsculas; las vacías se descartan; cada proceso sale una vez.
 *
 * @param todos        La tabla completa (hace falta entera para seguir la cadena de padres).
 * @param raices       Raíz REAL del paquete y, si vive fuera, la del paquete del binario de la plataforma.
 * @param plataforma   Fuera de Windows la respuesta es siempre [].
 * @param pidsTessera  Pids de los ptys de las sesiones de agente que el flujo va a parar (no el del main).
 * @param opciones     `porLineaComando`: contar también a quien CORRE algo bajo una raíz
 *                     con un ejecutable de fuera (el `node.exe <raiz>\cli.js` de Claude).
 */
export function procesosQueBloquean(
  todos: readonly ProcesoSistema[],
  raices: readonly string[],
  plataforma: Plataforma,
  pidsTessera: readonly number[],
  opciones: { porLineaComando?: boolean } = {}
): ProcesoBloqueador[] {
  if (plataforma !== 'windows') return []
  const prefijos = [
    ...new Set(raices.map((r) => normalizarRutaWindows(r)).filter((r) => r !== ''))
  ].map((r) => r + '\\')
  if (prefijos.length === 0) return []
  const cuelga = (texto: string, comoPrefijo: boolean): boolean => {
    const t = normalizarRutaWindows(texto)
    return prefijos.some((pr) => (comoPrefijo ? t.startsWith(pr) : t.includes(pr)))
  }

  const padreDe = new Map<number, number | null>()
  for (const p of todos) padreDe.set(p.pid, p.ppid)
  const deTessera = new Set(pidsTessera)

  const out: ProcesoBloqueador[] = []
  const vistos = new Set<number>()
  for (const p of todos) {
    if (vistos.has(p.pid)) continue
    const porRuta = !!p.ruta && cuelga(p.ruta, true)
    // La línea de comandos se busca por DENTRO (la ruta va entre comillas y detrás del
    // ejecutable), pero con la misma barra final: `…\claude-codefoo\` no casa.
    const porLinea = !porRuta && opciones.porLineaComando === true && !!p.lineaComando && cuelga(p.lineaComando, false)
    if (!porRuta && !porLinea) continue
    if (desciendeDe(p.pid, padreDe, deTessera)) continue
    vistos.add(p.pid)
    out.push({ pid: p.pid, nombre: p.nombre, ruta: p.ruta, esDemonio: esDemonioCodex(p.lineaComando) })
  }
  return out
}
