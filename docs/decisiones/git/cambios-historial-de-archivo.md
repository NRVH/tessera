# El historial de un archivo resuelve su repo por la ruta y distingue «preparando» de «no aparece»

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/git/{HistorialArchivo.tsx,useHistorialArchivo.ts}`

## Contexto

La historia de un archivo se lee comparando commits consecutivos: pide ver la lista y el cambio a
la vez. En una contenedora con varios repos, el dueño del archivo no es el repo seleccionado.

## Decisión

- Es una pestaña de la franja de Git, junto al log: son dos consultas distintas sobre lo mismo y
  se alterna entre ellas. Un panel flotante se comía el sitio del explorador y enseñaba una lista
  sin contexto.
- `fileHistory(path)` se llama SIN repo, a propósito: con un repo explícito el main deja de
  deducir el dueño por la ruta, y si no es el del archivo `toRepoPath` devuelve la ruta intacta y
  git la busca en el repo de al lado (cero commits para un archivo con decenas). El dueño vuelve
  en la respuesta, se guarda en un ref (no se pinta) y lo usan las peticiones siguientes.
- El diff elegido tiene tres valores: `null` (preparándose), el target y `'no-aparece'` (resuelto,
  pero el archivo no está en ese commit con este nombre). Sin el tercero, `git log --follow`, que
  lista commits anteriores a un rename, dejaba el panel en «Preparando el diff…» para siempre.
- El fallo al preparar UN diff es un estado aparte del de cargar la lista: si falla un commit, la
  lista sigue siendo buena y hay que poder pinchar otro.
- El último commit pedido va en un ref y no se lee del estado: el guard corre dentro de una
  promesa, y un updater de `setState` tiene que ser puro.
- La primera selección es automática: el commit más reciente es el que se mira casi siempre.

## Consecuencias

- Pasar el repo seleccionado a `fileHistory` reintroduce «funciona en unos repos y en otros no».
