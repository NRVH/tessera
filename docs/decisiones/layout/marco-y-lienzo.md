# El contorno es un gris único y el área de trabajo un lienzo hundido; ningún ancestro de una capa fija crea contexto de apilamiento ni contención

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/styles.css` (`.shell`, `.shell-main`, `.activity-bar`, `.status-bar`, `.tabs-bar.mosaico`, las casillas del mosaico, la superficie compartida de modal)

## Contexto

La ventana no tiene marco nativo: el renderer pinta la barra de título, las bandas, el riel y la
barra de estado. Menús, popovers y diálogos se pintan como hijos `position: fixed` de quien los abre,
salvo los que una zona con contención recortaría: van por portal a la capa flotante, dentro de `.shell`.

## Decisión

- Todo el contorno es un gris único (`--bg-chrome`) y `.shell-main` es el LIENZO: el hueco
  con un canal de `--lienzo-gutter` alrededor. Dentro, cada zona grande es su propia TARJETA
  redondeada (lateral, editor, BD, agente, terminal, Git·Log y cada casilla del mosaico), con
  el hueco del divisor entre ellas y `overflow: hidden` para recortar el contenido que toca el
  borde. El divisor entre zonas no pinta filete: es el hueco. Al usar cualquier divisor (con un
  instante de espera en el hover) se enciende una barra redondeada de 4 px del color del perfil.
  Una sola
  tarjeta con filetes dentro leía todo como un bloque; con tarjetas, cada zona se reconoce
  sola. En el mosaico la casilla no lleva borde (descuadraría la cuenta de columnas): la
  separan el hueco, el contraste con el marco y el marco de su perfil. El riel de iconos es su
  propia tarjeta, con el mismo hueco que las demás.
- Dentro de una zona, las partes que se reparten el espacio con un divisor (columnas de Git·Log,
  el riel SSH junto a la terminal, la consola de BD y sus resultados) son TARJETAS ANIDADAS sobre
  el tono hundido de la zona, con el hueco del divisor entre ellas; la cabecera de la zona va
  sobre ese tono, sin caja. Los filetes quedan para lo que no se reparte con divisor.
- Dentro de una tarjeta, la cabecera no lleva filete ni sombra que la separe de su contenido,
  y la terminal es toda del color de la consola, sin caja dentro: una zona se lee como una
  superficie.
- Las pestañas son cápsulas con una jerarquía por intensidad: el perfil activo lleva contorno y
  halo de su color sin relleno (es el más ancho y rellenarlo pesaría más que todo), el proyecto
  activo un contorno fino de su color más tenue y sin halo sobre un relleno neutro leve, y las
  pestañas de contenido (editor, BD, terminal, vistas de Git·Log) el relleno del color.
- La tira de pestañas del editor (y la de BD) se separa de su contenido por el TONO (el gris
  del lateral sobre el del editor), no por un filete ni un hueco: el hueco partiría la tarjeta.
  A su derecha, fijas, van la flecha con las pestañas que no se ven y las acciones del pane
  visible (el modo de vista de un archivo con vista previa), por portal: así el contenido
  empieza justo bajo las pestañas, sin una fila de botones en medio. Los tokens `--bg`,
  `--bg-elevated` y `--bg-deep` no cambian de valor: cambia qué selectores pintan el marco. La
  barra de estado centra su contenido
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
- La capa flotante (`.capa-flotante`, `display: contents`) cumple estas prohibiciones y va dentro de `.shell`, no en
  `<body>`, que no hereda `--perfil`: [../renderer/boton-dividido-y-capa-flotante.md](../renderer/boton-dividido-y-capa-flotante.md).

## Descartes

- Invertir la escalera entera (chrome claro, contenido oscuro): repinta toda la app y obliga a
  reauditar cada panel para ganar lo mismo que dan cuatro reglas.
