// =============================================================================
// Las reglas del riel de conexiones SSH a pantalla completa, en lógica pura: cuánto sitio hace falta para que
// quepa junto a la terminal o, con su columna plegada, junto al agente (que no bajan de un mínimo), hasta dónde
// se ensancha, qué ve el usuario según el modo, el perfil, su preferencia y el sitio, dónde se enseña la lista
// cuando la piden sin elegir, cuándo se ve la ▾ del lanzador (nunca a la vez que el riel) y cuándo se cierra
// el lanzador abierto. Sin React ni DOM: se fija bajo `node` (`test-lista-ssh.mts`). Depende de los límites
// de `shared/ajustesTerminal` y del ancho mínimo del agente (`shared/workspace-state-ipc`).
// Decisiones: docs/decisiones/terminales/riel-de-conexiones.md, docs/decisiones/terminales/lanzador-de-conexiones.md
// =============================================================================

import { SSH_RIEL_ANCHO_MAX, SSH_RIEL_ANCHO_MIN } from '../../../../shared/ajustesTerminal.ts'
import { CC_WIDTH_MIN } from '../../../../shared/workspace-state-ipc.ts'

/** El id del riel: lo nombra el `aria-controls` de su conmutador, en la cabecera de la terminal. */
export const ID_RIEL_SSH = 'ssh-riel'

/** El id del lanzador (la lista flotante): lo nombra el `aria-controls` de la ▾ de la cabecera. */
export const ID_LANZADOR_SSH = 'lanzador-ssh'

/** Ancho mínimo (px) que conserva la terminal: por debajo, una línea de salida deja de caber. */
export const TERMINAL_ANCHO_MIN = 420

/** Lo que ocupa el divisor entre el riel y la terminal (los 6 px de layout de `.splitter-vertical`). */
export const RIEL_DIVISOR = 6

/**
 * Holgura (px) que el divisor deja entre el riel más ancho que se puede arrastrar y el sitio en el que se
 * pliega: sin ella, un riel llevado al tope se pliega en cuanto el cuerpo de la terminal pierde un solo
 * píxel y reaparece al recuperarlo.
 */
export const RIEL_MARGEN_PLIEGUE = 40

/**
 * Lo mínimo que mide la columna de la terminal plegada junto a su agente: su cabecera. El panel lo lleva al
 * CSS (`--columna-plegada-min`), así que hay un solo número. Un riel más estrecho la rellena.
 */
export const COLUMNA_PLEGADA_MIN = 240

/**
 * ¿Cabe un riel de `ancho` px en `disponible` px dejando a su vecino su ancho mínimo? El vecino es la
 * terminal o, con la columna plegada, el agente de la terminal.
 */
export function rielCabe(disponible: number, ancho: number, vecinoMin = TERMINAL_ANCHO_MIN): boolean {
  return disponible - ancho - RIEL_DIVISOR >= vecinoMin
}

/**
 * Hasta dónde se puede arrastrar el riel en `disponible` px: lo que deja al vecino en su mínimo y,
 * además, `RIEL_MARGEN_PLIEGUE`, para que llegar al tope no lo deje al borde de plegarse. Nunca sale del
 * rango del riel. Un riel que ya mide `ancho`, más que ese tope (con la ventana estrecha), no se encoge solo
 * al agarrarlo: su ancho es el tope.
 */
export function anchoMaximoRiel(disponible: number, ancho = 0, vecinoMin = TERMINAL_ANCHO_MIN): number {
  const sitio = disponible - vecinoMin - RIEL_DIVISOR - RIEL_MARGEN_PLIEGUE
  return Math.max(SSH_RIEL_ANCHO_MIN, ancho, Math.min(SSH_RIEL_ANCHO_MAX, sitio))
}

/** Lo que decide qué ve el usuario. */
export interface EntradaRiel {
  pantallaCompleta: boolean
  /** El perfil de la terminal; `''` sin perfil (no hay conexiones que enseñar). */
  perfilId: string
  /** Su preferencia: el perfil lo ocultó a mano. Que no haya sitio no la cambia. */
  oculto: boolean
  /**
   * Ancho (px) del cuerpo de la terminal, de borde a borde; con la columna plegada, el de las dos columnas
   * (la de la terminal y la de su agente), que es lo que reparten.
   */
  disponible: number
  /** Ancho (px) que pide el riel. */
  ancho: number
  /** La columna de la terminal está plegada y el agente ocupa el resto: el vecino del riel es el agente. */
  sinTerminal?: boolean
}

/** Lo que mide el divisor del agente de la terminal (los 6 px que su columna suma a `--cc-width`). */
export const AGENTE_DIVISOR = 6

/**
 * Lo que las tarjetas restan a la fila del riel: el margen izquierdo del riel (8 px, `.ssh-riel-limite >
 * .ssh-riel`) y el borde de la tarjeta de la terminal (1 px por lado, `.shell-main > .terminal-panel`).
 */
export const MARCO_RIEL = 10

/** El hueco entre la columna plegada de la terminal y su agente (`--lienzo-gutter`). */
export const HUECO_TARJETAS = 6

