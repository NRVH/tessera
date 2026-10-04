# El contexto del autocompletado sale de una pila de niveles sobre el léxico compartido, no de un parser

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/autocompletado/contextoSql.ts`, `clausulasSql.ts`, `referenciasSql.ts`, `tokensSql.ts`, `estrellaSql.ts`

## Contexto

Qué cabe en el cursor (palabras clave, objetos, columnas, miembros de `X.`) en una sentencia a medio
escribir. La palabra anterior miente con paréntesis: en `select count(¦` manda la lista del SELECT,
`extract(year from ¦` tiene un FROM sin tablas y en `where x in (select ¦` manda el de dentro.

## Decisión

- Se trabaja sobre los tokens de `shared/sql/lexicoSql.ts`, el mismo léxico que parte, clasifica y
  avisa: una cadena, un comentario, un q-quote o un `$tag$` son lo mismo para todos.
- Cada `(` abre un nivel clasificado por lo que lo precede: grupo o subconsulta (sus cláusulas
  cuentan), llamada a función (sus FROM no son cláusulas; dentro, columnas), lista de columnas de
  `INSERT INTO t (`/`REFERENCES t (`, o definición de `CREATE TABLE t (`.
- `referencias` lee TODA la sentencia, también lo que va tras el cursor (`select e.¦` se escribe
  antes que su `from emp e`), en todos los niveles; excluye los CTE y la tabla ficticia del
  dialecto (`DUAL`).
- Se parte por `;`, `/` y `GO` dentro de la sentencia: un bloque PL/SQL es una sentencia para el
  divisor pero dentro hay varias, y un alias de otro lote no debe resolver.
- `texto` es opcional: da la caja del prefijo y el plegado exacto de PG (solo baja el ASCII). El
  cursor va en las coordenadas de los tokens, y `contextoEnTexto` estira el rango de la sentencia
  hasta el cursor (el divisor deja fuera los comentarios finales).
- Tres partes (`base.esquema.t`) solo con nivel «Bases». Reglas y reservadas, por el acceso que
  valida (`reglasDeMotor`, `dialectoDeMotor`): fuera del registro da «Motor desconocido».

## Consecuencias

- Mirar solo la palabra anterior, o no leer tras el cursor, rompe los casos de arriba.

## Descartes

- Un parser SQL por motor: la gramática la valida el servidor, y un parser fallaría justo en lo
  que se está escribiendo.
- El `wordPattern` y el Monarch de Monaco: no saben de q-quote ni de `$tag$`.
- Sugerir dentro de un citado sin cerrar (`"Mi¦`): duplicaría comillas. Un contexto `rutinas`
  aparte: son `objetos` con `tipos` invocables.
