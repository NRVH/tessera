// =============================================================================
// Qué sistema operativo es este. Puro: sin `os`, Electron ni `fs`.
// `esWindows()` / `esMac()` y nunca `process.platform === 'win32'` suelto: se sustituye en
// un test y `grep esWindows` es la lista de lo que falta para Linux. Cuidado con la negación:
// hay ramas «Windows y lo demás» y ramas «macOS y lo demás».
// `CapacidadesPlataforma` dice lo que una plataforma no puede hacer; esconder es lo último.
// En el renderer no hay `process`: allí solo `plataformaDe`, `capacidadesDe` y los tipos.
// Decisiones: docs/decisiones/shared/plataforma-y-nombres-del-sistema.md
// =============================================================================

/**
 * Las plataformas que Tessera reconoce. `'otra'` no es un error: es Linux y cualquier
 * BSD, donde la app puede arrancar en desarrollo. Se le da el nombre POSIX genérico
 * porque hoy su comportamiento es "como Mac salvo en lo que sea específico de Apple";
 * cuando Linux sea un objetivo de verdad tendrá su propia rama y este tipo dirá cómo.
 */
export type Plataforma = 'windows' | 'mac' | 'otra'

/** Traduce el `process.platform` de Node al vocabulario de Tessera. */
export function plataformaDe(platform: string): Plataforma {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'mac'
  return 'otra'
}

/** La plataforma donde corre ESTE proceso. */
export function plataformaActual(): Plataforma {
  return plataformaDe(process.platform)
}

/** ¿Windows? Úsese esto y no `process.platform === 'win32'` (ver la regla 1). */
export function esWindows(): boolean {
  return plataformaActual() === 'windows'
}

/** ¿macOS? */
export function esMac(): boolean {
  return plataformaActual() === 'mac'
}

/**
 * QUÉ SABE HACER TESSERA EN CADA SISTEMA.
 *
 * Esto NO es una lista de "lo que falta por portar": es el contrato que la UI
 * consulta para no ofrecer botones que no pueden cumplir.
 *
 * UNA CAPACIDAD EN `false` ES EL ÚLTIMO RECURSO, NO LA PRIMERA RESPUESTA. La regla 3
 * de arriba ("lo que no se puede hacer se DICE, no se finge") evita la casilla
 * muerta, pero se conforma con esconder la función, y esconder no es portar. La regla
 * de verdad es más exigente y va en este orden:
 *
 *   1. Se construye el EQUIVALENTE NATIVO de la plataforma. Que el mecanismo de
 *      Windows no exista allí no significa que la función no exista: significa que
 *      hay que escribirla con las piezas de esa plataforma, sin tocar el camino de
 *      la otra.
 *   2. Sólo si de verdad no hay equivalente se pone la capacidad en `false`, se
 *      esconde la superficie, y se documenta AQUÍ qué se intentó y por qué no salió.
 *      Un `false` sin ese porqué es una nota de "no me dio tiempo" disfrazada de
 *      límite del sistema.
 *
 * El auto-update es el caso que fijó la regla. Estuvo en `false` en macOS porque
 * Squirrel.Mac no puede aplicar una actualización sin Developer ID —cierto, medido y
 * no arreglable con configuración—, y de ahí se concluyó que macOS no podía
 * actualizarse sola. La conclusión era falsa: lo que no se podía usar era Squirrel.
 * Ver `autoInstalarUpdate` abajo.
 *
 * Cuando el equivalente nativo se comporta MEJOR o distinto que el de Windows, no se
 * fuerza a parecerse: se documenta la diferencia (`relevoMac.ts` enumera las tres
 * cosas que en macOS sobran).
 *
 * Cada campo se documenta con el PORQUÉ de su valor, no con lo que vale. Y cada campo
 * tiene que tener LECTOR: se declaró `portapapelesDeArchivos` y se retiró, porque era
 * `true` en las dos plataformas y ninguna superficie la consultaba; una capacidad sin
 * lector es documentación disfrazada de contrato. Lo que decide si el explorador ofrece
 * "Pegar" sobre archivos del sistema sigue siendo la implementación de
 * `main/clipboard` (CF_HDROP en Windows, `NSFilenamesPboardType`/`public.file-url`
 * en macOS), no una casilla
 * aquí.
 */
