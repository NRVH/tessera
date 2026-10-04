# Lo que ofrece el botón de reinicio lo decide una función pura, con tres guardas

- **Estado:** vigente
- **Ámbito:** `features/terminales/reloadButton.ts` y los botones de reinicio de la terminal y del agente

## Contexto

Con Docker apagado al abrir el proyecto la apertura falla y el pane queda sin sesión. El botón
colgaba de `!sessionId` y quedaba gris para siempre: levantar Docker no daba nada que pulsar.
Recuperarse de una caída en caliente sí existía, pero exige una sesión que llegó a existir.

## Decisión

- `botonReinicio` devuelve habilitado, etiqueta, título, acción (`reload`, `open` o `nada`) y
  `soloIcono`; el pane deriva de ahí el `disabled` y su propia guarda.
- Sin sesión y con estado `error` la acción es ABRIR, no `reload` (que en el main exige sesión).
- Guardas obligatorias: `hibernated` (limpia la sesión sin tocar el estado y levantaría un
  contenedor recién hibernado), `puedeAbrir` (las condiciones del reconcile) y `recuperando`
  (verdad síncrona en un ref; el estado pintado va diferido).
- Actualizar los agentes no añade un estado: entra como `reloading` con otra etiqueta.
- Con la sesión atrasada el título del botón en reposo lo dice; la etiqueta sigue siendo el icono.

## Consecuencias

- Colgar de nuevo el `disabled` de `!sessionId` reabre el fallo mudo (botón gris sin error).
- La etiqueta crece solo cuando hay algo que decir (reintentar, reabrir, progreso).
