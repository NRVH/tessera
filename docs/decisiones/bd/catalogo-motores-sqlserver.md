# El catálogo de SQL Server lee cualquier base con nombres de tres partes, sin USE y sin STRING_AGG

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/motores/catalogoSqlserver.ts`, `sqlSqlserver.ts`, `mapeoSqlserver.ts`, `verDdlSqlserver.ts`, `nombresSqlserver.ts`

## Contexto

El nivel «Bases» lista las bases de la conexión y la sesión `meta` tiene que servirlas todas. Las
funciones de metadatos (`SCHEMA_NAME()`, `OBJECT_NAME()`, `OBJECT_DEFINITION()`) resuelven en la
base de la SESIÓN, no en la del nombre de tres partes. El catálogo, la sesión y el DDL escriben
nombres y no pueden importarse entre sí (regla de los ciclos).

## Decisión

- Los nombres de objeto van por bind (`@p1`; `sp_executesql` como nvarchar). La base no puede
  (no es un valor): va citada como prefijo de tres partes (`[base].sys.objects`) cuando
  `DialectoCatalogo.base` existe. Medido: 16 ms desde master contra otra base, sin `USE` (que
  dejaría la sesión en otra base).
- Los nombres se citan con corchetes y `]` se dobla (`[a]]b]`): con QUOTED_IDENTIFIER ON valdrían
  comillas, pero un DDL copiado a otro cliente debe leerse igual. Vive en la hoja
  `nombresSqlserver.ts`, que no importa nada del explorador.
- Todo va con JOIN a `sys.*` de la base, no con las funciones de metadatos; el tipo de una columna
  se compone sobre `sys.columns`, `sys.types` y `sys.schemas` (LEFT JOIN).
- Sin `STRING_AGG` (es de 2017; el mínimo es 2012): una fila por columna, agrupadas en el mapeo.
- Las bases son las de `sys.databases` con `HAS_DBACCESS` y ONLINE (una sin acceso da el 916).
- La fuente sale de `sys.sql_modules` (NULL sin VIEW DEFINITION o WITH ENCRYPTION: `aviso`).

## Consecuencias

- Las reglas del tipo son las de `tipoMotorSqlServer` en `src/tdb/sqlserverComun.cjs`: cambiar
  una obliga a cambiar la otra.
- Un usuario con solo `db_datareader` no ve procedimientos ni funciones escalares: el árbol vacío
  no es un error.
