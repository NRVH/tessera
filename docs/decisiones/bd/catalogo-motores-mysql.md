# El catálogo de MySQL sale de `information_schema`, con las listas en JSON, y el DDL de `SHOW CREATE`

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/motores/{sqlMysql,mapeoMysql,verDdlMysql,catalogoMysql}.ts`

## Contexto

`information_schema` es común a MySQL 8 y a MariaDB 10.4+, pero los dos difieren en detalles: MariaDB
escribe el ancho de los enteros (`int(11)`), devuelve el `COLUMN_DEFAULT` como SQL (`NULL`, `'x'`) y
llama de otra forma al privilegio de ver el cuerpo de una rutina.

## Decisión

- Una sola versión de cada consulta para los dos servidores, con binds `?` y sin `JSON_ARRAYAGG`
  (no está en todas las versiones de MariaDB). Las listas de columnas de una restricción, un índice
  o una FK llegan como un array JSON hecho con `JSON_QUOTE` dentro de un `GROUP_CONCAT`: un nombre
  con comas no se confunde. El trabajador sube `group_concat_max_len` al abrir la sesión.
- Las bases del sistema (`information_schema`, `mysql`, `performance_schema`, `sys`) se atenúan;
  la de por defecto, sin base en la conexión, es la primera que el usuario ve fuera de ellas.
- Un procedimiento y una función pueden llamarse igual: la **firma** de una rutina es su lista de
  parámetros (los de una función, sin el modo), y la fuente y el «Ver DDL» la buscan por nombre Y
  firma. El nombre de un disparador es único en su base; su tabla va como firma, como en PG.
- **Fuente** (pestaña de fuente): reconstruida de `VIEWS`, `ROUTINES`, `TRIGGERS` y `EVENTS`.
  **«Ver DDL»**: el `SHOW CREATE …` del servidor, que es la sentencia exacta (con su `DEFINER`). Sin
  el privilegio para ver el cuerpo, el servidor devuelve la fila con la sentencia en NULL, y se dice
  «faltan privilegios», no un DDL vacío.
- Los eventos (`CREATE EVENT … ON SCHEDULE`) son una carpeta propia (`evento`), con su estado.
- Columnas: el tipo es el `COLUMN_TYPE` escrito; el «por defecto» de una generada es su expresión
  (`… STORED|VIRTUAL`), y el de una AUTO_INCREMENT, esa palabra.

## Descartes

- Leer el catálogo con los `SHOW …` de MySQL: no admiten binds y su forma cambia entre versiones.
- Un catálogo por servidor (uno de MySQL y otro de MariaDB): las diferencias se absorben en el mapeo.
