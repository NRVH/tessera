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
- La React key del pane es `ssh|perfil|sN`, sin el modo del proyecto: alternar nativo y Docker no remonta una sesión
  que no depende de él. Un id `sN` no se reutiliza.
- Cerrar un proyecto no las cierra, solo olvida cuál se miraba en él; cerrar el perfil las poda, pero solo cuando las
  pestañas ya cargaron (antes, «ninguno» es «aún no hay datos»). Hibernar el perfil tampoco: el pane ignora `hibernated`.
- Se abre sola solo la primera vez que se ve. Si falla o termina, volver a mirarla no reintenta: lo hace
  «Reconectar», que vuelve a leer la conexión (una edición se aplica entonces; una eliminada deshabilita el botón,
  con su motivo). No se reabren al arrancar la app.
- El nombre es el alias, con « (n)» si la conexión se repite, y sigue al alias nuevo salvo renombrado a mano; una
  conexión eliminada conserva el último.
- Al terminar: 255 en menos de 20 s es «No se pudo conectar», con el motivo si el main lo clasificó; 255 después, «Se
  cortó la conexión»; 0, «La sesión terminó»; otro código, «(código N)». Un 255 sin motivo pudo darlo el comando
  remoto, así que no se inventa uno.
- Solo texto: pegar no manda rutas ni imágenes y soltar un archivo no escribe nada (la ruta de aquí no vale allí).

## Consecuencias

- Pasar el modo del proyecto o `hibernated` al pane SSH reabriría o mataría sesiones remotas sin que nadie lo pida.
- La lista de conexiones no importa las terminales: recibe por props las pestañas abiertas de cada conexión.

## Descartes

- Pestañas SSH por proyecto: obligaba a abrir un proyecto para entrar a un servidor y duplicaba la sesión en cada uno.
- Reabrirlas al arrancar: una sesión remota no se restaura y la contraseña se vuelve a teclear.
