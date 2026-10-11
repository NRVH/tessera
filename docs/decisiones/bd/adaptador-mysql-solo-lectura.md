# En MySQL el agente solo lee: el servidor en READ ONLY, una sentencia por orden y lo que el prefijo no ve, rechazado

- **Estado:** vigente
- **Ámbito:** `src/tdb/mysql.cjs`, `src/tdb/catalogoMysql.cjs`

## Contexto

MySQL tiene candado de servidor: una transacción READ ONLY rechaza toda escritura (1792), también las
tablas temporales y el DDL. Pero la característica se puede cambiar desde la propia sesión, un DDL
confirma y cierra la transacción antes de ejecutarse, y hay escrituras que no son de tablas: un archivo
en el servidor (`INTO OUTFILE`) o lo que vaya dentro de un comentario ejecutable (`/*!…*/`).

## Decisión

- Cuatro capas, de fuera adentro: (1) la guardia por PREFIJO de `tdb.cjs` (`guardiaPorPrefijo`:
  SELECT, WITH, SHOW, DESC, DESCRIBE, EXPLAIN), que deja fuera SET, CALL, USE y todo lo demás;
  (2) el adaptador rechaza un comentario ejecutable o `INTO OUTFILE|DUMPFILE` en cualquier parte del
  texto (un falso positivo se arregla reescribiendo la consulta); (3) la sesión entera en `READ
  ONLY`, que es la que rechaza el DDL tras su confirmación implícita; (4) cada consulta dentro de
  `START TRANSACTION READ ONLY … ROLLBACK`.
- Una sentencia por orden (`multipleStatements: false`): `SELECT 1; DELETE …` falla en el servidor.
- El tope de filas: en solo lectura se CORTA la conexión al pasarlo (no hay nada que perder); con
  escritura se leen y descartan las que sobran, para que la sentencia termine entera. Se dice.
- Tope de tiempo de 60 s del servidor (`max_execution_time` en MySQL, `max_statement_time` en MariaDB).
- `schema` sin base fija enseña las tablas de todas las bases que el usuario ve, como `base.tabla`,
  que es también lo que acepta `describe`.
- La garantía de verdad sigue siendo un usuario con solo SELECT, y así lo dicen el diálogo y el aviso
  del agente.
