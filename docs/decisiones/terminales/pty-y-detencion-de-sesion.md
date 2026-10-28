# Todo pty se crea con la conpty.dll de node-pty, las paradas van de una en una y un reinicio descarta la cola del shell muerto

- **Estado:** vigente
- **Ámbito:** `src/main/terminals/TerminalService.ts`, `terminals/paradaSesion.ts`, `terminals/colaMuertes.ts`, `terminals/lanzamientoPty.ts`, `terminals/adaptadores/pty.ts`, `terminals/adaptadores/registroPtys.ts`, `terminals/adaptadores/taskkill.ts` y `terminals/TerminalController.ts`

## Contexto

Tres fallos que solo se ven en la app real: el `kill()` del ConPTY del sistema hace un `fork` que
lanza «AttachConsole failed» y segfaultea al crear y matar terminales rápido (cambio de perfil);
matar en paralelo varios ptys en Windows tumba el main con 0xC0000005 (tres paradas con `^C` caían
a la segunda o tercera ronda; en serie aguantan 75); y la cola de un shell recién matado llega al
renderer después de que este limpiara la pantalla y repinta un prompt viejo.

## Decisión

- Un solo sitio crea ptys (`lanzarPty`) y pasa siempre `useConptyDll: true`. Sigue siendo ConPTY;
  fuera de Windows no hace nada.
- `detenerSesion` teclea solo `^C` (hasta tres, con la cadencia `CTRL_C_SETTLE_MS` +
  `DETENER_ESPERA_MS`), nunca `exit`: en la TUI de un agente sería un prompt. Las comprobaciones
  y la marca `detenida` son síncronas.
- TODA muerte de pty del PROCESO (parar, cerrar, reiniciar y el cierre por árbol de la hibernación
  por inactividad), de los agentes y de las terminales de abajo, va por una cola (`colaMuertes.ts`).
- El kill de reserva, en Windows, es `taskkill /T /F` sobre el pty y después `pty.kill()`: al revés,
  los hijos de la PowerShell quedan fuera del árbol y sobreviven. Vale para todo lo que mata un
  pty: parar, cerrar o reiniciar cuando el `exit` no basta (un agente nunca sale con él) y el
  cierre de la app (`matarTodoConArbol`, un solo `taskkill` para todos). Desde que el cierre
  empieza no nace ni renace ningún pty: nadie lo mataría.
- Cada pty queda en el registro del proceso (`adaptadores/registroPtys.ts`) hasta que su raíz termina. Una raíz viva al
  salir cuelga la app: al desmontar Node, node-pty une el hilo que espera su fin. En Windows esa muerte la marca el aviso
  nativo de fin de proceso, no `onExit`, que con `useConptyDll` llega al cerrarse la tubería de salida aunque la raíz
  siga viva (un proceso que no usa la consola). Cerrar, reiniciar e hibernar rematan el pty que sueltan
  (`rematarPty`): `kill()` si nadie se lo mandó y, fuera de Windows, SIGKILL a la raíz si ya lo tuvo (allí el pid no se
  reutiliza mientras no se recoge; en Windows el aviso llega a JS después de soltarse el handle, y basta `kill()`, que
  termina la raíz con el handle de node-pty). El cierre de la app remata todos (`cierre-ordenado.md`).
- Todo `kill()` de un pty pasa por el registro, lo llame quien lo llame (`lanzarPty` lo envuelve). En Windows va una
  sola vez por pty, porque un segundo cerraría otra vez su pseudoconsola y tumba el proceso. Tampoco espera al primer
  byte: node-pty aplaza `kill()` hasta entonces, una raíz que no escribe no lo recibiría nunca, y antes de ese byte se
  llama al `kill` de su agente, que es lo que haría el aplazado.
- `matarArbolWindows` devuelve cómo acabó `taskkill`. Un fallo o el tope, que corta `taskkill` a medias y puede dejar
  parte del árbol vivo, se anotan: en `db.log` para una sesión y en `cierre.log` en el cierre de la app.
- Un reinicio descarta el buffer de salida antes del kill y no lo vuelca; el camino de salida real
  (`onExit`) sí lo vuelca, para que el último output llegue antes del aviso.
- `reloading` se limpia en un `finally` y toda espera tiene tope (`REAP_TIMEOUT_MS`): un `onExit`
  que no llega no puede dejar la sesión muda ni el reinicio colgado.
- La entrada del renderer al pty se registra solo por tamaño: lo tecleado puede ser una contraseña.
- La parada (`detenerSesion`: qué se puede detener, la promesa que hace esperar a un cierre o reinicio, el gesto y su
  registro) vive en `paradaSesion.ts`; el kill de reserva sigue siendo un método del servicio, que una prueba neutraliza.
- Con ConPTY, a veces `onExit` llega SIN código (`onExit({})`): node-pty emite la salida al cerrarse la tubería y, si se
  cierra antes que el aviso nativo de fin, no tiene el código todavía. Una pestaña SSH que no conecta perdía su 255 y decía
  «La sesión terminó (código undefined)» en vez de «No se pudo conectar». Se recupera sondeando el campo interno del agente de
  node-pty (`codigoDeSalidaTardio`) hasta `CODIGO_TARDIO_TOPE_MS` (1 s, menor que `REAP_TIMEOUT_MS`) antes de anunciar nada;
  si no aparece, el record queda con -1 y a quien escucha le llega ese mismo -1. Si entretanto la sesión se dio por muerta o ya
  tiene otro pty, el código tardío no se aplica: sería de un proceso que ya no es el suyo.
- El RELOAD de una sesión abierta (terminal y agente) espera al candado del borrado del perfil de esa sesión: relanzar un
  agente a mitad del borrado levantaría el contenedor de una cuenta de un perfil que se está borrando.
- En Linux el pty se lanza envuelto en `bash`, que cierra todo descriptor mayor que 2 y ejecuta en su lugar la shell
  (`adaptadores/descriptoresHeredados.ts`): node-pty hace allí `forkpty` + `execvp` sin cerrar nada, y la shell heredaba
  los `.pak`, la memoria compartida, las tuberías y los sockets del IPC de Chromium, que un proceso suelto de un agente
  (un servidor MCP) retenía con Tessera ya cerrada. En macOS node-pty usa `posix_spawn` con
  `POSIX_SPAWN_CLOEXEC_DEFAULT` y en Windows ConPTY no hereda: allí no se envuelve. La envoltura es un `bash -c` no
  interactivo, que ejecuta el guion de `BASH_ENV` al arrancar: esa variable viaja apartada
  (`TESSERA_BASH_ENV_APARTADO`) y la envoltura la devuelve a su sitio antes de ejecutar la shell, que la recibe intacta.

## Consecuencias

- Quien cree un pty nuevo debe pasar por `lanzarPty`; sin la opción vuelve el segfault, y en Linux la herencia.
- Una parada cuesta unos 0,7 s por sesión que sale elegante; es un reinicio masivo pedido a mano.
- No se puede paralelizar la parada para ganar tiempo.

## Descartes

- Reutilizar `killCurrentShell` para parar: su `exit` es un prompt en la TUI del agente.
- Volcar el buffer del pty viejo en el reload: repinta el prompt anterior sobre la pantalla nueva.
