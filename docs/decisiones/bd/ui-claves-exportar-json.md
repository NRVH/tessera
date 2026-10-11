# Exportar una clave de Redis a JSON lee la clave entera en el renderer y el main solo guarda el texto

- **Estado:** vigente
- **Ámbito:** `claves/exportarClave.ts`, `claves/useExportarClave.ts`, `KV_CHANNELS.GUARDAR_TEXTO`,
  `main/db/adaptadores/guardarTextoUsuario.ts`

## Contexto

El visor lee por trozos y con topes (un string de 256 KiB, un JSON de 1 MiB) porque pinta. Exportar es otra
cosa: se quiere la clave ENTERA o nada.

## Decisión

- **Documento**: `{ clave, tipo, ttlMs, valor }`. Unos bytes que son UTF-8 salen como texto y los demás como
  `{ "base64": … }` (también el nombre de la clave). Un hash sale como objeto si todos sus campos son texto y
  distintos, y como lista de pares si no; un stream, siempre con sus campos como pares (pueden repetirse y su
  orden cuenta); un zset como `{ miembro, puntuacion }` con la puntuación numérica, o texto si es `inf`; un
  JSON del servidor se copia tal cual (reinterpretarlo redondea los enteros de más de 2^53).
- **Entera o nada.** Un string o un JSON que el visor leyó cortado, una clave que ya no existe o un tipo de módulo
  se rechazan con su motivo; no se guarda un archivo a medias. Las colecciones se leen trozo a trozo (5 000
  elementos), sin repetir, con el tope de un millón de elementos.
- **Lee el renderer, guarda el main.** La lectura reutiliza el canal del visor (sus topes, su cancelación y
  su política ya existen); el main solo añade un canal que recibe el texto, abre el diálogo nativo de guardar
  (con la carpeta de las exportaciones de BD) y lo escribe, y responde solo el nombre del archivo, nunca la
  ruta. El texto tiene tope (64 MiB) y el nombre propuesto se sanea.
- **Cerrar la pestaña** corta la lectura entre dos trozos.

## Descartes

- Leer y componer en el main: duplicaría la paginación del visor y el exportador de filas, que es de SQL,
  no sabe de claves.
- Exportar con el exportador de filas (CSV/JSON): trataría la clave como una tabla y perdería el tipo y la
  caducidad.
- Exportar un string mayor que el tope del visor leyéndolo con `GETRANGE`: queda para quien lo pida; hoy se
  dice y se remite a la consola.
