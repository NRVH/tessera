# Con el agente oculto y maximizado a la vez, manda el oculto y se ve el editor

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/layout/layoutCentro.ts` (`maximizadoCoherente`, `derivarLayoutCentro`), su uso en `App.tsx` y `e2e/agente-maximizado.spec.ts`

## Contexto

El centro de la ventana se decidía con booleanos sueltos y, en la combinación agente maximizado
+ agente oculto + pestañas de editor, se ocultaban a la vez el editor (por el maximizado) y la
columna del agente (por el oculto): el centro quedaba vacío. El oculto suma la vista dividida
del archivo activo y el maximizado es de la ventana, no del proyecto, así que la combinación se
alcanza sin que nadie la pida: pasar a otro proyecto cuyo archivo activo está dividido, o cerrar
la pestaña activa desde fuera del editor y activar una dividida.

## Decisión

- En el origen, `maximizadoCoherente`: ocultar CANCELA el maximizado. `App` la aplica en cada
  render (ajuste de estado durante el render, sin efecto) y deja `ccExpanded=false`. Es un
  punto fijo y solo puede pasar de true a false.
- Como defensa, `derivarLayoutCentro` no cuenta el maximizado si la columna está oculta con
  pestañas (`expandidoEfectivo`) y muestra el editor. La función sigue siendo total: ninguna de
  las 2304 combinaciones deja el centro vacío.
- Solo cambian `editorOculto` y `cc.grow` respecto a la fórmula previa (96 combinaciones);
  el resto de 'files' y 'git' queda con paridad literal, y la prueba la fija.

## Consecuencias

- Al volver al proyecto donde se maximizó, el agente ya no vuelve maximizado (igual que tras
  ocultarlo a mano).
- Sin la cancelación en el origen, un maximizado rancio resucitaba al irse la vista dividida y
  el editor desaparecía bajo el ratón. Sin la defensa, la función deja de ser total.

## Descartes

- «Maximizado manda»: enseñaría la columna mientras la barra de estado dice que está oculta, y
  no se vería el editor dividido que se acaba de elegir.
- Maximizado por proyecto: cambiaría 'files' y 'git' fuera de este estado y no cerraría el
  camino dentro del mismo proyecto.
