# El Explain nunca ejecuta la sentencia y no estropea la transacción del usuario

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/planSql*.ts`, `motores/sesion*.ts` (`explicar`)

## Contexto

El usuario aceptó el Explain en conexiones de solo lectura con una condición: que no ejecute
nada. Y un error dentro de una transacción abierta puede tirar el trabajo pendiente.

## Decisión

- Oracle: `EXPLAIN PLAN SET STATEMENT_ID = '<id>' INTO PLAN_TABLE FOR <sentencia>`; los nodos
  se leen de PLAN_TABLE por ese id y el texto con `DBMS_XPLAN.DISPLAY`. El id va como LITERAL
  (STATEMENT_ID no admite bind), por eso su forma es cerrada (`TESSERA_[A-Z0-9_]`, 30
  caracteres) y `extraerExplicarOracle` es la inversa exacta de `sqlExplicarOracle`: el
  centinela del smoke de solo lectura deja pasar ESE texto y ningún parecido.
- PG: `EXPLAIN (FORMAT JSON)` sin ANALYZE (ANALYZE ejecuta). El texto se genera desde el JSON
  (aproximación del formato TEXT de `explain.c`), sin pedir `FORMAT TEXT`, que duplicaba la
  planificación y con binds podía dar otro plan.
- SQLite: `EXPLAIN QUERY PLAN` con el perfil `explain` del autorizador. SQL Server:
  `SET SHOWPLAN_XML ON` en su propio lote (comparte lote: error 1067), la sentencia y `OFF`;
  compila sin ejecutar, y el árbol se lee de los `RelOp` sin un parser de XML.
- La posición del error se devuelve relativa a la sentencia (se resta el prefijo, ASCII). Solo
  vale para el error del propio EXPLAIN: lo que falla después trae el offset de SU texto y va
  sin posición.
- Transacción del usuario: en Oracle un error solo revierte la sentencia (un SAVEPOINT se
  descartó: deja `transactionInProgress`). En PG un error aborta la transacción entera
  (25P02), así que CON transacción abierta el EXPLAIN va entre SAVEPOINT y RELEASE, con
  ROLLBACK TO si falla; SIN ella no se pone (25P01).

## Consecuencias

«No ejecuta la sentencia» no es «no ejecuta nada»: el planificador de PG evalúa funciones
IMMUTABLE con argumentos constantes; en solo lectura lo para el envoltorio BEGIN READ ONLY.

## Descartes

- `SHOWPLAN_ALL` (obsoleto desde 2008), `FORMAT XML`/`YAML`, leer V$SQL_PLAN tras ejecutar.
- SAVEPOINT en todas las sentencias de la consola: cambia una semántica documentada de PG.
