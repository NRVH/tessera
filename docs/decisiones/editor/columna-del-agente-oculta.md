# El motivo de ocultar la columna del agente se guarda («diff» o «manual»), no un booleano

- **Estado:** vigente
- **Ámbito:** `features/editor/centerPane.ts` (`siguienteMotivoCcOculto`), `useColumnaAgente`

## Contexto

La columna del agente se oculta por dos vías que se deshacen distinto: el colapso temporal al
abrir un diff (una comparación se lee mejor a todo lo ancho) y la decisión del usuario desde la
barra de estado. Un booleano `ccHidden` se quedaba en `true` tras el primer diff y ningún
camino lo bajaba: abrir un archivo del explorador heredaba el colapso.

## Decisión

- El estado es `'no' | 'manual' | 'diff'`. Abrir cualquier pestaña que no sea un diff deshace
  `'diff'` y nunca toca `'manual'`.
- Restaurar se deduce del `kind` de la pestaña, no de una bandera opcional que cada punto de
  apertura tendría que recordar pasar.
- Un colapso pedido no pisa un `'manual'`: desde que la apertura automática del historial también
  colapsa, mover la selección bastaría para deshacer lo que el usuario escondió a mano.
- La vista dividida NO es un motivo de este estado: es una propiedad del archivo que se mira
  ahora y se enciende y apaga sin abrir nada. `useColumnaAgente` la lee del pane activo en cada
  render y la suma a este motivo.
- El agente diferido del proyecto activo tampoco: es del proyecto, y se suma igual
  (`agentes/agente-diferido.md`).

## Consecuencias

- Meter la vista dividida como motivo reabre el fallo: volver a abrir el `.md` ya dividido
  borraba el motivo y devolvía la columna junto a un editor partido en dos.
