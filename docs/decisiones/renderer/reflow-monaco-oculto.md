# Al volver de oculto a visible, Monaco se recoloca reintentando unos frames con medidas explícitas

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/comun/useVisibleLayout.ts`

## Contexto

Bajo `display:none` Monaco mide 0×0. Al re-mostrarse, un solo `layout()` en el frame siguiente no basta:
la caja del pane puede seguir sin dimensiones ese primer frame, porque el `display:none` del ancestro
(otra pestaña de editor, otro proyecto o el área central mientras el agente estaba maximizado) aún no se
soltó. `layout()` mide 0 y el editor o el diff queda aplastado a una línea hasta que un resize manual de la
ventana dispara el `ResizeObserver`.

## Decisión

- Se reintenta hasta `MAX_FRAMES` frames (~200 ms) hasta que el host tiene caja real y solo entonces se
  llama a `layout({ width, height })` con dimensiones explícitas: el `layout()` sin argumentos reutiliza una
  medición interna que puede haber quedado obsoleta en 0.
- Si pasado el tope el host sigue sin caja, se abandona sin coste: el pane está tapado por un ancestro y su
  propio `ResizeObserver` hará el layout cuando reaparezca.

## Consecuencias

- Sustituirlo por un único `layout()` reabre el diff o archivo en blanco al volver a uno ya visto.
- El efecto solo depende de `visible`: `hostRef` y `editorRef` son refs estables.
