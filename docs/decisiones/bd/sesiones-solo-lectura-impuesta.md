# La solo lectura del explorador es la que se le impone, no la casilla de la conexión

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/soloLecturaImpuesta.ts` y quien la inyecta (gestores y controlador),
  `src/main/db/explorador/lecturaSegura.ts`

## Contexto

La casilla «Solo lectura» de una conexión (`DbConnection.readonly`) existe para que los agentes,
que consultan por `tdb`, no editen ni borren. Leída también por el explorador limitaba al humano
con una casilla pensada para el agente.

## Decisión

- En el explorador la casilla no limita al usuario: edita, inserta, borra, confirma y abre
  SQLite en lectura-escritura. `tdb` y su guardia la siguen leyendo igual.
- La maquinaria de solo lectura del explorador (guardia, candado por sentencia, Auto forzado,
  trabajador en solo lectura) NO se borra: queda detrás de UNA función inyectada que en el
  producto no impone ninguna (`sinSoloLecturaImpuesta`).
- La inyectan las pruebas contra una base real, que no puede recibir ninguna escritura
  (`soloLecturaEnTodas`: es su PRIMER candado), y las pruebas que fijan esa maquinaria
  (`(c) => c.readonly`). Esas pruebas llevan un SEGUNDO candado que no es del producto
  (`vetarPeticion`, en `lecturaSegura.ts`): mira cada mensaje antes de que salga hacia el
  trabajador y exige la solo lectura impuesta por su cuenta, así que si alguien quitara la
  inyección la prueba falla en vez de escribir. Es una lista blanca (SELECT y WITH sin
  `WITH FUNCTION/PROCEDURE`, sin `FOR UPDATE` ni `DBMS_LOCK`; las sentencias de usuario, con el
  candado de solo lectura; excepciones por igualdad exacta con lo que genera el producto: «Ver
  DDL», el cambio de esquema y el `EXPLAIN PLAN`, sin autocommit para revertir sus filas). La
  contraseña de esas pruebas se tapa en todo lo que imprimen, también su forma escapada en JSON.
- Se mantiene para el humano lo que no es la casilla: la confirmación de producción, la de los
  comandos peligrosos de Redis y los topes técnicos.

## Consecuencias

- Cada lectura del explorador pregunta a la función de forma explícita: el compilador obliga a
  decidir en cada sitio.

## Descartes

- Pasar al explorador una COPIA de la conexión con `readonly` cambiado: el explorador devuelve
  cosas al registro (verificada, introspección, esquemas) y la copia acabaría pisando la casilla
  de los agentes. Copiar la conexión entera arrastraría además `secretEnc` y una selección de
  esquemas «Todos» que multiplica el índice.
- Una lista negra (UPDATE, DELETE, MERGE…) en el veto de las pruebas: se escapa lo no previsto
  (un CALL, un LOCK TABLE, un bloque anónimo).
