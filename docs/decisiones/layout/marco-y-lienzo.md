# El contorno es un gris único y el área de trabajo un lienzo hundido; ningún ancestro de una capa fija crea contexto de apilamiento ni contención

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/styles.css` (`.shell`, `.shell-main`, `.activity-bar`, `.status-bar`, `.tabs-bar.mosaico`, las casillas del mosaico, la superficie compartida de modal)

## Contexto

La ventana no tiene marco nativo: el renderer pinta la barra de título, las bandas, el riel y la
barra de estado. Los menús contextuales, popovers y diálogos no van por `createPortal`: se
pintan como hijos `position: fixed` de quien los abre, dentro del centro de la ventana.

## Decisión

- Todo el contorno es un gris único (`--bg-chrome`) y `.shell-main` es el LIENZO: un panel
  oscuro con esquinas redondeadas y un canal de `--lienzo-gutter` alrededor. Los tokens `--bg`,
  `--bg-elevated` y `--bg-deep` no cambian de valor: cambia qué selectores pintan el marco. El
  riel no lleva `border-right` (el canal ya separa) y la barra de estado centra su contenido
  contando el canal como relleno inferior.
- Los modales se pintan con `--bg-modal`, el gris del marco: con `--bg-elevated` lo que flotaba
  por encima de todo era más oscuro que el marco (1,02:1 contra su fondo velado, medido).
- PROHIBIDO en `.shell-main`, en las casillas del mosaico y en la superficie compartida de
  modal: `transform`, `filter`, `backdrop-filter`, `opacity`, `z-index`, `will-change`,
  `contain` y `container-type`. Convierten al elemento en bloque contenedor o contexto de
  apilamiento de sus `position: fixed` descendientes y rompen de golpe menús, popovers y
  diálogos. Una container query va en un elemento sin capas fijas debajo
  (`.agent-pane .panel-header`, el card de Configuración).
- Las capas flotantes que caen sobre `.titlebar` llevan `-webkit-app-region: no-drag`: Chromium
  calcula la región de arrastre como unión de rectángulos, sin mirar el posicionamiento.

## Consecuencias

- Atenuar las casillas sin foco o animar su ampliación queda descartado mientras los menús del
  pane sigan siendo hijos suyos; el foco se marca con un `::after` sin `z-index`.
- Portar las capas a `createPortal(document.body)` cerraría el riesgo; es un refactor aparte.

## Descartes

- Invertir la escalera entera (chrome claro, contenido oscuro): repinta toda la app y obliga a
  reauditar cada panel para ganar lo mismo que dan cuatro reglas.
