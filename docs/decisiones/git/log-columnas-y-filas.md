# Log en tres columnas: la fila tiene alto fijo y la columna de autor se mide, no se estima

- **Estado:** vigente
- **Ámbito:** `features/git/FilaCommit.tsx`, `DetalleCommit.tsx`, `ArbolRamas.tsx`, `modelo/anchoColumnas.ts`

## Contexto

En una columna de 180-480 px solo cabe el asunto de un commit; a lo ancho de la pantalla caben
autor, fecha y ramas como columnas. La lista está virtualizada: calcula los offsets a partir
del alto de fila y cualquier fila más alta descuadra el grafo de todas las de abajo.

## Decisión

- El panel vive abajo, en tres columnas (ramas, filtros con commits, detalle) y toda la
  historia está aquí; el sidebar se queda con el working tree.
- La fila tiene alto FIJO (`white-space: nowrap`, `line-height` del chip derivado de
  `--ui-row-h`); el número que recibe la lista y el de la fila es el MISMO.
- El asunto es lo único elástico y trunca primero; los chips van al borde derecho de su celda.
- La columna de AUTOR se MIDE con `canvas.measureText` y llega como `--git-log-autor-w`. Una
  estimación por caracteres salió un 12 % corta y recortaba todos los nombres. Incluye el
  padding (el flex-basis es border-box), se calcula sobre lo cargado y no sobre lo visible
  (teclear no debe mover la columna) y el tope es un `max-width` en porcentaje.
- La canaleta de copiar tiene el hueco RESERVADO: revelarla anima solo la opacidad, sin mover
  nada bajo el cursor. Superponerla tapa los minutos; crearla al hover empuja la fecha.
- El detalle carga `commitDetail` y `branchesContaining` por separado: la segunda recorre las
  refs y puede tardar. El divisor reparte el alto con el de la columna medido en vivo, con
  una ref de callback (el div se remonta al elegir el primer commit).

## Consecuencias

- Un chip o dato nuevo en la fila no puede envolver ni cambiar su alto.

## Descartes

- Autor y chips en una sola celda alineada a la derecha: bordes izquierdos dentados.
- Un clic derecho con un menú de una sola opción: además saca el foco del listbox.
