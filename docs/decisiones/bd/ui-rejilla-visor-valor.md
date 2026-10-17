# El visor de valor es un Monaco de solo lectura que nace cuando su host ya mide, y el visor y la copia enseñan el valor tal como se guardó

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/VisorValor.tsx`, `rejilla/visorValor.ts`, `rejilla/copiarComo.ts`

## Contexto

Una celda puede ser un NUMBER(38) dentro de un JSON, un CLOB de 64 KiB o un BLOB de hasta 16 MiB
(`DB_VALOR_MAX`), y llegar recortada a la rejilla. El visor la enseña entera, igual en la pestaña de
datos y en los resultados de la consola. Un visor o una copia que cambien el valor son peores que no
tenerlos.

## Decisión

- Monaco y no un `<pre>`: un `<pre>` con 16 MiB es un solo nodo que el navegador maqueta
  entero (segundos de hilo principal, y otra vez con cada cambio de tamaño); Monaco pinta solo
  las líneas visibles, trae buscar, selección y copia de un trozo, y es el mismo visor de solo
  lectura que la pestaña de fuente. `wrappingStrategy: 'simple'` para no medir cada línea.
- Va en un modal por portal desde la rejilla: vive en filas con `transform` y pestañas
  `display:none`, y el modal tiene que ser `fixed` sobre la ventana entera.
- Nace en el primer `ResizeObserver` con el host midiendo algo, nunca a 0 px: sin
  `automaticLayout`, uno que nace a cero se queda en 5×5 px para siempre (ver
  [../renderer/reflow-monaco-oculto.md](../renderer/reflow-monaco-oculto.md)). El host no se oculta
  nunca: NULL, la cadena vacía y el binario vacío son una capa opaca encima.
- El valor completo se pide solo si la celda llegó recortada y el dueño sabe pedirlo (la
  pestaña de datos, por la clave). Mientras llega se enseña lo que hay con una línea de estado;
  un fallo sale en línea con «Reintentar», sin tapar lo cargado. Sin forma de pedirlo, la línea
  dice por qué.
- El JSON se re-sangra token a token copiando cada número, cadena y literal tal cual:
  `JSON.parse` solo VALIDA. `JSON.stringify(JSON.parse(t))` daría `12345678901234567000` por
  `12345678901234567890` y `1.1` por `1.10`. Los escapes se quedan como estaban.
- Es JSON la columna `json`/`jsonb` válida y cualquier texto entre `{}` o `[]` que se deje leer
  (el CLOB con JSON de una base vieja). Una recortada no es JSON válido: texto hasta que llega
  el valor completo. Se colorea hasta 2 MiB; por encima, texto plano: el lenguaje `json` de
  Monaco sincroniza el modelo entero con un worker (un segundo de hilo principal en 16 MiB).
- El binario, en volcado hex de 16 bytes por línea con la columna ASCII, hasta 1 MiB (16 MiB
  serían 80 MB de texto), sin números de línea y sin partir: partido, el ASCII se descoloca.
  «Copiar» copia el VALOR ENTERO (el `0x…` en binario, no el volcado), salvo el JSON, que se copia
  como se lee.
- Teclado: `useDialogo` (Esc, trampa de Tab y devolución del foco a la rejilla, que conserva la
  celda activa). Al abrir, el foco entra en el editor. El Esc del buscador de Monaco lo cierra a
  él antes que al modal: Monaco lo consume y no llega a la ventana.
- **Copiar celdas de la rejilla.** Copiar y exportar comparten serializador
  (`shared/formatosFilas.ts`): con dos, lo pegado y lo exportado diferirían en el primer caso raro
  (una fecha de Oracle en un INSERT, un `|`). TSV (Mod+C) sin salto final, que en una hoja añadiría
  una fila vacía; comillas si el campo lleva tabulador, CR, LF o comillas en cualquier sitio, para
  que sobreviva a toda hoja de cálculo. CSV con cabecera y sin BOM (se pegaría como un carácter
  invisible). NULL se copia VACÍO en TSV y CSV (`<null>` es cómo se pinta, no un valor), `null` en
  JSON y `NULL` en INSERT y Markdown. Los números, como llegaron. Se copia lo CARGADO (para la
  tabla entera está «Exportar a archivo») y se cuentan las celdas recortadas en cualquier formato,
  para avisar de que lo copiado no es el valor entero.

## Consecuencias

El conmutador «Formateado / Crudo» usa las clases de las partes de la pestaña de fuente: es
identidad (dice qué se lee), no una acción. `test-visor-valor.mts` y `test-celdas-rejilla.mts`
fijan el JSON y el TSV byte a byte.
