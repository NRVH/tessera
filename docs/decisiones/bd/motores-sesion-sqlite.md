# La sesión de SQLite edita por el alias del rowid, conserva la clase de almacenamiento y espera por archivo

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/motores/sesionSqlite.ts`

## Contexto

SQLite tiene solo el esquema `main` (sin ATTACH), bloquea el archivo entero y guarda cada valor
con su clase de almacenamiento. Un CREATE TRIGGER que no compila falla en el acto: no hay
errores de compilación que leer (`sqlErroresCompilacion` es null).

## Decisión

- Una consulta (`pragma_table_list` × `pragma_table_xinfo`) da las marcas de la tabla: si es
  una sombra de una virtual o `sqlite_*` (`interna`, no se edita), si es WITHOUT ROWID y el
  ALIAS del rowid: el primero de `rowid`, `_rowid_`, `oid` que no tape una columna (una tabla
  con las tres columnas las tapa todas; en una WITHOUT ROWID o una vista dan «no such column»).
  Con PK, identidad 'pk'; sin PK, 'rowid' solo si el alias es `rowid` (el DML escribe `ROWID`).
- Las columnas generadas y las declaradas BLOB no se escriben. La clave binaria viaja como BLOB
  (`BindValorSqlite` 'blob'; un texto hexadecimal no casa) y se compara con `unhex(?n)`.
- Clase de almacenamiento: el texto viaja como texto y la afinidad lo convierte sin pérdida
  (`'11'`, `'11.0'`, `'0011'` en una INTEGER guardan 11). En una columna SIN afinidad un 42
  entero editado a `'43'` quedaba como TEXTO y `WHERE c = 43` dejaba de encontrarlo: ahí un
  entero canónico va como entero y un real en su forma, como real. Límite: un texto `'42'` en
  una columna sin tipo pasaría a entero.
- Concurrencia optimista con identidad 'rowid' (un rowid se reutiliza tras borrar la fila más
  alta y VACUUM puede renumerarlo): se compara `c = ?n` solo donde la afinidad convierte el
  texto al valor guardado (numérica, texto); sin afinidad o BLOB no se compara.
- «Enviar» espera por el `busy_timeout` de la conexión (`PRAGMA busy_timeout` como primera
  sentencia; al vencer, SQLITE_BUSY). Una consola con cambios pendientes bloquea siempre; una
  que solo leyó, solo en modo rollback (`lectorBloquea`, por la cabecera del archivo): medido
  con dos procesos, en rollback el COMMIT espera 3 s y falla; en WAL entra en 6 ms.
- Explain: `EXPLAIN QUERY PLAN` con el perfil `explain` del autorizador, también en solo
  lectura; un error no aborta la transacción.

## Consecuencias

`unhex` exige SQLite 3.41+ (Electron 43 trae 3.53).