export interface CapacidadesPlataforma {
  /**
   * ¿Puede la app AÑADIR Y QUITAR EN CALIENTE, desde Configuración, una entrada suya
   * en el menú del botón derecho del gestor de archivos?
   *
   * Ojo a lo que la capacidad dice y a lo que NO dice. No dice "aquí se puede abrir
   * una carpeta desde el gestor de archivos" —eso funciona en las dos plataformas y
   * en Mac ni siquiera es conmutable—: dice que hay un INTERRUPTOR que se puede
   * poner y quitar sin reinstalar. Es lo que decide si la categoría de Configuración
   * tiene algo que ofrecer.
   *
   * Windows sí: claves en `HKCU\Software\Classes` que `reg.exe` escribe y borra sin
   * reinstalar ni UAC (`main/shell/IntegracionShellService.ts`).
   *
   * macOS TAMBIÉN, y esto estuvo en `false` por haber mirado el mecanismo
   * equivocado. Es cierto que las asociaciones de TIPO viven en
   * `CFBundleDocumentTypes` del `Info.plist` del .app, las indexa Launch Services al
   * instalarlo y no se pueden encender ni apagar: "Abrir con › Tessera" sobre un
   * archivo ya funciona siempre y no hay nada que conmutar ahí. Pero de eso no se
   * sigue que macOS no tenga interruptor, igual que de "Squirrel no puede" no se
   * seguía que macOS no pudiera actualizarse (ver `autoInstalarUpdate`). El
   * equivalente idiomático del menú contextual de Windows es el submenú «Servicios» /
   * «Acciones rápidas» del clic derecho del Finder, y eso se alimenta de bundles
   * `.workflow` en `~/Library/Services`: el HOME del usuario, sin administrador, sin
   * tocar el paquete. Instalar uno es escribir dos ficheros y llamar a `pbs -flush`;
   * quitarlo es borrar una carpeta. Está medido en esta máquina —la entrada aparece y
   * desaparece de `pbs -dump_pboard` en el acto— y es lo que hace
   * `main/shell/servicioFinder.ts`.
   *
   * Se descartó `lsregister -u` como interruptor, que es la primera idea que se le
   * ocurre a cualquiera: Launch Services vuelve a registrar la app por su cuenta al
   * lanzarla, así que el "apagado" no se sostiene y el usuario vería la entrada
   * volver sola. Un interruptor que el sistema deshace es la casilla muerta que la
   * regla 3 prohíbe.
   *
   * `'otra'` (Linux, BSD) sigue en `false`: allí el menú contextual lo pone el
   * escritorio (Nautilus, Dolphin, Thunar…), cada uno con su formato, y ninguno está
   * escrito.
   */
  integracionShellEnCaliente: boolean
  /**
   * ¿Puede la app instalarse sola una actualización descargada?
   *
   * Windows sí, con NSIS: electron-updater relanza el instalador y el instalador
   * hace el trabajo.
   *
   * macOS SÍ, pero NO con Squirrel.Mac. La distinción es la que costó el error de
   * bulto anterior, que dejó esta capacidad en `false`: Squirrel valida el paquete
   * nuevo contra el REQUISITO DESIGNADO del que corre, y el de una firma ad-hoc es su
   * propio cdhash (`codesign -d -r-` -> `designated => cdhash H"…"`). El paquete
   * nuevo tiene otro cdhash porque es otro binario, así que esa comprobación no puede
   * pasar nunca y `quitAndInstall` devolvía `false` sin explicarse. Lo que no sirve
   * sin Developer ID es Squirrel, no la actualización: sustituir un `.app` es
   * renombrar un directorio, y eso se hace con `ditto` y `mv` desde un guion que
   * sobrevive a la app. Es lo que hace `main/update/relevoMac.ts`, y por eso esto
   * vale `true` en Mac.
   *
   * Lo que la capacidad dice es "esta PLATAFORMA sabe hacerlo". Que esta COPIA
   * concreta pueda —que el `.app` esté en un sitio donde se pueda escribir— es otra
   * pregunta, y se responde en el momento (`sePuedeEscribirEnElBundle`); cuando la
   * respuesta es no, el ciclo se queda en `status:'available'` y ofrece la descarga
   * manual del .dmg. Ver `shared/update-ipc.ts`.
   *
   * `'otra'` (Linux, BSD) sigue en `false`: no hay ni NSIS ni bundle que renombrar, y
   * el formato de distribución allí ni siquiera está decidido.
   */
  autoInstalarUpdate: boolean
}

/** Las capacidades de una plataforma dada. Puro: se puede probar sin correr en ella. */
export function capacidadesDe(plataforma: Plataforma): CapacidadesPlataforma {
  return {
    integracionShellEnCaliente: plataforma === 'windows' || plataforma === 'mac',
    autoInstalarUpdate: plataforma === 'windows' || plataforma === 'mac'
  }
}

/** Las capacidades de ESTE proceso. */
export function capacidades(): CapacidadesPlataforma {
  return capacidadesDe(plataformaActual())
}
