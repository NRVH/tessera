# Un agente nativo delega tareas en las cuentas de Docker de su perfil con `tctx delegar`, sin abrir su ventana

- **Estado:** vigente
- **Ámbito:** `src/main/agentes/delegacion/` (`ServicioDelegacion`, `operacionDelegacion`, `lineaDelegada`, `salidaDelegada`,
  `eleccionCuenta`, `finalTarea`, `cuentasDelegables`, `catalogoModelos`, `registroTareas`, `ipc`), `src/shared/delegacion-ipc.ts`, `src/tctx/` (`cuentas`,
  `modelos`, `delegar`, `tarea`, `tareas`), `terminalAgente/apertura.ts` (`prepararContenedor`), los contadores de `terminalAgente/tipos.ts`
  que leen `cupo.ts` y `hibernacion.ts`, el aviso de `briefingCompuesto.ts`, la composición en `agentes/componer.ts` e
  `index.ts`, `src/preload/delegacion.ts` y `src/renderer/src/features/delegacion/`

## Contexto

Quien trabaja con un agente nativo como principal y tiene varias cuentas de Docker en un perfil (por ejemplo, tres de
Codex y una de Claude Code) quiere usarlas como subagentes: mandarles una tarea, esperar el resultado y seguir, sin tener
abiertas sus terminales. Cuando una cuenta agota su uso, quiere pasar a otra con una orden. Otros usuarios prefieren ver
la terminal del agente de Docker, y eso tiene que seguir igual.

Cada cuenta de Docker ya corre en su propio contenedor, que nace con su primer uso y se para a los dos minutos del último
(`sandbox/contenedor-por-cuenta.md`). Los dos agentes tienen un modo no interactivo (`claude -p`, `codex exec`) que
responde y termina. Falta un camino para que un agente nativo arranque ese modo dentro del contenedor de una cuenta y lea
la respuesta, sin cruzar el aislamiento.

## Decisión

### Las órdenes de `tctx`

- **`tctx cuentas`**: las cuentas de Docker del perfil de quien pregunta, con el agente, el nombre, el uso de cada ventana
  con su reinicio y el estado (lista, sin credencial, agotada). Es lo que el agente consulta antes de elegir.
- **`tctx modelos --agente <claude-code|codex> [--cuenta <nombre>|auto] [--actualizar]`**: los modelos y esfuerzos que
  anuncia el CLI de esa cuenta (ver «Modelos y esfuerzos»).
- **`tctx tareas`**: las tareas del proyecto con su id y su estado. Un id se pierde con facilidad (el shell del agente se
  corta, su contexto se compacta) y la tarea sigue gastando la cuenta: sin esta lista no habría forma de encontrarla.
- **`tctx delegar --agente <claude-code|codex> [--cuenta <nombre>|auto] [--modelo <m>] [--esfuerzo <n>] [--solo-lectura] [--sin-esperar]`**: la orden
  llega por la entrada estándar o con `--archivo <ruta dentro del proyecto>`, nunca como argumento: las comillas no
  sobreviven igual en todas las shells (`agentes/buscar-en-el-historial.md`). Lo primero que escribe, en la salida de
  errores, es el id de la tarea. Después espera el resultado y lo escribe en la salida estándar; mientras dura, cada
  30 s dice en la salida de errores cuánto lleva. Con `--sin-esperar` devuelve el id y termina.
- **`tctx tarea <id>`**: el estado de una tarea, el tiempo que lleva, cuánto hace de su última actividad y las últimas
  líneas de su salida; o el resultado, si ya terminó. Con eso el agente que delegó vigila una tarea larga.
- **`tctx tarea <id> --esperar [--max-segundos N]`** espera a que termine. Con `N`, devuelve el control con el código de
  «en marcha» antes del límite de la shell de quien llama, y puede volver a esperar sin consultar en bucle.
