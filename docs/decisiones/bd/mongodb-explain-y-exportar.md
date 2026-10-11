# MongoDB: el explain va al visor de planes y la exportación vuelve a leer por páginas

- **Estado:** vigente
- **Ámbito:** `src/tdb/planMongodb.cjs`, `src/tdb/exportarMongodb.cjs`, `src/tdb/sesionMongodb.cjs` y `src/main/db/explorador/documentos/exportarDocumentos.ts`

## Contexto

La consola de documentos enseñaba el `explain` como un texto largo, y el resultado de una consulta no
se podía guardar en un archivo, a diferencia de los motores SQL.

## Decisión

- **Explain**: sin argumento se pide con `executionStats`; la sesión lo convierte (`planDeExplain`) al
  mismo `DbPlan` que usa SQL, así que se enseña en el visor de planes existente. Es puro y tolerante:
  una forma que no reconoce acaba en un solo paso con el texto del servidor, nunca en un error. Avisa
  de recorrer la colección entera y de examinar mucho más de lo que se devuelve.
- **Exportar**: el main no guarda en memoria el resultado. Vuelve a pedir la colección (con su filtro y
  orden) o a ejecutar la sentencia de LECTURA por páginas del trabajador (`exportarAbrir` y
  `exportarMas`) y escribe cada página al archivo. En CSV las columnas son las de la primera página.
  JSON es una lista (`[ … ]`) con un documento por línea, en EJSON relajado.
- Una sentencia que escribe nunca se exporta: se rechaza antes de ejecutarla.

## Descartes

- Exportar lo que la rejilla ya tiene: perdería todo lo que no se cargó, y un resultado de miles de
  documentos es justo lo que se quiere exportar.
- Un visor de planes propio de MongoDB: duplicaría el de SQL sin enseñar nada distinto.

## Consecuencias

- Exportar vuelve a ejecutar la consulta: si los datos cambian entre medias, el archivo refleja el
  momento de exportar, no el de la tabla.
