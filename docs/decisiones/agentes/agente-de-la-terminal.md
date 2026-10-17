# El agente de la terminal: un agente propio del perfil, a la derecha de la terminal a pantalla completa

- **Estado:** vigente
- **Ámbito:** `src/main/ssh/controlador/espacioTerminal.ts`, `util/carpetaDePerfil.ts`, `bloqueAgenteTerminal.ts`, `features/agentes/useAgenteTerminal.ts`, `storeAgenteTerminal.ts`, `layoutCentro.ts`, `BarraEstadoApp.tsx`, `styles.css` (`.agente-terminal-visible`)

## Contexto

Quien administra servidores o su red necesita pedirle ayuda a un agente sin salir de Tessera ni
abrir una terminal aparte: dentro de la terminal a pantalla completa, con su propio historial y sin
mezclarse con ningún proyecto ni con el agente de datos.

## Decisión

- Es la TERCERA familia de targets de la columna (tras los proyectos y el espacio de datos):
  `useTargetsTerminal`, un target por agente para cada perfil con el agente preparado.
- Carpeta DEFINITIVA por perfil, `<userData>/terminal/<perfil>` (id validado como hija directa por
  `util/carpetaDePerfil.ts`): el historial del agente se indexa por la carpeta, así que no cambia
  nunca. Su `CLAUDE.md` y su `AGENTS.md` llevan el bloque `tessera:ssh` (conexiones disponibles para
  los agentes sin secretos ni rutas, cuántas se excluyen, `tssh` y las reglas), regenerado con cada
  `ssh:cambio`. La carpeta vive lo que vive el perfil: cómo se borra, en
  [../workspace/borrar-perfil-con-orden.md](../workspace/borrar-perfil-con-orden.md).
- El bloque gestionado del `CLAUDE.md`/`AGENTS.md` de los dos agentes propios lo escribe un solo
  escritor (`escribirBloqueContexto` de `db/agentMemory.ts`), cada uno con sus marcas.
- Nativo siempre y con la cuenta personal; su modo no se puede cambiar. Selector de agente propio
  (`agentePorPerfil`): no cambia el agente de los proyectos del perfil.
- Solo a pantalla completa de la terminal (`lay.agente === 'terminal'`, decidido por la función pura).
  Una rejilla CSS sobre `.shell-main` lo pone a la derecha SIN desmontar nada; salir del modo lo
  OCULTA y su sesión sigue viva. La preferencia de verlo se guarda por perfil; su ancho (640 px, unas
  80 columnas) es de la sesión.
- UN solo conmutador, como el del agente de datos: el de la barra de estado y Ctrl+Alt+B / ⌥⌘B lo
  muestran y ocultan con la terminal a pantalla completa y un perfil, esté a la vista o no.
- «Cerrar el agente de la terminal», en la cabecera de su pane, lo saca de los abiertos y desmonta
  su pane: una sesión nativa ociosa ocupa más de un gigabyte. Su conversación queda en el historial.
- Foco: entrar o salir de pantalla completa no lo mueve; mostrarlo o cambiar de agente lo lleva a él,
  y ocultarlo o cerrarlo lo devuelve a la terminal.
- No monta bases: su selector de montaje no se pinta.
- Hibernación coherente: hibernar un perfil cierra en el main TODAS sus sesiones; el renderer marca
  también sus targets que no son pestaña (este y el agente de datos) y se reabren al volver a verse.

## Descartes

- Reutilizar el espacio de datos: mezclaría su historial con el del agente de datos.
- Una pestaña de agente dentro de la franja: habría que reparentar el pane y eso mata la sesión.
- Un proyecto real en la banda de pestañas: la carpeta no es un proyecto y llenaría la banda.
- Un botón propio en la cabecera de la terminal: repetiría el del pie, que ya cubre los dos sentidos.
