# Los avisos de la consola son léxicos y no bloquean: orientan, y decide el servidor

- **Estado:** vigente
- **Ámbito:** `src/shared/sql/avisosSql.ts`

## Contexto

La consola valida mientras se escribe solo lo que se sabe sin una gramática. Un heurístico que
bloqueara ejecutaría menos que el servidor, y la última sentencia sin `;` es válida.

## Decisión

- Los avisos son amarillos y no bloquean: separador que falta, cadena o comentario sin cerrar,
  paréntesis desequilibrados, `/` que falta tras un bloque PL/SQL, `GO n`, escritura en una conexión de
  solo lectura y formato fijado (el mismo rechazo que hará el main, adelantado al editor).
- `faltaPuntoYComa`: una línea que empieza en la COLUMNA 1 con un verbo de sentencia, a profundidad 0,
  detrás de algo que puede cerrar una sentencia (identificador, literal, bind, `)` o `*`). Sin aviso si
  la anterior acaba en una palabra que pide continuación, y con excepciones por sentencia: la consulta
  principal de INSERT/CTAS/EXPLAIN/WITH, las cláusulas de ALTER, las ramas de MERGE, GRANT/REVOKE y
  CREATE SCHEMA, y los cuerpos `BEGIN ATOMIC` y de disparador.
- `faltaBarra` (dialectos donde la `/` termina): tras cerrarse la unidad PL/SQL, un verbo en columna 1
  es otra sentencia fundida con el bloque. Se lleva una pila de niveles; un fallo del contador se
  traduce en un aviso que FALTA, no en uno de más. COMPOUND y Java se excluyen.
- En SQL Server el aviso dice que el servidor EJECUTA juntas las dos sentencias, y calla dentro de una
  construcción de alcance de lote (el `;` es opcional).

## Consecuencias

Los avisos solo sirven si no mienten: `test-sql-avisos` tiene más casos negativos que positivos.
PostgreSQL es la excepción con gramática local real (`sintaxisSql.ts`).

## Descartes

- Un parser por motor: meses de trabajo para duplicar peor lo que el servidor ya dice.
- La columna 1 es a propósito: el código indentado es casi siempre continuación.
