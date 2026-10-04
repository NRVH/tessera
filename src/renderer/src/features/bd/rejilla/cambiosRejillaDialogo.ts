// =============================================================================
// El diálogo de «Enviar» de la rejilla: su estado tras un fallo, la marca de «último envío
// incierto» de la pestaña y a qué botón va el foco. Aquí y no en `DialogoEnvio.tsx` para
// probarlo con `node`; lo reexporta `cambiosRejilla.ts`.
// Decisiones: docs/decisiones/bd/ui-rejilla-modelo-cambios.md
// =============================================================================

import type { DbResultadoEnvio } from '../../../../../shared/db-explorador-ipc.ts'
import { mensajeFallo } from './cambiosRejillaEnvio.ts'
import { numCambios, type CambiosRejilla } from './cambiosRejillaModelo.ts'

/** El estado del diálogo de «Enviar». */
export type EstadoEnvio =
  | {
      tipo: 'listo'
      /**
       * El ÚLTIMO envío de esta pestaña quedó con el COMMIT incierto y nada lo ha
       * aclarado todavía (ver `sigueIncierto`): el diálogo reabierto lo vuelve a decir.
       */
      incierto?: boolean
    }
  | { tipo: 'enviando' }
  | {
      tipo: 'error'
      titulo: string
      mensaje: string
      /** El cambio que falló (se marca en la lista), o null si no hay uno al que culpar. */
      indice: number | null
      /** No se sabe si el COMMIT llegó a aplicarse (ver `estadoTrasFallo`). */
      incierto?: boolean
    }

/** El diálogo tras un fallo. */
export type EstadoEnvioError = Extract<EstadoEnvio, { tipo: 'error' }>

/** Lo que devuelve el main cuando el envío llegó al servidor y falló. */
export type FalloEnvio = Extract<DbResultadoEnvio, { tipo: 'error' }>

/** El título del diálogo tras un fallo, según su clase. */
function tituloFallo(incierto: boolean, detenido: boolean, enCommit: boolean, indice: number, n: number): string {
  if (incierto) return 'No se sabe si se aplicó: refresca la tabla antes de reenviar'
  if (detenido) return 'Envío detenido: se revirtió todo'
  if (enCommit) return 'Falló al confirmar: no se aplicó ninguno'
  return `Falló el cambio ${indice + 1} de ${n}: no se aplicó ninguno`
}

/**
 * El diálogo tras un fallo que llegó al servidor, de `n` cambios.
 *   - `indice` fuera de la lista (-1) es el COMMIT. Solo con un error del SERVIDOR se sabe
 *     que no quedó nada: con una pérdida el COMMIT pudo confirmarse antes del corte, y
 *     afirmar «no se aplicó ninguno» invitaría a reenviar y duplicar las inserciones
 *     (`incierto`). Va ANTES que el Stop: uno que coincide con el COMMIT tampoco lo sabe.
 *   - Stop: el main lo dice con 'cancelada'; el código del servidor (57014 de PG,
 *     ORA-01013) es la red por si llegara como error de la sentencia. `detenido` dice a
 *     la pestaña que no señale la fila: no falló, se paró.
 * `mensaje` es el del usuario (el mismo que se pone en la fila señalada).
 */
export function estadoTrasFallo(
  v: FalloEnvio,
  n: number
): { estado: EstadoEnvioError; detenido: boolean; mensaje: string } {
  const mensaje = mensajeFallo(v.error, v.filas)
  const detenido = v.error.motivo === 'cancelada' || v.error.codigo === '57014' || v.error.codigo === 'ORA-01013'
  const enCommit = v.indice < 0 || v.indice >= n
  const incierto = enCommit && v.error.motivo !== 'servidor'
  return {
    detenido,
    mensaje,
    estado: {
      tipo: 'error',
      titulo: tituloFallo(incierto, detenido, enCommit, v.indice, n),
      mensaje: detenido && !incierto ? '' : mensaje,
      indice: enCommit ? null : v.indice,
      ...(incierto ? { incierto: true } : {})
    }
  }
}

/** El botón del diálogo que se lleva el foco. */
export type FocoEnvio = 'enviar' | 'cancelar' | 'detener'

/**
 * A qué botón va el foco del diálogo (al abrirse y en cada cambio de estado), es decir,
 * qué hace un Intro reflejo: enviando, «Detener»; en producción o con el COMMIT incierto,
 * «Cancelar» (reenviar es un clic o un Tab deliberado, no un reflejo); si no, «Enviar».
 */
export function focoEnvio(estado: EstadoEnvio, produccion: boolean): FocoEnvio {
  if (estado.tipo === 'enviando') return 'detener'
  if (produccion) return 'cancelar'
  if (esEnvioIncierto(estado)) return 'cancelar'
  return 'enviar'
}

/**
 * ¿El diálogo está en la duda del COMMIT? En el fallo mismo (`error`) o al REABRIRLO
 * después (`listo` con la marca): las dos cosas piden lo mismo, que un Intro reflejo no
 * reenvíe y que el aviso se vea.
 */
export function esEnvioIncierto(estado: EstadoEnvio): boolean {
  return (estado.tipo === 'error' || estado.tipo === 'listo') && estado.incierto === true
}

// --- La marca de «último envío incierto» de la pestaña ---------------------------------
// Se quita cuando ya no hay nada pendiente que reenviar (un envío correcto, releer con su
// pregunta, «Revertir cambios»). Editar MÁS celdas NO la quita: el lote anterior sigue
// dentro de lo pendiente y puede estar ya aplicado.

/** Lo que dice el diálogo reabierto con la marca puesta. */
export const AVISO_ENVIO_INCIERTO = {
  titulo: 'El último envío quedó sin saber si se aplicó',
  texto:
    'Se cortó la conexión con el COMMIT en camino. Refresca la tabla para comprobarlo antes de reenviar: si se aplicó, reenviar duplicaría las inserciones.'
} as const

/** ¿Sigue la marca tras cambiar lo pendiente a `c`? Solo mientras quede algo que reenviar. */
export function sigueIncierto(incierto: boolean, c: CambiosRejilla): boolean {
  return incierto && numCambios(c) > 0
}

/** El estado con el que se abre el diálogo de «Enviar», según la marca de la pestaña. */
export function estadoAlAbrirEnvio(incierto: boolean): EstadoEnvio {
  return incierto ? { tipo: 'listo', incierto: true } : { tipo: 'listo' }
}

/** A dónde va el foco al CERRAR el diálogo: a la rejilla, o a quien lo abrió. */
export type FocoTrasEnvio = 'rejilla' | 'quienLoAbrio'

/**
 * A dónde va el foco cuando el diálogo de «Enviar» se CIERRA. Lo normal es devolverlo a
 * quien lo abrió, salvo con el COMMIT INCIERTO: ese suele ser el botón «Enviar cambios»,
 * que sigue activo, y con Intro mantenido la repetición del teclado lo reabriría y
 * reenviaría. Ahí el foco va a la rejilla, donde Intro edita la celda activa.
 */
export function focoTrasCerrarEnvio(estado: EstadoEnvio): FocoTrasEnvio {
  return esEnvioIncierto(estado) ? 'rejilla' : 'quienLoAbrio'
}
