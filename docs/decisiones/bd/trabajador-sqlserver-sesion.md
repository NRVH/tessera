# La sesión SQL Server lee todos los conjuntos en flujo, revierte cada sentencia de solo lectura y corta con attention

- **Estado:** vigente
- **Ámbito:** `src/tdb/sesionSqlserver.cjs` y `peticionesSesionSqlserver`, `conjuntosSesionSqlserver`

## Contexto

El servidor no tiene candado de solo lectura (`readOnlyIntent` acepta un INSERT en un servidor suelto,
medido) y un lote puede devolver varios conjuntos. Lado del main en `motores-sesion-sqlserver.md`.

## Decisión

- Sin parámetros, `execSqlBatch`; con ellos, `execSql` (sp_executesql). El lote conserva las #temp, los SET
  y el USE de la consola (dentro de sp_executesql una #temp muere al salir). Los parámetros solo los manda
  Tessera y van como `@p1…`: un número como entero (el OFFSET de la rejilla lo exige) y el texto como nvarchar.
- Todos los conjuntos: el primero es el resultado y los demás van en `siguientes`. Las AFECTADAS salen del token
  DONE de la SENTENCIA, no del `rowCount` del callback, que SUMA las del disparador. Por RPC vale la ÚLTIMA
  cuenta. Una cuenta sin columnas solo es una escritura si su `curCmd` no es el de SELECT: la asignación de una
  variable (`DECLARE @x int = 5`) llega como un SELECT.
- El corte de `maxFilas`: con `cortarAlLlenar` (consulta pura) y SIN transacción abierta antes, la fila
  `maxFilas + 1` corta con `cancel()` (attention: la conexión queda libre en 11-23 ms). Si no, se DESCARTAN las
  filas que sobran: un attention corta el LOTE entero y con XACT_ABORT ON REVIERTE la transacción del usuario.
- Estado de la transacción: `connection.inTransaction` y, para distinguir 'pendiente' de 'abierta', la DMV solo
  si hay VIEW SERVER STATE (`HAS_PERMS_BY_NAME`, mirado al abrir): una sonda que fallara por permisos, con
  XACT_ABORT ON, revertiría la del usuario. Sin el permiso se deduce; equivocarse hacia 'pendiente' cuesta un diálogo.
- Manual = `SET IMPLICIT_TRANSACTIONS ON`, perezoso y quitado para lo que el main marca `sinBegin`: con él puesto,
  un BEGIN TRAN deja @@TRANCOUNT en 2 y una sonda abre ELLA MISMA una transacción.
- Solo lectura: el clasificador del main y, por si algo se le escapa, `BEGIN TRAN; ` en la MISMA línea (el número
  de línea de un error no se mueve) + `\nIF @@TRANCOUNT > 0 ROLLBACK`, con un ROLLBACK de repuesto. Lo que no se
  deshace: una secuencia o un IDENTITY consumidos, un servidor vinculado, xp_ y CLR. La garantía de verdad es un
  usuario con `db_datareader`.
- El tope de celda lo corta el SERVIDOR con `SET TEXTSIZE` (tope × 2 + 2), ajustado antes si el tope cambió.
- Stop = `connection.cancel()`. «Leer sin esperar» = READ UNCOMMITTED solo para esa sentencia.
