# «Enviar» construye su DML con un solo constructor para los dos lados, con binds y nombres citados

- **Estado:** vigente
- **Ámbito:** `src/shared/sql/dmlRejilla.ts`, `originalesSql.ts`

## Contexto

El renderer enseña una vista previa y el main ejecuta. Si cada uno escribiera su SQL, lo que el
usuario aprueba y lo que corre diferirían en el primer caso raro. La regla de qué original se puede
comparar estuvo escrita dos veces y se separó dos veces.

## Decisión

- Un constructor (`sentenciaDeCambio`) produce el SQL con binds posicionales que se ejecuta y la misma
  sentencia con literales para la vista previa, que nunca se ejecuta. `columnas` dice qué columna recibe
  cada bind (`null` = el ROWID).
- Nombres SIEMPRE citados con la forma de su motor; el ROWID y el `''` que es NULL se leen del descriptor.
- Oracle: un nombre con carácter de control o `&` rompe SQL*Plus (medido en 11.2 y 21c), así que su
  vista va en un bloque con EXECUTE IMMEDIATE terminado en `/`; lo que se ejecuta no cambia.
- Concurrencia optimista: con el ROWID, que es una DIRECCIÓN reutilizable, los valores leídos van al
  WHERE con `"COL" = :n` y `"COL" IS NULL` por cada NULL; en Oracle `''` va como `IS NULL`.
- `originalesSql.ts` decide qué columnas y valores entran, por motor y con una lista blanca de tipos:
  comparar de más da un «la fila cambió» falso en cada envío. Un texto con U+FFFD no se compara (se leyó
  con pérdida y no casa nunca consigo mismo). Descartar solo quita una comprobación.

## Consecuencias

El renderer puede quitar originales de más, nunca poner. Lo del WHERE de la vista previa no usa
TO_CLOB (Oracle no compara un CLOB con `=`, ORA-00932).

## Descartes

- `DECODE("COL", :n, 1, 0) = 1` como forma NULL-safe: convierte al tipo del bind y no casa con la propia
  fila en NUMBER 0.5, FLOAT, BINARY_DOUBLE ni TIMESTAMP con zona.
- Que el main recalcule el orden de los binds con `Object.keys`: se rompería en silencio al reordenar.
