# El catálogo de PostgreSQL oculta las particiones y distingue las rutinas por su firma

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/motores/catalogoPostgres.ts`, `sqlPostgres.ts`, `mapeoPostgres.ts`, `verDdlPostgres.ts`

## Contexto

PG copia cada FK en cada partición de una tabla particionada, las rutinas pueden sobrecargarse
con el mismo nombre y las particiones aparecerían como tablas sueltas en el árbol.

## Decisión

- Binds posicionales (`$1`, `$2`), arrays incluidos (`$2::text[]`); los nombres siempre por bind.
- Las particiones no salen en el árbol ni en el índice de nombres (`NOT c.relispartition`): se
  ven una vez, en la tabla particionada. Las FK, por lo mismo, con `conparentid = 0`.
- Una rutina se identifica por nombre Y firma (`pg_get_function_identity_arguments`).
- La PK viene en la consulta de columnas (`array_position(pk.conkey, …)`, `pkEnColumnas: true`):
  el detalle no hace una consulta aparte.
- Las FK son UNA consulta con las columnas en arrays; no hay segunda tanda.
- Lo que PG no tiene (sinónimos, tipos declarados, tipo de un objeto por nombre) lanza con el
  mensaje de siempre; el controlador no lo pide (lo decide antes con el descriptor).
- Cada consulta de varias (FK, «Ver DDL») pasa por `lector.construir`: un fallo al construirla
  llega con su motivo y no como «Error interno».
- **Disparadores:** hay carpeta `disparador` (como en Oracle): cada uno cuelga del esquema de su
  tabla y enseña «sobre <tabla>» y su estado, se abre en la pestaña de fuente y tiene «Ver DDL». El
  nombre de un disparador solo es único dentro de su tabla, así que la tabla viaja también en
  `firma` (que ya distingue las sobrecargas de una rutina) y la fuente se pide por esquema, nombre
  y tabla. La fuente trae el `CREATE TRIGGER` y la función que ejecuta; el DDL las pone en orden de
  ejecución (función, después disparador). Quedan fuera los internos (`tgisinternal`: los de las
  claves foráneas) y los clonados en particiones. La fila del árbol no repite la tabla como «(firma)».

## Consecuencias

Quitar `conparentid = 0` duplica cada FK por partición en el diagrama y en el autocompletado
de JOIN. El módulo no importa `./index.ts` ni `../catalogoSql.ts` (ciclos, ver `tipos.ts`).

## Descartes

- Un campo `tabla` en `DbRefObjeto` para los disparadores: toca el contrato, las claves de caché y
  las pestañas por un caso que la firma ya resuelve.
