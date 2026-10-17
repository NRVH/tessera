// =============================================================================
// Lo que pinta la barra de la consola sobre la transacción (modo, «Tx pendiente (N)»,
// Commit, Rollback y sus `title`) a partir del estado de sesión que informa el main, o
// del modo de nacimiento si aún no hay sesión. Puro; lo reexporta `estadoConsola.ts`.
// Decisiones: docs/decisiones/bd/ui-consola-estado.md
// =============================================================================

import {
  type DbEstadoSesion,
  type DbEstadoTx,
  type DbTxModo,
  motivoCarpetaSinEscritura
} from '../../../../../shared/db-explorador-ipc.ts'
import { txBarraConsola } from './textosBarra.ts'

/** Lo que pinta la barra de la consola sobre la transacción. */
export interface BarraTx {
  modo: DbTxModo
  /** `Tx: Auto` / `Tx: Manual` (texto no pulsable de la izquierda). */
  textoModo: string
  soloLectura: boolean
  /** `title` del «Solo lectura»: por qué lo es (la carpeta de una base de archivo, o la conexión); null si no lo es. */
  tituloSoloLectura: string | null
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

export function tituloSoloLectura(): string {
  return txBarraConsola().soloLectura
}

/**
 * Base de archivo con una transacción abierta. En modo rollback una lectura dentro de la
 * tx ya impide a otra aplicación CONFIRMAR sus escrituras; en WAL, solo la escritura
 * bloquea. De ahí el «puede»: la frase es cierta en los dos modos.
 */
export function tituloTxArchivo(): string {
  return txBarraConsola().txArchivo
}

function textoModoDe(modo: DbTxModo): string {
  const t = txBarraConsola()
  return modo === 'auto' ? t.modoAuto : t.modoManual
}

function textoTxDe(tx: DbEstadoTx, n: number): string | null {
  const t = txBarraConsola()
  if (tx === 'pendiente') return n > 0 ? t.txPendienteN(n) : t.txPendiente
  if (tx === 'abierta') return t.txAbierta
  if (tx === 'fallida') return t.txFallida
  return null
}

function barraSoloLectura(modo: DbTxModo, titulo: string): BarraTx {
  return {
    modo,
    textoModo: textoModoDe(modo),
    soloLectura: true,
    tituloSoloLectura: titulo,
    textoTx: null,
    tituloTx: null,
    modoPulsado: modo === 'manual',
    puedeCambiarModo: false,
    tituloModo: titulo,
    puedeCommit: false,
    tituloCommit: titulo,
    puedeRollback: false,
    tituloRollback: titulo
  }
}

/** Por qué es de solo lectura: la carpeta de una base de archivo lo dice; si no, la conexión. */
function tituloSoloLecturaDe(sesion: DbEstadoSesion | null): string {
  return sesion?.soloLecturaPorCarpeta === true ? motivoCarpetaSinEscritura() : tituloSoloLectura()
}

function tituloCommitDe(puede: boolean, corriendo: boolean, tx: DbEstadoTx): string {
  const t = txBarraConsola()
  if (puede) return t.confirmarCommit
  if (corriendo && tx !== 'ninguna') return t.esperar
  return tx === 'fallida' ? t.commitFallida : t.commitNinguna
}

function tituloRollbackDe(puede: boolean, corriendo: boolean, tx: DbEstadoTx): string {
  const t = txBarraConsola()
  if (puede) return t.revertirRollback
  return corriendo && tx !== 'ninguna' ? t.esperar : t.rollbackNinguna
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
  if (ro) return barraSoloLectura(modo, tituloSoloLecturaDe(sesion))
  const tx: DbEstadoTx = sesion ? sesion.tx : 'ninguna'
  const corriendo = opciones.ejecutando === true
  const textoTx = textoTxDe(tx, sesion ? sesion.sentenciasEnTx : 0)
  const hayTx = tx !== 'ninguna'
  const puedeCommit = hayTx && tx !== 'fallida' && !corriendo
  const puedeRollback = hayTx && !corriendo
  const t = txBarraConsola()
  const tituloModo = modo === 'auto' ? t.tituloModoAuto : t.tituloModoManual
  return {
    modo,
    textoModo: textoModoDe(modo),
    soloLectura: false,
    tituloSoloLectura: null,
    textoTx,
    tituloTx: textoTx !== null && opciones.deArchivo === true ? tituloTxArchivo() : null,
    modoPulsado: modo === 'manual',
    puedeCambiarModo: !corriendo,
    tituloModo: corriendo ? t.esperar : tituloModo,
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
