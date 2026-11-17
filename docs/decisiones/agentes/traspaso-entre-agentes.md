# Pasar el trabajo a otro agente: el mismo agente sigue la conversación; otro, recibe un traspaso derivado

- **Estado:** vigente
- **Ámbito:** `src/main/traspaso/` (`ServicioTraspaso`, `rutasTraspaso`, `copiaTranscripcion`, `armarTraspaso`,
  `RegistroTraspasos`, `operacionTraspaso`), `src/shared/traspaso-ipc.ts`, `PeticionAbrirAgente.traspasoId`, la apertura y
  el cierre de `terminalAgente/`, `lineaArranqueAgente.ts` (prompt inicial), `briefingCompuesto.ts`, `tctx traspaso`,
  la reserva de nombres de `sandbox/gestor/montajes.ts` y, en `features/agentes/`, `PopoverCuenta`, `PopoverTraspaso`,
  `continuarEn.ts`, `traspasoPendiente.ts`, `store.ts` (`traspasosPendientes`), `modeloDivergencia.ts`,
  `storeDivergencia.ts`, `DialogoDivergencia.tsx`, `divergencia.css` y `test-modelo-divergencia.mts`;
  `features/agentes/app.ts` y `App.tsx` montan `CapaDivergencia`

## Contexto

Quien tiene varias cuentas y agentes empieza una tarea en uno y quiere seguirla en otro (otra cuenta, el otro
modo, u otro agente). Tessera ya lee las conversaciones de todos los agentes y cuentas desde el host.

## Decisión

- **Un solo lugar**: el botón «Continuar esta conversación» de la cabecera, siempre a la vista. Su popover enseña
  primero las otras cuentas del mismo agente y luego los otros agentes, cada grupo diciendo qué se lleva. El selector
  de cuenta queda para elegir y administrar: un clic allí cambia de cuenta sin llevarse la conversación. Continuar
  tiene que verse sin pasar el ratón por nada. El botón no sale si no hay destino (en nativo, sin cuentas de Docker
  ni otro agente), y el popover abierto se cierra si la sesión termina o empieza una actualización.
- **Mismo agente** (su grupo, marcado «Conversación completa», con todas sus cuentas menos la de ahora): Tessera
  COPIA el transcript (y en Claude Code su carpeta hermana de subagentes) a donde el CLI de destino lo busca:
  Claude Code, `projects/<cwd del destino con lo no alfanumérico a «-»>/<id>.jsonl`; Codex, la misma ruta bajo
  `sessions/`, comprimido o no. El pane pasa a esa cuenta reanudándolo; si el agente tiene un turno en marcha
  (trabajando o esperando una respuesta), se pregunta antes, porque cerrar su sesión se lo corta. Como el CLI de
  origen puede seguir escribiendo, un `.jsonl` se copia solo hasta su última línea completa (terminada en
  salto de línea): el destino nunca recibe un JSON a medias. Medido: los dos CLIs lo cargan aunque el
  `cwd` de dentro sea el del otro modo; el aviso de arranque de esa sesión dice a qué ruta corresponden ahora.
- **Sin seguir enlaces**: solo se comprueban los tramos bajo las carpetas de Docker, que escribe su contenedor.
  Un enlace simbólico (o una unión) llevaría al main a leer una carpeta del equipo hacia otra cuenta, o a escribir
  fuera de la de destino. Las carpetas del sistema no las escribe ningún contenedor y pueden tener enlaces legítimos.
  Antes de leer el contenido de ningún archivo de la copia, se comprueban sus rutas de origen y destino en Docker;
  si hay un enlace, no se copia y se dice por qué. La carpeta de subagentes no se recorre si es un enlace. También
  se comprueba el transcript de origen para el traspaso a otro agente: si hay un enlace en Docker, se prepara sin
  sus mensajes. Al copiar desde cualquier cuenta, el origen se abre una sola vez, se compara el descriptor (`dev`
  e `ino` del `fstat`) con el `lstat` inmediatamente anterior, que debe ser un archivo normal sin enlace, y se copia
  por trozos desde ese descriptor. En Docker se comprueba el destino antes de crear carpetas y antes del `rename`.
  El temporal se crea nuevo (`wx`) tras borrar el que hubiera, así que no se escribe a través de un enlace con su
  mismo nombre.
