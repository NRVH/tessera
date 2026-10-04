# El catálogo de SQLite sale de las funciones PRAGMA como tablas y solo enseña `main`

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/motores/catalogoSqlite.ts`

## Contexto

SQLite no tiene `information_schema`. Las funciones PRAGMA como tablas (`pragma_table_list`,
`pragma_table_xinfo`, `pragma_index_list`, `pragma_foreign_key_list`) y `sqlite_schema` son
lecturas para el autorizador (medido), así que corren con el perfil de lectura también en una
conexión de escritura y el catálogo no puede tocar la base.

## Decisión

- Un solo esquema, `main` (nada de ATTACH, que el trabajador cierra dos veces). `temp` no se
  enseña: sus tablas son de cada conexión y la de `meta` no es la de ninguna consola. El
  catálogo se lee de `sqlite_schema` a secas, sin calificar.
- Las tablas de sombra de una virtual (fts5, rtree) y las `sqlite_*` van con las tablas, con
  subtipo `sombra` o `sistema` para que el árbol las atenúe; `sinRowid` marca una WITHOUT ROWID.
- Columnas de `table_xinfo` y no de `table_info`: marca las generadas (hidden 2 virtual, 3
  stored), que la rejilla no deja escribir; las ocultas de una virtual (hidden 1) no se listan.
- Restricciones: la PK, las UNIQUE (índices de origen `u`) y las FK agrupadas por su id. Las
  CHECK no tienen PRAGMA: solo están en el texto del CREATE. SQLite no guarda el nombre de una
  FK: se enseña a qué tabla apunta.
- Una FK sin columnas de destino apunta a la PK de la tabla destino, resuelta en la misma
  consulta, con el nombre REAL de la tabla (SQLite compara los nombres sin caja).
- «Ver DDL» y la fuente de una vista son `sqlite_schema.sql`, el texto tal como se creó, con los
  índices y disparadores de la tabla detrás.
- `leeTiposDeclarados`: el trabajador sabe el tipo de una columna de tabla, no el de una
  expresión; la cabecera de la pestaña lo lee del catálogo.

## Consecuencias

Los binds son `?1`, `?2`… y una lista de esquemas viaja como JSON (`json_each(?1)`), porque
SQLite no tiene arrays. Sin sinónimos: esos métodos lanzan.
