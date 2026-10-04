// =============================================================================
// Conexiones de producción en el main del explorador: el main es la SEGUNDA barrera (sin
// `confirmado`, 'produccion' sin enviar nada) y sus consolas nuevas nacen en Manual. La solo
// lectura entra por PARÁMETRO (la que impone el explorador, nunca `con.readonly`) y, cuando la
// hay, manda. Puro: lo usan el gestor de sesiones y el controlador.
// Decisiones: docs/decisiones/bd/transacciones-produccion-y-manual.md
// =============================================================================

import type { DbConnection } from '../../../shared/db-ipc.ts'
import type { DbTxModo } from '../../../shared/db-explorador-ipc.ts'
import { esEntornoProduccion, modoTxInicial } from '../../../shared/sql/produccionSql.ts'

type ConEntorno = Pick<DbConnection, 'entorno'>

/** ¿La conexión está marcada como de PRODUCCIÓN? (La regla vive en `produccionSql.ts`.) */
export function esProduccion(con: Pick<DbConnection, 'entorno'>): boolean {
  return esEntornoProduccion(con.entorno)
}

/**
 * Modo de transacción con el que NACE la consola de una conexión. La regla es
 * `modoTxInicial` (compartida con la barra de la consola, que la pinta sin sesión).
 * `soloLectura`: la que IMPONE el explorador (ver la cabecera), no la casilla.
 * `preferencia`: la de Configuración; solo la pasa quien CREA la sesión.
 * Sin ella, la pregunta es «¿producción de escritura?», que es lo que quieren saber
 * `aplicarManualPendiente` y `alCambiarConexion`.
 */
export function txModoInicialConsola(con: ConEntorno, soloLectura: boolean, preferencia?: DbTxModo): DbTxModo {
  return modoTxInicial(con.entorno, soloLectura, preferencia)
}

/**
 * ¿Hay que exigir `confirmado` a esta escritura? `soloLectura`, la impuesta por el
 * explorador: si la hay, manda antes (ver la cabecera).
 */
export function exigeConfirmacion(con: ConEntorno, soloLectura: boolean, confirmado: unknown): boolean {
  return !soloLectura && esProduccion(con) && confirmado !== true
}

/**
 * El mensaje del rechazo 'produccion', con el nombre de la conexión: es lo que el
 * usuario lee si el renderer no pidió la confirmación (un fallo suyo, o una versión que
 * no la conoce), y tiene que decir qué conexión es y qué hacer.
 */
export function mensajeProduccion(alias: string, que: 'escritura' | 'commit' | 'enviar' = 'escritura'): string {
  const accion =
    que === 'commit'
      ? 'confirma el COMMIT antes de enviarlo'
      : que === 'enviar'
        ? 'confirma los cambios antes de enviarlos'
        : 'confirma la escritura antes de enviarla'
  return `«${alias}» es una conexión de PRODUCCIÓN: ${accion}. No se envió nada.`
}
