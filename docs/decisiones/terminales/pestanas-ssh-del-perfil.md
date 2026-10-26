# Las pestañas SSH son del perfil, se ven sin proyecto y no se reabren solas

- **Estado:** vigente
- **Ámbito:** `features/terminales/` (`sshTabsModel.ts`, `activoTerminales.ts`, `finSesionSsh.ts`, `PestanaSsh.tsx`,
  `PilaTerminales.tsx`, `TerminalPane.tsx`, `useTerminalesApp.ts`) y `features/ssh/`

## Contexto

Una conexión SSH es del perfil ([ssh/registro-y-claves.md](../ssh/registro-y-claves.md)) y trabajar en un servidor no
depende del proyecto abierto, ni de cuál ni de que haya alguno. Las terminales locales sí cuelgan del proyecto.

## Decisión

- Las pestañas viven por PERFIL y la elegida, por CONTEXTO (`perfil|ruta`, o `perfil|` sin proyecto). Sin elegida se
  ve la terminal local activa y, sin local, la primera SSH. Elegir o crear una local suelta la elección.
- Se pintan primero, luego un filete y luego las locales. El estado vacío «Sin proyecto abierto» no tapa sus panes y
  ofrece «Conectar por SSH…», que enseña la lista: el riel si se ve y, si no, el lanzador (`lanzador-de-conexiones.md`).
- La React key del pane es `ssh|perfil|sN`, sin ningún modo: el modo de un agente (`agentes/modo-por-agente.md`)
  no remonta una sesión que no depende de él. Un id `sN` no se reutiliza.
- Cerrar un proyecto no las cierra, solo olvida cuál se miraba en él; cerrar el perfil las poda, pero solo cuando las
  pestañas ya cargaron (antes, «ninguno» es «aún no hay datos»). Hibernar el perfil tampoco: el pane ignora `hibernated`.
- Se abre sola solo la primera vez que se ve. Si falla o termina, volver a mirarla no reintenta: lo hace
  «Reconectar», que vuelve a leer la conexión (una edición se aplica entonces; una eliminada lo deshabilita, con su
  motivo). Reconectar vive donde se ve el fallo, no en la cabecera del panel: la franja bajo la terminal terminada,
  Intro en ella y el menú de la pestaña. Mientras conecta se puede cancelar; cerrar la pestaña es desconectar, así
  que no hay un «Desconectar» aparte. Abrir varias pestañas de la misma conexión sigue permitido.
- Las pestañas abiertas (conexión, nombre a mano, alias, si es SFTP) se guardan en los ajustes
  (`sshPestanasPorPerfil`) y vuelven al arrancar SIN ELEGIR ninguna: un pane sin elegir no se ve y no abre su sesión,
  así que ninguna se conecta hasta que se mira. Las de una conexión que ya no existe no se vuelven a guardar (solo
  con una lista de conexiones de fiar). La poda de perfiles se repite al llegar las guardadas. Cerrar la última
  terminal local, si no se mira ninguna SSH, elige la primera del perfil aunque venga restaurada (`cierreLocal.ts`):
  es un gesto del usuario, y sin elegida el panel se quedaba sin terminal y la columna del agente se lo comía.
- El nombre es el alias, con « (n)» si la conexión se repite, y sigue al alias nuevo salvo renombrado a mano; una
  conexión eliminada conserva el último.
- Al terminar: 255 en menos de 20 s es «No se pudo conectar», con el motivo si el main lo clasificó; 255 después, «Se
  cortó la conexión»; 0, «La sesión terminó»; otro código, «(código N)». Un 255 sin motivo pudo darlo el comando
  remoto, así que no se inventa uno.
- Solo texto: pegar no manda rutas ni imágenes y soltar un archivo no escribe nada (la ruta de aquí no vale allí).

## Consecuencias

- Pasar un modo de agente o `hibernated` al pane SSH reabriría o mataría sesiones remotas sin que nadie lo pida.
- La lista de conexiones no importa las terminales: recibe por props las pestañas abiertas de cada conexión.

## Descartes

- Pestañas SSH por proyecto: obligaba a abrir un proyecto para entrar a un servidor y duplicaba la sesión en cada uno.
- Reconectarlas todas al arrancar: una sesión remota no se restaura, y abrirlas de golpe dispararía contraseñas,
  segundos factores y esperas de equipos caídos. Por eso vuelven sin conectar.
- Restaurar también cuál se miraba: esa conectaría sola al arrancar.
- Grupos de conexiones anidados: mucho cambio (formato, lanzador, riel, formulario, `tssh ls`) para pocas listas
  que lo necesiten; el filtro ya encuentra cualquier conexión.
