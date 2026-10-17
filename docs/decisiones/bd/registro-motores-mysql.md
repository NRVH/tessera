# MySQL y MariaDB son UN motor: la base es el esquema, mysql2 en JavaScript y el léxico con el modo SQL que fija Tessera

- **Estado:** vigente
- **Ámbito:** `src/shared/motores/mysql.ts`, `REGLAS.mysql` de `src/shared/sql/dialectosSql.ts`,
  `clasificarSqlMysql.ts`, `src/shared/escrituraSql/mysql.ts`, `src/tdb/motores.cjs`

## Contexto

MySQL (8.0 y posteriores) y MariaDB (10.4 y posteriores) hablan el mismo protocolo, se leen con el mismo
`information_schema`, comparten puerto, cliente y casi toda la gramática. Sus diferencias (el JSON de
MariaDB es un LONGTEXT, MariaDB escribe `int(11)`, `max_statement_time` frente a `max_execution_time`,
el nombre del privilegio para ver rutinas) son de versión del servidor, no de forma de conexión.

## Decisión

- **Un solo motor `mysql`, con la etiqueta «MySQL / MariaDB»**. El usuario no siempre sabe cuál
  tiene detrás (un servicio gestionado, un proxy), y dos entradas obligarían a elegir bien para
  luego hacer lo mismo: el registro, `REGLAS`, `MOTORES_EXPLORADOR` y `ESCRITURA_SQL` tendrían dos
  filas iguales. Lo que cambia se decide en ejecución por `VERSION()` (`esMariaDb` de
  `src/tdb/mysqlComun.cjs`). La URI admite `mysql://` y `mariadb://`.
- **La base ES el esquema** (`nivelBases: 'ninguno'`): el árbol pone las bases donde los demás
  motores ponen los esquemas, con su «N de M», y el selector de la consola hace `USE`. Un nivel
  «Bases» encima de los esquemas sería un nivel vacío. La base de la conexión es opcional: sin
  ella, la de por defecto es la primera que el usuario ve fuera de las del sistema.
- **Driver `mysql2`** (MIT, JavaScript puro): va en `dependencies` y lo carga `tdb` con el Node de
  Electron (`ELECTRON_RUN_AS_NODE`) sin nada nativo que recompilar ni descargar; no hay
  DriverManager. Se fija la versión exacta, como tedious e ioredis.
- **Todo por el protocolo de TEXTO**: los `?` se sustituyen por sus literales en el trabajador
  (fuera de cadenas, nombres y comentarios), porque el protocolo binario de las sentencias
  preparadas da los FLOAT como `float32` y no permite el `typeCast` que deja cada valor exacto.
  El marcador que genera Tessera es `?` a secas (`interrogacionSola`), uno por valor y en orden;
  los parámetros del usuario son `?` numerados por su orden de aparición (`interrogacion`).
- **El léxico tiene SUS reglas** (banderas de `REGLAS.mysql`): `"x"` es una cadena, la barra escapa
  dentro de las cadenas, `#` y `-- ` (con blanco) comentan, `/*!…*/` se EJECUTA, los cuerpos
  `BEGIN … END` de rutinas, disparadores y eventos no se parten por sus `;`, y `DELIMITER x` es una
  línea de cliente que cambia el terminador. Para que el texto signifique lo mismo para el léxico y
  para el servidor, el trabajador quita de la sesión `ANSI_QUOTES` y `NO_BACKSLASH_ESCAPES`, y
  `SET sql_mode`/`SET NAMES` se rechazan en todos los modos (`formatosFijados`), como el
  `standard_conforming_strings` de PostgreSQL.
- **Los nombres van entre acentos graves**: `citar(n, 'mysql')`, y el SQL que genera Tessera para la
  rejilla, el filtro y el valor de una celda cita con `citarGenerado`, que deja intactos los demás
  motores.
- **Solo lectura del servidor** (`candadoSoloLectura: 'envoltorioRollback'`): ver
  [adaptador-mysql-solo-lectura.md](adaptador-mysql-solo-lectura.md).
- Paginado `limitOffset` sin cursores vivos; Detener es `KILL QUERY` desde otra conexión; identidad
  sin PK por un índice único con todas sus columnas NOT NULL; carpetas Tablas, Vistas, Rutinas,
  Disparadores y Eventos (un tipo de objeto nuevo, `evento`).

## Descartes

- Dos entradas del registro (`mysql`, `mariadb`) con una implementación compartida: ver arriba.
- Sentencias preparadas (`execute`): los valores no salen exactos y no todas las sentencias se
  pueden preparar.
- `SET sql_mode` permitido y re-saneado después: entre la sentencia y el saneado, otra consola de
  la misma sesión leería el texto con otro léxico; y una conexión de solo lectura podría quitarse
  así la guardia. Quien necesita otro modo para una carga lo pide en la sentencia (CAST, IGNORE).
- Las secuencias de MariaDB como carpeta: MySQL no las tiene y no se enseña una carpeta siempre vacía.
- Autenticaciones fuera de usuario y contraseña (LDAP, Kerberos, IAM, X.509), formularios para crear
  objetos, diagramas, comparar esquemas y paneles de monitorización: fuera del alcance del motor.
