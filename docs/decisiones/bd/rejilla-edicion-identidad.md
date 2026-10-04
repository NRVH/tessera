# La rejilla solo edita lo que puede identificar con certeza, y compara lo que leyó antes de escribir

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/edicionRejilla*.ts`, `motores/sesion*.ts`

## Contexto

«Enviar» escribe UPDATE, INSERT y DELETE sobre datos del usuario. Una fila mal identificada, una
tabla que no admite DML o un ROWID reutilizado pisan datos que no eran los que se editaron.

## Decisión

- La identidad es `pk`, `rowid` o `ninguna` con su motivo. `ninguna` en: conexión de solo
  lectura (sin más consultas), vista, tabla foránea o virtual, objeto remoto (@dblink), esquema
  del sistema (incluido el que Oracle 12c+ marca `oracle_maintained`), temporal (sus filas son
  de cada sesión y «Enviar» escribe desde la suya), externa de Oracle (`ROWID` da ORA-01410) e
  interna de SQLite. Sin PK decide el descriptor: Oracle y SQLite por `rowid` (SQLite solo si
  ninguna columna lo tapa); PG por la primera UNIQUE con todas sus columnas NOT NULL, mirando
  la restricción (`pg_constraint`), no los índices, que pueden ser parciales o de expresión.
- No se edita: binarias, generadas, identidad GENERATED ALWAYS y, en Oracle, lo que no es un
  escalar que el servidor convierta desde texto (LONG, BFILE, XMLTYPE, tipos de objeto): un
  UPDATE fallido revertiría TODO el envío.
- Concurrencia optimista solo con la identidad `rowid` (una dirección que un hueco de bloque
  reutilizado pasa a otra fila): la rejilla manda lo que leyó, el main lo vuelve a filtrar
  contra el catálogo (`comparable`) y el DML lo pone en el WHERE; si la fila cambió, 0 filas.
  Se comparan VARCHAR2, CHAR, NUMBER, DATE y TIMESTAMP(≤6); no LOB, binarias, FLOAT, LOCAL TIME
  ZONE, INTERVAL, ROWID ni NCHAR/NVARCHAR2. Un texto con U+FFFD tampoco: se leyó con pérdida.
- Lo que no se puede comparar se descarta en silencio: descartar solo quita una comprobación;
  un «la fila cambió» falso bloquearía la fila para siempre.
- Las reglas comunes viven en `edicionRejilla*.ts`; lo de cada motor (SQL de columnas, bind de
  clave binaria, LOB, juego nacional) en su sesión, con un `switch` que cierra con `nunca`.

## Consecuencias

Todo puede quitar la edición, nunca darla. La identidad y los comparables se recalculan en el main.

## Descartes

- `ctid` en PG: cambia con cualquier UPDATE y con un VACUUM FULL, no hay ROWID estable.
- Buscar una UNIQUE en Oracle: ALL_CONSTRAINTS costaba 1,5-3,9 s por la VPN en la 11g.
