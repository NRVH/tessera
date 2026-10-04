# El visor de una clave es de solo lectura, sangra el JSON sobre el texto y acota lo que pinta

- **Estado:** vigente
- **Ámbito:** `claves/visorClaves.ts`, `claves/DbClavePane.tsx`

## Contexto

Un valor de Redis es un string (o JSON), o una colección con elementos que llegan por trozos.
Puede ser enorme y sus bytes no tienen por qué ser UTF-8 (ver [ui-claves-arbol.md](ui-claves-arbol.md)).

## Decisión

- **Solo lectura.** El visor enseña y ofrece `comandoConsola`, el comando de lectura equivalente
  (con los tipos grandes acotados a 100 elementos y `SSCAN` en vez de `SMEMBERS`), para seguir
  desde la consola, que es donde se escribe.
- **Modo inicial:** hex si los bytes no son UTF-8; JSON sangrado si el texto parsea como JSON;
  texto en cualquier otro caso.
- **El JSON se sangra sobre el TEXTO** (`sangrarJson`); `JSON.parse` solo valida. Pasar por
  `JSON.stringify(JSON.parse(…))` redondea en silencio los enteros de más de 2^53
  (`12345678901234567890` saldría `12345678901234567000`): un id falso sin aviso. El trabajador
  manda el JSON compacto por lo mismo.
- **Topes:** un string enorme llega cortado del trabajador y el visor dice cuánto se ve; el
  volcado hex tiene tope de bytes (cada línea es DOM); el JSON pasado de `COLOREAR_JSON_MAX` se
  enseña sin colorear. Un stream muestra como mucho `COLUMNAS_STREAM_MAX` columnas de campos, por
  orden de aparición, y la entrada entera va en el panel de detalle: con campos distintos en cada
  entrada saldría una tabla de cientos de columnas.
- **Tokenizador de JSON propio**, no el de documentos: aquel es de la notación del shell y vuelve
  a sangrar el texto, y aquí el sangrado ya está hecho.
- **«Cargar más»** suma el trozo nuevo sin repetir (HSCAN, SSCAN y ZSCAN pueden devolver un
  elemento dos veces); si la clave cambió de tipo entre dos trozos, vale lo nuevo.

## Consecuencias

Editar valores desde el visor queda pendiente. Una lista que cambia entre dos trozos se ve
descolocada hasta «Refrescar».
