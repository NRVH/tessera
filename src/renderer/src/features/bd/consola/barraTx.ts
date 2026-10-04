// =============================================================================
// Lo que pinta la barra de la consola sobre la transacción (modo, «Tx pendiente (N)»,
// Commit, Rollback y sus `title`) a partir del estado de sesión que informa el main, o
// del modo de nacimiento si aún no hay sesión. Puro; lo reexporta `estadoConsola.ts`.
// Decisiones: docs/decisiones/bd/ui-consola-estado.md
// =============================================================================

import type { DbEstadoSesion, DbEstadoTx, DbTxModo } from '../../../../../shared/db-explorador-ipc.ts'

/** Lo que pinta la barra de la consola sobre la transacción. */
export interface BarraTx {
  modo: DbTxModo
  /** `Tx: Auto` / `Tx: Manual` (texto no pulsable de la izquierda). */
  textoModo: string
  soloLectura: boolean
  /** `Tx pendiente (3)`, `Tx abierta`, `Tx fallida: haz Rollback`, o null. */
  textoTx: string | null
  /**
   * `title` de ese texto, o null. En una base de ARCHIVO (SQLite) una transacción abierta
   * retiene un bloqueo sobre el archivo entero, no sobre filas: se dice, porque el síntoma
   * («database is locked») aparece en OTRA aplicación, lejos de su causa.
   */
  tituloTx: string | null
  /** `aria-pressed` del conmutador ⇄ (Manual = pulsado). */
  modoPulsado: boolean
  puedeCambiarModo: boolean
  tituloModo: string
  puedeCommit: boolean
  tituloCommit: string
  puedeRollback: boolean
  tituloRollback: string
}

export const TITULO_SOLO_LECTURA = 'La conexión es de solo lectura'

/**
 * Base de archivo con una transacción abierta. En modo rollback una lectura dentro de la
 * tx ya impide a otra aplicación CONFIRMAR sus escrituras; en WAL, solo la escritura
 * bloquea. De ahí el «puede»: la frase es cierta en los dos modos.
 */
export const TITULO_TX_ARCHIVO =
  'Mientras esta transacción siga abierta, el archivo queda bloqueado: otras aplicaciones pueden no poder escribir en él. Confirma o revierte cuando acabes.'

const ESPERAR = 'Espera a que termine la ejecución'

function textoModoDe(modo: DbTxModo): string {
  return `Tx: ${modo === 'auto' ? 'Auto' : 'Manual'}`
}

function textoTxDe(tx: DbEstadoTx, n: number): string | null {
  if (tx === 'pendiente') return n > 0 ? `Tx pendiente (${n})` : 'Tx pendiente'
  if (tx === 'abierta') return 'Tx abierta'
  if (tx === 'fallida') return 'Tx fallida: haz Rollback'
  return null
}

function barraSoloLectura(modo: DbTxModo): BarraTx {
  return {
    modo,
    textoModo: textoModoDe(modo),
    soloLectura: true,
    textoTx: null,
    tituloTx: null,
    modoPulsado: modo === 'manual',
    puedeCambiarModo: false,
    tituloModo: TITULO_SOLO_LECTURA,
    puedeCommit: false,
    tituloCommit: TITULO_SOLO_LECTURA,
    puedeRollback: false,
    tituloRollback: TITULO_SOLO_LECTURA
  }
}

function tituloCommitDe(puede: boolean, corriendo: boolean, tx: DbEstadoTx): string {
  if (puede) return 'Confirmar (Commit)'
  if (corriendo && tx !== 'ninguna') return ESPERAR
  return tx === 'fallida' ? 'La transacción falló: solo se puede revertir' : 'No hay transacción que confirmar'
}

function tituloRollbackDe(puede: boolean, corriendo: boolean, tx: DbEstadoTx): string {
  if (puede) return 'Revertir (Rollback)'
  return corriendo && tx !== 'ninguna' ? ESPERAR : 'No hay transacción que revertir'
}

/**
 * Estado de los controles de transacción: Commit y Rollback se habilitan si hay tx, SEA
 * CUAL SEA EL MODO (un BEGIN del usuario en Auto también se resuelve desde la barra); en
 * `fallida` solo cabe Rollback; en solo lectura, todo deshabilitado con el mismo `title`.
 * Sin sesión mandan `soloLectura` y `modoSinSesion` (el modo en que ARRANCARÁ la consola,
 * para que una nueva no diga «Tx: Auto» hasta su primera sentencia); con sesión, el main.
 */
export function estadoBarraTx(
  sesion: DbEstadoSesion | null,
  opciones: { soloLectura?: boolean; ejecutando?: boolean; modoSinSesion?: DbTxModo; deArchivo?: boolean } = {}
): BarraTx {
  const modo: DbTxModo = sesion ? sesion.txModo : (opciones.modoSinSesion ?? 'auto')
  const ro = sesion ? sesion.soloLectura : opciones.soloLectura === true
  if (ro) return barraSoloLectura(modo)
  const tx: DbEstadoTx = sesion ? sesion.tx : 'ninguna'
  const corriendo = opciones.ejecutando === true
  const textoTx = textoTxDe(tx, sesion ? sesion.sentenciasEnTx : 0)
  const hayTx = tx !== 'ninguna'
  const puedeCommit = hayTx && tx !== 'fallida' && !corriendo
  const puedeRollback = hayTx && !corriendo
  const tituloModo = modo === 'auto' ? 'Transacción: Auto. Pulsa para Manual' : 'Transacción: Manual. Pulsa para Auto'
  return {
    modo,
    textoModo: textoModoDe(modo),
    soloLectura: false,
    textoTx,
    tituloTx: textoTx !== null && opciones.deArchivo === true ? TITULO_TX_ARCHIVO : null,
    modoPulsado: modo === 'manual',
    puedeCambiarModo: !corriendo,
    tituloModo: corriendo ? ESPERAR : tituloModo,
    puedeCommit,
    tituloCommit: tituloCommitDe(puedeCommit, corriendo, tx),
    puedeRollback,
    tituloRollback: tituloRollbackDe(puedeRollback, corriendo, tx)
  }
}

/**
 * ¿Pasar de Manual a Auto exige resolver la transacción (`DialogoTxPendiente`)?
 * Con `abierta` no: el main la confirma en silencio (solo había lecturas).
 */
export function pasoAAutoRequiereResolver(sesion: DbEstadoSesion | null): boolean {
  return sesion !== null && sesion.txModo === 'manual' && (sesion.tx === 'pendiente' || sesion.tx === 'fallida')
}
