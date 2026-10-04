# SQLite y SQL Server escriben una sentencia por línea, con las trampas de su cliente resueltas

- **Estado:** vigente
- **Ámbito:** `src/shared/escrituraSql/sqlite.ts`, `src/shared/escrituraSql/sqlserver.ts`

## Contexto

Como PostgreSQL, son cortos porque el cliente de línea (`sqlite3`, `sqlcmd`) lee las comillas: un
literal es una cadena y cada fila del guion, una sentencia de una línea. Lo de SQL Server está medido
contra un 2022 con el `sqlcmd` (ODBC) de la imagen oficial.

## Decisión

**SQLite**: números como numeral; binario `X'…'`; booleanos como 1 y 0 (`TRUE`/`FALSE` solo desde la
3.23); fechas como texto, que es como las guarda la aplicación; el REAL infinito como `9.0e+999` (lo que
escribe `.dump`), porque el texto `'Inf'` se guardaría como texto; un NUL fuera del literal como
`char(0)`, porque dentro el CLI cortaría la sentencia. Límite aceptado: la celda llega con el tipo
lógico de la columna declarada; en una columna sin tipo un 42 vuelve como texto, y con afinidad el viaje
de ida y vuelta es exacto (fijado con SQLite de verdad en `test-sql-sqlite`).

**SQL Server**:
- Texto como `N'…'`: sin la N lo que no cabe en la página de códigos se pierde. Los saltos van dentro del
  literal; `sqlcmd` respeta las comillas.
- `sqlcmd` sustituye `$(nombre)` en todas partes: un `$(` de un valor se parte en dos literales, y si lo
  lleva un nombre, el guion abre con un comentario que pide `sqlcmd -x`.
- El NUL va fuera del literal como `NCHAR(0)`. Si el texto pasa de 4000 caracteres el primer trozo va como
  `nvarchar(max)`: la concatenación de dos `nvarchar` que no son max se corta a 4000 en silencio.
- Binario `0x…` (`0x` a secas es el vacío); `bit` como 1 y 0; fechas con
  `CAST('…' AS date|datetime2|datetimeoffset)`, que leen igual con cualquier `DATEFORMAT` (`datetime` no);
  `datetime` y `smalldatetime` van como `datetime2`; una hora es texto.
- Un `GO` cada `FILAS_POR_LOTE` filas: cien mil `INSERT` en un lote se compilan de una vez.
- Los nombres se citan con corchetes: `sqlcmd` abre la sesión con `QUOTED_IDENTIFIER OFF` y `"x"` sería una
  cadena.
- Límites: una columna `IDENTITY` exige `SET IDENTITY_INSERT`, y una calculada o `rowversion` no se puede
  insertar; la celda no dice cuál es. El archivo va en UTF-8 (el `sqlcmd` de Windows lo lee con `-f 65001`,
  sin comprobar aquí).

## Descartes

- Vista previa de «Enviar» con otra forma: es la sentencia con su `;`, que T-SQL admite siempre.
