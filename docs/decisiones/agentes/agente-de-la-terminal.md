# El agente de la terminal: un agente propio del perfil, a la derecha de la terminal a pantalla completa

- **Estado:** vigente
- **Ámbito:** `src/main/ssh/controlador/espacioTerminal.ts`, `util/carpetaDePerfil.ts`, `profiles/borradoDePerfil.ts`, `profiles/candadoDeBorrado.ts`, `profiles/llegadaDePerfiles.ts`, `bloqueAgenteTerminal.ts`, `features/agentes/useAgenteTerminal.ts`, `storeAgenteTerminal.ts`, `layoutCentro.ts`, `BarraEstadoApp.tsx`, `styles.css` (`.agente-terminal-visible`)

## Contexto

El usuario abría una PowerShell aparte y lanzaba `claude` para pedir ayuda con su red. Lo quiere
dentro de la terminal a pantalla completa, con su historial, sin mezclarse con ningún proyecto.

## Decisión

- Es la TERCERA familia de targets de la columna (tras los proyectos y el espacio de datos):
  `useTargetsTerminal`, un target por agente para cada perfil con el agente preparado.
- Carpeta DEFINITIVA por perfil, `<userData>/terminal/<perfil>` (id validado como hija directa): el
  historial de Claude Code se indexa por la carpeta, así que no cambia nunca. Su `CLAUDE.md` y su
  `AGENTS.md` llevan el bloque `tessera:ssh` (conexiones disponibles para los agentes sin secretos ni
  rutas, cuántas se excluyen, `tssh` y las reglas), regenerado con cada `ssh:cambio`.
- La carpeta vive lo que vive el perfil (decisión del usuario, 5-oct-2026): al BORRAR el perfil sale
  entera, con sus notas, igual que su espacio de datos (`conexiones/<perfil>`, con sus consolas).
  Las dos van a la PAPELERA del sistema, nunca en firme (decisión del usuario, 5-oct-2026): el
  borrado no llega por un canal propio sino que se DEDUCE de la lista de perfiles guardada (E70), así
  que un guardado con la lista recortada por un fallo del renderer se llevaría carpetas que nadie
  quiso borrar, y eso tiene que poder deshacerse. Sus conexiones SSH y su historial de consultas se
  siguen borrando aparte. Lo hace solo el guardado de perfiles (`agents/componer.ts`), para los
  perfiles que desaparecen de la lista y tras cerrar sus sesiones, por una sola vía: los dos dueños
  (`EspacioTerminal` y `EspacioDatos`) le llegan como dependencia y cada uno lleva `shell.trashItem`
  inyectado UNA vez, al nacer en su composición;
  nunca una poda al arrancar. Antes de mandar nada a la papelera se valida como al crearla
  (`util/carpetaDePerfil.ts`, común a las dos carpetas): en las dos plataformas, sin puntos ni
  espacios al final ni `:`; los nombres de dispositivo (`CON`, `aux`…) solo se rechazan en Windows,
  porque en macOS son carpetas normales y el perfil «Aux» tiene la suya. No se toca si un perfil vivo
  da la misma carpeta (mismo id con otra caja: los discos por defecto de Windows y macOS no la
  distinguen).
- Recrear un perfil con el mismo id mientras se borra no puede costarle nada al nuevo (parar el
  contenedor tarda segundos y la papelera reintenta). Dos defensas (`profiles/borradoDePerfil.ts`):
  un CANDADO por id (`profiles/candadoDeBorrado.ts`, un `KeyedMutex`) que el guardado toma para todos
  los perfiles que quita antes de esperar nada y mantiene hasta el final de cada uno, y que esperan
  `ESPACIO_ASEGURAR`, `WORKSPACE_ENSURE` y la apertura de sesiones de ese id (terminal, SSH y agente;
  las sesiones solo esperan, no se lo quedan); y, justo antes de CADA paso irreversible (parar el
  contenedor, el historial, las conexiones SSH, cerrar sesiones y cada intento de papelera, también
  los reintentos), la lista de perfiles de ESE momento: si ha vuelto a existir, ni ese paso ni los
  siguientes. El RELOAD de una sesión abierta también espera al candado del perfil de esa sesión.
- Al revés, un perfil RECIÉN creado: el renderer guarda la lista con 250 ms de espera, así que su
  carpeta o su espacio de datos se pueden pedir antes de que el main lo conozca. `ESPACIO_ASEGURAR` y
  `WORKSPACE_ENSURE` esperan, fuera del candado y con tope de 2 s, a que `SAVE_PROFILES` lo traiga
  (`profiles/llegadaDePerfiles.ts`), y después decide la guarda de siempre: uno que no llega sigue
  siendo «Ese perfil no existe». Se descartó forzar el guardado desde el renderer: los dos caminos
  que piden el espacio de datos viven en pantallas distintas y bastaba con olvidar uno.