- **`tctx tarea <id> --cancelar`** la termina. Espera a que su proceso salga como mucho 15 s, muy por debajo del tope
  de `tctx` (60 s): un proceso que no sale, como el de un contenedor recién reiniciado o un montaje colgado, no puede
  dejar sin respuesta a quien cancela. Vencido ese plazo, la tarea se da por cancelada, su token de bases deja de valer
  y queda escrito en `db.log`; la credencial y el contenedor siguen tomados hasta que el proceso salga de verdad (no se
  desmontan debajo de él), y hasta entonces `--continuar` se rechaza, porque escribirían dos en la misma conversación.
  Lo remata el cierre de la sesión o el de la app. **`tctx tarea <id> --continuar`**, con una orden nueva por la entrada
  estándar, reanuda la MISMA conversación del agente delegado (`claude -p --resume`, `codex exec resume`): así se
  destraba una tarea atorada sin perder lo que llevaba, cancelándola y continuándola con una indicación. Conserva el
  modelo y el esfuerzo salvo que se indiquen otros, y la tarea pasa a depender de la sesión que la continúa.

Códigos de salida distintos para cada final, para que el agente que llama decida sin leer el texto: hecha, rechazada
(permiso, cuenta o agente), fallida (el agente delegado terminó con error), en marcha (al dejar de esperar), cancelada e interrumpida. Toda salida que no
es «hecha» dice por qué y qué hacer: otra cuenta, cuándo se reinicia el uso o iniciar sesión en la cuenta desde Tessera.

### Quién delega y en quién

- **Solo delega una sesión nativa**: cualquier agente nativo del perfil (Claude Code, Codex o uno manual) o la terminal
  del usuario. El perfil, el proyecto y quién
  pregunta salen del token de la sesión, nunca de la petición (como en `tctx buscar`). Un agente en Docker no delega: le
  daría a un contenedor la capacidad de mandar a otro.
- **Solo en las cuentas de Docker del mismo perfil.** Delegar en la cuenta de otro perfil montaría el proyecto de este
  perfil en el contenedor de aquel: el código de un cliente en la cuenta de otro. Es una regla fija, no un ajuste.
- **Solo Claude Code y Codex**, que tienen un modo no interactivo conocido. Un agente manual, no.
- **`--cuenta auto`** elige, entre las del agente pedido, la que tiene más uso disponible en su ventana más ajustada y
  menos tareas en marcha, y salta las que no tienen credencial o pasan del 95 %. Las tareas en marcha cuentan porque
  el uso tarda en reflejar una tarea recién lanzada: varias seguidas caerían en la misma cuenta. Si ninguna sirve, lo
  dice con la hora del primer reinicio.

### Modelos y esfuerzos

- **Tessera no guarda ninguna lista de modelos: pregunta al CLI de la cuenta.** Las listas cambian con cada versión, con
  el plan de la cuenta y con la configuración de la organización. Se pregunta dentro del contenedor de la cuenta, porque
  su versión puede ser otra que la del equipo: en Codex, `model/list` de `codex app-server`; en Claude Code, la respuesta
  de inicialización del modo `stream-json`, la misma de la que sale `supportedModels()` en su SDK, sin mandar ningún
  mensaje, así que no gasta uso.
- **Con la carpeta de la cuenta y en una carpeta neutra.** Sin la cuenta, Claude Code responde con éxito pero solo con los
  alias genéricos, y parecería que no ofrece más: se reconoce (`tokenSource: none`) y no vale como catálogo. En la carpeta
  del proyecto, `-p` cargaría sus hooks y sus servidores MCP.
- **Lo que anuncia el contenedor no es de fiar**: solo pasa lo que tiene forma de nombre, sin secuencias de control. Lo
  que pide quien delega tampoco: `--modelo` y `--esfuerzo` se comprueban con el mismo patrón antes de entrar en una
  línea de arranque, y empiezan por letra o número para que nunca sean una opción.
- **Se comprueba contra el catálogo, y si no se puede leer no se bloquea.** Un modelo que la cuenta no ofrece se rechaza
  con los disponibles; con `auto`, se elige la primera cuenta libre que lo tenga. Sin catálogo, la petición pasa tal
  cual y, si no vale, el CLI lo dice al empezar: delegar no depende de una interfaz que puede cambiar.
