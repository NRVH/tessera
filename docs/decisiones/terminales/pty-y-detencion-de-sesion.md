# Todo pty se crea con la conpty.dll de node-pty, las paradas van de una en una y un reinicio descarta la cola del shell muerto

- **Estado:** vigente
- **Ámbito:** `src/main/terminals/TerminalService.ts`, `terminals/colaMuertes.ts`, `terminals/lanzamientoPty.ts`, `terminals/adaptadores/pty.ts` y `terminals/TerminalController.ts`

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
  los hijos de la PowerShell quedan fuera del árbol y sobreviven.
- Un reinicio descarta el buffer de salida antes del kill y no lo vuelca; el camino de salida real
  (`onExit`) sí lo vuelca, para que el último output llegue antes del aviso.
- `reloading` se limpia en un `finally` y toda espera tiene tope (`REAP_TIMEOUT_MS`): un `onExit`
  que no llega no puede dejar la sesión muda ni el reinicio colgado.

## Consecuencias

- Quien cree un pty nuevo debe pasar por `lanzarPty`; sin la opción vuelve el segfault.
- Una parada cuesta unos 0,7 s por sesión que sale elegante; es un reinicio masivo pedido a mano.
- No se puede paralelizar la parada para ganar tiempo.

## Descartes

- Reutilizar `killCurrentShell` para parar: su `exit` es un prompt en la TUI del agente.
- Volcar el buffer del pty viejo en el reload: repinta el prompt anterior sobre la pantalla nueva.
