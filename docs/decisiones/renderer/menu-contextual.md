# El menú contextual agrupa con separadores y reserva dos columnas distintas: check e icono

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/comun/MenuContextual.tsx`, `menuContextualEstilos.ts`, `menuContextualModelo.ts`, `useNavegacionMenu.ts` y `useSubmenu.ts`;
  el de los editores, `menuEditor.ts`, `menuEditorModelo.ts` y `MenuDeEditores.tsx`

## Contexto

Un menú se ordena por tipo de consecuencia: lo destructivo va abajo y aislado, y la distancia hasta esa
opción es la red de seguridad (el rojo `danger` avisa antes de llegar). Además, el menú debe alinear las
etiquetas de todas las filas aunque solo algunas traigan check o icono.

## Decisión

- Por defecto, el menú abre en el cursor y se ajusta a la ventana con 8 px de margen. Con `anclaje="encima"`,
  el punto `(x, y)` es su esquina inferior izquierda: abre hacia arriba, se mide a su ancho natural hasta su
  `max-width` y después se acota con el mismo margen. Entra desde abajo con `mov-aparece`, sin `mov-desde-arriba`.
  Las cuentas fijadas lo apoyan 4 px sobre el borde superior de su cápsula, alineado por la izquierda salvo el ajuste
  al borde de la ventana, tanto con ratón como con teclado: la cápsula sigue visible y las filas tienen sitio.
- Se agrupa con separadores, nunca con títulos dentro del menú: saturan y ocupan tanto como lo que agrupan.
- **Cuando un menú crece, lo poco frecuente o una familia de opciones con un nombre común va a un submenú**
  (`{ label, submenu }`), como «Agentes en Docker» en el menú del perfil. Lo que se usa a diario se queda en el primer
  nivel, un submenú de una sola opción no vale, y una lista de valores (una rama, un repositorio) sigue plana. Un solo
  nivel. Se abre al detener el ratón (150 ms), con clic o con →, que también entra en uno abierto con el ratón; ← lo
  cierra y Esc cierra solo el submenú si el foco está en él. Una fila apagada no despliega. No se cierra si el ratón va camino de él
  aunque cruce otras filas, y junto al borde de la ventana se abre hacia el otro lado.
- El check y el icono son DOS columnas independientes, cada una reservada en todo el menú en cuanto una
  sola fila la usa. Los sistemas de diseño que las tratan por separado (columna de marca y columna de
  imagen) lo hacen porque un menú puede combinar ambas.
- El margen entre el check y la etiqueta es de 4px: lo notan los menús conmutables (filtros del historial
  de git, selector de repositorio), aunque hoy ninguno combine check e icono. La barra de estado usa
  clases propias (`statusbar-menu-*`) porque abre hacia arriba y su lista se desplaza, pero con la misma
  superficie y el mismo resaltado; la lista de un select de modal y el tooltip también la comparten.
- El menú es de la familia de lo que flota: la superficie de los modales (`--bg-modal`) con sus grises
  de apoyo, no la de las capas de la ventana, sobre la que se confundía con el fondo. Filas con radio
  dentro de la tarjeta, separadores metidos y tenues, la letra del ajuste de interfaz y un resaltado
  teñido con el color del perfil: lo único con color dice en qué perfil estás.
- La explicación de una opción va en una segunda línea pequeña (`detalle`), no entre paréntesis en la
  etiqueta, que se queda corta y no ensancha el menú.
- El acorde de teclado de una opción (`acorde`) va a la derecha de su fila, apagado y sin partirse: solo lo
  dice, no lo captura. El menú se mide a su ancho natural (hasta su `max-width`) también junto al borde de
  la ventana y después se acota con el margen: sin eso, uno abierto bajo un botón de la derecha partía
  sus etiquetas con el hueco que quedaba.
- El menú detiene la propagación del `mousedown` para que clicar una opción no lo cierre antes de
  disparar su acción; el cierre global es `mousedown` fuera o Escape. Dentro de un diálogo, cuya tarjeta frena el
  `mousedown`, ese cierre se oye en la fase de captura, y su Escape cierra el menú sin cerrar el diálogo.
- **Los editores de código usan este mismo menú**, no el de serie del editor, que tiene otro aspecto y
  no está traducido. Se engancha a cada editor al crearse (`menuEditor.ts`, también los dos lados de un
  diff) y lo pinta un anfitrión único (`MenuDeEditores.tsx`), porque los editores viven fuera de React.
  Ofrece lo del panel (las acciones con `contextMenuGroupId`, registradas con `agregarAccionesConMenu`),
  navegar por el código si el lenguaje lo admite, cambiar el texto y el portapapeles
  (`menuEditorModelo.ts`). En solo lectura no sale lo que edita, salvo cortar y pegar, apagados. La
  paleta de comandos del editor no entra: está sin traducir y sigue a un F1.

## Consecuencias

- Fusionar las dos columnas en una vuelve a bailar las etiquetas en cuanto un menú combine ambas.
- Quitar la propagación detenida cierra el menú antes de que se ejecute la acción.

## Descartes

- Títulos de grupo dentro del menú: saturan; lo que necesita un nombre va a un submenú.
