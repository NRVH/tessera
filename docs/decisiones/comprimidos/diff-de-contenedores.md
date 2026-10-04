# El diff de un contenedor se resta en el main por CRC32, y al renderer solo cruzan el índice restado y el texto de una entrada

- **Estado:** vigente
- **Ámbito:** `src/main/comprimidos/ComprimidosService.ts`, `compararIndices.ts`

## Contexto

Comparar un .jar/.war/.ear entre dos revisiones con los bytes de los dos lados en el renderer serían
decenas de MB de structured clone por cada pulsación de flecha del historial. El directorio central
de un ZIP ya trae, por entrada, su CRC32 y su tamaño, y se lee en milisegundos sea cual sea el archivo.

## Decisión

- Los bytes del contenedor no cruzan el IPC: el renderer recibe el índice ya restado (unos KB) y,
  después, el texto de UNA entrada. Por eso es un servicio del main y no canales sobre `git:blobBytes`.
- El oráculo es el CRC32 más el tamaño, sin inflar nada. Un jar recompilado sin cambios trae fechas
  nuevas y los mismos CRC: por CRC sale la lista vacía, que es la verdad. Los registros de directorio
  no se comparan (unos empaquetadores los escriben y otros no) y los nombres duplicados se desempatan
  en la misma dirección que `leerIndice`: dos capas que discrepen enseñarían un cambio que no existe.
- El lado de disco se lee por rangos; el de un commit o del índice es el blob entero (un ZIP se lee
  desde el final y `git cat-file` es un flujo), y los dos lados se piden en UNA llamada a git. Un
  lado `empty` no es un error: todas sus entradas son nuevas.
- La caché es `JarIndexCache` con clave `commit:<oid>:<ruta>`, inmutable por construcción; el disco y
  el índice no se cachean porque cambian sin avisar. El presupuesto es el de dos contenedores del
  tope: con menos, guardar el segundo lado desaloja el primero y cada clic relanza `git cat-file`.
- Una descompilación viva por pane: cada petición trae `(paneKey, token)` y antes de lanzar un motor
  se comprueba que el token siga vigente; si no, se responde `descartado`. Así barrer entradas con la
  flecha no forma una cola de JVM.
- El contexto de tipos va vacío en los dos lados: los jars hermanos del disco son los de hoy, no los
  de la revisión, y dar contexto a un solo lado pintaría rojo y verde fantasma en cada firma.

## Consecuencias

El renderer nunca ve el contenedor; cualquier dato nuevo del diff se calcula aquí. El texto de una
entrada se trunca con el mismo tope que el diff de texto, para un solo criterio en toda la app.

## Descartes

- Comparar los bytes de verdad: inflar los dos lados enteros para cambiar la respuesta en uno de cada
  cuatro mil millones de pares.
- Matar la JVM de la petición superada: ahorra unos 300 ms de un trabajo cuyo resultado va a la caché
  por contenido, y añadiría un camino de cancelación a un componente que solo mata al cerrar la app.