- **El catálogo vale una hora** por cuenta; `--actualizar` lo vuelve a leer. Leerlo toma las mismas referencias que una
  tarea: arranca el contenedor si estaba parado, y se para solo después.

### Lo que recibe el agente delegado

- **Lo mismo que esa cuenta en su pestaña de Docker sobre ese proyecto, ni más ni menos.** Quien delega es el usuario
  a través de su agente nativo: lo que el agente de Docker puede hacer si el usuario se lo pide en su pestaña, lo puede
  hacer la tarea. Tessera ya lo acota al nacer (el contenedor de su cuenta, el proyecto montado, nada más del equipo)
  y la tarea no le pone candados de más, que solo la dejarían a medias: las reglas del perfil citan documentos que
  hay que leer con `tctx`. Así que recibe el mismo token del puente que una pestaña, con las bases montadas en el
  proyecto (`tdb`), las conexiones SSH del perfil (`tssh`) y `tctx` (reglas, documentos y búsqueda en su cuenta), y el
  mismo aviso de arranque.
- **Ante el puente es un agente en Docker de su cuenta**: su token se ata a una sesión de agente
  (`agent:delegada-<id>`), así que `tctx buscar` mira solo en su cuenta y no puede delegar a su vez. El token se revoca
  al terminar la tarea.
- **Un aviso de subagente** además: nadie contestará preguntas y lo que escriba al final es lo que recibe quien delegó.
- **Dentro de su contenedor puede instalar** herramientas o servidores MCP para su tarea; se quedan en ese contenedor.
- **Lee y escribe sin preguntar**: Claude Code con `--dangerously-skip-permissions` y Codex con
  `--dangerously-bypass-approvals-and-sandbox`. Es un subagente que hace el trabajo en lugar del usuario, en una tarea
  no hay a quién preguntar y el contenedor ya es el límite. Los cambios caen en la carpeta del proyecto, la misma que
  ve el agente que llama. Con `--solo-lectura`, para una revisión o una consulta, Claude Code corre en
  `--permission-mode plan`, que no modifica nada. Codex no tiene un modo equivalente que funcione en el contenedor: su
  sandbox de solo lectura usa un aislamiento que dentro de Docker no arranca, y entonces no ejecuta ni una orden. Corre
  sin él y la restricción le llega como indicación en su aviso; en Codex es una petición, no un bloqueo, y el anuncio
  al agente que delega lo dice.
- **La orden viaja en un archivo** de la carpeta de la cuenta (montada en el contenedor) que el CLI lee por la entrada
  estándar y que se borra al terminar: una orden larga no cabe en una línea de arranque.

### Ciclo de vida

- La tarea toma el refcount del contenedor de la cuenta (lo arranca si estaba parado) y el de su credencial, y los
  suelta al terminar; el contenedor se para a los dos minutos como siempre. No hace falta pestaña abierta ni visible.
- **El límite de contenedores y la saturación no paran uno con tareas en marcha**: no tienen pestaña que las reabra.
  Arrancar el de una tarea no espera turno en el límite.
- **La sesión que delegó no hiberna por inactividad** mientras tenga tareas en marcha: hibernarla las cancelaría.
- **Sin tope de tiempo ni de número.** Una implementación o una batería de pruebas grande puede tardar horas, igual que
  en una pestaña. Quien vigila es el agente que delegó, con `tctx tarea`: decide si espera, la cancela o la continúa con
  otra indicación. El límite de recursos es el de los contenedores de Docker, que ya tiene el suyo
  (`sandbox/limite-de-contenedores.md`).
- **La tarea vive en Tessera, no en el proceso de `tctx`.** Si el agente que llama corta el comando por su propio límite
  de tiempo (las herramientas de shell de los agentes suelen tenerlo de minutos), la tarea sigue; se retoma con
  `tctx tarea <id>`. El anuncio se lo dice: una tarea larga, con `--sin-esperar` y vigilada.
- **Nada queda huérfano**: si la sesión que delegó se cierra, sus tareas se cancelan. Si se para el contenedor
  (hibernar o borrar el perfil) o se cierra Tessera, la tarea termina con él. Una tarea sin nadie que la vigile no
  sigue gastando la cuenta.
