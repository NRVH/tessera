# La columna del agente mantiene vivos todos los panes y el mosaico no cambia la forma del árbol

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/agentes/CCPanel.tsx`, `panesCCPanel.ts`, `useCCPanelMosaico.ts`

## Contexto

Cada pane del agente es dueño de una sesión (pty, xterm, chat). React desmonta un elemento si
cambia su tipo, su key o su padre, y desmontar un pane cierra su sesión. La columna alterna
perfiles y proyectos, se pliega y enseña varias sesiones a la vez (el mosaico) sin cerrar ninguna.

## Decisión

- Se monta un pane por cada target de agente ABIERTO, de todos los perfiles, con
  `key = target.key` (más `|host` en modo nativo: cambiar de modo sí remonta). Solo el del
  target activo es visible (ninguno si su agente está diferido: `agente-diferido.md`); el resto, vivo.
- Una sesión se cierra solo al salir su target de la lista o al desmontar la columna.
  Plegarla es `display: none`, y el estado vacío es un overlay, no un reemplazo.
- El mosaico vive en la columna porque ahí están ya todas las terminales: la columna pasa a
  rejilla CSS y enseña hasta seis de los panes que ya mantenía vivos. Solo cambian clases,
  estilos inline y props; el árbol es el mismo en los dos modos: `ErrorBoundary` (con la
  misma key) > `AgentTerminalPane`, sin envoltorios que dependan del modo. Por eso las props
  de cada pane se calculan con funciones (`panesCCPanel.ts`) y no con un subcomponente.
- La distribución del mosaico se calcula EN EL RENDER y no en un efecto: con un efecto la
  primera pasada no tendría celdas, todas las casillas se esconderían y la terminal en uso
  soltaría y volvería a crear su WebGL.
- Las casillas se deciden en caracteres: el cromo de cada casilla calca la cuenta del ajuste
  de xterm (`CROMO_CASILLA`), y se mide la columna con un ResizeObserver, no con una
  container query (`contain` rompería los menús `position: fixed` de los panes).

## Consecuencias

- Añadir un envoltorio, cambiar una key o mover el `ErrorBoundary` según el modo cierra
  sesiones al entrar o salir del mosaico. Otro alto de cabecera o pie exige `CROMO_CASILLA`.

## Descartes

- Una ventana aparte para el mosaico: el main habla con una sola, no hay forma de engancharse
  a una sesión abierta y un pty tiene un único tamaño por el que dos vistas se pelearían.
- Mover los nodos de las terminales a otro contenedor: no hace falta, ya están juntas aquí.
