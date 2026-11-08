# Nativo o Docker lo elige cada agente; los proyectos no tienen modo

- **Estado:** vigente
- **Ámbito:** `features/agentes/modoAgente.ts`, `store.ts` (`modoPorTarget`, `elegirModoAgente`), `panesCCPanel.ts`, `selectorCuenta.ts`, `PopoverCuenta.tsx`, `MenusAgentPane.tsx`, `CabeceraAgentPane.tsx`, `useCuentasAgente.ts`, `retiroDeCuentas.ts`, `agentesDelProyecto.ts`, `ModalAgenteManual.tsx`, `pestanas/ProjectTabs.tsx`, `terminales/PilaTerminales.tsx`, `shared/workspace-state-ipc.ts` (`agentModeByTarget`, `modosDesdeModoDeProyecto`)

## Contexto

Docker sirve para una cosa: tener varias cuentas del mismo agente a la vez, cada una en su contenedor. Para todo
lo demás (levantar la aplicación, una terminal, leer la carpeta) el equipo del usuario ya lo hace. Atar el modo al
proyecto obligaría a cambiar de modo el proyecto entero para usar otra cuenta en un solo agente.

## Decisión

- **Los proyectos no tienen modo.** La pestaña de un proyecto no tiene menú ni glifo de modo (lleva un icono de
  proyecto), abrir un proyecto no pregunta «¿nativo o Docker?» y no hay un modo por defecto en los ajustes.
- **Cada agente de serie elige el suyo**, en su botón de cuenta: la cuenta del sistema (nativo) o una de
  sus cuentas de Docker, y «Nueva cuenta de Docker…» (crearla corriendo nativo es pasar a Docker con ella).
  El botón es el icono del modo (equipo o contenedor), y el selector un popover con un apartado por modo y una
  tarjeta por cuenta: elegir y administrar quedan separados. Las acciones de una cuenta de Docker van en un menú
  tras el botón «⋯» de su tarjeta, que solo aparece al pasar por ella (`entradasCuenta`, `controlesCuenta.tsx`):
  «Editar configuración…» (abre el contexto de los agentes con esa cuenta elegida), «Renombrar» (en la propia
  tarjeta), «Cerrar sesión…» y, al final y aislado, «Eliminar cuenta…». Un clic de elección nunca cae en una
  acción, y una destructiva pide abrir el menú. Confirmar una acción no cierra el selector. Al pie, «Administrar las
  cuentas…» abre Configuración › Agentes, donde están las cuentas de todos los agentes, también las de uno oculto
  (`abrirGestion.ts`); un agente manual no lo lleva, porque allí no tiene sus cuentas. Cualquier cuenta se
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
- **Un archivo de ajustes con modo por proyecto** (`modosDesdeModoDeProyecto`): el saneado deriva el modo de cada
  agente. Los agentes de serie de un proyecto en Docker siguen en Docker (los de un proyecto abierto aunque
  nunca eligieran cuenta, y los que tenían cuenta guardada), para que quien lo aisló no lo encuentre
  corriendo en su equipo; los demás, nativos. Solo si el archivo no trae aún modo por agente.
- **Un agente en Docker sin cuenta conserva su botón** («Cuenta de <agente>: sin cuenta…»): es la vuelta a nativo.

## Consecuencias

- El historial de conversaciones, el uso y el contexto son de la cuenta: pasar un agente de nativo a
  Docker enseña los de la otra cuenta, como cambiar entre cuentas de Docker.
- Las bases montadas siguen siendo del proyecto y llegan a cada agente con el mecanismo de su modo.
- `test:modo-agente` fija la regla y la migración; `test:selector-cuenta`, qué enseña el selector.

## Descartes

- Un modo del proyecto como valor de partida: es un segundo sitio donde decidir lo mismo, y el usuario
  tendría que razonar sobre cuál manda.
- Terminales de abajo en Docker: no aportan nada que la nativa no haga sobre la misma carpeta, y quien
  quiera entrar al contenedor tiene las herramientas de Docker.
- Cambiar de modo un agente manual ya definido: su instalación y su carpeta están en un solo sitio.
