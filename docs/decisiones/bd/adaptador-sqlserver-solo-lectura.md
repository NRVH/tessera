# En SQL Server el solo lectura lo impone Tessera con tres capas, y el tope de filas cancela la petición

- **Estado:** vigente
- **Ámbito:** `src/tdb/sqlserver.cjs` y sus piezas `lexicoSqlserver`, `guardiaSqlserver`,
  `peticionSqlserver`, `catalogoSqlserver`

## Contexto

SQL Server no tiene un candado de sesión: `readOnlyIntent` en un servidor suelto ACEPTA el INSERT. El
prefijo del texto no basta: `SELECT 1\nDELETE FROM t`, sin `;`, se ejecuta ENTERO, y en T-SQL un nombre
suelto al principio de un lote EJECUTA ese procedimiento sin EXEC. El servidor corta los números donde
termina su literal: `SELECT 1DELETE FROM t` es `1` y `DELETE`. GO no es T-SQL, sino el separador de los
clientes de SQL Server.

## Decisión

- Tres capas, siempre: (1) cada lote empieza por SELECT o WITH (se admite `;WITH`); (2) un léxico propio de
  T-SQL (comentarios anidados, cadenas, [corchetes], @variables, #temporales, dinero, números cortados como
  el servidor) rechaza en todo el texto lo que escribe o ejecuta, cualquier transacción, los SET fuera de los
  de `REGLAS.sqlserver.sesionSoloLectura`, `NEXT VALUE FOR`, OPENQUERY/OPENROWSET y los bloqueos para
  modificar: lista NEGRA, y por eso `send` como columna se rechaza (se escribe `[send]`); (3) cada lote va
  como `BEGIN TRAN; <lote>\nIF @@TRANCOUNT>0 ROLLBACK` con el prefijo en la misma línea, y si la transacción
  sigue abierta se manda otro ROLLBACK. La guardia se mira dos veces: antes de conectar y antes de enviar.
- Se parte por las líneas que solo dicen GO, fuera de cadenas y comentarios; cada lote va en su petición y
  las variables no cruzan un GO. `GO n` se RECHAZA con su mensaje.
- El tope de filas CANCELA (attention de TDS) y no envuelve en `SELECT TOP n`, que rompe los CTE, el ORDER
  BY y los lotes; lo que venía detrás NO se ejecuta y un aviso lo dice.
- Un error dice cuántas sentencias corrieron después de él (SQL Server sigue tras muchos errores) y, en una
  conexión de escritura, qué quedó confirmado. Una transacción que el texto deja abierta se revierte y se avisa.

## Consecuencias

- Lo que ninguna capa deshace: una secuencia o un IDENTITY que avanzó, un servidor vinculado, xp_cmdshell,
  CLR, sp_OA*. La garantía real es un usuario con solo `db_datareader`, y así lo dicen los textos del agente.
- El léxico es propio (`tdb` no puede cargar `clasificarSql.ts`): `test-sqlserver-tdb` lo cruza.

## Descartes

- Una lista BLANCA de palabras (el SELECT de T-SQL es enorme), permitir procedimientos de sistema que solo
  leen (pueden hacer COMMIT de la transacción de fuera) y rechazar GO (un script copiado lo trae).
