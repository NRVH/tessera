# El proceso de sesión no toca stdout, no muere por una promesa huérfana y sale a mano

- **Estado:** vigente
- **Ámbito:** `src/tdb/sesion.cjs` (el otro extremo, en `ProcesoTrabajador.ts`)

## Contexto

`sesion.cjs` aloja las sesiones de una conexión (varias, cada una con su transacción) y habla con el
main por el canal IPC de `fork`. El protocolo y el reparto de procesos están en
`sesiones-protocolo-del-trabajador.md` y `sesiones-procesos-y-autoridad.md`; esto es lo que decide
cuándo el proceso vive y muere.

## Decisión

- `console.*` se redirige a stderr ANTES de cargar nada: una escritura nativa en el fd 1 rompería la
  trama y dejaría una promesa colgada para siempre. Lo que escriba el trabajador o un driver va al log
  del main (truncado y sin SQL).
- `disconnect` (el main murió o cerró el canal): rollback y close de todo y `process.exit` A MANO
  (plazo `PLAZO_SALIDA_MS`, el main espera 3 s y luego mata). El cliente Oracle deja hilos vivos y el
  proceso tardaba ~30 s en morir solo. `salir` responde ANTES de cerrar: el main espera el `exit`.
- `uncaughtException`: evento `fatal` y exit 70, porque el estado ya no es fiable. Sin canal IPC, exit 64.
- `unhandledRejection`: se REGISTRA y se sigue. Node mataría el proceso y con él las transacciones
  pendientes de todas las consolas, por una promesa huérfana de un driver que no afecta a ninguna sesión.
- Una operación por sesión a la vez (la cola la lleva el main): la segunda responde `ocupada`;
  `cancelar` es la excepción.
- Pérdida: si una operación falla con un código de pérdida, la sesión queda como lápida (lo que venga
  después responde `perdida`) y se cierra en silencio, porque la respuesta ya lo dice; si muere ociosa
  se emite el evento. Un `abrir` sobre una lápida la sustituye.
- El motor se carga con `esMotor` (`hasOwnProperty`), no con `MOTORES[motor]` a pelo: «constructor» o
  `['oracle']` dan un error de protocolo y no un `TypeError` ni el adaptador de otro motor.
- El secreto llega solo en `abrir` y se suelta.

## Descartes

- `worker_threads` y `utilityProcess`: comparten proceso con el main (NJS-090 y la regla «el main nunca
  carga drivers») o no se pueden lanzar desde las pruebas.
