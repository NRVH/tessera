# El agente de un proyecto fuera de pantalla se hiberna solo tras N minutos sin E/S

- **Estado:** vigente
- **Ámbito:** `src/main/agents/politicaHibernacion.ts`, `terminalAgente/hibernacion.ts`, `TerminalService.cerrarConArbol`, `transcripts/tareasSegundoPlano.ts`, `features/agentes/useAutoHibernacion.ts`, `shared/ajustesAgente.ts`, `src/main/agents/presionMemoria.ts`, `vigilanteMemoria.ts`

## Contexto

Una sesión nativa ociosa ocupa 1,2-1,5 GB (el CLI, sus servidores MCP y sus WebView2; medido):
cinco proyectos abiertos son ~6,5 GB que nadie usa. En Docker lo caro es el contenedor.

## Decisión

- Se cierra SOLO el agente, y solo el nativo de proyectos que no están en pantalla (ni el activo
  ni una casilla del mosaico). Las terminales no se tocan; Docker queda fuera de esta versión.
- El renderer dice QUÉ hay en pantalla y lleva el temporizador; el main MIDE (reloj monotónico de
  la última E/S del pty), decide con una función pura y cierra en el mismo tick. La inactividad es
  el mínimo entre el tiempo sin E/S y el tiempo fuera de pantalla. Sin renderer, nadie hiberna.
- Vetos, todo o nada por proyecto: trabajando, esperando respuesta, texto sin enviar, sin revisar,
  ocupada, contrapresión y TRABAJO PENDIENTE: el CLI calla con tareas en segundo plano o un `/loop`,
  así que se lee del transcript y, si nadie lo vigila, se da por pendiente.
- El cierre no teclea nada (`^C` y `exit` son entrada en la TUI): mata el árbol (`taskkill /T /F`; en
  macOS, grupos con TERM y KILL), en una sola cola por proceso y con la marca de parada síncrona.
- El main responde al soltar las sesiones y devuelve el chat ANCLADO de cada una, que el pane reanuda.
- En el renderer es un estado propio, `'agente-hibernado'` (se guarda como `'hibernated'`): los
  panes del agente lo tratan como hibernado y la terminal de abajo lo ignora. Ajuste «Hibernar el
  agente inactivo tras» (5 min por defecto, o Nunca). Sin aviso: la pestaña atenuada ya lo dice.
- Con poca memoria (`presionMemoria.ts`; en macOS, `kern.memorystatus_level`) el plazo baja a 2 min con
  los mismos vetos y se avisa una vez por racha con «Hibernar inactivos ahora» (plazo 0); «Nunca» se
  respeta. Sin tope de proyectos vivos: pararía trabajo en curso y el número depende del equipo.

## Consecuencias

- Volver a uno hibernado cuesta unos segundos; en el mosaico los hibernados no cuentan como vivos.
- Una tarea en segundo plano sin aviso de fin deja ese agente sin hibernar hasta que se relance.
  macOS (también su medida de la memoria) queda escrito y sin verificar.

## Descartes

- Reutilizar `'hibernated'`: la terminal de abajo soltaría su sesión y quedaría una shell huérfana.
- Decidir por el rastreador de turnos: cierra el turno tras 10 s de silencio; solo sirve de veto.
- Cerrar con `closeSession`: teclea `exit` en la conversación del usuario.
