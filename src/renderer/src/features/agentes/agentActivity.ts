// =============================================================================
// Modelo puro de la actividad de los agentes en el renderer: el punto que late por
// perfil, el aviso de «terminó sin revisar» y qué entra en el mosaico.
// Combina la señal del main (`raw`: trabajando o no por target) con `unseen`, lo que
// sólo sabe la UI: targets que cerraron un turno REAL sin que los estuvieras viendo.
// `unseen` es pegajoso hasta visitar el target o que vuelva a trabajar; un cierre
// 'idle' nunca lo marca. `esperando` son los que te esperan (lo dice el agente): vuelven
// a `unseen` cada vez que dejas de mirarlos sin contestar. Sin React, para probarlo bajo `node`.
// =============================================================================

import type { AgentActivityState, AgentMotivoEspera } from '../../../../shared/agent-terminal-ipc'

/**
 * Estado crudo VISIBLE de un target: trabajando o no. El main emite además 'done'
 * (fin de turno REAL), que aquí no es un estado sino un EVENTO: deja el crudo en
 * 'idle' y añade el target a `unseen`.
 */
export type AgentWork = 'working' | 'idle'

export interface ActivityState {
  /** Último estado crudo por key de target. */
  raw: Record<string, AgentWork>
  /** Keys que terminaron, o te esperan, sin ser vistos (el halo de «te necesita»). */
  unseen: Set<string>
  /** Keys que te esperan (un permiso, una pregunta…), con lo que esperan si el agente lo dice. */
  esperando: Map<string, AgentMotivoEspera | null>
}

/** Estado vacío inicial. */
export const emptyActivityState: ActivityState = { raw: {}, unseen: new Set(), esperando: new Map() }

/** `esperando` con `key` puesta (con su motivo) o quitada; el mismo mapa si no cambia nada. */
function conEspera(
  esperando: Map<string, AgentMotivoEspera | null>,
  key: string,
  motivo: AgentMotivoEspera | null | undefined
): Map<string, AgentMotivoEspera | null> {
  if (motivo === undefined) {
    if (!esperando.has(key)) return esperando
    const m = new Map(esperando)
    m.delete(key)
    return m
  }
  if (esperando.has(key) && esperando.get(key) === motivo) return esperando
  return new Map(esperando).set(key, motivo)
}

/**
 * Aplica un evento de actividad del main para `key`.
 *   - 'working': el target abrió turno. Deja de estar "listo sin ver" (unseen -=
 *     key): si vuelve a moverse ya no es algo terminado por revisar.
 *   - 'done': terminó un turno REAL (el main ya filtró los triviales). Si el
 *     usuario no lo estaba viendo, se marca unseen (listo por revisar); si lo
 *     tenía delante, cuenta como ya visto.
 *   - 'idle': cierre SILENCIOSO (turno trivial, sesión cerrada/hibernada). Apaga
 *     el indicador y NUNCA marca unseen: ahí está la diferencia con la v1, donde
 *     cualquier working->idle fabricaba un falso "listo por revisar".
 *   - 'blocked': te espera. Como 'done' (avisa si no lo ves), y además entra en
 *     `esperando` hasta que el agente diga otra cosa.
 * `isActive` = el target es el que el usuario ve ahora mismo. Devuelve el MISMO
 * objeto si nada cambió (identidad estable => sin re-render).
 */
export function applyActivity(
  state: ActivityState,
  key: string,
  event: AgentActivityState,
  isActive: boolean,
  motivo: AgentMotivoEspera | null = null
): ActivityState {
  const prev = state.raw[key]
  // 'done', 'idle' y 'blocked' dejan el crudo igual (no trabaja); difieren en si avisan.
  const work: AgentWork = event === 'working' ? 'working' : 'idle'
  const nextUnseen = unseenTras(state, key, event, isActive)
  const esperando = conEspera(state.esperando, key, event === 'blocked' ? motivo : undefined)

  const rawChanged = prev !== work
  if (!rawChanged && nextUnseen === state.unseen && esperando === state.esperando) return state
  return {
    raw: rawChanged ? { ...state.raw, [key]: work } : state.raw,
    unseen: nextUnseen,
    esperando
  }
}

/** `unseen` tras `event` en `key`; el mismo conjunto si no cambia. */
function unseenTras(state: ActivityState, key: string, event: AgentActivityState, isActive: boolean): Set<string> {
  const tiene = state.unseen.has(key)
  const avisa = (event === 'done' || event === 'blocked') && !isActive && !tiene
  // Una espera que se apaga sin terminar (cancelada, relanzada) se lleva su aviso: lo puso ella, y
  // dejarlo diría «terminó» de algo que no terminó. Volver a trabajar también lo quita.
  const quita = tiene && (event === 'working' || (event === 'idle' && state.esperando.has(key)))
  if (avisa) return new Set(state.unseen).add(key)
  if (!quita) return state.unseen
  const sin = new Set(state.unseen)
  sin.delete(key)
  return sin
}

/**
 * Dejaste de mirar `key`: si te sigue esperando, vuelve a avisar. Sin esto, mirar una pregunta y
 * cambiar de pestaña sin contestarla la dejaría sin ninguna señal. Identidad estable si no aplica.
 */
export function dejarDeVer(state: ActivityState, key: string): ActivityState {
  if (!state.esperando.has(key) || state.unseen.has(key)) return state
  return { ...state, unseen: new Set(state.unseen).add(key) }
}

/**
 * Marca un target como VISTO (el usuario lo activó): sale de `unseen`. No toca el
 * estado crudo (puede seguir 'working'). Identidad estable si no había nada.
 */