- El bloque gestionado del `CLAUDE.md`/`AGENTS.md` de los dos agentes propios lo escribe un solo
  escritor (`escribirBloqueContexto` de `db/agentMemory.ts`), cada uno con sus marcas.
- La papelera mueve la entrada tal cual. Medido en Windows 11 con `shell.trashItem` de Electron 43: una
  carpeta con una unión dentro, una carpeta que ES una unión y un enlace simbólico de directorio llegan
  a la Papelera de reciclaje como enlaces y su destino no se toca (tampoco al vaciarla con el borrado
  del shell). Una carpeta con un archivo abierto sin compartir o que es el directorio de trabajo de un
  proceso vivo falla ENTERA («Operation was aborted», sin mover nada), así que no queda a medio
  borrar. Si falla, tres reintentos de 300 ms (una sesión que aún se está cerrando) y, si sigue, la
  carpeta SE QUEDA en su sitio y se registra; no rompe el guardado. En Windows, Electron aborta lo que
  no cabe en la Papelera en vez de borrarlo (según su código, `PreDeleteItem` sin
  `TSF_DELETE_RECYCLE_IF_POSSIBLE`; no medido). En macOS (`trashItemAtURL`, un movimiento a la Papelera
  del usuario) queda SIN VERIFICAR. Las conversaciones viven en la cuenta y no se tocan: recrear el
  perfil con el mismo id las reencuentra.
- `ESPACIO_ASEGURAR` rechaza un perfil que el main no conoce: si no, uno recién borrado volvería a
  tener carpeta.
- Nativo siempre y con la cuenta personal; su modo no se puede cambiar. Selector CC/Codex propio
  (`agentePorPerfil`): no cambia el agente de los proyectos del perfil.
- Solo a pantalla completa de la terminal (`lay.agente === 'terminal'`, decidido por la función pura).
  Una rejilla CSS sobre `.shell-main` lo pone a la derecha SIN desmontar nada; salir del modo lo
  OCULTA y su sesión sigue viva. La preferencia de verlo se guarda por perfil; su ancho (640 px, unas
  80 columnas) es de la sesión.
- UN solo conmutador, como el del agente de datos: el de la barra de estado y Ctrl+Alt+B / ⌥⌘B lo
  muestran y ocultan con la terminal a pantalla completa y un perfil, esté a la vista o no.
- «Cerrar el agente de la terminal», en la cabecera de su pane, lo saca de los abiertos y desmonta
  su pane: una sesión nativa ociosa ocupa 1,2-1,5 GB. Su conversación queda en el historial.
- Foco: entrar o salir de pantalla completa no lo mueve; mostrarlo o cambiar de agente lo lleva a él
  (una bandera de un commit), y ocultarlo o cerrarlo lo devuelve a la terminal.
- En v1 no monta bases: su selector de montaje no se pinta.
- Hibernación coherente: hibernar un perfil cierra en el main TODAS sus sesiones; el renderer marca
  también sus targets que no son pestaña (este y el agente de datos) y se reabren al volver a verse.

## Descartes

- Reutilizar el espacio de datos: mezclaría su historial con el del agente de datos.
- Conservar la carpeta al borrar el perfil: un perfil nuevo con el mismo nombre (mismo id) heredaba
  notas y un `CLAUDE.md` con conexiones ya borradas.
- Borrarla en firme (`rm`), como hasta el 5-oct-2026: con el borrado deducido de la lista guardada,
  un fallo del renderer perdería notas y consolas sin vuelta atrás.
- Solo comprobar la lista antes de cada paso, sin candado: no cubre lo que pasa DURANTE el paso (parar
  el contenedor tarda segundos), en que el perfil recreado ya podría abrir sesiones o sembrar su carpeta.
- Usar el `profileLock` del sandbox como candado del borrado: `stopContainer` lo toma dentro y no es
  reentrante.
- Caer al borrado en firme cuando la papelera falla: es justo el caso en que no se puede deshacer.
  Una carpeta que se queda ocupa poco y se ve en el registro.
- Una pestaña de agente dentro de la franja: habría que reparentar el pane y eso mata la sesión.
- Un proyecto real en la banda de pestañas: la carpeta no es un proyecto y llenaría la banda.
- Un botón propio en la cabecera de la terminal: repetiría el del pie, que ya cubre los dos sentidos.
