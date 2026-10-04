# Lo que cambia de un motor SQL a otro es dato en una tabla de banderas, y un dialecto desconocido lanza con nombre

- **Estado:** vigente
- **Ámbito:** `src/shared/sql/dialectosSql*.ts`, y quien lee `REGLAS`

## Contexto

Léxico, divisor, clasificador, parámetros y avisos son uno para todos los motores. Comparar el
dialecto con su nombre (`d === 'oracle'`) hace que un motor nuevo caiga en silencio en la rama de
otro. Y un índice a pelo (`REGLAS[d]`) con un valor mal validado da un TypeError anónimo.

## Decisión

- Cada diferencia del LENGUAJE es una bandera de `REGLAS` (sí/no) o una unión cerrada; el `switch` que
  la lee cierra con `nunca`, y un valor nuevo no compila hasta que cada sitio decida.
- El dialecto de un motor es SU PROPIO id (`MOTORES[m].sql.dialecto === m`); un motor derivado tiene
  su fila (copiándola), no apunta a la de otro.
- Lo que depende del motor y no del lenguaje (catálogo, sesión, formulario) vive en el descriptor.
- `deDialecto` valida la clave con `hasOwnProperty` (con `'constructor'` o `'toString'`, `in` encuentra
  lo heredado de `Object.prototype`) y lanza «Dialecto desconocido: "x".». Lo llama cada entrada
  exportada al empezar, no cada lectura; `test-sql-dialecto-desconocido` exige que todo export con
  `DialectoSql` esté en su tabla.
- Las tablas por dialecto (`REGLAS`, `RESERVADAS`, `PALABRAS_CLAVE`, `SEGURO`) son `Record`s exhaustivos.
- Las reglas de identificadores: la caja sin comillas es un modo (`mayus`, `minus`, `insensible`,
  `insensibleUnicode`); SQL Server escribe corchetes porque `"x"` depende de QUOTED_IDENTIFIER.

## Consecuencias

`ReglasDialecto` debe seguir en `dialectosSql.ts`: `test-motores-sueltos` lee de ahí las uniones.

## Descartes

- Una clase por motor con métodos: escondería en qué se parecen dos motores.
- Guardar aquí el paginado: depende de la versión del servidor y vive en el descriptor.
- Deducir el dialecto del texto: un `BEGIN` es un bloque en Oracle y una transacción en PG.
