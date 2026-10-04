# La fila de archivo de git es un solo componente con dos modos y sin letra de estado

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/git/{FilaArbolArchivo,Casilla}.tsx`

## Contexto

Los archivos de un commit (árbol, sin casillas) y la vista de Cambios (lista plana, con casilla)
se ven distintos pero comparten interacción, icono, color por estado y tooltip.

## Decisión

- Un solo componente: dos gemelos divergen, y ya pasó con las dos filas que este unificó. Lo que
  cambia es la decoración: la casilla y el chevron son slots opcionales (`marca`, `plana`).
- Interacción: clic selecciona (y precalienta el diff), doble clic o Enter abren, Espacio alterna
  la casilla si la hay (la casilla no es parada de tabulador: sin esta tecla marcar sería cosa
  del ratón) y clic derecho selecciona y abre el menú. Sin debounce entre clic y doble clic: el
  clic ya no abre nada, así que no hay nada que cancelar.
- El hover precalienta solo si el ratón se queda; salir antes lo cancela.
- La letra de estado no se pinta: el color del nombre ya lo dice y un chip por fila desplazaba el
  nombre en cada nivel. La letra vive en el tooltip.
- Las filas de archivo reservan un hueco del ancho REAL del chevron (`ANCHO_CHEVRON`) para
  alinearse con las carpetas; en la lista plana no hay hueco.
- `enfocable={false}` quita hasta el `tabIndex` -1, que seguiría siendo enfocable con el ratón y
  pintaría dos marcadores de foco: el árbol de un commit deja el foco en su contenedor.
- La casilla es un `span` con `aria-checked`, no un `input`: el estado parcial del nativo solo se
  escribe en el nodo, y una lista virtual recicla nodos y arrastraría el de la fila anterior.
- En el CSS de la carpeta gris de la lista plana, `flex-shrink: 9999` no se baja a 1: flexbox
  reparte el recorte por `flex-basis`, y con 1 se cortaba el nombre largo antes que la ruta. No
  se puso shrink 0 en `git-arbol-etiqueta` porque lo comparten las filas de carpeta, y un nombre
  largo empujaría su conteo fuera de la fila.

## Consecuencias

- Una interacción nueva se añade aquí, no en una fila propia de una de las superficies.

## Descartes

- El badge de letra por fila, y calcar la sangría del explorador (allí el chevron mide 14 px y el
  hueco añade 4 más: está desalineado desde siempre).
