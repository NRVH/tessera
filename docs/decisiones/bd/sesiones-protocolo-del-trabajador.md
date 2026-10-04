# El proceso de sesión es Electron haciendo de Node, habla por el canal de `fork` y es tonto

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/ProcesoTrabajador.ts`, `protocoloTrabajador.ts`, `sesiones/correlador.ts` (y `src/tdb/sesion.cjs` al otro lado)

## Contexto

Cada conexión corre sus drivers en un proceso aparte que viaja con la app. Una respuesta perdida
no puede dejar una promesa colgada, el SQL no se clasifica dos veces y nada filtra SQL ni
secretos al log.

## Decisión

- `fork` con `execPath` + `ELECTRON_RUN_AS_NODE=1` (sin Dock ni ventana, los drivers de la app);
  `execArgv: []` (un `--inspect` heredado abriría el mismo puerto); `UV_THREADPOOL_SIZE=16` (en
  thick cada llamada bloquea un hilo de libuv: con 4 consolas largas el árbol se quedaba
  esperando); `windowsHide` y sin las variables `TESSERA_*`, que son del entorno del agente.
- El protocolo va por el canal IPC con `serialization: 'advanced'`, que es el formato de V8:
  vale porque en la app los dos extremos son el MISMO binario. El test que corre con `node` usa
  'json'; la app no, porque reparsearía la página de 4 MiB en el hilo del main.
- stdout y stderr son ruido para el log: truncado a 200 caracteres, sin líneas con pinta de SQL
  y con el secreto redactado. Del protocolo solo se registran op e id.
- El trabajador es TONTO: ejecuta, gestiona cursores y lee el estado de la tx. Qué es releíble,
  el candado de solo lectura o el BEGIN perezoso los decide el main (`OpcionesEjecucion`).
  Excepción: documentos y claves APLICAN la política del main (`PoliticaDocs`, `PoliticaClaves`),
  porque el parser del shell de MongoDB y las marcas `COMMAND INFO` de Redis viven allí.
- Los errores son DATOS (`ErrorTrabajador` con `clase`): el canal no conserva un Error.
- Vigilante por operación (`plazoDePeticion`) para el árbol, abrir y cerrar; una sentencia o un
  `tx` de usuario no lo llevan. Al salir el proceso se rechaza todo lo pendiente, como `perdida`
  o con el motivo de `matar` (el Stop de SQLite vuelve `cancelada`).
- El secreto viaja SOLO en `abrir`. `salir(plazo)` pide rollback + close y después SIGKILL.

## Descartes

- Líneas JSON por stdin/stdout: una escritura nativa sin `\n` se fundía con la respuesta
  siguiente y la promesa no terminaba NUNCA.
- Duplicar en TS el clasificador de MongoDB o de Redis: dos copias de una lista blanca de
  seguridad acaban divergiendo. Reutilizar la op 'docs' para Redis: `consola` diría dos cosas.
- Un proceso por sesión: ver [sesiones-procesos-y-autoridad.md](sesiones-procesos-y-autoridad.md).
