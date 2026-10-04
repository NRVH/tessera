# El tipo de una columna de Oracle no lleva un tamaño de texto que el driver no sabe dar

- **Estado:** vigente
- **Ámbito:** `src/tdb/celdasOracle.cjs` (`tipoMotorOracle`) y `contextoTipos` de `sesionOracle.cjs`

## Contexto

`metaData.byteSize` no significa lo mismo en thin y en thick, y en ninguno es el tamaño declarado
con su unidad. Medido (11.2 thick, 21c thin y thick, oracledb 6.10, AL32UTF8 con juego nacional
AL16UTF16):

| Declarado | thin | thick |
|---|---|---|
| VARCHAR2(40 BYTE) | 40 | 40 |
| VARCHAR2(40 CHAR) | 40 | 160 |
| VARCHAR2(1000 CHAR) | 1000 | 4000 |
| NVARCHAR2(20) | 20 | 40 |
| RAW(16) | 16 | 16 |

Thin da el número declarado sin su unidad; thick da el máximo en bytes.

## Decisión

- RAW lleva su tamaño (los dos modos dan el declarado). NCHAR y NVARCHAR2 lo llevan en caracteres:
  thin ya los da; thick da bytes y se divide entre 2 solo si el juego nacional es AL16UTF16; con
  otro, o sin saberlo, sin tamaño.
- VARCHAR2 y CHAR van SIN tamaño en los dos modos. TIMESTAMP lleva su precisión con la forma de
  `data_type` de `ALL_TAB_COLS`, y NUMBER su escala también si es negativa (`NUMBER(5,-2)`).
- En una pestaña de tabla el tipo exacto sale del catálogo (`DbColumnaResultado.tipoDeclarado`);
  esto queda para las consultas de consola.

## Consecuencias

- La rejilla decide qué original compara con el ROWID por el NOMBRE y la precisión del TIMESTAMP
  (`shared/sql/originalesSql.ts`), nunca por el tamaño de un texto.

## Descartes

- Escribir el número con la unidad que sí se sabe (`VARCHAR2(160 BYTE)`): es un tipo que existe y no es el
  de la columna. Deducir la semántica por el tamaño: el mismo resultado se leería distinto en thin y thick.
