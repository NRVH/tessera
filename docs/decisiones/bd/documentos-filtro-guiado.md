# El filtro guiado de documentos se compila a texto en notación del shell, con los valores escapados

- **Estado:** vigente
- **Ámbito:** `documentos/filtroDocumentos.ts`

## Contexto

La pestaña de colección tiene un filtro guiado (`shared/filtroGuiado.ts`) y un orden por cabecera.
El trabajador ya interpreta los textos `filtro` y `orden` de la op `consultar` con
`@mongodb-js/shell-bson-parser`, sin evaluarlos.

## Decisión

- El filtro guiado se compila a `{ "$and": [ { "edad": { "$gt": 40 } }, … ] }` y el orden a
  `{ "a": 1, "b": -1 }`, y viajan por los mismos campos: ni campo nuevo en el protocolo, ni cambio en
  el trabajador. Los valores salen de `JSON.stringify` y los tipos BSON con constructores del shell
  (`ObjectId`, `ISODate`, `NumberDecimal`).
- **Texto:** «contiene» y «empieza por» son `$regex` con el valor escapado; «=» compara exacto.
  **Número:** entero seguro a pelo, entero mayor y decimales que no son la forma corta de un double
  como `NumberDecimal`; más de 34 cifras es un error, no un redondeo. **Fecha:** UTC; sin hora, el
  día entero. **`_id`:** con 24 hexadecimales, las dos formas (`ObjectId` y texto), porque existen
  `_id` guardados como texto. «≠» es `$ne`/`$nin`/`$not`, que ya incluyen documentos sin el campo.
- Un nombre de campo con `.` es una ruta; un segmento vacío, uno que empieza por `$` o un carácter
  nulo es un error de la condición (MongoDB leería el `$` como operador).
- **El orden:** un objeto de JavaScript pone las claves de nombre entero delante, y el parser
  devuelve un objeto, así que `{ "b": 1, "2": -1 }` ordenaría mal. Ese caso es un error con
  `campo: 'orden'`.
- Las condiciones llevan su rango en el texto compilado: un error del trabajador con posición se
  convierte en la condición culpable y pierde la posición.

## Consecuencias

Se descartó compilar a un objeto BSON en el main (el canal va en JSON y perdería los tipos), y
escribir siempre `NumberDecimal` (un decimal no es igual a un double que no sea su valor binario).
