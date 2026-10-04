# La rejilla pagina por la forma que cada motor admite, sin FETCH en Oracle y con el ROWID sin alias

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/sqlRejilla.ts`, `motores/sesion*.ts`

## Contexto

Cada motor pagina de una manera, y una mala forma cambia lo que cuesta o lo que devuelve:
Oracle 11.2 no tiene `FETCH`/`OFFSET`; en SQLite, `OFFSET` de 1,5 M de filas costaba 9 s por
página (por clave, 1 ms); en SQL Server, saltar 900 000 filas costaba 97 ms con OFFSET/FETCH
frente a 1185 ms re-ejecutando.

## Decisión

- `cursor` (Oracle): el SELECT sin paginar, leído con `resultSet`. `rownum` (respaldo si el
  cursor se expulsó): ROWNUM anidado con el número de fila como última columna,
  `"__TESSERA_RN"`, citada y con prefijo: con `rn__` sin citar, una tabla con una columna
  `RN__` daba ORA-00918 (medido en 11.2 y 21c).
- `limitOffset` (PG), `offsetFetch` (SQL Server: el ORDER BY va siempre, `(SELECT NULL)` con
  la píldora de orden no estable) y `keyset` (SQLite: `WHERE clave > ?` sin OFFSET; la clave
  viaja como columnas ocultas `__TESSERA_CLAVE_i` y con su clase de almacenamiento).
- Orden estable: en PG sin ORDER BY se ordena por la PK, y sin PK `sinOrdenEstable`. En Oracle
  NO se añade orden por PK: el cursor lee una vez y el `rownum` debe casar con él.
- ROWID (editar sin PK): `"E"."O".*, ROWIDTOCHAR(ROWID) AS "__TESSERA_ROWID"` SIN alias de
  tabla; con alias, un WHERE del usuario como `EMP.SUELDO > 0` daría ORA-00904.
- Qué formas admite cada motor, sus enlaces y su ROWID salen del descriptor
  (`shared/motores/`), no de comparar el dialecto; los `switch` de las formas cierran con
  `nunca`.

## Consecuencias

Un motor nuevo no compila sin decidir su forma. El `*` de SQLite va a secas: su gramática no
admite `esquema.tabla.*`.
