# Los fragmentos WHERE y ORDER BY del usuario se validan con el léxico y se insertan en líneas propias

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/sqlRejilla*.ts`, `filtroSql.ts`

## Contexto

La pestaña de tabla deja escribir un WHERE y un ORDER BY a mano. Sin validar,
`true); COMMIT; SET default_transaction_read_only=off; DELETE FROM t; SELECT (1` en el WHERE
cerraba el paréntesis de Tessera y encadenaba sentencias en una conexión de solo lectura.

## Decisión

- La forma es `SELECT * FROM "E"."O"\nWHERE (\n<where>\n)\nORDER BY <orderBy>`. Los
  identificadores van siempre citados, exactos como los devuelve el catálogo.
- Cada fragmento va en SU PROPIA LÍNEA y todo lo que se añade tras el ORDER BY empieza con `\n`:
  un `--` del usuario acaba en el salto y no se come el `)` ni el `LIMIT`.
- Cada fragmento se tokeniza con el léxico compartido con la consola (`lexicoSql.ts`) y se
  rechaza: `;` a cualquier profundidad, paréntesis desequilibrados, cadenas, comentarios,
  identificadores citados y `$tag$` sin cerrar, variables de enlace (en PG `$1`/`$2` apuntarían
  a los `LIMIT`/`OFFSET` de Tessera), metacomandos de psql (esconden un `;`) y `FOR` a
  profundidad 0 en el ORDER BY (FOR UPDATE bloquearía filas en la sesión de datos).
- Un fragmento solo de blancos o comentarios cuenta como vacío: no se emite la cláusula.
- `rangos` guarda dónde quedó cada fragmento, para devolver un error del servidor como `campo`
  + posición relativa al `<input>` (SQL Server solo da la línea: se toma el principio de ella).
- El filtro guiado y el orden de la cabecera son excluyentes con su texto libre (con los dos,
  error sin campo); sus parámetros van delante de los del paginado.

## Consecuencias

La segunda barrera no es de este módulo: en PG todo va con `queryMode: 'extended'`, que rechaza
varias sentencias. El léxico supone `standard_conforming_strings = on`; con `off` los dos
lexemas divergen y esa barrera es la que sostiene.

## Descartes

- Validar volviendo a partir el SQL compuesto con `dividirSentencias`: no ve el escape por
  paréntesis (`true) OR (1=1` sigue siendo una sentencia) y no da campo ni posición.
- Añadir la PK como desempate tras un ORDER BY del usuario: cambia el SQL que cree ejecutar.
