# Un diff se enruta por tipo de archivo, y su modo (lado a lado o unificado) lo decide el ancho

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/editor/` (`PaneDeTab.tsx`, `viewerKind.ts`, `modoDiff.ts`, `diffEditorModo.ts`, `ImageDiffPane`), `git:blobBytes` en `src/shared/git-ipc.ts`

## Contexto

Un diff puede ser de texto, de una imagen, de un documento o de un comprimido, y el visor puede
estar en una columna estrecha (con el agente a la vista) o a todo el ancho.

## Decisión

- Un diff se enruta por tipo igual que una pestaña normal. Una imagen abre `ImageDiffPane`, que pide
  los BYTES de cada revisión por `git:blobBytes` (tope de 50 MiB: protege la memoria del renderer, no
  a Monaco como el de 2 MiB del diff de texto).
- Un visor que no puede enseñar la revisión pedida NO enseña otra en su lugar. Los que leen por RUTA
  (documentos, comprimidos, clases) solo se usan si lo pedido es el disco; un archivo borrado no llega
  a ningún visor, y cuando lo que se ve no es el disco la cabecera lo rotula.
- El SVG se queda en el diff de texto aunque sea una imagen: saber qué trazo cambió vale más que ver
  dos dibujos casi iguales.
- El ANCHO manda el modo: por encima de `UMBRAL_LADO_A_LADO` (el mismo valor por defecto de Monaco),
  lado a lado; por debajo, unificado. El botón de la cabecera fuerza el otro modo AHORA y el forzado
  se descarta en cuanto el ancho cruza el umbral en cualquier sentido. Forzar lado a lado en un
  visor estrecho exige apagar `useInlineViewWhenSpaceIsLimited`, o Monaco lo desharía.
- Se aplica con `updateOptions` desde el `ResizeObserver` que ya tenía el pane, con guarda de ancho
  cero: un pane oculto mide 0 y sin ella todos pasarían a unificado al ocultarse.

## Consecuencias

`test-modo-diff.mts` fija la máquina de estados del forzado. Nada de `container-type` sobre el editor:
implica `contain`, que rompería los elementos `position: fixed` de Monaco.

## Descartes

- Que el botón fije el modo para siempre: con el agente a la vista el diff forzado no cabría.
