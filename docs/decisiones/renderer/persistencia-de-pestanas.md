# El guardado del workspace vive en un temporizador con dueño propio, no en la limpieza del efecto

- **Estado:** vigente
- **Ámbito:** `features/pestanas/usePersistenciaTabs.ts`

## Contexto

El workspace (`workspace-state.json`) se guarda con debounce de 150 ms y deduplicado por
proyección: `serializeWorkspace` descarta lo derivado (`repoState`). Con
`return () => clearTimeout(timer)` en el efecto, el workspace NO SE PERSISTÍA NUNCA: (1) se abre un
proyecto y se programa el guardado; (2) dentro de esos 150 ms el escaneo rellena `repoState`, que
vive dentro de `byProfile`, y el efecto se relanza; (3) React ejecuta primero la limpieza, que mata
el guardado pendiente, y el cuerpo ve una proyección idéntica y sale sin reprogramar. Se midió:
`workspace-state.json` con `byProfile: {}` aunque hubiera un proyecto abierto, y el síntoma se leía
como «se perdieron mis proyectos al actualizar».

## Decisión

- El temporizador vive en un `useRef`; un relanzamiento que no cambia la proyección no toca lo
  pendiente. Solo se cancela al desmontar (efecto con deps vacías), junto al de la lista de perfiles.
- La salida temprana de «sin perfiles» lleva `lastSavedWorkspaceRef.current === null`: tras borrar
  el último perfil hay que seguir adelante, porque el estado vacío es un cambio real y, con el
  temporizador en un ref, salir antes dejaría armado un guardado que reescribiría el `byProfile` de
  un perfil que ya no existe.
- Una lista de perfiles vacía significa dos cosas: antes de `init` no se guarda; después, sí.

## Consecuencias

- No devolver un `clearTimeout` desde esos efectos: reabre la pérdida silenciosa del workspace.
- Los efectos declaran `state.byProfile`, `state.activeProfileId` y `state.profiles` (con un
  `eslint-disable` motivado) para no serializar todo el workspace en cada cambio de estado.
