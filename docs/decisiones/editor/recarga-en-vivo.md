# La recarga en vivo solo relee el target activo y nunca un buffer sucio, pero sí le comprueba el borrado

- **Estado:** vigente
- **Ámbito:** `features/editor/recargaEnVivo.ts`, `useRecargaEnVivo.ts`

## Contexto

Cuando un archivo cambia por fuera (un agente, un `git checkout`), las pestañas abiertas deben
releerlo. La decisión de cuáles tiene reglas que se rompen en silencio y por eso vive en un
módulo puro; el efecto (suscribirse al watcher y subir los tokens) está en el hook.

## Decisión

1. **Solo el target activo.** `textModels.reload` resuelve la ruta contra la raíz del proyecto
   activo; por el keep-alive hay panes montados de otros proyectos y recargarlos leería el
   archivo homónimo del proyecto equivocado.
2. **Nunca se relee un buffer sucio**: la recarga usa `setValue`, que descarta el deshacer, y
   sobre una edición a medias destruiría trabajo. Pero «no recargar» no es «no mirar»: a las
   pestañas sucias se les pregunta si su archivo sigue en disco (`panesAComprobar`), porque el
   peor caso es que borren el archivo cuyo único ejemplar son cambios sin guardar.
3. **`parcial` manda sobre la lista.** Si el aviso llegó truncado (una ráfaga tipo `npm install`
   desborda el tope del watcher) se releen todas las pestañas limpias del target.
4. Solo pestañas de archivo: un `untitled` no existe en disco y el id de un `diff` no es una ruta.

## Consecuencias

`panesARecargar` y `panesAComprobar` son complementarios y no se solapan: un buffer limpio ya se
entera del borrado al releer. Unificarlos en una sola lista reabre el caso de la pestaña sucia
sin tachar.
