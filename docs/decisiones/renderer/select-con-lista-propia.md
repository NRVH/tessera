# La lista de un select de modal es la «select personalizable» del motor, con la piel de los menús de Tessera

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/comun/selectDesplegable.css` (se importa desde `main.tsx`), `comun/useDialogo.ts` y `features/bd/dialogo.css`

## Contexto

La lista de un `<select>` era la del sistema: cuadrada y con el azul de la plataforma, fuera del tema, cuando todos los demás
menús de Tessera (el contextual, los popovers) son propios. En macOS era además el menú nativo del sistema.

## Decisión

- `appearance: base-select` en el control y en `::picker(select)`, para los `select` de un modal (`.modal-overlay select`) y no
  para los de una barra. La lista es un popover de la capa superior: ni la recorta el cuerpo con scroll del modal ni la mueve
  su animación, y el motor la coloca, la voltea si abajo no cabe y la cierra al pulsar fuera.
- La lista copia lo del menú contextual (fondo `--bg-elevated`, filete, radio de 6 px, sombra, resaltado `color-mix` del acento,
  lo elegido marcado en acento) y se limita a 320 px o al 45 % de la ventana.
- El control CERRADO conserva el aspecto que le da la hoja de cada select: el modo base centra mal, deja envolver el texto y
  dibuja otra flecha, así que se compensa (texto centrado y sangrado 4 px como el nativo, una línea recortada en el borde con
  `contain: paint`, flecha propia con `::picker-icon` a 8 px del filete). La regla pesa (0,2,1) a propósito: gana a la de
  cada hoja sin depender del orden de carga. `contain: paint` hace del select un contexto de apilado: el logo del motor de
  BD lleva `z-index`.
- El Esc con la lista abierta llega también a `window`. `useDialogo` lo deja pasar si viene de un select con `:open`, y así
  cierra solo la lista y no el diálogo.

## Consecuencias

- Con el control cerrado, las flechas abren la lista (en Windows el nativo cambiaba el valor en sitio). Con un texto más largo
  que la caja se recorta y la flecha se pierde.
- En macOS el select pasa a verse igual que en Windows, porque los menús de Tessera ya son propios en las dos plataformas. Es
  el mismo motor y el mismo CSS, pero queda sin verificar allí: hay que mirarlo en un Mac.
- Un select nuevo dentro de un modal la hereda sin hacer nada; uno fuera de un modal sigue nativo.

## Descartes

- Una lista propia en React: repite el teclado, el foco, escribir para saltar y la accesibilidad que el elemento ya trae.
- Un `<button>` con `<selectedcontent>` dentro de cada select: arreglaría el texto largo, pero obliga a cambiar el marcado de
  todos.
