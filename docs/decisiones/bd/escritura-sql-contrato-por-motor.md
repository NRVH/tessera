# Cada motor escribe su SQL de exportar con su propio módulo, tras un contrato y un registro exhaustivo

- **Estado:** vigente
- **Ámbito:** `src/shared/escrituraSql/` (`tipos.ts`, `index.ts`, `comun.ts`, `oracle.ts`, `postgres.ts`), `src/shared/formatosFilas.ts`, `src/shared/sql/dmlRejilla.ts`

## Contexto

Tres cosas generan SQL que no ejecuta el driver sino que se enseña o se guarda para correrlo en el
cliente de línea del motor: el literal de una celda («Copiar como INSERT», la vista previa de
«Enviar»), el guion INSERT de exportar y la vista previa de un cambio. Cada motor lo escribe con su
algoritmo: el de Oracle es un guion que SQL*Plus no rompe, con bloques PL/SQL; el de PostgreSQL, una
sentencia por línea.

## Decisión

- Un contrato (`EscrituraSqlMotor`, en `tipos.ts`), un archivo por motor y un registro `ESCRITURA_SQL`
  que es un `Record<DbMotor, …>`: un motor nuevo no compila hasta traer los suyos.
- Antes vivían en `formatosFilas.ts` tras un `switch (motor)` con `nunca`, y la vista previa de «Enviar»
  colgaba de `barraTermina`, una bandera léxica («la `/` termina una sentencia») que decidía si se
  enseñaba un `EXECUTE IMMEDIATE`. El `switch` avisaba, pero sumar un motor seguía siendo editar dos
  módulos comunes; la bandera no avisaba de nada y un motor con esa `/` habría recibido la vista de otro.
- `escrituraSql()` lanza con un motor que no está en el registro, con el mismo mensaje del `nunca` de
  antes en cada sitio: nunca sigue con los literales de otro.
- Ciclos: los archivos de cada motor no importan `index.ts`; lo que comparten con `formatosFilas.ts`
  está en la hoja `comun.ts` (solo `import type`). Si viviera en `formatosFilas.ts`, el de Oracle lo
  importaría de vuelta y cerraría un ciclo que compila y revienta al cargar.
- PostgreSQL es corto porque `psql` lee las comillas: un literal es una cadena con el salto de línea o
  el `&` dentro tal cual; booleanos `TRUE`/`FALSE`, binario con `decode('…', 'hex')` y las fechas como
  texto que PG convierte al tipo de la columna. La vista previa siempre lleva su `;`.

## Consecuencias

Todo se mudó sin cambiar un byte de lo que produce, comprobado con un diferencial contra la versión
anterior. Oracle: [escritura-sql-oracle-sqlplus.md](escritura-sql-oracle-sqlplus.md) y
[escritura-sql-oracle-binario-grande.md](escritura-sql-oracle-binario-grande.md).
