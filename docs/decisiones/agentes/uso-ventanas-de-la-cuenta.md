# El pie del agente enseña las ventanas de uso que trae la cuenta, sin dar ninguna por supuesta

- **Estado:** vigente
- **Ámbito:** `src/main/uso/ventanasUso.ts`, `features/agentes/BarrasUso.tsx`, `useSondeoUso.ts`, `useDesplegableUso.ts`, `modeloUsoCuentas.ts`, `useUsoCuentas.ts`, `cuentasALaVista.ts`, `UsoCuentasBarra.tsx`, `UsoCuentaTarea.tsx`, `InicioSesionCuenta.tsx`, `piezasUsoCuenta.tsx`, `formatoUso.ts`, la escalera `@container agentfooter` y la de `data-escalon` de `styles.css`

## Contexto

Una línea compacta que enseñe siempre las dos primeras ventanas (`5h` y `7d`) deja fuera las demás:
Claude Code puede llevar dos límites semanales (el general y el de un modelo concreto), y el segundo
solo se vería al desplegar. Qué límites hay depende del plan y cambia: un modelo deja de tener el suyo,
aparece otro, o todo se homologa en uno.

## Decisión

- Se pinta LO QUE LA CUENTA TRAE, en su orden. En Claude Code, cada entrada de `limits[]` con
  porcentaje es una ventana; su periodo sale de `group` (`session` → 5h, `weekly` → 7d) y su nombre
  de `scope` (modelo o superficie) o, sin `scope`, de lo que su `kind` diga tras el grupo. Un grupo
  que no se conoce se pinta con su nombre. En Codex, `primary` y `secondary` y, detrás, cualquier
  otra clave de `rate_limits` con forma de ventana.
- La línea compacta enseña TODAS; el desplegable también, con nombre largo («Semanal Fable»).
- El ancho lo gobierna la escalera del pie según cuántas hay (`data-ventanas`: 2, 3, 4 o más):
  primero ceden las micro-barras, después las últimas ventanas ENTERAS, y sesión y semanal
  aguantan hasta el corte de siempre. Con tres caben todas desde el ancho mínimo de la columna
  (330 px). Como red, una ventana que no cabe entera salta a una fila oculta: nunca se corta.
- **Cada pie es de su cuenta y su conversación.** Su desplegable es un tooltip informativo, que no recibe el puntero.
  **Un solo desplegable del pie a la vez** (`desplegablePie.ts`): al abrirse el del contexto, el del uso se cierra.
- **El uso de las demás cuentas es de la cuenta, no del panel, y vive en la barra de estado**, una sola vez para toda la
  ventana: «Uso de las cuentas» lista las del perfil, de los dos agentes de serie y donde corran (la nativa si tiene
  datos, las de Docker privadas y las globales), con los límites de 5 h y semanal. El icono de cada fila dice dónde corre
  (equipo, Docker del perfil, Docker global). No depende de qué agentes estén ocultos. Lee solo mientras está abierta y
  por cuenta, para no añadir tráfico a un dato con límite por token. Desde seis cuentas lleva filtro, como el selector.
- **Lo que está a la vista no se repite.** Cada pie anuncia su cuenta mientras se ve (`cuentasALaVista.ts`); esa cuenta
  sale de la lista y, si está fijada, de la barra, y vuelve al dejar de verse. Con varios paneles a la vista, salen las de
  todos. La lista lo dice en una línea para que no parezca que falta algo. Una fijada sí se lista aunque esté a la
  vista o haya cerrado la sesión, porque ocupa un hueco y sin su fila no habría cómo quitarla; una de Docker borrada deja
  de ocuparlo y sale de lo guardado al fijar otra.
