# Los popovers de esquemas se manejan desde el filtro, y el de la consola elige uno sin efectos que nadie pidió

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/DbEsquemasPopover.tsx`, `consola/SelectorEsquemaConsola.tsx`,
  `consola/popoverFlotante.ts`, `consola/usePopoverFlotante.ts`, `consola/useListaCatalogo.ts`

## Contexto

Dos popovers por portal eligen esquemas o bases: el de esquemas visibles del árbol (varios, con
casilla) y el selector de la consola SQL (uno). Cuelgan de un botón y se acotan a la ventana. Lo
común con el resto de la barra está en [ui-consola-barra-y-pane.md](ui-consola-barra-y-pane.md).

## Decisión

- **El foco se queda en el filtro** y la lista se recorre con ↑/↓ nombrando la fila activa con
  `aria-activedescendant`: se teclea para filtrar y se marca sin cambiar de sitio.
- **Espacio marca la fila activa** en el de esquemas visibles: un nombre de esquema con espacios es
  una rareza, y a cambio el teclado no va y viene entre el filtro y la lista.
- **Esquemas visibles:** Enter o clic fuera APLICAN, Esc cancela; se guarda la configuración, no la
  lista pintada. Los del SISTEMA y PUBLIC van al final y atenuados, pero se pueden marcar: si el
  usuario quiere ver SYS, es suyo.
- **Selector de la consola:** elige UNO; Enter o clic eligen y cierran, Esc y el clic fuera
  CANCELAN (un clic fuera que cambiara el esquema de la sesión sería un efecto que nadie pidió).
  Elegir el vigente solo cierra. Se alinea por el borde DERECHO de su botón, que está a la derecha
  de la ventana: alineado a la izquierda se saldría, y el acotado lo alejaría del botón.
- Al cerrar, el foco vuelve a quien lo tenía solo si quedó huérfano en `<body>`: si se cerró con un
  clic en el editor, el foco es suyo.

## Consecuencias

La mecánica de foco y cierre (`usePopoverFlotante.ts`) la comparten los selectores de base de
documentos y claves; el teclado y el estado de carga de esos selectores siguen siendo propios.

## Descartes

- Un «Aplicar» en el popover de esquemas visibles: un clic que todo el mundo se salta.
