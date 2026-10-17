# Los iconos del riel se reparten en dos grupos que el usuario decide, y ninguno puede quedarse vacío

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/util/gruposRiel.ts`, `features/layout/ActivityBar.tsx`, `normalizarParticion` en `src/shared/workspace-state-ipc.ts`

## Contexto

El riel tiene dos grupos (arriba y abajo, separados por un filete). Por defecto arriba van las vistas
de la columna lateral y abajo los conmutadores de la franja inferior, pero dónde quiere cada uno el
botón es una preferencia, no una propiedad de lo que abre.

## Decisión

- Cualquier icono se puede arrastrar al otro grupo. Moverlo NO cambia qué abre: Git·Log sigue
  ocupando la franja inferior aunque su botón esté arriba. El filete solo separa lo que el usuario
  puso a cada lado.
- Cada icono conserva su semántica a los dos lados: los de vista son un radio (siempre hay una
  activa), los de panel un interruptor (pulsar el abierto lo cierra).
- Un grupo no puede quedarse vacío: con un solo icono, arrastrarlo fuera no hace nada, porque un
  lado en blanco no se podría deshacer desde la interfaz.
- La operación entre grupos es `moverEntreGrupos`, hermana de `reorderByDrag` y no un parámetro suyo:
  opera sobre DOS listas. El saneado del archivo de ajustes es `normalizarParticion`, que reparte
  todos los ids entre los dos grupos con cada uno exactamente una vez.
- `activityBarOrder` y `bottomBarOrder` conservan su nombre (renombrarlos reiniciaría la preferencia
  de todo el mundo), pero su contrato es una PARTICIÓN, no dos conjuntos estancos.

## Consecuencias

Sin `normalizarParticion` el icono movido volvería a su grupo de fábrica en el siguiente arranque.
Un icono nuevo del riel entra en la partición por defecto y el saneado lo coloca si falta.

## Descartes

- Un parámetro en `reorderByDrag`: mezcla una operación de una lista con una de dos.
- Grupos fijos por tipo de icono: obligaba a cada uno a tener el botón donde decidió el diseño.
