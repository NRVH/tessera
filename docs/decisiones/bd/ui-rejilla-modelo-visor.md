# El visor y la copia de la rejilla enseñan y copian el valor tal como se guardó

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/rejilla/{visorValor,copiarComo}.ts`, `VisorValor.tsx`

## Contexto

Una celda puede ser un NUMBER(38) dentro de un JSON, un CLOB de 64 KiB o un BLOB de 16 MiB.
Un visor o una copia que cambien el valor son peores que no tenerlos.

## Decisión

- El JSON se re-sangra token a token copiando cada número, cadena y literal tal cual:
  `JSON.parse` solo VALIDA. `JSON.stringify(JSON.parse(t))` daba `12345678901234567000` por
  `12345678901234567890` y `1.1` por `1.10`. Los escapes se quedan como estaban.
- Es JSON la columna `json`/`jsonb` válida y cualquier texto entre `{}` o `[]` que se deje leer
  (el CLOB con JSON de una base vieja). Una recortada no es JSON válido: texto hasta que llega
  el valor completo.
- El binario, en volcado hex de 16 bytes por línea con la columna ASCII, hasta 1 MiB (16 MiB
  serían 80 MB de texto). «Copiar» copia el valor ENTERO en `0x…`, lo único reutilizable.
- El JSON se colorea hasta 2 MiB; por encima, texto plano: el lenguaje `json` de Monaco
  sincroniza el modelo entero con un worker (un segundo de hilo principal en 16 MiB).
- Copiar y exportar comparten serializador (`shared/formatosFilas.ts`): con dos, lo pegado y
  lo exportado diferirían en el primer caso raro (una fecha de Oracle en un INSERT, un `|`).
- TSV (Mod+C) sin salto final, que en una hoja añadiría una fila vacía; comillas si el campo
  lleva tabulador, CR, LF o comillas en cualquier sitio, para que sobreviva a toda hoja de
  cálculo. CSV con cabecera y sin BOM (se pegaría como un carácter invisible).
- NULL se copia VACÍO en TSV y CSV (`<null>` es cómo se pinta, no un valor), `null` en JSON y
  `NULL` en INSERT y Markdown. Los números, como llegaron.
- Se copia lo CARGADO (para la tabla entera está «Exportar a archivo») y se cuentan las celdas
  recortadas en cualquier formato, para avisar de que lo copiado no es el valor entero.

## Consecuencias

`test-visor-valor.mts` y `test-celdas-rejilla.mts` fijan el JSON y el TSV byte a byte.