/**
 * El sitio del riel a partir de la zona que reparten la terminal y su agente (`.shell-main`), que mide lo
 * mismo plegada o no: así ninguna medida es de otro modo. `agenteAncho` es el ancho del agente de la
 * terminal si está al lado (`--cc-width`), o null. Devuelve `disponible` (la entrada de `resolverRiel`, ya sin
 * los marcos de las tarjetas) y `desplegado`, el cuerpo que tendría la terminal sin plegar: el tope de
 * arrastre plegada no puede pasar de lo que cabría junto a ella, o restaurar las terminales plegaría el riel.
 */
export function sitioDelRiel(zona: number, agenteAncho: number | null, plegada: boolean): { disponible: number; desplegado: number } {
  const desplegado = (agenteAncho === null ? zona : zona - agenteAncho - AGENTE_DIVISOR) - MARCO_RIEL
  return { disponible: plegada ? zona - MARCO_RIEL - HUECO_TARJETAS : desplegado, desplegado }
}

/** Qué ve el usuario. */
export interface ResolucionRiel {
  /** Hay un riel que gobernar (a pantalla completa, con perfil y con sitio): su conmutador funciona. */
  enRiel: boolean
  /** El riel se ve: está en modo riel y su perfil no lo ocultó. */
  visible: boolean
}

/**
 * Qué ve el usuario. Sin sitio el riel se pliega SIN que cambie la preferencia (la entrada no la
 * devuelve: no hay nada que guardar) y reaparece solo cuando vuelve a haberlo.
 */
export function resolverRiel(e: EntradaRiel): ResolucionRiel {
  const enRiel = e.pantallaCompleta && e.perfilId !== '' && haySitio(e)
  return { enRiel, visible: enRiel && !e.oculto }
}

/**
 * ¿Hay sitio para el riel? Junto a la terminal, dejándole su mínimo. Con la columna plegada, la columna mide
 * lo que el riel y su divisor (nunca menos que su cabecera) y lo que queda tiene que llegar al mínimo del agente.
 */
function haySitio(e: Pick<EntradaRiel, 'disponible' | 'ancho' | 'sinTerminal'>): boolean {
  if (e.sinTerminal !== true) return rielCabe(e.disponible, e.ancho)
  return rielCabe(e.disponible, Math.max(e.ancho, COLUMNA_PLEGADA_MIN - MARCO_RIEL - RIEL_DIVISOR), CC_WIDTH_MIN)
}

/**
 * Hasta dónde se puede arrastrar el riel en el modo de la entrada (ver `anchoMaximoRiel`). Plegada, también
 * hasta lo que cabría junto a la terminal desplegada (`desplegado`, de `sitioDelRiel`).
 */
export function anchoMaximoDe(e: Pick<EntradaRiel, 'disponible' | 'ancho' | 'sinTerminal'> & { desplegado?: number }): number {
  if (e.sinTerminal !== true) return anchoMaximoRiel(e.disponible, e.ancho)
  const junto = anchoMaximoRiel(e.disponible, e.ancho, CC_WIDTH_MIN)
  return e.desplegado === undefined ? junto : Math.min(junto, anchoMaximoRiel(e.desplegado, e.ancho))
}

/** Dónde se enseña la lista de conexiones cuando alguien la pide sin elegir. */
export type DondeConectar = 'riel' | 'lanzador'

/**
 * Dónde se enseña la lista cuando la piden sin elegir (el «Conectar por SSH…» del estado vacío de la
 * terminal): en el riel si se ve, y si no en el lanzador de la cabecera. Con el riel plegado a mano sigue
 * siendo el lanzador: mostrar el riel guardaría una preferencia que el usuario no ha tocado.
 */
export function dondeConectar(riel: ResolucionRiel): DondeConectar {
  return riel.visible ? 'riel' : 'lanzador'
}

/**
 * ¿Se ve la ▾ del botón de nueva terminal? Solo cuando la lista no está ya a la vista en el riel (es la otra
 * cara de `dondeConectar`): a pantalla completa con el riel visible la ▾ sobra, y en cuanto el riel se pliega,
 * a mano o por falta de sitio, vuelve. Así la lista siempre tiene una entrada, y nunca dos.
 */
export function flechaLanzadorVisible(riel: ResolucionRiel): boolean {
  return dondeConectar(riel) === 'lanzador'
}

/** Lo que importa del modo de la terminal para un lanzador abierto. */
export interface ModoLanzador {
  pantallaCompleta: boolean
  /** La ▾ de la que cuelga está a la vista (`flechaLanzadorVisible`). */
  flechaVisible: boolean
}

/**
 * ¿Se cierra el lanzador abierto al pasar de un modo a otro? Sí si cambia la pantalla completa (la ▾ ya no está
 * donde se midió su ancla: la cabecera gana o pierde el conmutador del riel por la izquierda) y sí si la ▾ deja de
 * verse (el riel pasa a enseñar la lista). Que el riel se pliegue y la ▾ vuelva no lo cierra.
 */
export function lanzadorSeCierra(antes: ModoLanzador, ahora: ModoLanzador): boolean {
  return antes.pantallaCompleta !== ahora.pantallaCompleta || (antes.flechaVisible && !ahora.flechaVisible)
}
