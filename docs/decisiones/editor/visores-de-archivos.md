# Los visores de archivos piden solo si son del proyecto activo y leen bytes solo por IPC

- **Estado:** vigente
- **Ámbito:** `features/editor/`: `ImageViewerPane`, `ImageDiffPane`, `BinaryViewerPane`, `JavaClassPane` y `ComprimidoDiffPane` (con sus hooks `use*` y módulos `*Carga`/`*Modelo`)

## Contexto

Los panes de todos los proyectos viven montados a la vez (keep-alive) y el main resuelve las
rutas relativas contra el proyecto ACTIVO. Un pane de otro proyecto que leyera al recibir el
tick del watcher pintaría la imagen, el jar o la clase de OTRO proyecto con el mismo nombre.

## Decisión

- Los panes que leen `worktree`/`index` o descompilan (imagen, java, comprimido) reciben
  `targetKey` y `activeTargetKey` y solo piden con ambas iguales; al volver a ser el activo, el
  efecto se re-ejecuta y carga entonces.
- El `fsTick` solo cuenta si algún lado es mutable (disco o índice): un blob de commit es
  inmutable y repedirlo con cada ráfaga del watcher parpadearía «Cargando…». En Java, un fallo
  no se repite por un tick (relanzaría la JVM para fallar igual).
- Los efectos dependen de los campos primitivos de `target`/`bytesLado`, no del objeto, que
  se reconstruye en cada render de `PaneDeTab`; el `eslint-disable` que lo dice se conserva.
- Los object-URL se guardan en un ref y se revocan al cambiar o desmontar; el cleanup no captura
  estado. Una respuesta tardía se descarta por `token`, sin invalidarla por cambiar de proyecto.
- `JavaClassPane` crea su propio modelo (el registro solo carga por `files.read`), `readOnly`
  desde la creación, y no lo rehace si el texto es idéntico (perdería scroll y plegado).
- Su host nace oculto: hacen falta el `ResizeObserver` y `useVisibleLayout`, o la pestaña sale negra.
- Un fallo puede llegar sin texto: se enseña uno de respaldo y los botones de recuperación.

## Consecuencias

Partir un visor en hooks (`useImageViewer`, `useJavaClass`, `useComprimidoDiff`…) mantiene el
orden de estados y efectos del pane; mover un efecto a un hijo lo cambiaría. Los refs y setters
que un hook recibe por parámetro figuran en sus dependencias solo por el linter: son estables.

## Descartes

- Comparar `r.targetKey !== targetKey` al recibir la respuesta: el main hace eco del que
  recibió, así que nunca falla y aparenta una protección que no existe.
- Un efecto de rAF sobre `conFuente` en el pane Java: redundante con el observer.
