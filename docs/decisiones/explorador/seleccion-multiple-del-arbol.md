# La selección del árbol guarda claves de fila y las rutas movibles se derivan al usarlas

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/explorador/seleccionArbol.ts`, `treeFlatten.ts` y sus usuarios del árbol (`interaccionArbol.ts`, `tecladoArbol.ts`, `arrastreArbol.ts`)

## Contexto

Una carpeta compactada («com/ejemplo/app») es UNA fila con DOS rutas: la clave de fila es la HOJA
(`row.key`, lo que usan expandir, renombrar, eliminar y el menú) y lo que se ARRASTRA es el PRIMER
segmento (mover la cadena tal como se ve sería mover `com`). Además la lista está virtualizada: las
filas de en medio de un rango normalmente no están montadas en el DOM.

## Decisión

- La selección guarda claves de fila, que casan con `getKey` de la lista virtual; las rutas
  movibles se derivan de las filas en el momento de usarlas.
- Los índices de un rango se calculan sobre la lista APLANADA, nunca sobre el DOM.
- Las decisiones (qué queda seleccionado, qué se poda al refrescar, qué rutas se mandan al main,
  si una carpeta puede recibir el grupo) viven en módulos puros y se prueban con `node` a secas.
- La frontera `!/` de los `.jar` se resuelve con `esDescendiente`: `startsWith(x + '/')` miente.

## Consecuencias

- Mezclar clave de fila y ruta movible da un fallo que solo aparece con carpetas compactadas y
  mueve el archivo equivocado sin error.

## Descartes

- Un «conjunto base» para que un segundo Ctrl+Mayús+clic REEMPLACE el rango anterior en vez de
  acumularlo: los editores y los IDE acumulan, que es lo que la gente tiene en los dedos, y el
  conjunto sería un cuarto campo de estado con su propia poda y su propio colapso.