export function markSeen(state: ActivityState, key: string): ActivityState {
  if (!state.unseen.has(key)) return state
  const unseen = new Set(state.unseen)
  unseen.delete(key)
  return { ...state, unseen }
}

/** El mapa de espera sin las keys que no cumplan `queda`; el mismo si no sobra nada. */
function filtrarEspera(
  esperando: Map<string, AgentMotivoEspera | null>,
  queda: (k: string) => boolean
): Map<string, AgentMotivoEspera | null> {
  if ([...esperando.keys()].every(queda)) return esperando
  return new Map([...esperando].filter(([k]) => queda(k)))
}

/* AQUÍ VIVÍA `markAllSeen`, que apagaba TODOS los avisos de una vez porque mirar el
   inspector de progreso era, por sí solo, revisarlos: la lista entera estaba delante.
   Se fue con el inspector. Hoy el aviso se apaga target por target (`markSeen`), que
   es lo correcto para las dos vistas que quedan: en la normal se apaga el de la
   terminal que traes al frente, y en el mosaico sólo el de la casilla que ENFOCAS —con
   seis a la vista, darlas por vistas todas borraría justo la señal de «¿quién me
   necesita?»—. */

/**
 * Poda el estado a las keys de targets ABIERTOS (cerrar un proyecto no debe dejar
 * entradas colgadas creciendo). Identidad estable si no sobra nada.
 */
export function pruneActivity(state: ActivityState, openKeys: Set<string>): ActivityState {
  const rawKeys = Object.keys(state.raw)
  const rawStale = rawKeys.some((k) => !openKeys.has(k))
  const unseenStale = [...state.unseen].some((k) => !openKeys.has(k))
  const esperando = filtrarEspera(state.esperando, (k) => openKeys.has(k))
  if (!rawStale && !unseenStale && esperando === state.esperando) return state
  const raw: Record<string, AgentWork> = {}
  for (const k of rawKeys) if (openKeys.has(k)) raw[k] = state.raw[k]
  const unseen = new Set<string>()
  for (const k of state.unseen) if (openKeys.has(k)) unseen.add(k)
  return { raw, unseen, esperando }
}

/**
 * Elimina por completo un conjunto de keys del estado (crudo + unseen). Uso: targets
 * HIBERNADOS, cuya sesión el backend cierra sin emitir 'idle' y que siguen abiertos
 * (no los poda pruneActivity). Se limpia su estado SIN marcarlos como "terminó"
 * (no queremos un falso aviso de revisión por hibernar). Identidad estable si nada sobra.
 */
export function clearActivityKeys(state: ActivityState, keys: Set<string>): ActivityState {
  if (keys.size === 0) return state
  const rawHit = Object.keys(state.raw).some((k) => keys.has(k))
  const unseenHit = [...state.unseen].some((k) => keys.has(k))
  const esperando = filtrarEspera(state.esperando, (k) => !keys.has(k))
  if (!rawHit && !unseenHit && esperando === state.esperando) return state
  const raw: Record<string, AgentWork> = {}
  for (const k of Object.keys(state.raw)) if (!keys.has(k)) raw[k] = state.raw[k]
  const unseen = new Set<string>()
  for (const k of state.unseen) if (!keys.has(k)) unseen.add(k)
  return { raw, unseen, esperando }
}

/**
 * Reemplaza el estado CRUDO por la foto completa de las sesiones vivas del main. Es
 * distinto de aplicar los eventos uno a uno, y la diferencia es justo lo que arregla:
 * un target que YA NO ESTÁ en la foto (su sesión murió mientras el aviso se perdía)
 * tiene que apagarse, y aplicando solo lo que la foto trae se quedaría 'working' para
 * siempre —que es el fallo que esta resincronización existe para curar—.
 *
 * `unseen` NO se toca: es un aviso pendiente ("terminó y aún no lo revisas"), no un
 * estado de sesión, y borrarlo aquí tiraría avisos legítimos cada vez que vuelves a la
 * ventana. `esperando` sí se sustituye por el de la foto: es estado de sesión, y uno que
 * se quedara colgado avisaría para siempre. Identidad estable si nada cambia.
 */
export function sincronizarActividad(
  state: ActivityState,
  vivos: Record<string, AgentWork>,
  esperandoVivos: Map<string, AgentMotivoEspera | null> = new Map()
): ActivityState {
  const conEsperando = sincronizarCrudo(state, vivos)
  const iguales =
    esperandoVivos.size === state.esperando.size &&
    [...esperandoVivos].every(([k, m]) => state.esperando.has(k) && state.esperando.get(k) === m)
  return iguales ? conEsperando : { ...conEsperando, esperando: esperandoVivos }
}

/** El crudo de `sincronizarActividad`. */
function sincronizarCrudo(state: ActivityState, vivos: Record<string, AgentWork>): ActivityState {
  const claves = new Set([...Object.keys(state.raw), ...Object.keys(vivos)])
  let cambio = false
  const raw: Record<string, AgentWork> = {}
  for (const k of claves) {
    const nuevo = vivos[k]
    if (nuevo === undefined) {
      // Fuera de la foto = sin sesión viva = no puede estar trabajando. Se quita en vez
      // de dejarlo en 'idle': el estado ausente ya significa eso y no crece con el uso.
      if (state.raw[k] !== undefined) cambio = true
      continue
    }
    raw[k] = nuevo
    if (state.raw[k] !== nuevo) cambio = true
  }
  if (!cambio) return state
  return { ...state, raw }
}

/** true si el target está trabajando ahora mismo. */
export function isWorking(state: ActivityState, key: string): boolean {
  return state.raw[key] === 'working'
}
