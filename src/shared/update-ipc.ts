// =============================================================================
// Contrato IPC del auto-update: comprobar y descargar solo, aplicar al cerrar (o cuando lo
// pida el usuario) y decir siempre por qué falla. El main es dueño de la máquina de estados
// y la difunde entera: un renderer recargado se resincroniza con un `getState()`.
// «Se aplicó una actualización» NO es un `UpdateStatus`: es un hecho del arranque, y el
// primer chequeo (a los 8 s) lo borraría. Son dos avisos pegajosos que solo retira el
// usuario: `avisoAplicada` al leerlo, `avisoFallo` con «Descartar». Así `status:'error'`
// es solo «falló un chequeo», y al despertar se limpia sin tocar los avisos.
// Decisiones: docs/decisiones/actualizacion/ciclo-y-estados.md
// =============================================================================

export const UPDATE_CHANNELS = {
  /** renderer->main (invoke): estado actual. Para re-sincronizar al montar. */
  GET_STATE: 'update:getState',
  /** renderer->main (invoke): fuerza una comprobación (botón "Buscar actualizaciones"). */
  CHECK: 'update:check',
  /** renderer->main (invoke): reinicia e instala AHORA. Arranca el cierre garantizado. */
  INSTALL: 'update:install',
  /** renderer->main (invoke): abre el registro de actualizaciones en el explorador. */
  OPEN_LOG: 'update:openLog',
  /** renderer->main (invoke): descarta un aviso pegajoso. `AvisoDescartable` -> void. */
  DISMISS: 'update:dismiss',
  /** main->renderer (send): nuevo `UpdateState` completo. */
  STATE: 'update:state'
} as const

/**
 * Estados posibles. Son EXCLUYENTES y describen en qué punto del ciclo está:
 *   disabled    – app sin empaquetar (dev): no hay feed ni instalador.
 *   idle        – al día. El botón ofrece "Buscar actualizaciones".
 *   checking    – consultando el feed.
 *   downloading – bajando en segundo plano. Anillo de progreso determinado.
 *   available   – hay versión nueva pero ESTA COPIA no puede instalarla sola. NO se
 *                 descarga nada y la acción del botón abre la descarga manual (el
 *                 .dmg del feed).
 *   ready       – descargada y verificada, esperando a aplicarse.
 *   installing  – el usuario pidió instalar ya; cerrando contenedores y lanzando
 *                 el instalador.
 *   error       – falló un CHEQUEO (red, feed, descarga). NO el fallo de aplicar:
 *                 ése es `avisoFallo`, que es pegajoso.
 *
 * `available` CAMBIÓ DE SIGNIFICADO Y ES IMPORTANTE SABERLO. Antes era "esta
 * PLATAFORMA no puede dar el último paso" y describía macOS entero: allí el ciclo se
 * quedaba en avisar. Desde que macOS aplica sus actualizaciones con un relevo propio
 * (`main/update/relevoMac.ts`, `capacidades().autoInstalarUpdate` en `true`), lo que
 * `available` significa es "esta COPIA no puede", y las razones son de la copia, no
 * del sistema:
 *
 *   · no se sabe dónde está el `.app` (se corre desde un binario suelto);
 *   · el `.app` está donde no se puede escribir: `/Applications` instalado por otro
 *     usuario, un volumen de sólo lectura, una imagen montada;
 *   · el feed no publica un `.zip` con sha512, así que no hay nada verificable que
 *     aplicar (ver `descargaManual.ts`).
 *
 * En los tres casos hay algo real que ofrecer —el .dmg, que una persona sí puede
 * instalar— y eso es lo que hace el botón. Es el respaldo honesto, no un estado de
 * segunda: por eso NO se retiró al portar el update de macOS.
 *
 * Donde la app SÍ puede instalarse sola no hay un estado "available" separado de
 * "downloading": la descarga arranca sola e inmediatamente, así que sería un
 * parpadeo sin información. Reutilizar `ready` para `available` se descartó porque
 * `ready` promete "descargada y verificada", y aquí no hay nada descargado.
 */
export type UpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'available'
  | 'ready'
  | 'installing'
  | 'error'

/** Se aplicó una actualización y esta es la primera vez que la app arranca con ella. */
export interface AvisoAplicada {
  /** Versión desde la que se venía. */
  desde: string
  /** Versión que corre ahora. */
  hasta: string
}

/**
 * La actualización no llegó a aplicarse. Cubre los dos momentos en que eso se
 * descubre, que son muy distintos:
 *
 *   - EN EL CIERRE: el instalador ni siquiera arrancó (falta el .exe, hay una ruta
 *     pasada de MAX_PATH, `quitAndInstall` lanzó). Ahí sí sabemos POR QUÉ, y el
 *     porqué viaja en `mensaje`/`detalle`.
 *   - EN EL ARRANQUE: cedimos el control y hemos vuelto en la versión vieja. Ahí
 *     no hay causa que contar —el que falló fue un proceso que ya no existe—, así
 *     que `mensaje` es null y la UI usa su frase genérica.
 *
 * Es PEGAJOSO: no lo borra ningún chequeo ni el despertar del equipo, sólo el
 * usuario. Por eso NO se reutiliza `status:'error'`, que significa "falló un
 * CHEQUEO" y sí lo limpian los dos.
 */
