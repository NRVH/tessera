# «Copiar como» y exportar comparten un solo serializador de filas

- **Estado:** vigente
- **Ámbito:** `src/shared/formatosFilas.ts`, `src/main/db/explorador/` (exportar), `src/renderer/src/features/bd/`

## Contexto

La rejilla copia lo que tiene cargado (renderer) y exportar lee la tabla entera por páginas y escribe en el
main. Con un serializador por lado, lo pegado y lo exportado acabarían difiriendo en el primer caso raro.

## Decisión

- Un serializador en `shared/`, puro y ES2020. `crearEscritor` da `inicio()`, `filas(trozo)` y `fin()`: el
  main escribe cada página según llega sin juntar un millón de filas; `formatearFilas` es el atajo de un
  trozo para copiar.
- **TSV**: el entrecomillado de Excel, idéntico al Mod+C de la rejilla. NULL vacío: `<null>` es cómo se
  pinta, no un valor.
- **CSV**: RFC 4180 (coma, CRLF). Con BOM al exportar (sin él Excel abre el UTF-8 como ANSI y rompe los
  acentos) y sin BOM al copiar (se pegaría como un carácter invisible).
- **JSON**: array con un objeto por línea. Un número sale como número JSON si su texto exacto es un numeral
  válido (`.5` de Oracle es `0.5`); si no, como cadena: `NUMBER(38)` no cabe en un double. Las columnas
  duplicadas se desambiguan con ` (2)`, porque un objeto con dos claves iguales pierde una.
- **INSERT**: una sentencia por fila con la lista de columnas citada con las reglas del dialecto. Los
  literales y el guion los escribe cada motor con su algoritmo (`shared/escrituraSql/`); aquí queda lo que
  no depende del motor: el NULL, la cabeza del `INSERT` y los demás formatos. Los literales de «Copiar como
  INSERT» y de la vista previa de «Enviar» son los mismos.
- **Markdown**: tabla GFM. `|` se escapa, los saltos pasan a `<br>`, NULL se escribe `NULL` (en un documento
  una celda vacía y una nula no se distinguirían) y los números van a la derecha.
- Una celda que el main recortó (un CLOB de más de 64 KiB) se serializa como está; quien llama sabe cuántas
  hay y lo avisa.

## Consecuencias

Escritura por motor: [escritura-sql-contrato-por-motor.md](escritura-sql-contrato-por-motor.md).
