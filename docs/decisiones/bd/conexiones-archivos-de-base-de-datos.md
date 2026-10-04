# Bases de archivo (SQLite): la ruta no sale del main y solo se monta de la carpeta anclada

- **Estado:** vigente
- **Ámbito:** `src/main/db/controlador/motoresDeArchivo.ts`, `archivosBd.ts`, `rutaArchivoBd.ts`

## Contexto

Un motor de archivo se elige con el diálogo nativo, se suelta sobre el árbol o se monta desde el explorador de
archivos. El renderer nunca ve ni envía rutas del host.

## Decisión

- Al renderer llega una ficha (`FichasArchivo`) y el nombre; al guardar manda la ficha o la ruta relativa al
  proyecto (`DbOrigenArchivo`), y el main la resuelve y guarda la ruta canónica. La ficha caduca (media hora) pero
  no se gasta al usarla: un guardado que falla por un nombre repetido puede repetirse. Es del motor con el que se
  eligió. Una ficha que el main no conoce da un error que pide volver a elegir, nunca un alta sin archivo.
- Un archivo «del proyecto» solo se acepta de la contenedora que el explorador de archivos tiene anclada
  (`contenedoraAnclada`). Antes solo se miraba que la ruta relativa quedara dentro de la carpeta que mandaba el
  renderer, y un renderer con otra carpeta registraba cualquier `.db` del disco como base del perfil, visible
  para su agente. Además se resuelve dos veces contra el proyecto: la ruta escrita y la real (`realpath`), porque
  un `.db` que es un enlace a otra base del usuario (el agente, en Docker, puede crear enlaces de verdad) queda
  fuera aunque su nombre esté dentro.
- Qué motor es un archivo lo decide su cabecera y no la extensión (un `.db` puede ser de H2 o de Access): se
  pregunta a cada motor de archivo con su adaptador, `src/tdb/sqliteComun.cjs`, cargado en ejecución (el main no
  importa los `.cjs` de `tdb`). El main no abre la base para consultarla.
- Se guarda la ruta canónica (`realpath` nativo, no el de JS, que en Windows resuelve las uniones a mano) para que
  una carpeta enlazada o un `..` no hagan de un archivo dos conexiones. Si no existe o no hay permiso (TCC en
  macOS), no se inventa nada: ruta absoluta normalizada y el porqué. Comparar es sin caja en Windows y macOS y en
  NFC (APFS guarda los nombres como se escribieron).
- «Montar como base de datos» reutiliza la conexión del perfil que ya apunta al archivo real o crea una de solo
  lectura, dada por verificada porque se acaba de comprobar que se abriría. Un motor sin credenciales rechaza una
  contraseña. Los mensajes no llevan rutas: van al renderer.

## Descartes

- Mandar la ruta elegida al renderer y de vuelta; fichas de un solo uso; guardar la ruta tal cual y canonizar al
  comparar (cada lector tendría que canonizar igual).
