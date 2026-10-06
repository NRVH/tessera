# Las terminales viven por ranura, siguen vivas al ocultarse y se reinician con la pantalla limpia

- **Estado:** vigente
- **Ámbito:** `features/terminales/TerminalPane.tsx`, `TerminalsPanel.tsx`, `shellTerminalsModel.ts` y sus hooks

## Contexto

Atar el ciclo de vida del xterm a `[perfil, proyecto]` cerraba el pty al cambiar de perfil y se
perdía lo que corriera dentro. Reiniciar arranca un shell nuevo sobre un xterm sucio: PSReadLine
calcula posiciones absolutas y el prompt salía duplicado, con lo tecleado en la primera línea.

## Decisión

- El pane está atado a su ranura (React key estable: proyecto, ranura y modo). Su efecto de ciclo
  de vida depende solo de `[activated]` y la sesión se cierra únicamente al desmontar. Cambiar de
  perfil, proyecto o terminal solo alterna `visible`.
- La sesión se abre la primera vez que se ve (`activated`), y solo el pane visible tiene contexto
  WebGL (el tope de Chromium es unos 16). Al ocultarse o desmontarse lo DEVUELVE
  (`soltarContextosWebgl`): el addon quita su lienzo sin soltar el contexto.
- El `id` de la ranura es un contador monótono (React key: reutilizarlo reciclaría el xterm de la
  terminal cerrada); el número visible es el hueco libre más bajo y se recicla.
- Reiniciar hace `flow.reset()` y `term.reset()` (no `clear()`: hay que llevarse los modos) DESPUÉS
  de que `terminal.reload` haya salido bien, para que un fallo no borre el historial. Antes de
  arrancar el shell no se escribe nada: un banner movía el prompt dos filas.
- Tras cada `await` se comprueba que `refs.term.current` siga siendo el mismo terminal.

## Consecuencias

- Mover un efecto del pane a un hijo o cambiar sus dependencias rompe el keep-alive.
- El banner solo se usa al despertar de una hibernación, donde no hay un shell arrancando.

## Descartes

- Una lista lateral de terminales: se comía 180 px del ANCHO (una línea de log que no cabe se parte) por una columna
  de casi siempre dos filas: van en pestañas. Matiz a pantalla completa: [riel-de-conexiones.md](riel-de-conexiones.md).
- Conservar el banner esperando al callback de `term.write` antes de lanzar el shell: no bastó,
  porque lo desacompasado no es el pintado sino la fila que el shell da por suya al arrancar.
- Encolar en el renderer la salida de una sesión que aún no se conoce: la respuesta del open y del reload llega antes
  que cualquier salida (el pty nace en el turno en que se responde y su salida sale de un temporizador de 8 ms o de un
  callback nativo; medido en Electron 43, nada emitido a ≥ 2 ms de la respuesta la adelantó).
