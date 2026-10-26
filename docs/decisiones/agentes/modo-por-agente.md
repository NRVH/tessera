# Nativo o Docker lo elige cada agente; los proyectos no tienen modo

- **Estado:** vigente
- **Ámbito:** `features/agentes/modoAgente.ts`, `store.ts` (`modoPorTarget`, `elegirModoAgente`), `panesCCPanel.ts`, `selectorCuenta.ts`, `PopoverCuenta.tsx`, `MenusAgentPane.tsx`, `CabeceraAgentPane.tsx`, `useCuentasAgente.ts`, `retiroDeCuentas.ts`, `agentesDelProyecto.ts`, `ModalAgenteManual.tsx`, `pestanas/ProjectTabs.tsx`, `terminales/PilaTerminales.tsx`, `shared/workspace-state-ipc.ts` (`agentModeByTarget`, `modosDesdeModoDeProyecto`)

## Contexto

Cada proyecto era nativo o Docker y todos sus agentes y su terminal heredaban ese modo. Docker sirve
para una cosa: tener varias cuentas del mismo agente a la vez, cada una en su contenedor. Para todo lo
demás (levantar la aplicación, una terminal, leer la carpeta) el equipo del usuario ya lo hace. Atar el
modo al proyecto obligaba a cambiar de modo el proyecto entero para usar otra cuenta en un solo agente.

## Decisión

- **Los proyectos no tienen modo.** Se quitan el menú de la pestaña, su glifo (la pestaña lleva un icono
  de proyecto), el diálogo «¿nativo o Docker?» al abrir y el ajuste del modo por defecto.
- **Cada agente de serie elige el suyo**, en su botón de cuenta: la cuenta del sistema (nativo) o una de
  sus cuentas de Docker, y «Nueva cuenta de Docker…» (crearla corriendo nativo es pasar a Docker con ella).
  El botón es el icono del modo (equipo o contenedor), y el selector un popover con un apartado por modo y una
  tarjeta por cuenta: elegir y administrar (renombrar en la propia tarjeta, cerrar sesión, eliminar) quedan
  separados, y confirmar una acción no cierra el selector, las acciones solo
  al pasar por la tarjeta, para que un clic de elección no caiga en una destructiva. Cualquier cuenta se
  administra desde cualquier pane: el main cierra todas sus sesiones, el diálogo avisa de cuántos agentes
  abiertos la usan y espera a que termine, y esos panes la sueltan y reabren (`retiroDeCuentas.ts`). El
  modo se guarda por target (`agentModeByTarget`, `perfil|proyecto|agente`) junto a la cuenta (`agentAccountByTarget`);
  sin elección, nativo. Elegir modo y cuenta va en el mismo cambio de estado: el pane se remonta con la
  otra clave y tiene que encontrar ya la cuenta con la que abrir.
- **Vale igual para el agente del espacio de datos**, que deja de tener su modo propio. El de la
  terminal sigue siempre nativo.
- **Un agente manual corre donde se definió**: los nativos son de todo el equipo, los de Docker del
  perfil, porque su instalación vive en un sitio u otro. Un proyecto enseña los de serie, los manuales
  nativos y los Docker de su perfil. Al definir uno nuevo se elige dónde corre; uno existente no cambia.
- **La terminal de abajo es siempre nativa.**
- **Al llegar desde el modo por proyecto**, el saneado de los ajustes deriva el modo de cada agente: los
  agentes de serie de un proyecto que estaba en Docker siguen en Docker (los de un proyecto abierto aunque
  nunca eligieran cuenta, y los que tenían cuenta guardada), para que quien lo aisló no lo encuentre
  corriendo en su equipo; los demás, nativos. Solo si el archivo no trae aún modo por agente.
- **Un agente en Docker sin cuenta conserva su botón** («Docker · sin cuenta»): es la vuelta a nativo.

## Consecuencias

- El historial de conversaciones, el uso y el contexto son de la cuenta: pasar un agente de nativo a
  Docker enseña los de la otra cuenta, como cambiar entre cuentas de Docker.
- Las bases montadas siguen siendo del proyecto y llegan a cada agente con el mecanismo de su modo.
- `test:modo-agente` fija la regla y la migración; `test:selector-cuenta`, qué enseña el selector.

## Descartes

- Mantener el modo del proyecto como valor de partida: era un segundo sitio donde decidir lo mismo, y el
  usuario tendría que razonar sobre cuál manda.
- Terminales de abajo en Docker: no aportan nada que la nativa no haga sobre la misma carpeta, y quien
  quiera entrar al contenedor tiene las herramientas de Docker.
- Cambiar de modo un agente manual ya definido: su instalación y su carpeta están en un solo sitio.
