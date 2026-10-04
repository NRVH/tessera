# Un binario de más de 2000 bytes se escribe como un bloque PL/SQL, no como un literal

- **Estado:** vigente
- **Ámbito:** `src/shared/escrituraSql/oracle.ts`

## Contexto

Un literal de más de 4000 bytes da ORA-01704, y el hex de `HEXTORAW('…')` ocupa el doble que los bytes:
en la 11.2, 2000 bytes entran y 2001 no. «Copiar como INSERT» lleva hasta 32 KiB por celda y exportar,
hasta 16 MiB. Trocearlo como el texto no sirve (medido): `HEXTORAW(a) || HEXTORAW(b)` concatena como
`VARCHAR2` y da ORA-01489, y `TO_BLOB(a) || TO_BLOB(b)` da ORA-00932.

## Decisión

- La fila con alguna celda binaria de más de 2000 bytes se escribe como un bloque:
  `DECLARE tessera_b1 BLOB; BEGIN DBMS_LOB.CREATETEMPORARY(…); DBMS_LOB.WRITEAPPEND(…, 1000, HEXTORAW('…'));
  … INSERT … VALUES (…, tessera_b1, …); DBMS_LOB.FREETEMPORARY(…); END;` y la `/` sola en su línea, que
  cierra un bloque en SQL*Plus, SQLcl y otros clientes y entiende el divisor de la consola. Las demás
  celdas siguen con su literal y las filas sin binario grande no cambian.
- 1000 bytes por línea (2000 de hex más la llamada), bajo los 2498 que admite una línea de SQL*Plus 11g.
  Los 16 MiB de una celda son un bloque de 33 MiB y 16 778 llamadas, y la 11.2 lo ejecuta entero
  (~46 s en una XE en Docker).
- `LONG RAW` y `RAW` (este solo pasa de 2000 bytes con `MAX_STRING_SIZE=EXTENDED`) van en una variable
  `RAW(32767)` que se alarga con `UTL_RAW.CONCAT`: un BLOB no entra en un `LONG RAW` (ORA-22835). El tipo
  se sabe por `tipoMotor`; sin él se asume BLOB. Por encima de 32767 bytes no hay manera (32768 da
  ORA-06502): el bloque se escribe igual, con un comentario que lo explica, y esa fila falla con el motivo
  a la vista.
- El BLOB temporal se libera con `FREETEMPORARY`, y si el bloque falla PL/SQL lo libera al salir de
  ámbito (medido con `V$TEMPORARY_LOBS`), así que no hace falta `EXCEPTION`. `tessera_b1` no choca con
  una columna homónima: en `VALUES` no hay columnas a la vista.
- El literal sigue siendo solo un literal: para un binario grande no existe ninguno y el escritor del
  `INSERT` lo saca al bloque.

## Descartes

- Escribir `NULL` en su lugar: un guion que mete `NULL` en silencio estropea los datos.
- `VALUES (…, EMPTY_BLOB()) RETURNING … INTO` y escribir en el locator: un trigger de la tabla vería el
  BLOB vacío. Con el temporal el `INSERT` recibe el valor entero.
