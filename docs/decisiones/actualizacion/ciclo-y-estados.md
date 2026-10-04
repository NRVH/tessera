# La actualización se descarga sin preguntar, se prepara en disco y se aplica al cerrar; todo fallo se ve y nada se promete sin motor armado

- **Estado:** vigente
- **Ámbito:** `src/main/update/AutoUpdate.ts`, `nucleo.ts`, `chequeo.ts`, `arranque.ts`, `instalacion.ts`, `shared/update-ipc.ts`

## Contexto

El cierre de Tessera es propio (mata contenedores y desmonta), así que electron-updater no puede decidir cuándo
instalar. Quien aplica la actualización es un proceso que ya no existe cuando termina, y electron-updater no sabe
nada del marcador que Tessera deja en disco entre sesiones.

## Decisión

- Nunca se pregunta si descargar. Preparada, se aplica sola al CERRAR (sin relanzar: cerrar es cerrar) o antes si
  se pulsa el botón. `autoInstallOnAppQuit` va en `false`: el cierre ordenado llama a `runInstaller` al final.
- Todo fallo de comprobar o descargar va a `status:'error'` con frase, detalle copiable y registro en disco. El de
  APLICAR se descubre al arrancar, por el marcador, y va a `avisoFallo`, que NO es un `status`: es pegajoso (solo lo
  cierra el usuario), mientras que `error` lo limpian el siguiente chequeo y el despertar del equipo.
- Un `ready` sembrado del marcador no es aplicable hasta que un chequeo re-emite `update-downloaded` desde la caché
  (motor armado). `necesitaRevalidar()` es la ÚNICA función que lo decide y la usan `check()` y la cadencia; dos
  copias discreparían. `aplicable` se deriva en `setState` y nunca se parchea; `seAplicaAlCerrar` dice lo que va a
  pasar de verdad (motor armado, sin bloqueo, intentos y preferencia), no la preferencia.
- `check()` sale temprano con algo descargado, salvo con un `ready` sin revalidar: una versión aún más nueva no se
  detecta hasta aplicar la preparada. Es deliberado; tocarlo arrastra el ciclo de descarga entero.
- `fail` no degrada un `ready` (el instalador sigue en disco) ni, en chequeos automáticos, un `available`; esos
  chequeos tampoco pasan por `checking` (un parpadeo cada 5 min, y un `idle` si el feed no contesta).
- `available` significa «esta copia no puede dar el último paso» (bundle no escribible, feed sin zip con sha512,
  plataforma sin instalador). El handler de INSTALL decide por ESTADO, no por plataforma, y abre el fichero que el
  feed anunció; nunca el feed pelado, que sin nombre de fichero responde 404.
- La URL del feed sale de `app-update.yml` (o `TESSERA_FEED_URL`), no de `getFeedURL()`, que en 6.8.x devuelve la
  cadena «Deprecated. Do not use it.».

## Consecuencias

El estado se difunde entero en cada transición y el main es el dueño de la máquina de estados. Un `installing` solo
lo pone una persona; `cierreCanceladoAntesDeInstalar` lo devuelve a `ready` si cancela el diálogo de salida.

## Descartes

- `isUpdateInstallPending(): boolean`: no llevaba la intención y relanzaba la app también al cerrar.
