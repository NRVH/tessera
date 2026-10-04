# La terminal del agente abre su sesión la primera vez que se mira y vive hasta desmontarse

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/agentes/AgentTerminalPane.tsx` y sus piezas (`useAgentPane.ts`, `use*AgentPane`/`use*Agente`, `sesionAgente.ts`, `sesionViva.ts`, `xtermAgente.ts`, `terminalAgente.ts`); el xterm, en `terminales/ciclo-del-xterm-comun.md`

## Contexto

Un pane por target abierto, dueño de un pty; abrir cuesta y el mosaico enseña varios a la vez.

## Decisión

- Montar crea el xterm; la sesión se abre la PRIMERA vez que el pane se mira (`activated`, que no
  vuelve a false) y desmontar la cierra. Nada envuelve el nodo del pane: un envoltorio condicional
  lo desmontaría y cerraría la sesión; el mosaico solo cambia clases y estilos en línea.
- Cuatro señales que no se funden: `visible` (seleccionado: ciclo de vida), `mostrado` (se pinta),
  `enPantalla` (hay píxeles: WebGL y sondeos del pie) y `robaFoco` (solo una casilla se lleva el
  teclado). "Se mira" se calcula en un solo sitio para el latch y el reconcile. La salida del pty
  se filtra estrictamente por NUESTRA sesión (el canal es un broadcast).
- El reconcile no abre sin los ajustes cargados, en los DOS modos: en contenedor, abrir con el
  montaje vacío fija el ámbito de `tdb` de TODO el proyecto a nada.
- Reanudar y «nueva conversación» llaman a `abrirSesion` a mano: el reconcile no los ve. Si un
  `open` falla, lo pedido vuelve a la sesión: si no, el reintento reanudaría otra conversación.
- El estado de la sesión es SOLO de `SesionAgente`; soltarla sigue `PLAN_SOLTAR`: solo cierra en
  el main lo que él no cerró ya, y el logout reabre la misma conversación con banner «reanudado».
- Relanzar (actualización nativa) reabre la entrada ANTES del reload: `disableStdin` corta
  también las respuestas del xterm a las preguntas que el CLI hace al arrancar.
- Clic derecho: pega solo si el CLI no sigue el ratón (si lo sigue, pega él: se midió un pegado
  doble); desde el teclado o sin sesión abre el menú para poder copiar.
- Al dejar de ser casilla, un pane escondido recupera el tamaño previo al mosaico: el agente
  sigue escribiendo y partiría el historial al ancho de la casilla. Lo apuntan TODAS las casillas.
- `HOST_ACCOUNT_ID` vale `'windows-personal'` en los dos sistemas: id persistido y compartido.

## Consecuencias

- El orden de los hooks de `useAgentPane` es el de los efectos: no se reordena.

## Descartes

- Mover el nodo de la terminal a otro contenedor al entrar en el mosaico: desmonta el pane.
- No apuntar el tamaño de la casilla seleccionada: también se esconde al salir (otro agente, columna plegada).
