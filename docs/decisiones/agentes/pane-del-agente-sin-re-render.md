# El pane del agente va memoizado y la columna le pasa props de identidad estable

- **Estado:** vigente
- **Ámbito:** `features/agentes/AgentTerminalPane.tsx`, `agentPaneTipos.ts`, `panesCCPanel.ts`, `store.ts`

## Contexto

La columna mantiene vivo un pane por target abierto de TODOS los perfiles (dos por proyecto). Sin
memo, cada render de la ventana los repintaba todos, y un cambio de perfil produce unos diez: el
coste crecía con el total de proyectos abiertos (medido en `calidad/presupuesto-del-cambio-de-perfil.md`).

## Decisión

- `AgentTerminalPane` es `memo` con `mismasPropsPane`, que recorre la UNIÓN de claves con
  `Object.is`. Solo perdona lo que la columna rehace sin que cambie: `target` (vale su clave) y
  `versionesAgente` (valen sus dos versiones). Una prop nueva queda cubierta sin tocarlo.
- Los avisos del pane reciben la clave o el perfil (`onStatusChange(key, …)`, `onSelectAgent(profileId, …)`)
  y la columna pasa a todos las MISMAS funciones, las del store. Dentro del pane, las refs guardan
  la versión ya ligada a su target.
- Las listas compartidas (`agentsInProfile`, las bases montadas vacías) son constantes congeladas.
- `canExpand` y `expanded` solo llegan al pane activo: los pinta el botón de maximizar, que solo
  existe ahí, y cambian cada vez que el proyecto activo pasa de tener pestañas a no tenerlas.
- Una acción del store que no cambia nada devuelve el MISMO estado: con `{}` Zustand avisa a todos.
- El árbol sigue siendo `ErrorBoundary` > `AgentTerminalPane` con las mismas keys, y los hooks del
  pane no cambian de orden: `memo` no es un envoltorio que monte o desmonte nada.

## Consecuencias

- Una closure o una lista nueva por render en `propsPaneDeTarget` devuelve el coste entero sin que
  nada falle: lo vigila el recuento de `e2e/rendimiento-perfiles.spec.ts`.
- En el mosaico las casillas (seis como mucho) se repintan con cada render de la columna, porque
  `mosaico` es un objeto nuevo. Se acepta.
- Siguen llegando a todos los panes, en eventos poco frecuentes: `tokenFoco`, `robaFoco` y `dbReady`.

## Descartes

- Un comparador escrito prop a prop: la prop que se añada después se quedaría rancia sin avisar.
- Un subcomponente por pane que calcule sus props: cambia la forma del árbol que protege la sesión.
