# El menú contextual agrupa con separadores y reserva dos columnas distintas: check e icono

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/comun/ContextMenu.tsx`, `contextMenuEstilos.ts` y `contextMenuModel.ts`;
  el de los editores, `menuEditor.ts`, `menuEditorModelo.ts` y `MenuDeEditores.tsx`

## Contexto

Un menú se ordena por tipo de consecuencia: lo destructivo va abajo y aislado, y la distancia hasta esa
opción es la red de seguridad (el rojo `danger` avisa antes de llegar). Además, el menú debe alinear las
etiquetas de todas las filas aunque solo algunas traigan check o icono.

## Decisión

- Se agrupa con separadores, no con cabeceras de grupo: con menos de unas quince opciones la cabecera
  ocupa tanto como lo que agrupa.
- El check y el icono son DOS columnas independientes, cada una reservada en todo el menú en cuanto una
  sola fila la usa. Los sistemas de diseño que las tratan por separado (columna de marca y columna de
  imagen) lo hacen porque un menú puede combinar ambas.
- El margen entre el check y la etiqueta es de 4px: lo notan los menús conmutables (filtros del historial
  de git, selector de repositorio), aunque hoy ninguno combine check e icono. La barra de estado usa
  clases propias (`statusbar-menu-*`).
- El menú detiene la propagación del `mousedown` para que clicar una opción no lo cierre antes de
  disparar su acción; el cierre global es `mousedown` fuera o Escape.
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

- Cabeceras de grupo con título: solo compensan en menús muy largos.
