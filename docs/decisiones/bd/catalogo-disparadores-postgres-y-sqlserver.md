# Disparadores en el árbol de PostgreSQL y SQL Server

**Decisión.** Los dos motores tienen la carpeta `disparador` (como Oracle): cada disparador cuelga del
esquema de su tabla y enseña «sobre <tabla>» y su estado. Se abre en la pestaña de fuente y tiene «Ver DDL».

- **PostgreSQL.** El nombre de un disparador solo es único dentro de su tabla, así que la tabla viaja
  también en `firma` (que ya distingue las sobrecargas de una rutina) y la fuente se pide por esquema,
  nombre y tabla. La fuente trae el `CREATE TRIGGER` y la función que ejecuta; el DDL las pone en orden
  de ejecución (función, después disparador). Quedan fuera los internos (`tgisinternal`: los de las
  claves foráneas) y los clonados en particiones.
- **SQL Server.** El nombre es único en el esquema, sin `firma`. La definición sale de
  `sys.sql_modules`. Solo los de tabla (`parent_object_id <> 0`): los de DDL no cuelgan de una tabla.
  No entran en el índice de nombres del autocompletado.
- La fila del árbol no repite la tabla como «(firma)».

**Descartado.**
- Un campo `tabla` en `DbRefObjeto`: toca el contrato, las claves de caché y las pestañas por un caso
  que la firma ya resuelve.
- Parámetros de consola en SQL Server: en T-SQL `@x` es una variable del lote y no se puede saber
  cuál es un parámetro del usuario y cuál una variable declarada; el dialecto sigue sin pedirlos. La
  salida de `PRINT` y `RAISERROR` (clase ≤ 10) ya llega a la consola como la de `NOTICE`.
