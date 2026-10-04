# En T-SQL el clasificador mira la unidad entera, por tramos, y hereda el más peligroso

- **Estado:** vigente
- **Ámbito:** `src/shared/sql/clasificarSqlTramos.ts`, `clasificarSqlTsql.ts`

## Contexto

En Oracle y PG, dos sentencias pegadas sin `;` son una sentencia mal escrita que el servidor
rechaza. En SQL Server no: las ejecuta juntas (`sinSeparadorSeEjecutanJuntas`). Medido:
`SELECT 1⏎DELETE FROM t WHERE id=1` borró la fila. Mirar la primera palabra deja pasar la escritura.

## Decisión

- La unidad se parte en TRAMOS, uno por sentencia: una palabra reservada de `INICIO_TSQL` a
  profundidad 0 abre uno, salvo que continúe el actual (el SET de un UPDATE, el SELECT de un INSERT,
  las ramas de un MERGE, `ON DELETE SET NULL`, `OFFSET … FETCH`, los permisos hasta su TO…).
- Es sólido porque esas palabras son reservadas: sin corchetes no pueden ser un nombre. Las que no
  lo son (`ENABLE TRIGGER`, `SEND`, `THROW`…) solo parten tras la condición de un IF o un WHILE.
- La clase es la del tramo más peligroso: escribe si alguno escribe, el peligro más grave, los SET de
  todos (lista blanca y formatos fijados) y `noTransaccional` si alguno lo es.
- `OPENQUERY`/`OPENROWSET`/`OPENDATASOURCE` y `NEXT VALUE FOR` hacen la unidad `otra`.
- Un CREATE/ALTER de PROCEDURE, FUNCTION, TRIGGER o VIEW no se parte: su cuerpo no se ejecuta al
  crearlo. Los tramos neutros (DECLARE, SET @x, IF, PRINT…) son consulta sin filas.
- `masTrasLasFilas` avisa al main de que no corte con attention un conjunto con sentencias detrás.

## Consecuencias

Cada regla de continuación es una puerta: una palabra de escritura tomada por continuación deja de
contar como sentencia. Por eso cada una se ciñe al tramo donde es gramática y exige texto que
compile (un error de compilación aborta el lote sin ejecutar nada). Se equivoca hacia «escritura»:
es la barrera de solo lectura de SQL Server, que no tiene candado de servidor.

## Descartes

- «El primer SET del ALTER» como gramática: se tragaba el SET que el servidor sí ejecuta.
