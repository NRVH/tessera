// =============================================================================
// Modelo puro de la actividad de los agentes en el renderer: el punto que late por
// perfil, el aviso de «terminó sin revisar» y qué entra en el mosaico.
// Combina la señal del main (`raw`: trabajando o no por target) con `unseen`, lo que
// sólo sabe la UI: targets que cerraron un turno REAL sin que los estuvieras viendo.
// `unseen` es pegajoso hasta visitar el target o que vuelva a trabajar; un cierre
// 'idle' nunca lo marca. `esperando` son los que te esperan (lo dice el agente): vuelven
// a `unseen` cada vez que dejas de mirarlos sin contestar. Sin React, para probarlo bajo `node`.
// =============================================================================

import type { EstadoActividadAgente, MotivoEsperaAgente } from '../../../../shared/agent-terminal-ipc'

/**
 * Estado crudo VISIBLE de un target: trabajando o no. El main emite además 'done'
 * (fin de turno REAL), que aquí no es un estado sino un EVENTO: deja el crudo en
 * 'idle' y añade el target a `unseen`.
 */
export type TrabajoAgente = 'working' | 'idle'

export interface EstadoActividad {
  /** Último estado crudo por key de target. */
  crudo: Record<string, TrabajoAgente>
  /** Keys que terminaron, o te esperan, sin ser vistos (el halo de «te necesita»). */
  sinVer: Set<string>
  /** Keys que te esperan (un permiso, una pregunta…), con lo que esperan si el agente lo dice. */
  esperando: Map<string, MotivoEsperaAgente | null>
}

/** Estado vacío inicial. */
export const estadoActividadVacio: EstadoActividad = { crudo: {}, sinVer: new Set(), esperando: new Map() }

