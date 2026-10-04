# Todo cierre pasa por un único cierre ordenado que pregunta antes, apaga en orden y decide la actualización al final

- **Estado:** vigente
- **Ámbito:** `src/main/app/cierre.ts`, `src/main/app/eventosApp.ts`, `src/main/util/registroCierre.ts`, `src/main/util/esperas.ts`

## Contexto

La X, `Cmd+Q`/Salir y «Reiniciar para actualizar» deben dejar sin contenedores, montajes ni ptys colgados, sin perder
lo último que se tecleó, y sin que el instalador tropiece con archivos en uso.

## Decisión

- Los tres caminos llaman a `iniciarCierre`. Dos cerrojos APARTE: `confirmandoCierre` mientras pregunta y `cerrando`
  desde que ya no hay vuelta atrás. La pregunta nativa (transacciones y cambios de la rejilla sin enviar) va ANTES de
  poner `cerrando`: si se cancela, la siguiente X debe volver a pasar por aquí. Cancelar devuelve la actualización a
  «lista».
- Orden: overlay; vaciar consolas (con acuse y tope); `workspace-state` (con tope); procesos de sesión de BD; pausar el
  puente de `tdb` y soltar vigilantes y temporizadores; `docker rm -f` de todos los contenedores con progreso; 450 ms
  de «Listo». Cada etapa deja su duración en `logs/cierre.log`.
- `window-all-closed` no sale mientras `cerrando`: `destroy()` lo emite síncrono y salía antes de lanzar el instalador.
- Con actualización: se matan los ptys registrados (en Windows cargan `OpenConsole.exe` desde la carpeta de
  instalación) y se lanza el instalador. Si falla y el cierre lo pidió el usuario al CERRAR, se sale igual (nunca se
  devuelve una app vaciada que no pidió actualizar). Si pidió actualizar: plan B, abrir el instalador a mano; plan C,
  abortar el cierre, reanudar el explorador de BD y el puente, y enseñar el error.

## Consecuencias

`test:registro-cierre` fija las llamadas y las etapas, en orden, sobre `cierre.ts`. Cada salida del proceso escribe
antes su «termina».

## Descartes

- Cierre «elegante» de los ptys uno a uno: lento y frágil; `docker rm -f` garantiza.
