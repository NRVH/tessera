# El botón dividido tiene dos paradas de Tab y sus menús y popovers van a una capa flotante dentro de `.shell`

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/comun/` (`BotonDividido.tsx`, `capaFlotante.tsx`, `ContextMenu.tsx`, `popoverFlotante.ts`,
  `usePopoverFlotante.ts`) y `App.tsx`

## Contexto

El «+» de nueva terminal pasa a ser un botón con una flecha que abre el lanzador de conexiones, dentro de una zona con
`container-type` y `overflow: hidden`, que recorta y descoloca cualquier hijo fijo. Un portal a `<body>` no hereda
`--perfil`, que va en línea en `.shell`.

## Decisión

- `BotonDividido` tiene dos paradas de Tab. La flecha ya no es un «menu button»: es un botón que abre un diálogo que monta
  quien aloja el botón, colgado de su `grupoRef`. Lleva `aria-haspopup="dialog"`, `aria-expanded` y `aria-controls`; Intro,
  Espacio y ↓ lo abren, y Esc lo cierra y devuelve el foco a quien lo tenía (la flecha). Su nombre accesible no contiene el
  de la principal («Nueva terminal»): las pruebas buscan por subcadena.
- `ContextMenu` gana `disparador`, opcional. El foco vuelve al disparador solo si seguía dentro del
  menú, y el efecto es de layout: en uno pasivo el foco ya habría caído en `<body>`.
- Los menús y popovers que no pueden colgar de quien los abre se pintan por portal en `.capa-flotante`: un `div` de
  `App.tsx` dentro de `.shell` y fuera de `.shell-main`, con `display: contents` (sin transform, contain ni
  container-type, que volverían absolutos a sus hijos fijos).
- Su `z-index` queda bajo el menú contextual (1000) y los modales (2000).
- `popoverFlotante.ts` y `usePopoverFlotante.ts` pasan a `comun/`: solo dependen de React y los usa también el lanzador SSH.
- Un popover cierra con Esc solo si el evento nace dentro de él: lo de un menú suyo burbujea por el árbol de React.
- El botón cuyo menú o popover está abierto lleva `.abierto` y no se funde en reposo: está fuera del panel y le quita el foco.

## Consecuencias

- Un hijo de `.capa-flotante` con `transform` o `filter` rompe el `position: fixed` de los demás.
- Un portal a `<body>` pierde el color del perfil.

## Descartes

- Portal a `<body>`, como hacían los popovers de la vista de BD: pierde `--perfil` y el acento.
- El menú como hijo de la zona de pestañas: recortado y mal colocado.
- La flecha como menú con «Nueva terminal», «Nueva conexión SSH…» y «Nuevo grupo…»: repetía el «+» y la lista de
  conexiones (`terminales/lanzador-de-conexiones.md`).
