# La consola de MongoDB interpreta el shell con una lista blanca y nunca ejecuta JavaScript

- **Estado:** vigente
- **Ámbito:** `src/tdb/literalesMongodb.cjs`, `src/tdb/sentenciaMongodb.cjs`, `src/tdb/mongoComun.cjs`

## Contexto

`tdb` y el explorador comparten una sola copia de cómo se interpreta una sentencia y qué es lectura, o
uno de los dos mentiría al otro. Una consola que evaluara JavaScript no puede imponer solo lectura.

## Decisión

- Los literales (documentos, filtros, celdas) los lee `@mongodb-js/shell-bson-parser` en modo `loose`
  (admite comentarios). `parse()` no lanza al rechazar: devuelve `''`, y eso es un rechazo y nunca un
  filtro vacío (que sería «todo»). El único `''` legítimo es un literal de texto vacío, que se reconoce
  aparte. El parser envuelve la entrada en `(\n…\n)`, así que sus posiciones de error van desplazadas 2.
- Cuando rechaza sin posición, `localizar` la busca preguntando al propio parser por cada trozo del árbol
  de `acorn`: no hay una segunda lista blanca que mantener.
- La forma de la sentencia (`db.col.metodo(args).sort(…).limit(n)`, `db.getCollection("x")`, `db["x"]`,
  `show dbs|collections`, `use x`) la recorre `acorn` con una lista blanca de nodos, y cada argumento
  pasa por el parser de literales. No hay `eval`, `Function` ni `vm`. `show` y `use` se reconocen antes de
  `acorn`, como hace mongosh.
- Solo lectura = lista blanca de métodos de lectura. `aggregate` con `$out` o `$merge` en cualquier sitio
  del pipeline es escritura: se busca en profundidad, incluso dentro de un `Map` u otro objeto que BSON
  serialice como documento, porque es mejor un falso «escribe» que un falso «lee». `$where`, `$function`
  y `$accumulator` son JavaScript de servidor: pasan como lectura con aviso.
- Posiciones de error en puntos de código (`offsetCp`), no en unidades UTF-16.

## Descartes

- `db.getSiblingDB('x')`: no está en la lista blanca de la forma, y abrirla solo para `tdb` haría divergir
  el intérprete del de la consola. `use <base>` como primera línea cubre esa necesidad.
- Evaluar en un `vm`: no da ninguna garantía de solo lectura.

## Consecuencias

Los rechazos llevan su posición y su texto en español. El explorador y `tdb` clasifican con la misma
función (`clasificar`); el solo lectura de verdad es un usuario con rol `read`.
