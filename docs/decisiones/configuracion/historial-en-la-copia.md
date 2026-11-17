# El historial de conversaciones viaja en la copia, opcional, sin credenciales y sin pisar lo que hay

- **Estado:** vigente
- **Ámbito:** `src/main/configuracion/` (`trozosCopia.ts`, `historialCopia.ts`, `inclusionHistorial.ts`,
  `emparejarProyectos.ts`, la versión 2 de `cifradoFrase.ts` y el IPC), `src/shared/copia-configuracion-ipc.ts`,
  `src/shared/seleccionCopia.ts`, `src/main/agentes/AlmacenCuentas.ts` (rutas de lectura),
  `src/main/agentes/ControladorTerminalAgente.ts` (`conversacionesAbiertas`) y
  `src/renderer/src/features/ajustes/copia/` (`HistorialExportar.tsx`, `etiquetasHistorial.ts`)

## Contexto

Las reglas del perfil viajan con el perfil, pero lo hablado vive en las carpetas de cada CLI: las nativas en la
carpeta del usuario y las de las cuentas de Docker en los datos de Tessera. Sin ellas, en otro equipo el
historial, `tctx buscar` y «Continuar esta conversación» no tienen nada. Esas carpetas guardan también la sesión iniciada de
cada cuenta, y una conversación puede llevar código y datos sensibles.

## Decisión

- **Un apartado más de la copia, «Historial de conversaciones», desmarcado de serie**, con lo que ocupa y
  cuántas conversaciones hay por agente y cuenta (y un aviso por encima de 1 GiB). Sigue a los perfiles elegidos
  (sus cuentas de Docker); el historial nativo es del usuario y no de un perfil: va como opción propia.
- **Solo conversaciones**, por una lista de lo que entra y nunca de lo que se excluye: los transcripts de Claude
  Code (`projects/<carpeta>/<id>.jsonl` y `projects/<carpeta>/<id>/subagents/**/*.jsonl`) y los rollouts de
  Codex (`sessions/**/rollout-*.jsonl[.zst]`), con su ruta relativa a la carpeta de la cuenta y sin seguir
  enlaces. Nada más: ni credenciales, ni ajustes, ni cachés, ni las instantáneas de archivos.
- **Cifrado como el resto de la copia** y, por su tamaño, en trozos que se cifran y se escriben sin cargarlo
  entero en memoria. Formato (versión 2): primera línea, la cabecera con el contenido de siempre; luego un trozo
  por línea, `"<fuente>:<base64>",` (≤ 4 MiB de un archivo, zstd y AES-256-GCM con una subclave HKDF de la de la
  frase, nonce = su índice, y su fuente, su índice, si es el último y el hash de la primera línea como datos
  autenticados) y uno de cierre, `"fin:<base64>"`, que fija el total y un hash encadenado de la cabecera y de
  cada línea de trozo. La fuente (la cuenta) va en claro para que importar salte sin descifrar ni descomprimir
  los trozos de las cuentas no elegidas; esos pasan igual por el hash encadenado, así que quitarlos, moverlos,
  duplicarlos, tocarlos o cambiarles la fuente se nota al llegar al cierre, y en un trozo que sí se abre, al
  abrirlo (su índice y su fuente están autenticados). Traer un trozo de otro archivo o cortar el archivo también
  falla. El archivo entero sigue siendo JSON: una Tessera anterior lo rechaza por «más nueva»; sin historial se
  sigue escribiendo la versión 1. Sin frase solo si se pide, con el aviso de siempre y otro: lleva lo hablado
  con los agentes (y sin frase nada está autenticado: el orden y el hash solo cazan un archivo dañado).
- **Al exportar, un archivo que desaparece o se bloquea** entre el listado y su lectura (Codex comprime un
  rollout frío y borra el `.jsonl`) se salta y el resumen dice cuántos; cualquier otro fallo (el disco lleno)
  corta la exportación, borra el temporal y enseña ese error.
- **Al importar, fusiona sin pisar**, con las reglas de «Continuar esta conversación» en otra cuenta: igual (o aquí más avanzado), se salta;
  el principio de lo que llega, se pone al día; distinto, se conserva el de este equipo y se dice. Poner al día
  sustituye el archivo, y un CLI que lo tenga abierto seguiría escribiendo en el viejo (en macOS y Linux esos
  turnos se perderían; en Windows la sustitución falla): una conversación en la que está ahora una sesión de
  agente de Tessera, o tocada en los últimos 10 minutos (cubre un CLI lanzado fuera de Tessera), no se pone al
  día; se conserva la de aquí con el motivo «abierta en un agente», y otra importación la pondrá al día. Las
  conversaciones de una cuenta de Docker van a la cuenta del mismo agente y nombre en el perfil de destino
  (el que se crea o el de aquí al que se añade el perfil del archivo, [exportar-importar.md](exportar-importar.md);
  si la cuenta no existe, se crea, sin sesión); las nativas, a la carpeta nativa de este equipo. Lo que llega pasa otra vez la lista de lo
  que entra y una guarda de rutas: nada fuera de la carpeta de su cuenta ni a través de un enlace.
- **Proyectos en otra ruta**: Claude Code guarda cada conversación bajo la carpeta de la ruta del proyecto. Si
  en este equipo hay abierto un solo proyecto con el nombre de carpeta de la ruta de origen (el `cwd` del
  transcript), y en la copia no hay otra ruta de origen distinta con ese nombre, las conversaciones se dejan bajo
  la carpeta de la ruta de aquí; si no hay ninguno, hay varios aquí o varios en el otro equipo (se mezclarían en
  el mismo proyecto), se quedan con la de origen y se dice. Las de Docker (`/workspace/<carpeta>`) no cambian.

## Consecuencias

- Una copia con historial puede ser grande y es tan sensible como lo hablado: quien la exporta decide.
- Tras importar hay que iniciar sesión en cada cuenta: las credenciales no viajan nunca.
- Una conversación de un proyecto que en este equipo no está abierto se queda con su ruta de origen hasta que
  se abra ese proyecto con la misma ruta.
- Un trozo dañado a mitad corta la importación del historial ahí: lo ya escrito era auténtico y se queda. Uno
  saltado (de una cuenta no elegida) que esté tocado se nota en el cierre, cuando lo elegido ya se escribió: cada
  trozo escrito se autenticó solo, así que también se queda.
- La vista previa del diálogo de exportar mide las carpetas con los `stat` en paralelo y con tope, y guarda la
  lista de cada carpeta 30 s: marcar y desmarcar perfiles no la recorre otra vez.
- Lo fijan `test:trozos-copia` (formato, frase, trozos tocados, también los saltados, versiones, topes al
  abrir), `test:historial-copia` (qué entra, guarda, emparejado, no pisar), `test:historial-ida-vuelta` (dos
  equipos en temporales, credenciales, enlaces, importar dos veces, conversación abierta, temporales, archivos
  que desaparecen, proyectos con el mismo nombre), `test:copia-configuracion` (la selección) y
  `e2e/copia-historial.spec.ts`.

## Descartes

- Copiar las carpetas de las cuentas enteras: llevaría las sesiones iniciadas a otro equipo.
- Cifrar el historial de una vez con el contenido: cientos de MB en memoria y en una sola etiqueta.
- Sincronizar en vivo entre equipos: conflictos, red y otro producto; para eso hay herramientas de sincronización.
- Reemplazar al importar: borraría lo que el usuario ya tenía en el equipo nuevo.
