# La parte superior de la ventana son tres franjas: título, perfiles y proyectos

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/layout/TabsBar.tsx`, `.titlebar*` y `.tabs-bar` de `styles.css`

## Contexto

La ventana se crea sin barra de título nativa (`titleBarStyle: 'hidden'`) y el sistema pinta
los botones de ventana encima del contenido (en Windows, Window Controls Overlay). Las pestañas
de perfil se reparten el ancho a partes iguales (`flex: 1 1 0`).

## Decisión

- Tres franjas: `.titlebar` (30 px: mosaico, agentes, asa de arrastre, aviso, engranaje), la
  banda de perfiles a ancho completo y la de proyectos del perfil activo.
- Los botones de ventana no están en el DOM: el renderer solo reserva su hueco con
  `env(titlebar-area-*)` en `.titlebar`.
- La región de arrastre es solo `.titlebar`: el arrastre para reordenar y el menú contextual de
  perfiles y proyectos, y el renombrado inline de los perfiles, no conviven con
  `-webkit-app-region: drag`.
- El botón del mosaico es el primer control, a la izquierda y centrado sobre el eje del riel:
  transforma la ventana entera y sus controles salen justo a su derecha.
- El botón de actualizar agentes nativos va tras el del mosaico, y en el mosaico antes de sus
  controles, en UNA sola ranura para los dos modos.

## Consecuencias

- No fundir título y perfiles en una fila: restar el hueco de los botones a las pestañas de
  perfil deja un socavón junto al engranaje y acorta su tira de color.
- Con una ranura por modo, React desmonta y monta el botón al entrar y salir del mosaico y el
  panel abierto se cierra solo.
- El botón de agentes lejos del de actualizar Tessera evita dos «actualizar» contiguos y que su
  etiqueta desplegada empuje al vecino bajo el ratón.