- **Un apagado no pierde el rastro.** Las tareas sin terminar se registran en los datos de Tessera, fuera de todo
  contenedor, para que nada de lo que escriba un agente delegado decida qué se reanuda ni dónde. Al arrancar, las que
  seguían en marcha pasan a **interrumpida** durante siete días: `tctx tareas` las lista y `--continuar` reanuda su
  conversación desde cualquier sesión del mismo perfil y proyecto. Nunca se reanudan solas: no habría quién las
  vigilara. Una que termina antes del corte no se registra; su conversación sigue en el historial de la cuenta.
- **Dos tareas que escriben comparten la carpeta del proyecto.** `tctx delegar` avisa si ya hay otra en marcha; no las
  aísla.
- La conversación de una tarea queda en el historial de su cuenta, como cualquier otra de esa cuenta.

### Lo que el usuario ve

- **Ninguna ventana.** Quien quiera la terminal de la cuenta la abre como siempre; quien no, la oculta y delega igual.
- **Un indicador en la cabecera del pane que delegó** (o de la franja de terminales, si delegó la terminal) mientras haya
  tareas en marcha: cuenta, tiempo y cancelar. Con varias, un solo chip con su número y un desplegable con la lista: la
  cabecera no crece con diez tareas. Cada fila dice la cuenta con sus límites de 5 h y semanal
  (`agentes/uso-ventanas-de-la-cuenta.md`). Confirmar la cancelación cierra la pregunta al momento: el chip dice «Cancelando…»
  mientras dura y, si falla, su fila lo dice y se puede volver a intentar. Nada retiene la ventana.
- **Al terminar bien**, el chip confirma en su sitio y se retira solo (un único aviso de éxito; la respuesta ya la tiene el
  agente). **Al fallar**, queda en rojo hasta que se mira, con el motivo, lo que dijo el agente y lo último que hizo, y
  se descarta. No se reintenta desde aquí: el fallo ya lo recibió el agente que delegó, que decide.
- El indicador es su propia feature del renderer (`features/delegacion/`), de la que dependen la cabecera del agente
  y la de la franja de terminales sin depender una de otra. La pieza del uso de la cuenta le llega por prop desde ellas:
  es de los agentes, que a su vez pintan el indicador.

### Anuncio

El aviso de arranque de un agente nativo, solo en un perfil con alguna cuenta de Docker de Claude Code o Codex con su
sesión iniciada, anuncia en pocas líneas `tctx cuentas`, `tctx modelos`, `tctx tareas`
y `tctx delegar`, lo que tiene el agente delegado y que no ve la conversación de quien delega. No lista las cuentas: cambian durante la sesión y `tctx cuentas`
las da al momento.

### Plataformas

Va por el puente y el buzón, iguales en las tres. Con Docker detenido, la tarea lo inicia antes de arrancar y, si no lo
logra, termina fallida con el motivo (`sandbox/iniciar-docker-al-necesitarlo.md`).

## Consecuencias

- El gasto de las cuentas de Docker puede crecer sin que el usuario mire sus terminales; el indicador es lo que lo hace
  visible.
- Los eventos de cada CLI (`stream-json` de Claude Code, `--json` de Codex) son un contrato con él: sus pruebas fijan
  los que se leen, tomados de los CLIs de verdad dentro de un contenedor de cuenta.
- En la terminal interactiva de Windows no se ven los avisos de `tctx` por la salida de errores (el atajo corre con el
  ejecutable de Electron); un agente los lee igual, porque captura las dos salidas.

## Alternativas descartadas

- **Que el agente nativo llame a `docker exec` por su cuenta**: necesitaría acceso a Docker, conocer los nombres de los
  contenedores, arrancarlos y montar el proyecto; y saldría de la vista de Tessera.
- **Delegar en cuentas de cualquier perfil**: rompe el aislamiento entre perfiles.
- **Un ajuste para mostrar u ocultar las tareas delegadas**: el indicador es pequeño y solo aparece mientras hay algo en
  marcha; un proceso de minutos no corre a escondidas.
