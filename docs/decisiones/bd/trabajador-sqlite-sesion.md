# La sesión SQLite es un proceso por consola, sin cursor vivo, con el autorizador como guardia

- **Estado:** vigente
- **Ámbito:** `src/tdb/sesionSqlite.cjs` y `erroresSesionSqlite`, `bindsSesionSqlite`, `posicionSesionSqlite`, `filasSesionSqlite`

## Contexto

`node:sqlite` es SÍNCRONO y no se puede interrumpir (ni `interrupt` ni progress handler, medido): mientras
corre una consulta, el proceso entero está bloqueado. Lado del main en `motores-sesion-sqlite.md`.

## Decisión

- Un proceso por consola (`procesoPorSesion`): el Stop es MATAR ese proceso (17 ms; relanzar cuesta 62 ms).
  `cancelar` responde que no puede: si llegara, el proceso estaba libre. Descartados, medidos: un hilo
  compartido (un ping a otra sesión del mismo proceso no respondió en 3 s) y `worker_threads` (`terminate()`
  no corta la consulta y bloquea la salida del proceso).
- La guardia la pone SIEMPRE `sqliteComun.cjs`: autorizador en toda conexión con el perfil que toca a cada
  sentencia, `limits.attach = 0` y apertura por cabecera. Tres capas de solo lectura: el main clasifica, el
  autorizador con el perfil 'lectura' (también en una conexión de escritura si llega `candadoRO`) y `readOnly`
  al abrir. Un EXPLAIN del usuario en solo lectura va con el perfil 'explain', como en `tdb`.
- Lectura con `iterate()` cortando en `maxFilas + 1` y `return()`. NUNCA un cursor vivo entre operaciones: en
  modo rollback un SELECT a medias retiene el bloqueo SHARED y el COMMIT de la aplicación dueña del archivo
  falla al instante con SQLITE_BUSY. «Más» es re-ejecutar saltando filas. El perfil se mantiene puesto
  mientras se AVANZA (`conPerfil`): un cambio de esquema a mitad hace que SQLite vuelva a preparar.
- Estado de la transacción: `isTransaction` y, dentro de una, Δ`total_changes()` más una marca de DDL (un DDL
  no cuenta en `total_changes`; sale de comparar `schema_version`). Algunas sentencias la REVIERTEN ENTERA en
  silencio (`INSERT OR ROLLBACK`): si había transacción antes del error y no después, el error lo dice.
- Modo manual: `BEGIN DEFERRED` perezoso, no IMMEDIATE (no bloquea hasta que se lee o escribe de verdad).
- Binds: un entero de JS va como BigInt (como Number, node:sqlite lo manda REAL y un LIMIT con REAL falla);
  un array son los valores de `?1`, `?2`… enlazados por NOMBRE.
- Posición del error: SQLite no la da; se busca por bisección el prefijo más corto que da el MISMO mensaje,
  con el perfil 'explain' puesto, porque un PRAGMA con valor hace efecto YA EN EL PREPARE.
