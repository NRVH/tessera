# El catálogo de Oracle sirve a la 11.2 por VPN: sin FETCH, binds con nombre y FKs en tres consultas

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/motores/catalogoOracle.ts`, `sqlOracle.ts`, `sqlObjetosOracle.ts`, `fksOracle.ts`, `mapeoOracle.ts`

## Contexto

Las bases heredadas que se leen por VPN son Oracle 11.2: sin `FETCH FIRST` ni `OFFSET` y sin
`oracle_maintained` en `all_users` (llega en la 12.1). Allí la consulta única de FKs (las de la
tabla OR las que apuntan a su PK/UNIQUE) tardaba 2,6-2,9 s; con un diccionario grande en Docker
(142 000 restricciones, 19 000 FK) 44-45 s, y más de 5 min con estadísticas de los X$.

## Decisión

- Todo el SQL lleva binds con nombre (`:esq`, `:obj`, `:k0`…); nada de `FETCH FIRST` ni `OFFSET`
  (`test-catalogo-motores` lo comprueba). Las listas se trocean por ORA-01795 y lejos del tope de
  1000 binds (`MAX_ELEMENTOS_LISTA_IN`, `CLAVES_POR_CONSULTA`, `RESTRICCIONES_POR_CONSULTA`).
- Esquemas del sistema: `oracle_maintained` desde la 12.1; en la 11.2, `esEsquemaSistemaOracle`.
- Los sinónimos se listan por `ALL_OBJECTS`; `ALL_SYNONYMS` solo resuelve UNO (en 11g filtra por
  privilegio sobre el destino y es lentísima).
- El driver no sabe la unidad de una VARCHAR2 (`byteSize` son bytes en thick y un número sin
  unidad en thin): la cabecera enseña el tipo del catálogo (`leeTiposDeclarados: true`).
- FKs en tres consultas del mismo turno de `meta` (33-57 ms en 11.2, 35 ms en 21c, las mismas
  relaciones): (1) `sqlFks`, las R/P/U DE la tabla, sin hint; (2) `sqlFksEntrantesOracle`, las
  que apuntan a esas PK/UNIQUE, solo si hay alguna, con `/*+ RULE */` SOLO en la 11g (sin él, de
  0,5 s a 140 s); (3) `sqlColumnasDeRestricciones`, UNA consulta POR DUEÑO, sin hint.
- Una FK a sí misma sale en (1) y (2): se une por (dueño, nombre). Una FK hacia una tabla que el
  usuario no ve queda fuera: sin las dos puntas no sirve para un JOIN.

## Consecuencias

El hint va por versión y por consulta porque es lo que se midió: quitarlo o moverlo, plan lento.

## Descartes

- `FETCH FIRST` para limitar el catálogo: rompe en la 11.2.
- El OR con o sin RULE (44-45 s; sin RULE, 2,2-3,9 s). `USER_CONSTRAINTS` cuando el esquema es
  el del usuario: no cubre las entrantes de otros esquemas.
- Las columnas por (dueño, tabla) de cada punta (0,5-3 s), por tuplas `(owner, constraint_name)`
  (1,7 s) o con ramas unidas por OR (0,6-0,9 s): por dueño, 14-46 ms con 804 restricciones.
