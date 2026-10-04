// =============================================================================
// Qué señalar para matar el árbol de procesos de un pty en POSIX (macOS), decidido a
// partir de una tabla de `ps`. Puro: no lanza ni señala nada; lo ejecuta
// `matarArbolPosix` (adaptadores/pty.ts). En Windows el árbol lo mata `taskkill /T`.
// Invariante: solo grupos que lidera un miembro del árbol y pids del árbol; nunca un
// identificador ≤ 1 ni el grupo propio, que señalarían a Tessera o a todo el usuario.
// Decisiones: docs/decisiones/agentes/hibernacion-por-inactividad.md
// =============================================================================

/** Una fila de `ps -A -o pid=,ppid=,pgid=`. */
export interface ProcesoPs {
  pid: number
  ppid: number
  pgid: number
}

/** Lo que hay que señalar: grupos enteros (`kill(-pgid)`) y procesos sueltos. */
export interface PlanMuerte {
  grupos: number[]
  pids: number[]
  /** Los miembros del árbol con su grupo: la identidad con la que se comprueba el remate. */
  miembros: ProcesoPs[]
}

const PLAN_VACIO: PlanMuerte = { grupos: [], pids: [], miembros: [] }

/** Las filas válidas de una salida de `ps`: tres enteros positivos; lo demás se descarta. */
export function leerTablaPs(salida: string): ProcesoPs[] {
  const filas: ProcesoPs[] = []
  for (const linea of salida.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(linea)
    if (!m) continue
    const [pid, ppid, pgid] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (pid > 0 && Number.isSafeInteger(pid) && Number.isSafeInteger(ppid) && Number.isSafeInteger(pgid)) {
      filas.push({ pid, ppid, pgid })
    }
  }
  return filas
}

/** La raíz y todos sus descendientes, siguiendo `ppid`. */
function arbolDe(tabla: readonly ProcesoPs[], raiz: number): ProcesoPs[] {
  const porPadre = new Map<number, ProcesoPs[]>()
  for (const p of tabla) {
    const hijos = porPadre.get(p.ppid)
    if (hijos) hijos.push(p)
    else porPadre.set(p.ppid, [p])
  }
  const origen = tabla.find((p) => p.pid === raiz)
  if (!origen) return []
  const arbol = [origen]
  const vistos = new Set<number>([raiz])
  for (let i = 0; i < arbol.length; i++) {
    for (const hijo of porPadre.get(arbol[i].pid) ?? []) {
      if (vistos.has(hijo.pid)) continue
      vistos.add(hijo.pid)
      arbol.push(hijo)
    }
  }
  return arbol
}

/**
 * El plan para matar el árbol que cuelga de `raiz` (el pid del pty). Vacío si la raíz no
 * está en la tabla, si no se conoce el grupo propio o si la raíz es el propio proceso: ante
 * la duda no se señala nada.
 */
export function planMuerte(tabla: readonly ProcesoPs[], raiz: number, propioPid: number): PlanMuerte {
  const propio = tabla.find((p) => p.pid === propioPid)
  if (!propio || raiz <= 1 || raiz === propioPid) return PLAN_VACIO
  const arbol = arbolDe(tabla, raiz)
  // Un árbol que contiene a Tessera no es el de un pty suyo: la tabla no es de fiar.
  if (arbol.length === 0 || arbol.some((p) => p.pid === propioPid)) return PLAN_VACIO
  const miembros = arbol.filter((p) => p.pid > 1)
  const prohibido = (id: number): boolean => id <= 1 || id === propio.pgid || id === propioPid
  const grupos = new Set<number>()
  for (const p of miembros) if (p.pgid === p.pid && !prohibido(p.pgid)) grupos.add(p.pgid)
  const pids = miembros.filter((p) => !grupos.has(p.pgid)).map((p) => p.pid)
  return { grupos: [...grupos], pids, miembros }
}

/**
 * Lo que queda por rematar tras la primera señal: solo lo que sigue en la tabla nueva con el
 * MISMO grupo que tenía. Un pid que reaparece con otro grupo es de otro proceso.
 */
export function planRemate(plan: PlanMuerte, tablaNueva: readonly ProcesoPs[]): Pick<PlanMuerte, 'grupos' | 'pids'> {
  const vivos = plan.miembros.filter((m) => tablaNueva.some((p) => p.pid === m.pid && p.pgid === m.pgid))
  const grupos = plan.grupos.filter((g) => vivos.some((m) => m.pgid === g))
  const pids = plan.pids.filter((pid) => vivos.some((m) => m.pid === pid))
  return { grupos, pids }
}
