# Un .jar se navega como una carpeta: se lee por rangos con zlib nativo, sus carpetas se sintetizan y su índice se cachea por mtime y tamaño

- **Estado:** vigente
- **Ámbito:** `src/main/java/zipRandom.ts`, `JarService.ts`, `jarListado.ts`, `JarIndexCache.ts`; el enrutado en `src/main/files/FileService.ts`

## Contexto

El explorador expande .jar/.war/.ear/.aar mientras se navega, también un .war de 200 MB con decenas
de jars dentro, por los canales de siempre (`files:listDir`, `files:readFile`): el árbol no sabe que
existen los jars. Muchos jars no traen registros de directorio y los antiguos guardan los nombres en
CP437/latin1 salvo que lleven el bit 11 del flag.

## Decisión

- Se leen tres rangos y nada más: la cola (EOCD), el directorio central y la entrada que se abre. El
  coste no depende del tamaño del archivo; `MAX_CONTENEDOR_BYTES` (512 MiB) es un techo de cordura,
  no un presupuesto, y por eso no se reutiliza `readZip` ni su tope de 50 MiB.
- Se infla con `zlib.inflateRaw` asíncrono y `maxOutputLength`: lanza en vez de reservar, que es la
  defensa contra una zip bomb, y trabaja en el pool de libuv en vez de parar el hilo del main.
- `JarService` recibe la ruta absoluta ya validada por `FileService.resolveSafe`, nunca traduce
  rutas, y abre, lee y cierra por operación: sin descriptores abiertos mientras corre un empaquetado.
- `jarListado` sintetiza las carpetas a partir de los nombres, oculta las clases internas
  (`Foo$Bar.class`) cuya externa está en el mismo jar (se leen dentro de su fuente al descompilar;
  una huérfana sí se enseña), marca un jar anidado como `contenedor` y ordena igual que el disco.
- `JarIndexCache` es una LRU con doble tope (entradas y bytes, contando los buffers de los jars
  anidados) cuya clave lleva `(ruta, mtime, size)`: un jar reconstruido deja de casar solo, sin
  depender del watcher. Una entrada que sola supera el tope de bytes no se expulsa por él.

## Consecuencias

Cambiar la forma de `FileEntry` o el orden rompe la paridad con el disco. Un prefijo antes del ZIP
(un `.exe` autoejecutable) se corrige por la diferencia con el final real del directorio central,
que en ZIP64 es el propio EOCD64; un ZIP64 con prefijo falla con `ErrorZip`, a propósito.

## Descartes

- `fflate` para leer: exige los bytes contiguos en memoria. Un control por ratio de compresión:
  redundante con `maxOutputLength` y con falsos positivos (deflate legítimo llega a 1032:1).
- Colapsar los paquetes aquí (`com.a.b`): la compactación ya existe en el árbol y daría filas dobles.
  Ocultar META-INF: es donde vive el MANIFEST que se quiere mirar.
- Una librería de LRU: `Map` conserva el orden de inserción, y `delete` + `set` en cada acierto ES
  un LRU. Cachear el descriptor junto al índice: dejaría handles abiertos sobre los jars del proyecto.
