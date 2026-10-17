# Cada petición de archivos o de git dice de qué proyecto es y el main la atiende en el suyo, no en el anclado

- **Estado:** vigente
- **Ámbito:** `src/shared/files-ipc.ts` (`EnProyecto`, `RutaEnProyecto`), `src/main/files/ipc.ts`, `FileService.paraRaiz`, `src/main/clipboard/ipc.ts`, `src/preload/archivos.ts`, `src/shared/git-ipc.ts` (`PeticionGit`), `src/main/git/ipc.ts`, `GitService.paraRaiz`, `src/preload/git.ts`, `src/shared/comprimidos-ipc.ts`, `ComprimidosService`, `src/shared/java-ipc.ts`, `JavaService`, `src/renderer/src/comun/raizDelProyecto.ts`, `features/git/useAccionesGit.ts`, `features/pestanas/useSincronizacionBackend.ts`

## Contexto

El main ancla UNA contenedora, y `setFilesRoot` la cambia en cuanto llega, mientras en el renderer
siguen vivos los panes, el árbol y los paneles de git del proyecto anterior. Una petición que solo
lleve rutas relativas se resolvería contra el ancla: un guardado, un renombrado, un borrado o un
descarte de git de ese momento caería en la MISMA ruta relativa del otro proyecto, y una lectura
del anterior traería el contenido del nuevo. Pasa al cambiar de perfil y al cambiar de pestaña de
proyecto.

## Decisión

- Toda petición de `files:*` que nombra rutas, el pegado desde el portapapeles del sistema, todo
  invoke de `git:*`, el diff de comprimidos y la descompilación de Java (`java:decompile`) llevan `raiz`: la contenedora del proyecto al que
  pertenecen. Es la única ruta del host que el renderer manda, y solo como identidad; las rutas
  siguen siendo relativas.
- El main la atiende en la vista de ESE proyecto (`FileService.paraRaiz`, `GitService.paraRaiz`):
  el servicio anclado si es el suyo, o una vista con su raíz si es otro proyecto ya anclado en la
  sesión. Uno que nunca se ancló, o una `raiz` que falta, se rechaza sin tocar el disco ni correr
  git. Solo quedan fuera la raíz neutra y los buffers sin título.
- Un proyecto recién abierto ya es conocido cuando llega su primera petición: `setFilesRoot` lo
  registra en los dos servicios, sale en un efecto de LAYOUT (antes que los efectos de los paneles
  que piden) y su handler es síncrono, y el IPC entrega en orden. Por eso ni los archivos ni git
  esperan al proyecto confirmado. Si aun así `setFilesRoot` fallara, la petición acaba en su error,
  visible, y no en una espera.
- Las vistas de archivos no vigilan: el vigilante sigue siendo uno, el del anclado. Las de git
  comparten el candado de escritura con el anclado (dos pueden tocar el mismo repo) y su abanico
  de estado va en un ámbito propio, que el cambio de ancla no cancela. Sin `repo`, una vista de git
  resuelve el repo de la contenedora; el repo elegido en el panel lo nombra quien pregunta.
- En el renderer la `raiz` sale de quien es dueño del proyecto, nunca del proyecto activo: cada
  buffer del registro del editor guarda la suya (`RutaArchivo`), y el área del editor (por target),
  el árbol del explorador y los paneles de git la proveen por contexto (`RaizDelProyecto`). Las
  acciones de git que escriben nacen con la de su panel (`AccionesGitDe`).

## Consecuencias

- Guardar, leer, listar, preparar o descartar en un proyecto mientras el ancla cambia a otro
  funciona contra el suyo: no hay ventana en la que un gesto se pierda ni caiga en otro proyecto.
- Los paneles de git (Cambios, Log, diffs, historial) piden en cuanto saben su proyecto y su repo.
- Un canal nuevo con rutas nace con `enProyecto`; `test:raiz-anclada` y `test:git-por-proyecto`
  fallan si alguno se registra sin pasar por `paraRaiz`.
- Aceptar solo raíces ya ancladas no amplía lo que el renderer puede tocar: `setFilesRoot` ya las
  aceptaba.

## Descartes

- Rechazar la petición que no es del anclado: cierra la escritura cruzada, pero un pane que carga
  justo en el cambio se queda con el error, y obliga a esperar al ancla para todo.
- Frenar las escrituras de git en el renderer hasta que el ancla llegue al proyecto que se ve:
  deja un hueco en que el gesto se pierde con un aviso, y la seguridad depende de que cada acción
  nueva se acuerde de pasar por la guarda.
- Sacar la `raiz` del proyecto activo en cada llamada: es justo el valor que cambia en la ventana.
- Una instancia vigilada por proyecto: un vigilante recursivo por carpeta abierta cuesta en grandes
  repos, y los avisos solo importan para lo que se ve.
