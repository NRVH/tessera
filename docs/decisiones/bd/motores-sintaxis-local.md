# La gramática local carga una vez, sin reintento, y solo un abort del runtime la rompe

- **Estado:** vigente
- **Ámbito:** `src/main/db/sintaxisLocal.ts`

## Contexto

`libpg-query` compila su WASM (1,7 MB) al hacer `require`, y las consolas de PG piden un
veredicto de sintaxis mientras se teclea. Un parser que se recarga o se rompe por un texto
dejaría sin subrayado a todas las consolas.

## Decisión

- El `import()` va dentro de `cargar`, no arriba: quien no abre una consola de PG no paga el
  WASM. La promesa se guarda para que dos peticiones a la vez no carguen dos veces.
- Si la carga FALLA, la gramática queda sin servicio hasta reiniciar y se registra una vez.
  Reintentar no sirve: la librería crea su promesa de arranque al evaluarse el módulo y el
  `import()` la cachea, así que un reintento espera la misma promesa rechazada.
- Es un error de sintaxis lo que lanza `SqlError` con `sqlDetails` (sintaxis, cadena sin cerrar,
  escape Unicode inválido, «memory exhausted» de más de 10 000 niveles: el módulo sigue vivo).
  Cualquier otra excepción es un fallo de ESE texto: `null` para él y el parser sigue.
- Solo un ABORT del runtime de emscripten (`RuntimeError` o un mensaje `Aborted(…)`) lo deja
  roto hasta reiniciar: tras él todas las llamadas fallan igual y no se puede recargar.
  Roto, cada petición responde `ok: false` sin tocarlo.
- Se parsea sentencia a sentencia y se cede el hilo (`setImmediate`) cada `PORCION_MS`, con
  topes de tamaño (`TOPE_*` de `sintaxisSql`): un texto de más de 256 KB no se parsea.

## Consecuencias

Romper por cualquier `Error` corriente de la librería («memory allocation failed», «No parse
tree generated») dejaba sin gramática a todas las consolas. Sin gramática, la consola queda sin
subrayado y el servidor sigue validando al ejecutar.

## Descartes

- «Olvidar y reintentar» tras un fallo de carga: solo funcionaba con el doble de la prueba y
  llenaba el log en cada pausa de tecleo.
