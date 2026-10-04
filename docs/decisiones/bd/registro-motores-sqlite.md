# El descriptor de SQLite: un archivo, un proceso por consola y nunca un cursor vivo

- **Estado:** vigente
- **Ámbito:** `src/shared/motores/sqlite.ts`, `src/tdb/sqliteComun.cjs`

## Contexto

Es el primer motor de archivo (`node:sqlite` del Node de Electron): sin servidor, puerto, usuario ni
contraseña. La conexión es un archivo cuya ruta guarda y resuelve el main; el renderer solo ve su
nombre (`archivoVisible`).

## Decisión

- Se puede escribir como en los demás motores; «Montar como base de datos» crea la conexión de solo
  lectura. `ATTACH`/`DETACH`, `load_extension`, `VACUUM INTO` y los `PRAGMA` peligrosos van siempre
  cerrados (autorizador en toda conexión y `limits.attach = 0`): una conexión es un archivo con su
  esquema `main`.
- Un proceso por consola (`procesoPorSesion`): `node:sqlite` no se interrumpe y Detener mata el proceso.
- `puertoPorDefecto: null` y `credenciales: 'ninguna'`; `obligatorios` lleva `'archivo'` y de ahí salen
  `forma` y `deArchivo`. `extensionesArchivo` solo filtra el diálogo; decide la cabecera del archivo.
- Paginado `keyset` por rowid o PK en la pestaña de tabla sin `ORDER BY` (1 ms frente a 9 s de un
  `OFFSET` de 1,5 M, medido) y `limitOffset` con `ORDER BY` y en vistas. Nunca cursores vivos
  (`lectorPorId` y `mantenerCursor` a `false`): en modo rollback un cursor abierto bloquea las
  escrituras de la aplicación dueña del archivo. Sin `ORDER BY`, `paginasInestablesSinOrden: true`.
- `candadoSoloLectura: 'autorizador'`: no hay `SET TRANSACTION READ ONLY`; el autorizador impone el
  perfil de lectura sobre una conexión `readOnly`.
- `identidadSinPk: 'rowid'`; qué columnas se comparan con lo leído lo decide la afinidad del tipo
  declarado (`comparacionOriginalSqlite`, compartida por la sesión del main y la rejilla).
- Carpetas: Tablas, Vistas y Virtuales. Índices y disparadores cuelgan de cada tabla. Las tablas de
  sombra de fts5/rtree y las `sqlite_*` las atenúa el catálogo del main.
- Inertes, escritos para no dejar el campo sin decidir: `esquemaImplicito: 'main'`,
  `fijarEsquemaValida: true`, `esquemaTransaccional: false`, `salidaServidorSiempre: true` y
  `explainPideValores: false` (un parámetro sin valor se enlaza a NULL; el plan no depende de él).

## Consecuencias

El formateador usa el dialecto `sqlite` de sql-formatter con sus `paramTypes` de serie (`?`, `?NNN`,
`:x`, `@x`, `$x`). Ver [motores-sesion-sqlite.md](motores-sesion-sqlite.md).
