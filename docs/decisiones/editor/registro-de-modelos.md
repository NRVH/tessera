# Un registro con refcount es el único dueño de cada buffer y nunca reemplaza su modelo

- **Estado:** vigente
- **Ámbito:** `features/editor/modelRegistry*.ts`, `textModelRegistry.ts` y sus titulares: `useCargaDelPane.ts`/`useMonacoDelPane.ts` (EditorPane) y `diffEditorCarga.ts`/`diffEditorMontaje.ts` (DiffEditorPane)

## Contexto

El mismo archivo puede estar abierto como pestaña normal y como diff editable del working tree.
Con una copia por panel habría dos buffers, dos estados sucios y dos guardados: escribir en uno
pisaría en silencio lo del otro.

## Decisión

- Hay UN buffer por (proyecto, ruta), con refcount. El registro crea y dispone el modelo; nadie
  más. **Nunca lo reemplaza: solo muta su contenido** (`setValue`). Recargar, descartar cambios y
  reabrir con otra codificación son mutaciones in-place.
- `refs++` es síncrono, antes de cualquier `await`. Cada corrida de un efecto suelta exactamente
  lo que adquirió. Un panel que ya no es titular no dispone un modelo compartido.
- Las guardas post-await comparan la entrada por identidad: el buffer puede haberse cerrado y su
  key reciclada. Las cargas fallidas se borran por identidad, no por clave.
- Un archivo borrado por fuera conserva el buffer y se marca; Ctrl+S lo recrea, previa
  re-pregunta si el buffer está limpio (un `git checkout` desenlaza y recrea el archivo).
- Si el contenido leído es igual al del buffer no se toca el modelo: `setValue` limpia la pila de
  deshacer y el eco del watcher tras cada guardado la vaciaría.
- El núcleo no importa Monaco; el binding vive en `textModelRegistry.ts` y el loader es
  `files.read`, el mismo camino que la pestaña normal (una sola detección de codificación).
- `acquire` y `reload` solo se llaman desde el target activo: `files.read` resuelve contra la
  raíz del proyecto activo.

## Consecuencias

- Recrear un modelo con dos titulares deja al otro con un modelo muerto: pantalla en blanco y
  muda, porque el «TextModel got disposed» cae en el filtro de ruido del arranque.
- No entran los buffers sin título: no tienen ruta ni se comparten.

## Descartes

- `pushEditOperations` con el rango completo (conserva el deshacer): dejaría deshacer un descarte.
- «Acquire primero, release del anterior después»: dobles releases al cambiar de archivo deprisa.
