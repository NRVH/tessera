# Un agente busca en lo que se habló en su proyecto con `tctx buscar`, sin cargarlo todo y sin cruzar el aislamiento de Docker

- **Estado:** vigente
- **Ámbito:** `src/main/historial/` (`coincidencia.ts`, `lineasTranscripcion.ts`, `buscarHistorial.ts`, `operacionBuscar.ts`),
  `src/tctx/` (`buscar`), `PuenteBd.resolverOperacion` (operaciones de sesión con promesa), `reglas/componer.ts` y
  `buzonTctx.ts` (las esperan), `ControladorTerminalAgente.sesionParaHistorial`, la composición en `agentes/componer.ts` e
  `index.ts`, y el anuncio en `briefingCompuesto.ts` (`AVISO_HISTORIAL`)

## Contexto

Lo que se decidió en un proyecto queda en las conversaciones de sus agentes, repartido entre Claude Code y
Codex y entre cuentas. Mantener un resumen al día es lo que se quiere evitar, y cargarlo todo en cada sesión
llena el contexto de ruido. Tessera ya lee esas conversaciones desde el host.

## Decisión

- **`tctx buscar <palabras> [--exacta] [--max N]`**: el agente pregunta cuando lo necesita, nunca se le carga
  nada. Busca en las conversaciones de ESE proyecto (las de su ruta, con el mismo filtro y la misma criba por
  carpeta que el panel del historial; una base sin carpeta de ese proyecto no lee las de los demás) y devuelve
  pocas coincidencias, las más recientes primero (8; con `--max`, hasta 20), cada una con el agente, la cuenta
  («Nativa» o el nombre de la de Docker; el de la predeterminada, en el idioma de la app), la fecha, el título que
  enseña el panel (el nombre propio si lo tiene), quién lo dijo y un trozo de unos 300 caracteres alrededor, en
  texto legible y en el idioma de `tctx`.
- **El orden es el de la fecha del mensaje, no el del archivo**: un archivo escrito hoy puede tener mensajes de
  hace meses. Se leen todas las conversaciones que caben en los topes y se guardan solo las `max` de mensaje más
  reciente (una lista acotada); si se descartó alguna, dice que hay más. No se corta al llenar `max`.
- **La hora es la del equipo de Tessera**: el main escribe la fecha de cada coincidencia (`AAAA-MM-DD HH:MM`) en su
  zona y `tctx` la imprime tal cual, porque en un contenedor la zona suele ser UTC.
- **Solo el texto de la conversación**: los mensajes del usuario y del agente, con la misma extracción que el
  traspaso derivado; ni herramientas, ni sus resultados, ni imágenes, ni razonamiento, ni lo que inyecta el CLI.
  Se lee cada transcript entero por trozos, sin cargarlo, también los rollouts comprimidos de Codex; una línea
  con una imagen en base64 se compacta al vuelo como en la cabeza, y una de texto que ni así cabe se salta.
- **La coincidencia**: sin distinguir mayúsculas ni marcas (tildes, diéresis, la virgulilla de la ñ), todas las
  palabras tienen que estar en el mensaje, en cualquier orden y también dentro de otra palabra. La frase exacta,
  con `--exacta` o entre comillas. Nunca una expresión del usuario. Las palabras van sueltas, sin comillas: las
  comillas dobles no sobreviven igual en todas las shells (PowerShell 5.1 las quita al pasarlas a un programa), y
  por eso existe `--exacta` y el anuncio no las lleva. Texto obligatorio, de 200 caracteres como mucho.
- **Con topes**: 64 MiB de JSONL leídos, 8 s (listar incluido) y 300 conversaciones por búsqueda, y dos búsquedas
  a la vez. Al cortarse por un tope, o con más coincidencias que las pedidas, lo dice, para que el agente afine
  en vez de creer que no hay más. `tctx` espera 20 s por el pipe y 30 s por el buzón, por encima del tope.
- **El aislamiento de Docker se respeta**: una sesión nativa busca en todas las bases del perfil, la del sistema
  de cada agente y cada cuenta de Docker de Claude Code y de Codex; la terminal del proyecto es el usuario y
  busca como una nativa. Un agente en Docker, solo en su propia cuenta, como hoy no ve las credenciales ni el
  historial de otra, y el resultado lo dice; un agente manual en Docker no tiene conversaciones que Tessera lea.
- **El perfil, el proyecto y quién pregunta salen del token de la sesión**, nunca de la petición. La sesión a la
  que se ató el token dice si es un agente (`claveSesionAgente` de `shared/db-ipc.ts`, el mismo formato que usa el
  refcount del contenedor) y cuál, con su modo y su cuenta, de la sesión viva; un token aún sin atar, o de un
  agente que ya no vive o de otro perfil, no busca. Toda sesión atada que no es de agente es una terminal del
  usuario (no hay otra clase de sesión con token), así que no hay nada más con lo que distinguirla.
- **Buscar no toca el disco**: las carpetas de las cuentas se resuelven con `AlmacenCuentas.rutaDe`, que no crea ni
  mueve; una carpeta que no existe no tiene conversaciones.
- **Asíncrona**: la operación de sesión puede contestar con una promesa, que el puente y el buzón esperan, así
  que la lectura no bloquea el hilo del main.
- El aviso de arranque de todo agente de serie lo anuncia en una frase, aunque el perfil no tenga reglas.

## Consecuencias

- Una búsqueda recorre transcripts del disco: con muchos y grandes, un tope la corta y lo dice. Codex no tiene
  criba por carpeta: con muchos rollouts de otros proyectos, sus cabezas (en la caché del panel) gastan tiempo.
- La carpeta del sistema de cada agente es del usuario, no del perfil: una sesión nativa ve lo hablado en ese
  proyecto también desde otro perfil en nativo.
- Lo que no quedó en una conversación (lo hablado fuera) no se encuentra: para eso están las reglas del perfil.
- `test:buscar-historial` fija la coincidencia, el trozo, la lectura por líneas y sus topes, la búsqueda sobre
  transcripts con las formas reales (también `.zst`), el alcance por modo y la operación con el token;
  `test:puente-operaciones`, la promesa en una operación de sesión; `test:tctx`, el CLI por el pipe, por el buzón
  y en PowerShell; `test:briefing-compuesto`, el anuncio; `e2e/buscar-historial.spec.ts`, el recorrido nativo.

## Descartes

- Un índice persistente (o embeddings): otro almacén que mantener al día y que puede quedarse viejo; con los
  topes, recorrer los archivos del proyecto basta.
- Que un agente en Docker busque en todas las cuentas: rompería el aislamiento por cuenta sin que el usuario lo
  pida en el momento.
- Que `tctx buscar` imprima JSON: lo lee un agente igual que una persona, y el texto ya lleva lo que hace falta.
