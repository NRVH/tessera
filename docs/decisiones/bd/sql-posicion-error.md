# La posición de un error del servidor se convierte en un solo sitio, el main, entre tres unidades distintas

- **Estado:** vigente
- **Ámbito:** `src/shared/sql/posicionErrorSql.ts`

## Contexto

Tres unidades en juego, y cada una es un fallo si se confunde: Oracle da `err.offset` en BYTES UTF-8
(un comentario con «años» corre la marca un carácter por cada ñ), PostgreSQL da `err.position` en
PUNTOS DE CÓDIGO base 1, y Monaco y `String.slice` cuentan en UTF-16 (un emoji son dos).

## Decisión

- Convierte SOLO el main; el renderer suma el inicio VIVO de la decoración de la sentencia. Dos
  conversiones en dos procesos restarían dos veces el prefijo de un EXEC o pasarían dos veces de bytes
  a caracteres.
- El trabajador normaliza a `offsetCp` (puntos de código, base 0); aquí se pasa a UTF-16 y del texto
  enviado al modelo. Un offset 0 de Oracle es «sin posición», no el primer carácter.
- Respaldos sin offset: ORA-06550 `line N, column M`, `internalQuery` + `internalPosition` de PG y el
  `where` con «line N» de PL/pgSQL.
- Errores de compilación (ALL_ERRORS): la línea 1 es la de la palabra PROCEDURE/PACKAGE/… (o el cuerpo de
  un disparador), las líneas se parten solo por `\n` y la columna va en BYTES.
- Cómo da la posición cada servidor es un algoritmo, no una bandera: un `switch` sobre el dialecto que
  cierra con `nunca`. SQL Server da línea y no columna.
- Todo resultado se acota al rango de la sentencia; la cuenta de bytes UTF-8 es la ÚNICA de `shared/`.

## Consecuencias

Un servidor nuevo tiene que escribir su caso; hasta entonces no compila. `sesionOracle.cjs` lleva su
copia de la cuenta de bytes porque corre en otro proceso, en CommonJS.
