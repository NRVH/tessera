# En SQLite la guardia es el autorizador y las sentencias de un texto se ejecutan una a una

- **Estado:** vigente
- **Ámbito:** `src/tdb/sqlite.cjs` y `src/tdb/sqliteComun.cjs` (`abrirSqlite`, `prepararUna`)

## Contexto

`prepare()` de node:sqlite ejecuta la PRIMERA sentencia y descarta el resto EN SILENCIO
(`select 1; attach …` no falla). Un `WITH x AS (…) INSERT …` empieza por WITH y un `PRAGMA x = 1`
por PRAGMA, así que el prefijo del texto no dice qué hace. La ruta del archivo dice dónde vive
el usuario y el agente no la necesita.

## Decisión

- En solo lectura, `abrirSqlite` pone el perfil `lectura` del autorizador (lista blanca medida
  y columnas exigidas): un `PRAGMA table_info(t)` pasa; `ATTACH`, `VACUUM INTO` y
  `load_extension` no. En escritura, el perfil `base`: todo menos lo cerrado siempre. `tdb.cjs`
  salta su guardia por prefijo para este motor (`guardiaPorPrefijo`).
- Cada sentencia se prepara con `prepararUna` (la cola sale de `sourceSQL`) y pasa su guardia
  antes de correr; no se preparan todas antes de empezar (un `CREATE TABLE t…; INSERT INTO t…`
  no se puede preparar entero). Se devuelve la última y se dice cuántas corrieron; si una
  falla, el error dice cuál y qué pasó con las anteriores.
- Un `EXPLAIN [QUERY PLAN] INSERT …` en solo lectura se prepara con el perfil `explain`.
- Un `BEGIN` sin `COMMIT` se revierte al cerrar y se avisa: `tdb` abre y cierra la base en cada
  comando. Nunca queda un cursor vivo (bloquearía las escrituras de la aplicación dueña).
- La ruta sale del registro, nunca de argv, y no se le enseña: los errores de «no existe», «disco
  desconectado» y «la ruta cambió» se reescriben con el alias y el remedio.

## Consecuencias

- Producción no cambia nada aquí; la regla del agente es la del bloque de memoria y el aviso de
  `tdb ls`.

## Descartes

- Mirar el prefijo del texto como en Oracle y PostgreSQL.
- Preparar primero el texto entero para validarlo.
- Envolver las sentencias en un SAVEPOINT: un `BEGIN` o `COMMIT` del propio texto chocaría.