export interface AvisoFallo {
  /** La versión que debería estar corriendo y no está. */
  versionEsperada: string
  /** Intentos ya consumidos con ESA versión destino. */
  intentos: number
  /** Se agotó la guarda anti-bucle: ya no se reintenta solo. */
  agotado: boolean
  /** Causa en LENGUAJE DE USUARIO, si se conoce. */
  mensaje: string | null
  /** Detalle técnico copiable, si lo hay. Nunca se muestra de primeras. */
  detalle: string | null
}

/** Avisos que el usuario puede cerrar a mano. */
export type AvisoDescartable = 'aplicada' | 'fallo' | 'error'

export interface UpdateState {
  status: UpdateStatus
  /** Versión que corre AHORA (`app.getVersion()`). */
  currentVersion: string
  /** Versión nueva; solo en downloading/available/ready/installing. */
  newVersion: string | null
  /** 0..100. Solo significativo en `downloading`. */
  percent: number
  /**
   * Mensaje en LENGUAJE DE USUARIO. En `error`, y también en `ready`/`available`
   * cuando un chequeo automático falla sin degradar el estado (ver `fail()` en
   * `AutoUpdate.ts`): ahí se guarda pero no se pinta.
   */
  errorMessage: string | null
  /**
   * Detalle técnico (código, stack, URL). Nunca se muestra de primeras: va detrás
   * de "Ver detalles" y del botón de copiar, para poder pegarlo en un reporte.
   */
  errorDetail: string | null
  /**
   * Ruta del instalador ya descargado, si lo hay. Habilita el ÚLTIMO recurso de la
   * UI: "abrir el instalador a mano" cuando el relanzamiento automático falla.
   */
  installerPath: string | null

  /**
   * Epoch (ms) del último chequeo CONCLUIDO, con éxito o sin él. `null` si aún no
   * ha habido ninguno en esta instalación.
   *
   * Va como NÚMERO y no como cadena ya formateada: el renderer refresca el "hace N
   * min" con un ticker propio, y una cadena se quedaría rancia entre difusiones.
   * Es lo único que hace informativo al estado `idle`, y es lo que justifica que el
   * botón de la barra esté siempre visible en vez de aparecer y desaparecer.
   */
  ultimoChequeoMs: number | null
  /**
   * Sólo en `ready`: la actualización venía ya preparada de un arranque anterior
   * (se restauró del marcador en disco, no se re-descargó). Es información para la
   * UI, que puede decir "preparada desde el arranque anterior" en vez de fingir que
   * acaba de bajarla.
   */
  preparadaDesdeArranque: boolean
  /**
   * Sólo en `ready`: la actualización se puede aplicar YA. Espeja el `motorArmado`
   * del main —que electron-updater tenga la descarga en la mano— y NO es redundante
   * con `preparadaDesdeArranque`: una restaurada del marcador nace con
   * `aplicable:false` y pasa a `true` en cuanto un chequeo la revalida contra el
   * feed, conservando el otro rótulo.
   *
   * Existe porque sin él la UI no podía distinguir un `ready` de verdad de uno a
   * medias: ofrecía "Actualizar ahora" y deshabilitaba "Buscar ahora" ("ya hay una
   * versión preparada: no hay nada más que buscar") justo cuando comprobar era LO
   * ÚNICO que hacía falta.
   */
  aplicable: boolean
  /**
   * Sólo en `ready`: ¿se aplicará sola al cerrar Tessera? Refleja la preferencia
   * del usuario Y la guarda anti-bucle a la vez: con los intentos agotados es
   * `false` aunque la preferencia esté activada. La UI muestra este booleano, no la
   * preferencia, porque es el que dice lo que de verdad va a pasar.
   */
  seAplicaAlCerrar: boolean
  /**
   * PEGAJOSO. Se aplicó una actualización en ESTE arranque. Solo lo borra el usuario,
   * al cerrar el popover de la barra de título (la única superficie cuyo ciclo de vida es
   * el de la lectura: que Configuración se desmonte no significa que se haya leído).
   */
  avisoAplicada: AvisoAplicada | null
  /** PEGAJOSO. El último intento de aplicar no llegó a puerto. Solo lo borra el usuario. */
  avisoFallo: AvisoFallo | null
}

/** Estado inicial coherente (sin versión nueva, sin error, sin avisos). */
export function initialUpdateState(currentVersion: string, packaged: boolean): UpdateState {
  return {
    status: packaged ? 'idle' : 'disabled',
    currentVersion,
    newVersion: null,
    percent: 0,
    errorMessage: null,
    errorDetail: null,
    installerPath: null,
    ultimoChequeoMs: null,
    preparadaDesdeArranque: false,
    aplicable: false,
    seAplicaAlCerrar: false,
    avisoAplicada: null,
    avisoFallo: null
  }
}
