# El agente de un proyecto fuera de pantalla se hiberna solo tras N minutos sin E/S

- **Estado:** vigente
- **Ámbito:** `src/main/agents/politicaHibernacion.ts`, `terminalAgente/hibernacion.ts`, `TerminalService.cerrarConArbol`, `transcripts/tareasSegundoPlano.ts`, `features/agentes/useAutoHibernacion.ts`, `shared/ajustesAgente.ts`

## Contexto

Una sesión nativa ociosa ocupa 1,2-1,5 GB (el CLI, sus servidores MCP y sus WebView2; medido):
cinco proyectos abiertos son ~6,5 GB que nadie usa. En Docker lo caro es el contenedor.

## Decisión

- Se cierra SOLO el agente, y solo el de proyectos nativos que no están en pantalla (ni el activo
  ni una casilla del mosaico). Las terminales no se tocan; Docker queda fuera de esta versión.
- El renderer dice QUÉ hay en pantalla y lleva el temporizador; el main MIDE (reloj monotónico de
  la última E/S del pty), decide con una función pura y cierra en el mismo tick. La inactividad es
  el mínimo entre el tiempo sin E/S y el tiempo fuera de pantalla. Sin renderer, nadie hiberna.
- Vetos, todo o nada por proyecto: trabajando, esperando respuesta, texto sin enviar, sin revisar,
  ocupada, contrapresión y TRABAJO PENDIENTE. Medido: Claude Code no emite un byte con una shell o
  un subagente en segundo plano, ni entre las vueltas de un `/loop`; se lee del transcript (tareas
  sin aviso de fin, despertares programados) y, si nadie lo vigila, se da por pendiente.
- El cierre no teclea nada (`^C` y `exit` son entrada en la TUI): mata el árbol (`taskkill /T /F`;
  en macOS, grupos y descendientes con TERM y KILL). Todas las muertes de pty del PROCESO van por
  una sola cola, y la marca y la promesa de la parada son síncronas.
- El main responde al soltar las sesiones y devuelve el chat ANCLADO de cada una, que el pane reanuda.
- En el renderer es un estado propio, `'agente-hibernado'` (se guarda como `'hibernated'`): los
  panes del agente lo tratan como hibernado y la terminal de abajo lo ignora. Ajuste «Hibernar el
  agente inactivo tras» (5 min por defecto, o Nunca). Sin aviso: la pestaña atenuada ya lo dice.

## Consecuencias

- Volver a uno hibernado cuesta unos segundos; en el mosaico los hibernados no cuentan como vivos.
- Una tarea en segundo plano sin aviso de fin deja ese agente sin hibernar hasta que se relance.
- macOS queda escrito y sin verificar.

## Descartes

- Reutilizar `'hibernated'`: la terminal de abajo soltaría su sesión y quedaría una shell huérfana.
- Decidir por el rastreador de turnos: cierra el turno tras 10 s de silencio; solo sirve de veto.
- Cerrar con `closeSession`: teclea `exit` en la conversación del usuario.
