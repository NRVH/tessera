# El historial se criba por el nombre de la carpeta de Claude Code y el filtro exacto sigue decidiendo por ruta

- **Estado:** vigente
- **Ámbito:** `src/main/conversations/slugProyecto.ts`, `ConversationsReader` y `ServicioConversaciones`

## Contexto

Listar las conversaciones de un proyecto costaba resumir las de todos: se abrían los cientos de
transcripts del disco (256 KiB de cabeza cada uno) y solo después se filtraba por proyecto. Está en
el camino crítico de abrir el panel del agente, despertar de hibernación y recuperar un contenedor.
Claude Code codifica el `cwd` en el nombre de la carpeta (todo lo no alfanumérico pasa a `-`), así
que se puede descartar la inmensa mayoría sin abrir un fichero.

## Decisión

- La criba (`carpetaPuedeSerDe`) es un superconjunto a propósito: acepta la carpeta que termina en
  `-<proyecto>` o que es el proyecto; separarla del filtro exacto (`esDelProyecto`) hace que se
  equivoque por exceso sin cambiar nunca el resultado. Es insensible a mayúsculas porque conviven
  `D--…` y `d--…` para la misma unidad.
- La criba se aplica ANTES de leer el disco (`transcripts/listadoTranscripts.ts`): una carpeta que
  no la pasa ni se lista. Solo cuentan `<base>/projects/<carpeta>/*.jsonl` y, en Codex,
  `<base>/sessions/**`: recorrer la base entera costaba cientos de ms en cada apertura del agente, y
  un `projects/` anidado sería otra cuenta. El borrado de una conversación usa el mismo alcance.
- Si lo cribado no da ningún transcript, el panel y el anillo miran todas las carpetas (si Claude
  cambia su codificación, no quedan vacíos en silencio); el camino caliente (`soloUltima`) responde
  vacío, porque casi siempre es un proyecto sin historial.
- El basename no identifica un proyecto: dos carpetas con el mismo nombre en el mismo perfil
  mezclaban historiales (y en modo nativo la base la comparten todos los perfiles). En modo nativo
  se compara la ruta entera; bajo `/workspace` el último segmento, que es seguro porque
  `SandboxManager.addProject` ya resuelve las colisiones de nombre.
- `soloUltima` aplica también el filtro exacto: la criba es un superconjunto y Codex no tiene
  criba, así que la más reciente puede no ser de este proyecto.

## Descartes

- Traducir `/workspace/<n>` a la ruta host con el registro de montajes: obligaría a un módulo puro a
  depender del SandboxManager y a tener el contenedor vivo para leer un proyecto hibernado.
