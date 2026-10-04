# El léxico y el divisor SQL son uno solo para el main y el renderer, y el main vuelve a partir cada sentencia

- **Estado:** vigente
- **Ámbito:** `src/shared/sql/lexicoSql*.ts`, `divisorSql*.ts`

## Contexto

La guardia de solo lectura del main clasifica lo que el renderer manda. Si los dos partieran el
texto con código distinto, la guardia se fiaría de una partición que no es la suya. Un divisor
que corta por `;` parte dentro de cadenas, comentarios, `$$…$$` y bloques PL/SQL.

## Decisión

- Un solo léxico (`tokenizar`, `leerToken`) y un solo divisor en `shared/`. El main VUELVE A
  PARTIR cada sentencia y la rechaza si no sale exactamente una.
- Reconoce por dialecto, con banderas de `REGLAS` y nunca comparando el nombre: comentarios (en PG
  anidan), q-quote de Oracle, `E'…'` y `$tag$` de PG, corchetes de SQLite y T-SQL, `/` sola,
  metacomandos `\cmd` de psql, `GO` de SQL Server. Una cadena sin cerrar se marca y llega al final.
- La entrada valida el dialecto una vez (`reglasDe`) y baja la FILA a `leerToken`: validar en cada
  token costaba, medido, entre un 3 y un 7 % del tiempo de tokenizar.
- Los números de T-SQL se cortan donde los corta el servidor: con el léxico genérico, `1EDELETE` y
  `0xINSERT` escondían una escritura que el servidor ejecuta.
- `GO n` no es separador: sale como palabra marcada (`loteRepetido`) y el aviso lo explica.
  Tomarlo por separador ejecutaría el lote una vez, haciendo en silencio menos de lo escrito.
- Los comandos de SQL*Plus y los `.tables` de `sqlite3` solo se reconocen al inicio de una
  sentencia y consumen la línea sin pasar por el léxico (`PROMPT it's done` no abre una cadena).
- `EXEC p(1)` viaja como `BEGIN p(1); END;` con `mapa.prefijoSintetico` para devolver el error a
  su sitio; los bloques PL/SQL y los cuerpos `BEGIN ATOMIC` / de disparador no se parten por `;`.

## Consecuencias

Todo offset es UTF-16 del texto completo, también con `desde/hasta`. Partir `leerToken` por tipo de
token está bien; crear objetos o cierres por carácter no, porque corre en cada tecla.

## Descartes

- Regex globales por tipo de token: no ven el contexto (un `--` dentro de una cadena).
- La línea en blanco como separador: contradice el aviso que espera quien escribe.
- Reutilizar el tokenizador del editor: vive en el renderer y no delimita.