- **Una cuenta sin sesión** ofrece el botón de inicio de sesión en el hueco del pin, esté fijada o no (nunca pinta el
  pin). Si está fijada, su fila conserva el fondo de fijada y ofrece «Desfijar "{nombre}"» en el menú contextual de la
  fila (clic derecho, Menú o Mayús+F10) para poder quitarla. Al releer una cuenta que ya tiene sesión, el botón que
  ocupa el hueco del pin se funde con él en la misma celda. El pie del panel de tareas también ofrece el botón junto al
  estado de la cuenta. Los dos abren el [diálogo de inicio de sesión](cuentas-por-perfil-y-agente.md#decisión).
  El detalle de uso remite a Configuración › Agentes y menciona el botón de la fila solo si está a la vista junto al detalle.
- **Hasta dos cuentas fijadas por perfil**, en `cuentasFijadasPorPerfil` y no en la copia de la configuración, porque los
  ids de cuenta son de cada equipo. Cada una es una cápsula, como las del pie, para que se vea dónde empieza y dónde
  acaba. Lo fijado en un perfil no se ve en otro, tampoco una nativa o una global: cada perfil enseña lo suyo y la
  barra no recibe cápsulas que no se fijaron en ella. Dos porque la barra se comparte con la rama, el archivo y el
  conmutador de la columna.
- **El botón «Uso de las cuentas» permanece a la derecha de las cápsulas**, junto al conmutador del agente; las
  cápsulas crecen hacia la izquierda. El botón abre la lista, anclada a su borde derecho. Las cápsulas no son botones
  ni responden al clic izquierdo: enseñan la tarjeta de límites con el puntero o el foco de Tab. El clic derecho
  (incluido Ctrl+clic en macOS), la tecla Menú y Mayús+F10 abren `MenuContextual` con «Desfijar “{nombre}”» y «Uso de las
  cuentas…», ambas con icono. La lista y el menú abiertos suprimen la tarjeta. Las cápsulas conservan su entrada, salida y cruce; el
  icono permanece montado al fijar o quitar cuentas.
- **El uso alto y crítico se lee en blanco y peso 600**, incluido el icono de modo: fondos de `--yellow` al 40 % y
  `--red` al 50 % sobre `--bg-deep`, pistas blancas al 25 %, separador al 30 % y rellenos aclarados hacia el blanco.
  Sin nivel se conserva el aspecto neutro.
- **Si no caben, ceden por pasos** (`data-escalon`, `layout/useEscalonBarra.ts`): primero la marca, que es decorativa;
  luego las micro-barras, la ventana que menos aprieta y el nombre. El botón del icono no se oculta en ningún escalón.
  Nunca se enciman; el detalle sigue en el tooltip.
- **En la vista de agentes, la barra no enseña cuentas**: ni la lista ni las fijadas salen, con un fundido, y vuelven al
  regresar a un perfil. El mosaico junta agentes de varios perfiles y no es la vista de ninguno: enseñar las de uno, el
  de la casilla activa o todas juntas, mezclaría cuentas privadas de perfiles distintos o cambiaría con cada clic. Ahí el
  uso va con cada agente: el de su cuenta en su pie y el de sus tareas delegadas en su indicador.
- **Cada tarea delegada enseña solo el agente y el nombre de su cuenta** bajo el resumen. El pie del panel del
  indicador, «Cuentas en uso», reúne cada cuenta una sola vez por perfil, agente e id, en orden de primera aparición
  entre las tareas listadas. `UsoCuentaTarea` enseña su modo, nombre y límites de 5 h y semanal con las mismas celdas
  que la lista; se lee mientras el panel está abierto. La lista de tareas se desplaza y el pie permanece fijo; desde
  unas cuatro filas, las cuentas tienen su propio desplazamiento. Sus filas entran y salen con `Presente` y
  `mov-despliega`. El id de la cuenta llega en la vista del indicador (`VistaTareaPanel`), no en la que reciben los agentes.

## Consecuencias

- Un límite nuevo aparece sin tocar código, con el nombre que le dé el agente (puede salir en inglés).
- Con cuatro o más ventanas, una columna estrecha enseña solo las primeras; el resto, al desplegar.
- `TESSERA_USO_CLAUDE` desvía el endpoint para las pruebas de interfaz, solo a `127.0.0.1`, y la
  petición desviada NO lleva el token de la cuenta. Los anchos están medidos en Windows.

## Descartes

- Una lista fija de ventanas conocidas (sesión, semanal, Fable): esconde justo lo que cambia.
- Medir con JavaScript cuántas caben en el pie: la escalera de CSS ya existía y no añade un observador por pane. En la
  barra de estado sí se mide: lo que cabe depende de la rama, del archivo abierto y de las fijadas, y es un solo
  observador para toda la ventana.
- Las cuentas de los demás agentes en el pie de cada panel: se repetían en cada panel del mosaico y le quitaban sitio al
  uso del propio panel.
- Impedir fijar la cuenta que está a la vista: estar a la vista cambia con el panel y el proyecto, y el botón aparecería y
  desaparecería; se fija siempre y lo que no se repite es la cápsula.
