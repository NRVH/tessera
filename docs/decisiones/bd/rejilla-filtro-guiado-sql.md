# El filtro guiado se compila a SQL con parámetros y una forma distinta por motor

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/filtroSql.ts`, `filtroSqlValores.ts`, `sqlRejilla.ts`

## Contexto

El renderer manda la estructura del filtro (columna, operador, valor) y el main la convierte
en el WHERE de la rejilla. Un valor pegado en el texto es inyección esperando un descuido, y
en Oracle un literal de fecha o de número depende del NLS de la sesión.

## Decisión

- Los valores nunca van en el texto. Oracle los enlaza por nombre (`:f1`…, porque el ROWNUM
  de respaldo ya enlaza `:hasta`/`:desde` por nombre); los demás, posicionales numerados
  desde 1 (el paginado va detrás).
- «contiene» y «empieza por» no distinguen mayúsculas y usan `ESCAPE '!'` (no la barra
  invertida, que en PG depende de `standard_conforming_strings`). Se escapa `!`, `%`, `_` y,
  solo en SQL Server, `[`; en Oracle escapar un no comodín es ORA-01424. PG y SQL Server
  hacen CAST a texto (uuid, inet, xml, `text`/`ntext` no tienen LIKE).
- Números exactos: Oracle `TO_NUMBER` con modelo del mismo número de cifras y NLS explícito;
  PG `bigint` si cabe en int8 y `numeric` si no (sin tipo, `int = '12.5'` es un error);
  SQL Server `BIGINT` o `DECIMAL(38, s)` (más de 38 cifras, error antes de enviar).
- Fechas: un día sin hora es el día entero (`c >= d AND c < d+1`); el 9999-12-31 no tiene
  día siguiente. SQL Server escribe `YYYY-MM-DDTHH:MM:SS` (la `T` evita `SET DATEFORMAT`);
  SQLite compara texto con el día a secas.
- «=» y «≠» de texto en Oracle van como CHAR: un VARCHAR2 compara sin relleno y contra una
  columna CHAR(n) no casaba nunca.
- «Vacío» de texto es `IS NULL` en Oracle (allí `''` es NULL) y `IS NULL OR texto = ''` en el resto.
- Cada dialecto es un `switch` que cierra con `nunca`: uno nuevo no compila sin decidir.

## Consecuencias

El SQL y el orden de los parámetros son un contrato con `sqlRejilla.ts` y los cuatro motores
(`test-filtro-sql` y las pruebas contra servidor). El LOWER de SQLite solo pliega ASCII.

## Descartes

- Literales escapados en el texto; `CAST(:f AS NUMBER)` en Oracle (usa el NLS); ILIKE en todos
  (solo existe en PG); minúsculas en JS para el patrón (el servidor pliega con otras reglas: «ß»).
