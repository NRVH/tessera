# El autocompletado espera al catálogo con un solo tope por pregunta y parte cada versión del modelo una vez

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/autocompletado/proveedorSqlMonaco.ts`, `analisisModelo.ts`

## Contexto

Las sugerencias necesitan el catálogo (índice de nombres, columnas, FKs), que viaja al main y, por
una VPN, tarda. Y partir la consola entera en sentencias es lo caro: `dividirSentencias` pasa el
léxico por TODO el texto. Medido bajo `node` con una consola Oracle mixta: unos 10 ms a 0,25 MiB,
35 ms a 1 MiB y 60-80 ms a 2 MiB, en el hilo del renderer; buscar la sentencia del cursor en lo ya
partido es 0,1 ms. Monaco pregunta varias veces por la misma versión (al abrir, con `.`, con
Ctrl+Espacio).

## Decisión

- La espera tiene un tope de 800 ms para TODA la pregunta, no por fase: primero lo de base
  (esquemas, índice, sinónimos públicos) y, con eso, lo que pide el contexto. Si no llega, se
  sugiere con lo que hay y la tecla siguiente lo ve (`incomplete: true`). Una pregunta cancelada
  deja de esperar en el acto.
- En posición de palabra clave no se espera, pero las cargas de base se DISPARAN igual, para que
  al llegar al FROM el índice ya esté.
- La división se memoriza por `getVersionId()` + dialecto (cambiar de motor no cambia la versión y
  parte distinto) en un `WeakMap` por modelo, una entrada: la de la última versión. La comparten
  el proveedor, la precarga de FKs y los avisos léxicos de la consola: la hace quien llega primero.
- Por encima de 2 MiB no se sugiere: el mismo tope que el análisis vivo (`MAX_ANALISIS_VIVO`), que
  no se importa porque su módulo carga Monaco y el proveedor se prueba con `node`.
- Una sentencia de cliente (`PROMPT`, `SET SERVEROUTPUT ON`, `CONN`) no sugiere en sus argumentos,
  salvo `DESC tabla` y mientras se escribe la primera palabra: `del`, `save`, `exec`, `def` son
  abreviaturas de cliente para el clasificador y el comienzo de DELETE, SAVEPOINT o DEFAULT.

## Consecuencias

- La memoria retiene el texto de la última versión analizada mientras viva el modelo.

## Descartes

- Reabrir el widget si la carga acaba tarde: cerrado con Esc en la espera, se reabriría solo.
- Que la precarga o los avisos partieran por su cuenta: repetían en cada pausa una división que
  a menudo ya existía.
