// =============================================================================
// ¿Se puede aplicar la actualización AHORA MISMO? Módulo puro. `decidirPlanDeCierre` responde
// «¿queremos?»; esto, «¿podemos?»: sin `update-downloaded` en ESTA sesión electron-updater no
// tiene el instalador en la mano y su `install()` devuelve `false` sin lanzar nada ni salir,
// así que un `ready` sembrado del marcador se aborta antes del sello (un pre-vuelo que aborta
// no quema intento), con un motivo distinto según haya habido chequeo o no.
// Decisiones: docs/decisiones/actualizacion/marcador-y-prevuelos.md
// =============================================================================

export interface EntradaInstalar {
  /** electron-updater tiene la descarga registrada: hubo `update-downloaded` EN ESTA SESIÓN. */
  motorArmado: boolean
  /** Nuestro marcador apunta a un instalador que sigue en disco. */
  instaladorEnDisco: boolean
  /**
   * Ha concluido al menos un chequeo en esta sesión (con evento o sin él). NO cambia
   * el veredicto —los dos casos sin motor abortan igual— pero sí el MOTIVO, y esa
   * distinción es la que hace accionable el aviso: "aún no se ha preguntado" se cura
   * solo en el siguiente chequeo; "se preguntó y el feed no confirmó" no.
   */
  chequeoConcluido: boolean
}

// NO HAY CAMPO `origen`. Lo hubo, y era una promesa falsa: sugería que la decisión
// difiere entre el camino manual y el de cierre cuando no lo hace —esa diferencia
// vive en `iniciarCierre` (`app/cierre.ts`), que elige plan B o salir—. Un parámetro que el
// cuerpo ignora es peor que no tenerlo: obliga al llamador a construirlo y al lector
// a suponer una distinción inexistente.

export type DecisionInstalar =
  | { via: 'quitAndInstall' }
  | { via: 'abortar'; motivo: string; bloquear: boolean }

export function decidirComoInstalar(e: EntradaInstalar): DecisionInstalar {
  // Determinista: sin fichero no hay nada que instalar, ni ahora ni en el siguiente
  // cierre. Es el prechequeo de siempre, movido aquí para que haya UN solo sitio que
  // decida si se cede el control.
  if (!e.instaladorEnDisco) {
    return {
      via: 'abortar',
      motivo: 'el instalador descargado ya no está en disco',
      bloquear: true
    }
  }

  if (e.motorArmado) return { via: 'quitAndInstall' }

  // LOS DOS CASOS DE MOTOR SIN ARMAR NO BLOQUEAN, y esa es la parte que hay que
  // pensar: `bloquear` existe para los fallos DETERMINISTAS (fichero que no está,
  // ruta pasada de MAX_PATH). Estos dos son transitorios —falta tiempo o falta red—
  // y bloquear aquí mataría una actualización perfectamente buena porque el servidor
  // estuvo caído una tarde. El marcador sobrevive con sus intentos intactos y el
  // siguiente arranque con red lo resuelve solo.
  if (!e.chequeoConcluido) {
    return {
      via: 'abortar',
      motivo: 'la actualización venía del marcador y aún no se ha revalidado contra el feed',
      bloquear: false
    }
  }
  return {
    via: 'abortar',
    motivo: 'el feed no confirmó la descarga cacheada (servidor caído o versión retirada)',
    bloquear: false
  }
}
