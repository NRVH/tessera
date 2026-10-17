# Todo cierre pasa por un único cierre ordenado que pregunta antes, apaga en orden, decide la actualización al final y no deja el proceso vivo

- **Estado:** vigente
- **Ámbito:** `src/main/app/cierre.ts`, `src/main/app/eventosApp.ts`, `src/main/app/guardianSalida.ts`, `src/main/app/planGuardianSalida.ts`, `src/main/util/registroCierre.ts`, `src/main/util/esperas.ts`

## Contexto

La X, `Cmd+Q`/Salir y «Reiniciar para actualizar» deben dejar sin contenedores, montajes ni ptys colgados, sin perder
lo último que se tecleó, y sin que el instalador tropiece con archivos en uso.

## Decisión

- Los tres caminos, y el reinicio por cambio de idioma (`reabrir`, que relanza al salir), llaman a `iniciarCierre`. Dos cerrojos APARTE: `confirmandoCierre` mientras pregunta y `cerrando`
  desde que ya no hay vuelta atrás. La pregunta nativa (transacciones y cambios de la rejilla sin enviar) va ANTES de
  poner `cerrando`: si se cancela, la siguiente X debe volver a pasar por aquí. Cancelar devuelve la actualización a
  «lista».
- Orden: overlay; vaciar consolas (con acuse y tope); `workspace-state` (con tope); procesos de sesión de BD; pausar el
  puente de `tdb` y soltar vigilantes y temporizadores; `docker rm -f` de todos los contenedores con progreso; 450 ms
  de «Listo». Cada etapa deja su duración en `logs/cierre.log`.
- La etapa de Docker lleva un tope de 30 s SIN AVANZAR (`conTopeSinAvance`), además del de cada orden (2 min): con
  Docker sin responder encadenaba el listado, los desmontajes y la verificación, y la ventana se quedaba minutos en
  «Cerrando». Un tope total se descartó: con muchos contenedores y Docker sano cortaba un cierre que avanzaba y dejaba
  agentes vivos sobre los proyectos. Pasado el tope se dice en el overlay y se sale; lo que quede lo retira el barrido
  del siguiente arranque. La limpieza sigue en segundo plano: su progreso tardío ya no llega al overlay ni al registro,
  y el plan C la espera antes de devolver la app (vaciaría el estado del sandbox con la app ya en uso).
- Tras matar los árboles de terminales y agentes, `ptys-sueltos` remata todo pty cuya raíz no conste como terminada,
  también los que ya no tiene ninguna sesión (`terminales/pty-y-detencion-de-sesion.md`): con una raíz viva, al
  desmontar Node node-pty une el hilo que la espera, y el proceso no termina tras `app.exit` aunque el registro diga
  «sale».
- Antes de `app.exit`, `salir()` deja escritos los ptys con la raíz viva, escucha el `exit` de Node (cuánto tarda tras
  «sale» y qué seguía activo en su bucle) y arma el **guardián de salida**: un proceso aparte que termina la app si no
  ha salido 15 s después de «sale», dejando antes su línea en `cierre.log`. Tras `app.exit` no corre JS que pueda
  cortar un desmontaje colgado, sea cual sea su causa; desde fuera sí. Nunca mata por nombre ni un pid que ya pudiera
  ser de otro: en Windows (PowerShell por ruta absoluta y guion codificado) abre un handle al proceso, con el que el
  pid ya no se reutiliza, y solo sigue si ese proceso nació antes que el guardián; en macOS y Linux (`/bin/sh`) solo
  mata mientras la app siga siendo su padre, y sale en cuanto deja de serlo. En Windows se lanza sin `detached`: sin
  consola, PowerShell sale sin hacer nada, y allí un hijo no muere con su padre. Su cwd es el temporal del sistema,
  para no retener la carpeta de un proyecto ni la de instalación.
- `window-all-closed` no sale mientras `cerrando`: `destroy()` lo emite síncrono y salía antes de lanzar el instalador.
- Con actualización: se matan los ptys registrados (en Windows cargan `OpenConsole.exe` desde la carpeta de
  instalación) y se lanza el instalador. Si falla y el cierre lo pidió el usuario al CERRAR, se sale igual (nunca se
  devuelve una app vaciada que no pidió actualizar). Si pidió actualizar: plan B, abrir el instalador a mano; plan C,
  abortar el cierre, reanudar el explorador de BD y el puente, y enseñar el error.

## Consecuencias

`test:registro-cierre` fija las llamadas y las etapas, en orden, sobre `cierre.ts`. Cada salida del proceso escribe
antes su «termina», sus ptys pendientes, el oyente del `exit` de Node y el guardián. `test:guardian-salida` prueba el
plan de las dos familias y, con procesos reales, que una app que no sale cae a su plazo y una que sale no se toca.
Un cierre que termina el guardián deja en rojo el e2e que lo provocó.

## Descartes

- Corregir en node-pty la espera de su hilo (soltarlo en vez de unirlo): exige recompilar su binario para las tres
  plataformas en cada versión y solo cubre esa causa; el guardián cubre cualquiera.
- Salir con `process.exit`: se salta el apagado de Chromium, que vacía el almacenamiento de la sesión.

- Cierre «elegante» de los ptys uno a uno: lento y frágil. Dentro de un contenedor `docker rm -f`
  garantiza su muerte; en modo nativo la garantiza matar el árbol de cada pty (`cerrar-ptys`, con
  tope), no solo su raíz.
