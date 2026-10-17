# La columna del agente es de cada perfil, y con ella oculta y maximizada a la vez manda el oculto

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/layout/columnaPorPerfil.ts`, `layoutCentro.ts` (`maximizadoCoherente`, `derivarLayoutCentro`), `features/agentes/useColumnaAgente.ts` y `e2e/agente-maximizado.spec.ts`

## Contexto

El centro de la ventana se decide con el maximizado y el oculto de la columna del agente. En la
combinación agente maximizado + agente oculto + pestañas de editor se ocultarían a la vez el
editor (por el maximizado) y la columna (por el oculto): el centro quedaría vacío. El oculto
suma la vista dividida del archivo activo y el agente diferido del proyecto, así que la
combinación se alcanza sin que nadie la pida. Y cada perfil es un espacio de trabajo propio: lo
que se maximiza u oculta en uno no puede aparecer en otro, ni perderse por lo que se hizo allí.

## Decisión

- Maximizado y oculto son de cada PERFIL (`columnaPorPerfil`, efímero como `maximizadoPorPerfil`):
  al volver a un perfil, su columna está como se dejó. Abrir un archivo cambia solo la del perfil
  de sus pestañas.
- En el origen, `maximizadoCoherente`: ocultar CANCELA el maximizado. `useColumnaAgente` lo aplica
  antes de pintar y deja `maximizada=false` en la columna del perfil que se ve; todo lo que la
  vuelve incoherente (sus pestañas, su vista dividida, su agente diferido) es de ese perfil. Es un
  punto fijo y solo puede pasar de true a false.
- Como defensa, `derivarLayoutCentro` no cuenta el maximizado si la columna está oculta con
  pestañas (`expandidoEfectivo`) y muestra el editor. La función sigue siendo total: ninguna de
  las 2304 combinaciones deja el centro vacío.

## Consecuencias

- Dentro de un perfil, al volver al proyecto donde se maximizó tras pasar por uno dividido, el
  agente ya no vuelve maximizado (igual que tras ocultarlo a mano).
- Sin la cancelación en el origen, un maximizado rancio resucitaba al irse la vista dividida y
  el editor desaparecía bajo el ratón. Sin la defensa, la función deja de ser total.

## Descartes

- «Maximizado manda»: enseñaría la columna mientras la barra de estado dice que está oculta, y
  no se vería el editor dividido que se acaba de elegir.
- Maximizado de la ventana: un perfil heredaba el de otro y lo perdía por lo que se hacía allí.
- Maximizado por proyecto: cambiaría 'files' y 'git' fuera de este estado y no cerraría el
  camino dentro del mismo proyecto.