- **No pisar**: igual, se reutiliza; si lo de destino es el principio del origen (la conversación siguió aquí),
  se pone al día; si hay otro contenido con el mismo id, se pregunta con cuál de las dos copias seguir,
  mostrando su fecha y número de mensajes. La más reciente se recomienda como acción principal (con empate
  o fechas desconocidas, la de origen). Hasta elegir no se modifica nada. Con la de destino se reanuda sin copiar;
  con la de origen, la copia de destino que pierde se aparta con `.aparte-<fecha>`, fuera del historial del CLI,
  y se copia la de origen en su lugar. La apartada no se borra y se puede recuperar de la carpeta de conversaciones.
- **Agente distinto** (su grupo, marcado «Solo un resumen», fuera del mosaico, donde no se puede poner a la vista otro agente): un
  **traspaso derivado**, armado sin
  un modelo: los últimos mensajes de texto de usuario y agente (sin herramientas, imágenes ni razonamiento), los
  más recientes dentro de un tope, y `git status --short` y `git log --oneline -5` en el host. Su pestaña se abre
  con una conversación nueva cuyo primer mensaje pide leerlo con `tctx traspaso`, resumir y esperar; si tiene un
  turno en marcha (trabajando o esperando una respuesta), se pregunta antes. El origen sigue abierto.
- **El main prepara y el renderer abre**: `continuarEn` deja un pendiente en memoria y devuelve su id (y la
  conversación a reanudar); el pane de destino lo toma al abrir como cualquier apertura (`traspasoId`). Sin
  abrirse en 10 minutos caduca, y la entrada del store que lo espera lleva esa misma caducidad (contada desde
  antes de pedirlo, así que caduca antes que la del main): al caducar, o si el pane cambia de modo o cuenta tras
  haber coincidido, se descarta; nunca se cierra una sesión viva para abrir uno caducado. La apertura TOMA el
  pendiente al empezar (dos aperturas solapadas no lo comparten) y lo devuelve si falla; si el main ya no lo
  tiene, la apertura falla con un error reconocible y el pane lo dice en vez de abrir un chat vacío. El traspaso queda atado a esa sesión (la que se ató a su token): `tctx traspaso`
  lo da solo a ella, las veces que lo pida (puede perderlo al compactar o fallar dentro del sandbox), y se borra
  al cerrarla. No va a disco ni a ningún repositorio. Mismo perfil y proyecto siempre.

## Consecuencias

- La copia deja la conversación en las dos cuentas: seguir en una no cambia la otra.
- Los agentes manuales no son origen ni destino (no hay formato que Tessera conozca).
- En Docker, la carpeta de Claude Code depende del nombre del montaje (`/workspace/<carpeta>`, o `-2` si choca):
  se calcula con el registro de montajes del contenedor de esa cuenta y el nombre queda reservado para ese
  proyecto hasta que `addProject` lo monte, para que otro proyecto con la misma carpeta no se lo quite entre la
  copia y la apertura.
- La recuperación automática de un contenedor caído relanza la línea guardada: repite el primer mensaje.
- Con una ruta de proyecto cuya carpeta de Claude Code pasaría de 200 caracteres no se sigue la conversación
  (un nombre de archivo no pasa de 255, y cómo la acorta Claude Code no es un contrato conocido): se dice y se
  ofrece continuar con otro agente.
- En el destino de Docker, un tramo cambiado por un enlace entre la comprobación y `mkdir` o la creación del
  temporal puede crear carpetas o el temporal fuera de la cuenta, con contenido que ya controla el contenedor.
  La comprobación antes del `rename` impide poner el archivo fuera en su sitio si el enlace sigue presente en ese
  momento; queda una ventana entre esa comprobación y el propio `rename`. Node no abre por tramos sin seguirlos.
- `test:traspaso` fija rutas, no pisar, frase, armado, registro, `ctx.traspaso` y los enlaces en las dos cuentas; `test:tctx`, el CLI por pipe y
  buzón; `test:linea-arranque-agente`, el prompt ejecutado; `e2e/traspaso.spec.ts`, el recorrido.

## Descartes

- Pedir el resumen al agente de origen: tarda, gasta cuota y depende de que siga vivo y responda bien.
- Mover el transcript, o reescribir sus rutas: el origen perdería su historial; tocar su formato es otro contrato.
