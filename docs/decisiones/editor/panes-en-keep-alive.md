# Cada pestaña del editor es un pane en keep-alive que presta su buffer y no crea ni dispone modelos

- **Estado:** vigente
- **Ámbito:** `features/editor/EditorPane.tsx` y los hooks `use*DelPane`

## Contexto

Cada pestaña monta su `EditorPane` y solo el activo se ve (`display:none` en el resto). El mismo
archivo puede estar abierto además como diff editable, y los dos tienen que ver el mismo texto,
con un solo estado sucio y un solo guardado.

## Decisión

- El modelo de un archivo lo presta el registro (`acquire`) y lo suelta (`release`) la corrida
  del efecto de carga que lo adquirió. El pane nunca hace `dispose` de un modelo compartido;
  solo del local de un buffer sin título. El sucio y el borrado llegan por suscripción al registro.
- Guardar, convertir y recargar delegan en el registro, que muta el buffer in-place.
- El host de Monaco está siempre montado y con el mismo padre en los tres modos de vista; solo
  cambia la dirección del flex. Moverlo de sitio en el DOM lo desmonta y pierde modelo, undo y scroll.
- El trabajo caro (seguir al modelo, dibujar diagramas, el iframe) solo corre con `visible`.
- El foco pendiente del frame siguiente no se lo quita a un modal abierto y no se reintenta.
- Los hooks del pane se llaman en un orden fijo y sus efectos no se reordenan.

## Consecuencias

Disponer un modelo compartido deja al otro titular con un modelo muerto y el fallo es mudo:
el error cae en el filtro de ruido benigno del arranque. Un `useState` nuevo que un efecto cruce
con un store reabre la carrera descrita en `renderer/estado-de-app.md`.

## Descartes

- Un modelo propio por pane con sincronización: dos estados sucios y dos guardados que divergen.
- Montar el envoltorio de la vista dividida solo al dividir: recrea el editor.
