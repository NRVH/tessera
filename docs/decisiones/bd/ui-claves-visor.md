# El visor de una clave edita por la consola del main, sangra el JSON sobre el texto y acota lo que pinta

- **Estado:** vigente
- **Ámbito:** `claves/visorClaves.ts`, `claves/DbClavePane.tsx`, `claves/edicionClaves.ts`, `claves/useEdicionClave.ts`, `claves/DialogoEdicionClave.tsx`, `claves/accionesEdicionClave.tsx`

## Contexto

Un valor de Redis es un string (o JSON), o una colección con elementos que llegan por trozos.
Puede ser enorme y sus bytes no tienen por qué ser UTF-8 (ver [ui-claves-arbol.md](ui-claves-arbol.md)).

## Decisión

- **Edita lo de todos los días, y siempre enseñando el comando.** El valor de un string, añadir,
  editar y borrar campos de un hash, la caducidad (`EXPIRE`; vacía, `PERSIST`), renombrar y borrar la
  clave. Cada acción abre UN diálogo que pide el dato y enseña el comando exacto que se ejecutará,
  rehecho al escribir (`edicionClaves.ts`); en producción, con la franja y «Ejecutar en producción»,
  que ya es la confirmación. Las listas, sets, zsets y streams siguen por la consola.
- **Va por la consola de Redis del main**, en una sesión propia de la pestaña (`visor-<uuid>`, que
  se cierra al desmontarse): la política (producción, comandos peligrosos) la decide el main igual que
  para la consola, y si devuelve el comando sin enviar, el diálogo lo dice y el siguiente clic lo
  confirma. No hay canal de escritura nuevo.
- **Lo que no se puede reescribir bien no se ofrece:** unos bytes que no son UTF-8, un valor cortado
  por el tope del visor o uno con retornos de carro (un cuadro de texto los convierte en saltos de
  línea) se reescribirían distintos, y su botón va apagado con el motivo. Una clave cuyo nombre no es
  UTF-8 no se renombra aquí. Lo que el usuario confirma ante un aviso del main vale solo para ESE
  comando: si cambia lo escrito, el main vuelve a mirar.
- **`SET` con `KEEPTTL` si la clave caduca** (sin él, reescribir le quitaría la caducidad), y
  **`RENAMENX`, no `RENAME`**: renombrar a un nombre que ya existe no pisa esa clave, lo dice.
- **Sigue ofreciendo `comandoConsola`**, el comando de lectura equivalente (con los tipos grandes
  acotados a 100 elementos y `SSCAN` en vez de `SMEMBERS`), para seguir desde la consola.
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

Tras renombrar, la pestaña pasa a la clave nueva EN SU SITIO (`reemplazarPestana`; si ya estaba
abierta, se cierra la vieja y se activa aquella), y tras renombrar o borrar se vuelve a pedir el
árbol de la conexión. Una lista que cambia entre dos trozos se ve
descolocada hasta «Refrescar».
