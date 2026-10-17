# Un archivo borrado no es un error: la pestaña se queda, se tacha y guardar lo recrea

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/editor/` (`modelRegistryCore.ts`, `modelRegistryTipos.ts`, `EditorTabs`), `files:exists` en `src/shared/files-ipc.ts`, `FileService.existeRuta` y `FileService.writeFile`

## Contexto

Un archivo abierto puede desaparecer por fuera (un agente, un `git checkout`, otro programa). Un
cartel de «No se pudo abrir el archivo» taparía un buffer vivo que a menudo es el único ejemplar del
trabajo, y no ofrecería salida.

## Decisión

- El estado `borrado` vive en el registro de buffers, hermano de `dirty` y con sus propios oyentes,
  y llega a la pestaña por el mismo camino que el punto de sin guardar. Las dos marcas conviven: un
  archivo borrado puede tener cambios sin guardar. En la pestaña: nombre tachado, punto ámbar y el
  tooltip que dice que ya no existe en disco.
- La marca se pone por TRES caminos, porque cada uno tapa un hueco de los otros: la recarga en vivo
  se topa con el ENOENT; las pestañas SUCIAS, que no se pueden releer, preguntan si su archivo sigue
  ahí (`revisarBorrado`); y abrir algo que ya no está publica un buffer vacío y marcado en vez de
  dejar la entrada sin cachear. Se quita sola cuando el archivo vuelve o al guardar.
- «¿Sigue ahí?» tiene canal propio (`files:exists`): usar la lectura para contestar un booleano
  pagaba el archivo entero. No distingue archivo de carpeta, una entrada de un `.jar` responde por su
  contenedor, y una ruta inválida LANZA: quien pregunta tiene que distinguir «no existe» de «la
  pregunta no vale», o se tacharía una pestaña por un fallo de programación.
- `esArchivoInexistente` mira el TEXTO del error: el IPC de Electron re-serializa el error y se come
  el `code`. Cuentan ENOENT y ENOTDIR (borraron la carpeta); un EACCES NO cuenta y sigue siendo un
  error de verdad.
- `writeFile` crea la carpeta padre: sin eso, el guardado que debe recrear el archivo moriría con el
  ENOENT del directorio.

## Consecuencias

`recarga-en-vivo.md` fija que las pestañas limpias releen y las sucias solo comprueban: las dos
listas son disjuntas y las dos alimentan esta marca.

## Descartes

- El cartel de error sobre el contenido: escondía lo único que quedaba del archivo.
- Cerrar la pestaña al detectar el borrado: perdería los cambios sin guardar.
