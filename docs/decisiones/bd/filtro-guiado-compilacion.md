# El filtro guiado se compila en el main: a SQL con parámetros y una forma distinta por motor, o a texto en notación del shell con los valores escapados

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/filtroSql.ts`, `filtroSqlValores.ts`, `sqlRejilla.ts`,
  `src/main/db/explorador/documentos/filtroDocumentos.ts`

## Contexto

El renderer manda la estructura del filtro (columna, operador, valor; ver
[contratos-filtro-guiado.md](contratos-filtro-guiado.md)) y el main la convierte en el WHERE de la
rejilla o en el filtro de la colección. Un valor pegado en el texto es inyección esperando un
descuido, y en Oracle un literal de fecha o de número depende del NLS de la sesión. En documentos,
el trabajador ya interpreta los textos `filtro` y `orden` de la op `consultar` con
`@mongodb-js/shell-bson-parser`, sin evaluarlos.

## Decisión

### SQL

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
  columna CHAR(n) no casaría nunca.
- «Vacío» de texto es `IS NULL` en Oracle (allí `''` es NULL) y `IS NULL OR texto = ''` en el resto.
- Cada dialecto es un `switch` que cierra con `nunca`: uno nuevo no compila sin decidir.

### Documentos

- El filtro guiado se compila a `{ "$and": [ { "edad": { "$gt": 40 } }, … ] }` y el orden a
  `{ "a": 1, "b": -1 }`, y viajan por los mismos campos: ni campo nuevo en el protocolo, ni cambio en
  el trabajador. Los valores salen de `JSON.stringify` y los tipos BSON con constructores del shell
  (`ObjectId`, `ISODate`, `NumberDecimal`).
- **Texto:** «contiene» y «empieza por» son `$regex` con el valor escapado; «=» compara exacto.
  **Número:** entero seguro a pelo, entero mayor y decimales que no son la forma corta de un double
  como `NumberDecimal`; más de 34 cifras es un error, no un redondeo. **Fecha:** UTC; sin hora, el
  día entero. **`_id`:** con 24 hexadecimales, las dos formas (`ObjectId` y texto), porque existen
  `_id` guardados como texto. «≠» es `$ne`/`$nin`/`$not`, que ya incluyen documentos sin el campo.
- Un nombre de campo con `.` es una ruta; un segmento vacío, uno que empieza por `$` o un carácter
  nulo es un error de la condición (MongoDB leería el `$` como operador).
- **El orden:** un objeto de JavaScript pone las claves de nombre entero delante, y el parser
  devuelve un objeto, así que `{ "b": 1, "2": -1 }` ordenaría mal. Ese caso es un error con
  `campo: 'orden'`.
- Las condiciones llevan su rango en el texto compilado: un error del trabajador con posición se
  convierte en la condición culpable y pierde la posición.

## Consecuencias

El SQL y el orden de los parámetros son un contrato con `sqlRejilla.ts` y los cuatro motores
(`test-filtro-sql` y las pruebas contra servidor). El LOWER de SQLite solo pliega ASCII.

## Descartes

- Literales escapados en el texto; `CAST(:f AS NUMBER)` en Oracle (usa el NLS); ILIKE en todos
  (solo existe en PG); minúsculas en JS para el patrón (el servidor pliega con otras reglas: «ß»).
- Compilar a un objeto BSON en el main: el canal va en JSON y perdería los tipos.
- Escribir siempre `NumberDecimal`: un decimal no es igual a un double que no sea su valor binario.
