# La rejilla solo pinta, selecciona y copia; los datos, el servidor y lo pendiente son de su dueño

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/DbRejilla.tsx`, `rejilla/{Rejilla*,useRejilla*,rejilla*}.ts(x)`, `rejilla.css`

## Contexto

La misma rejilla sirve a un cursor vivo de Oracle, un LIMIT/OFFSET de PG y un resultado de consola
que no se puede releer. Vive en pestañas ocultas con `display:none` y dentro de filas con `transform`.
El modelo (ventana, anchos, texto) está en [ui-rejilla-modelo-pintado.md](ui-rejilla-modelo-pintado.md).

## Decisión

- El DUEÑO pide páginas, cuenta, reordena y hace lo que necesita al servidor (exportar, traer todas,
  valor completo); sin su función, la entrada no aparece. La rejilla avisa (`onCargarMas`, `onOrdenar`).
- Capas: raíz `role=grid` con UN punto de tabulación (`aria-activedescendant`), un solo scroll en X e
  Y, cabecera `sticky` y filas con `translateY` con el número `sticky` DENTRO (medido: un `transform`
  rompe el `fixed` de los descendientes, no el `sticky`). Menú y visor van por PORTAL sobre `<body>`:
  ni `transform`, `filter`, `contain` ni `container-type` en la raíz o sus ancestros.
- React repinta solo si cambia el rango visible (el scroll se lee en un rAF) y las filas son `memo`.
- El scroll se guarda en `onScroll` solo con la caja midiendo algo y se reaplica al volver a verse, en
  layout y unos rAF: `display:none` pone `scrollTop` a 0 sin avisar y se suelta un fotograma tarde.
- Copiar va por el portapapeles de Tessera (el de Chromium no es fiable en un renderer aislado);
  `onCopy` es la red del menú Edición de macOS, que resuelve ⌘C sin keydown.
- Menú de DOS PASOS (ni cascada ni trece filas planas): «Copiar como…» y «Exportar a archivo…»
  sustituyen la lista en el sitio; el segundo paso MONTA otro menú, con `key`, que enfoca su primera
  opción. Al cerrarse, el foco vuelve a la rejilla: tras «Copiar» quedaba en `<body>` sin flechas.
- Orden: clic = esa columna (asc → desc → sin orden), Mayús+clic la añade o cicla; el ciclo es del
  dueño, por NOMBRE. El mousedown con Mayús se corta: extendería la selección de texto de la página.
- Edición: lo pendiente es del dueño ([ui-rejilla-modelo-cambios.md](ui-rejilla-modelo-cambios.md)); la
  rejilla pinta la vista (nuevas arriba) y reubica selección y visor por identidad.
- Todo el estado y los efectos son de `DbRejilla`: los hooks `useRejilla*` se llaman en el orden de
  sus efectos, y las acciones reciben el contexto del render (`Rejilla`), no un cierre viejo.

## Consecuencias

Mover un efecto a un hijo o reordenar los hooks cambia el orden de efectos. Un envoltorio DOM nuevo
rompe el CSS (grid y `sticky`) y los e2e, que seleccionan por estructura. Arrastrar la selección más
allá del borde no autodesplaza: se dejó fuera a propósito y el arrastre se acota a lo visible.
