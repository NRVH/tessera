// =============================================================================
// Errores y mensajes del gestor de sesiones: `ErrorGestor` (lo miran `instanceof` y
// `gestorFamilia`), la traducción de los fallos del trabajador y los textos que ve el usuario.
// Los textos los comparan las pruebas: no se cambian sin cambiarlas.
// Decisiones: docs/decisiones/bd/transacciones-perdidas-y-commit-en-camino.md
// =============================================================================

import type { DbErrorSql, DbMotivoError } from '../../../../shared/db-explorador-ipc.ts'
import { type ConfirmacionEnVuelo, MENSAJES, type MotivoRechazo } from '../maquinaSesion.ts'
import type { ClaseErrorTrabajador, ErrorTrabajador } from '../protocoloTrabajador.ts'
import type { UbicacionErrorRejilla } from '../sqlRejilla.ts'

import { textosSesionesEs, txSesiones } from './textosSesiones.ts'

export const mensajeExportarNoReleible = (): string => txSesiones().exportarNoReleible

export const mensajeFilaDesaparecida = (): string => txSesiones().filaDesaparecida
/** El texto en español (idioma por defecto): lo comparan las pruebas; la interfaz usa la función. */
export const MENSAJE_FILA_DESAPARECIDA = textosSesionesEs.filaDesaparecida

/**
 * El Stop de un motor que no se interrumpe (`detenerMatando`): lo que estaba en vuelo
 * vuelve con este error, clase `cancelada`.
 */
export const CODIGO_DETENIDA = 'TESSERA-DETENIDA'

/**
 * Exportar por páginas SIN clave (LIMIT/OFFSET: una vista, o un ORDER BY del usuario) en un
 * motor sin cursor vivo (`exportarTablaPorPaginas`, `correrExportacionConsulta`).
 */
export const avisoExportarPorPaginas = (): string => txSesiones().exportarPorPaginas

export const mensajeDetenida = (): string => txSesiones().detenida
/** El texto en español (idioma por defecto): lo comparan las pruebas; la interfaz usa la función. */
export const MENSAJE_DETENIDA = textosSesionesEs.detenida

/** Error que el controlador devuelve como `{ ok: false, error }`. Su mensaje es seguro. */
export class ErrorGestor extends Error {
  readonly error: DbErrorSql
  /** Catálogo: la sesión se perdió y se puede reintentar una vez. */
  reintentable = false

  constructor(motivo: DbMotivoError, mensaje: string, extra: Partial<DbErrorSql> = {}) {
    super(mensaje)
    this.name = 'ErrorGestor'
    this.error = { ...extra, mensaje, motivo }
  }
}

/**
 * El extremo local del túnel SSH de la conexión antes de abrir una sesión, o `null` sin túnel. Su error
 * (huella sin confirmar, ssh que no conecta) es un mensaje para el usuario y sale tal cual.
 */
export async function destinoPorTunel<C>(
  tunel: ((con: C) => Promise<{ host: string; port: number }> | null) | undefined,
  con: C
): Promise<{ host: string; port: number } | null> {
  try {
    return (await tunel?.(con)) ?? null
  } catch (e) {
    throw new ErrorGestor('servidor', e instanceof Error ? e.message : String(e))
  }
}

/**
 * Pone en el error del servidor DÓNDE cayó (`campoDeError`): el campo con su posición, o
 * la condición del filtro guiado, que no tiene posición que marcar.
 */
export function ubicarError(error: DbErrorSql, u: UbicacionErrorRejilla | null): void {
  if (!u) return
  error.campo = u.campo
  if (u.campo === 'filtro') error.condicion = u.condicion
  else error.posicion = u.posicion
}

/** Clase de error del trabajador -> motivo del contrato. */
export function motivoDeClase(clase: ClaseErrorTrabajador): DbMotivoError {
  switch (clase) {
    case 'servidor':
      return 'servidor'
    case 'cancelada':
      return 'cancelada'
    case 'perdida':
      return 'sesionPerdida'
    case 'timeout':
      return 'timeout'
    case 'driver':
      return 'driver'
    case 'soloLectura':
      return 'soloLectura'
    case 'ocupada':
      return 'ocupada'
    case 'protocolo':
      return 'interno'
  }
}

export function motivoDeRechazo(m: MotivoRechazo): DbMotivoError {
  if (m === 'cerrada') return 'interno'
  // Para el contrato sigue siendo una transacción por resolver (con revertir); el
  // mensaje propio dice por qué no vale confirmar.
  if (m === 'txFallida') return 'txPendiente'
  return m
}

/** Mensaje del servidor con DETAIL/HINT de PG debajo, si los hay. */
export function textoError(et: ErrorTrabajador): string {
  let t = et.mensaje
  if (et.detalle) t += '\n' + et.detalle
  if (et.pista) t += '\n' + txSesiones().pista + et.pista
  return t
}

export function errorSql(et: ErrorTrabajador): DbErrorSql {
  const e: DbErrorSql = { mensaje: textoError(et), motivo: motivoDeClase(et.clase) }
  if (et.codigo) e.codigo = et.codigo
  if (et.requiereDriver) e.requiereDriver = et.requiereDriver
  // SQL Server: el procedimiento donde ocurrió el error, para que la
  // consola lo diga (`textoError`). Solo lo manda su trabajador; los demás, igual al byte.
  if (et.objeto) e.objeto = et.objeto
  return e
}

export function mensajePerdida(et: ErrorTrabajador): string {
  return et.mensaje ? `${MENSAJES.perdidaConTx} (${et.mensaje})` : MENSAJES.perdidaConTx
}

/**
 * Lo que dice una sentencia perdida con una confirmación en camino
 * (`confirmaEnVuelo`), según cuál: nunca «revirtió», porque no se sabe.
 */
export function textoEnDuda(enDuda: ConfirmacionEnVuelo, caida: boolean): string {
  if (enDuda === 'commit') return caida ? MENSAJES.caidaEnCommit : MENSAJES.perdidaEnCommit
  if (enDuda === 'porDentro') return caida ? MENSAJES.caidaPorDentro : MENSAJES.perdidaPorDentro
  return caida ? MENSAJES.caidaEnAuto : MENSAJES.perdidaEnAuto
}

export { mensajeDe } from '../../../util/valores.ts'

export const mensajeSinLector = (): string => txSesiones().sinLector
/** El texto en español (idioma por defecto): lo comparan las pruebas; la interfaz usa la función. */
export const MENSAJE_SIN_LECTOR = textosSesionesEs.sinLector

export const mensajeNoReleible = (): string => txSesiones().noReleible

export const mensajeEsquemaCambiado = (): string => txSesiones().esquemaCambiado
/** El texto en español (idioma por defecto): lo comparan las pruebas; la interfaz usa la función. */
export const MENSAJE_ESQUEMA_CAMBIADO = textosSesionesEs.esquemaCambiado

export const avisoSinOrden = (): string => txSesiones().sinOrden
