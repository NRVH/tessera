# El humo de solo lectura contra una base real lleva dos candados independientes

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/lecturaSegura.ts`, `test-db-oracle-lectura.mts`

## Contexto

El humo corre contra una base de desarrollo real y remota, y no se puede ejecutar desde la máquina
donde se escribe: lo lanza el usuario y lo que falle allí cuesta un viaje de ida y vuelta. Todo lo que decide
sin red vive en `lecturaSegura.ts` y lo fija `test-lectura-segura.mts`.

## Decisión

- Candado 1: el humo construye el explorador con la solo lectura impuesta en todas las conexiones
  (`soloLecturaEnTodas`). La casilla `readonly` de la conexión es solo de los agentes; la copia sigue saliendo
  con `readonly: true` y el humo lo comprueba, pero ya no es lo que protege.
- Candado 2, que no es del producto: `vetarPeticion` mira cada mensaje antes de que salga hacia el trabajador.
  Existe porque se prueba justo el producto: si el primer candado fallara, el humo sería la vía por la que una
  escritura llegaría a esa base real. Un veto es un FAIL del humo.
- Lista blanca, no negra: SELECT y WITH sin `WITH FUNCTION/PROCEDURE`, sin `FOR UPDATE` ni `DBMS_LOCK`; las
  sentencias de usuario, con el candado RO. Excepciones por igualdad exacta con lo que genera el producto: el
  bloque de «Ver DDL», el cambio de esquema y el `EXPLAIN PLAN` (sin autocommit, para revertir sus filas).
- La contraseña sale del puente como en `tdb`, se usa solo contra la entrada para la que se emitió (su huella)
  y se tapa en todo lo que el humo imprime, también su forma escapada en JSON; por debajo de 4 caracteres no.

## Descartes

- Copiar la conexión entera y cambiar `readonly`: arrastra `secretEnc` y una selección de esquemas «Todos» que
  multiplica el índice medido. Se copia campo a campo.
- Una lista negra (UPDATE, DELETE, MERGE…): se escapa lo no previsto (un CALL, un LOCK TABLE, un bloque anónimo).
- Usar la primera tabla del listado en la pestaña de datos: en una base real puede tener cien millones de
  filas y Contar es un `COUNT(*)`. Se prefiere una de tamaño moderado según las estadísticas del diccionario.