/** `esperando` con `key` puesta (con su motivo) o quitada; el mismo mapa si no cambia nada. */
function conEspera(
  esperando: Map<string, MotivoEsperaAgente | null>,
  clave: string,
  motivo: MotivoEsperaAgente | null | undefined
): Map<string, MotivoEsperaAgente | null> {
  if (motivo === undefined) {
    if (!esperando.has(clave)) return esperando
    const m = new Map(esperando)
    m.delete(clave)
    return m
  }
  if (esperando.has(clave) && esperando.get(clave) === motivo) return esperando
  return new Map(esperando).set(clave, motivo)
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
 * `esActivo` = el target es el que el usuario ve ahora mismo. Devuelve el MISMO
 * objeto si nada cambió (identidad estable => sin re-render).
 */
export function aplicarActividad(
  estado: EstadoActividad,
  clave: string,
  evento: EstadoActividadAgente,
  esActivo: boolean,
  motivo: MotivoEsperaAgente | null = null
): EstadoActividad {
  const prev = estado.crudo[clave]
  // 'done', 'idle' y 'blocked' dejan el crudo igual (no trabaja); difieren en si avisan.
  const trabajo: TrabajoAgente = evento === 'working' ? 'working' : 'idle'
  const sinVerSiguiente = sinVerTras(estado, clave, evento, esActivo)
  const esperando = conEspera(estado.esperando, clave, evento === 'blocked' ? motivo : undefined)

  const crudoCambiado = prev !== trabajo
  if (!crudoCambiado && sinVerSiguiente === estado.sinVer && esperando === estado.esperando) return estado
  return {
    crudo: crudoCambiado ? { ...estado.crudo, [clave]: trabajo } : estado.crudo,
    sinVer: sinVerSiguiente,
    esperando
  }
}

/** `unseen` tras `event` en `key`; el mismo conjunto si no cambia. */
function sinVerTras(estado: EstadoActividad, clave: string, evento: EstadoActividadAgente, esActivo: boolean): Set<string> {
  const tiene = estado.sinVer.has(clave)
  const avisa = (evento === 'done' || evento === 'blocked') && !esActivo && !tiene
  // Una espera que se apaga sin terminar (cancelada, relanzada) se lleva su aviso: lo puso ella, y
  // dejarlo diría «terminó» de algo que no terminó. Volver a trabajar también lo quita.
  const quita = tiene && (evento === 'working' || (evento === 'idle' && estado.esperando.has(clave)))
  if (avisa) return new Set(estado.sinVer).add(clave)
  if (!quita) return estado.sinVer
  const sin = new Set(estado.sinVer)
  sin.delete(clave)
  return sin
}

/**
 * Dejaste de mirar `key`: si te sigue esperando, vuelve a avisar. Sin esto, mirar una pregunta y
 * cambiar de pestaña sin contestarla la dejaría sin ninguna señal. Identidad estable si no aplica.
 */
export function dejarDeVer(estado: EstadoActividad, clave: string): EstadoActividad {
  if (!estado.esperando.has(clave) || estado.sinVer.has(clave)) return estado
  return { ...estado, sinVer: new Set(estado.sinVer).add(clave) }
}

/**
 * Marca un target como VISTO (el usuario lo activó): sale de `unseen`. No toca el
 * estado crudo (puede seguir 'working'). Identidad estable si no había nada.
 */
export function marcarVisto(estado: EstadoActividad, clave: string): EstadoActividad {
  if (!estado.sinVer.has(clave)) return estado
  const sinVer = new Set(estado.sinVer)
  sinVer.delete(clave)
  return { ...estado, sinVer }
}

/** El mapa de espera sin las keys que no cumplan `queda`; el mismo si no sobra nada. */
function filtrarEspera(
  esperando: Map<string, MotivoEsperaAgente | null>,
  queda: (k: string) => boolean
): Map<string, MotivoEsperaAgente | null> {
  if ([...esperando.keys()].every(queda)) return esperando
  return new Map([...esperando].filter(([k]) => queda(k)))
}

/* El aviso se apaga target por target (`marcarVisto`): en la vista normal se apaga el de la
   terminal que traes al frente, y en el mosaico sólo el de la casilla que ENFOCAS —con
   seis a la vista, darlas por vistas todas borraría justo la señal de «¿quién me
   necesita?»—. */

/**
 * Poda el estado a las keys de targets ABIERTOS (cerrar un proyecto no debe dejar
 * entradas colgadas creciendo). Identidad estable si no sobra nada.
 */
export function podarActividad(estado: EstadoActividad, clavesAbiertas: Set<string>): EstadoActividad {
  const clavesCrudo = Object.keys(estado.crudo)
  const crudoObsoleto = clavesCrudo.some((k) => !clavesAbiertas.has(k))
  const sinVerObsoleto = [...estado.sinVer].some((k) => !clavesAbiertas.has(k))
  const esperando = filtrarEspera(estado.esperando, (k) => clavesAbiertas.has(k))
  if (!crudoObsoleto && !sinVerObsoleto && esperando === estado.esperando) return estado
  const crudo: Record<string, TrabajoAgente> = {}
  for (const k of clavesCrudo) if (clavesAbiertas.has(k)) crudo[k] = estado.crudo[k]
  const sinVer = new Set<string>()
  for (const k of estado.sinVer) if (clavesAbiertas.has(k)) sinVer.add(k)
  return { crudo, sinVer, esperando }
}

/**
 * Elimina por completo un conjunto de keys del estado (crudo + unseen). Uso: targets
 * HIBERNADOS, cuya sesión el backend cierra sin emitir 'idle' y que siguen abiertos
 * (no los poda podarActividad). Se limpia su estado SIN marcarlos como "terminó"
 * (no queremos un falso aviso de revisión por hibernar). Identidad estable si nada sobra.
 */
export function limpiarClavesActividad(estado: EstadoActividad, claves: Set<string>): EstadoActividad {
  if (claves.size === 0) return estado
  const crudoAfectado = Object.keys(estado.crudo).some((k) => claves.has(k))
  const sinVerAfectado = [...estado.sinVer].some((k) => claves.has(k))
  const esperando = filtrarEspera(estado.esperando, (k) => !claves.has(k))
  if (!crudoAfectado && !sinVerAfectado && esperando === estado.esperando) return estado
  const crudo: Record<string, TrabajoAgente> = {}
  for (const k of Object.keys(estado.crudo)) if (!claves.has(k)) crudo[k] = estado.crudo[k]
  const sinVer = new Set<string>()
  for (const k of estado.sinVer) if (!claves.has(k)) sinVer.add(k)
  return { crudo, sinVer, esperando }
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
  estado: EstadoActividad,
  vivos: Record<string, TrabajoAgente>,
  esperandoVivos: Map<string, MotivoEsperaAgente | null> = new Map()
): EstadoActividad {
  const conEsperando = sincronizarCrudo(estado, vivos)
  const iguales =
    esperandoVivos.size === estado.esperando.size &&
    [...esperandoVivos].every(([k, m]) => estado.esperando.has(k) && estado.esperando.get(k) === m)
  return iguales ? conEsperando : { ...conEsperando, esperando: esperandoVivos }
}

/** El crudo de `sincronizarActividad`. */
function sincronizarCrudo(estado: EstadoActividad, vivos: Record<string, TrabajoAgente>): EstadoActividad {
  const claves = new Set([...Object.keys(estado.crudo), ...Object.keys(vivos)])
  let cambio = false
  const crudo: Record<string, TrabajoAgente> = {}
  for (const k of claves) {
    const nuevo = vivos[k]
    if (nuevo === undefined) {
      // Fuera de la foto = sin sesión viva = no puede estar trabajando. Se quita en vez
      // de dejarlo en 'idle': el estado ausente ya significa eso y no crece con el uso.
      if (estado.crudo[k] !== undefined) cambio = true
      continue
    }
    crudo[k] = nuevo
    if (estado.crudo[k] !== nuevo) cambio = true
  }
  if (!cambio) return estado
  return { ...estado, crudo }
}

/** true si el target tiene un turno en marcha: trabajando, o esperando una respuesta (un permiso, una pregunta). */
export function turnoEnMarcha(estado: EstadoActividad, clave: string): boolean {
  return estado.crudo[clave] === 'working' || estado.esperando.has(clave)
}

/** true si el target está trabajando ahora mismo. */
export function estaTrabajando(estado: EstadoActividad, clave: string): boolean {
  return estado.crudo[clave] === 'working'
}
