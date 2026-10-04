# «Ver DDL» sale de DBMS_METADATA en Oracle y se genera desde el catálogo en el resto

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/ddlCatalogo*.ts`, `src/main/db/explorador/motores/ddl*.ts`

## Contexto

Solo Oracle sabe dar el DDL de un objeto (DBMS_METADATA). PostgreSQL y SQL Server no tienen un
equivalente, y en Oracle hay servidores donde DBMS_METADATA no funciona o no enseña el objeto.

## Decisión

- **Oracle:** un solo bloque anónimo fija la transformación de sesión (terminador, sangrado, sin
  almacenamiento), pide el DDL, añade los índices que NO respaldan una restricción y los
  comentarios, y lo devuelve por un bind de salida CLOB. Un procedimiento y una función no se
  distinguen en `DbRefObjeto`: el bloque lo resuelve en ALL_OBJECTS.
- **Limpieza** (`limpiarDdlOracle`): ordena entre sentencias; el cuerpo de una unidad de PL/SQL se
  copia íntegro hasta su `/`, para que su línea N sea la de USER_ERRORS.
- **Repliegue** (`motivoRepliegueDdl`): ORA-31603 (otro esquema sin SELECT_CATALOG_ROLE, u objeto
  de Oracle), ORA-39212/31605 (sin XDK, como la imagen 11-slim), ORA-01031, PLS-00201/00904 y
  ORA-01403. El DDL se reconstruye desde ALL_* y la respuesta lo avisa (sin CHECK, sin ON DELETE).
- **PostgreSQL y SQL Server:** se generan desde el catálogo, un objeto cada vez. Lo que el
  servidor sabe escribir (`pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_viewdef`,
  `pg_get_functiondef`, `format_type`; en SQL Server, la definición de `sys.*`) se le pide a él.
- **Herencia y particiones (PG), como `pg_dump`:** una partición sale con su CREATE TABLE, sus
  índices y DESPUÉS `ATTACH PARTITION`; una hija por INHERITS sale sin lo heredado y con `INHERITS`.

## Consecuencias

- Los generadores son puros y no importan el catálogo de ningún motor: `catalogoSql -> motores ->
  catalogoOracle -> ddlCatalogo -> catalogoSql` sería un ciclo.

## Descartes

- `SELECT DBMS_METADATA.GET_DDL(…) FROM dual`: otro viaje más y no puede tragar ORA-31608.
- `GET_DEPENDENT_DDL('INDEX')`: trae el índice de la PK y el script falla con ORA-00955.
- Limpiar también el cuerpo de PL/SQL: pierde líneas vacías y blancos de literales y descuadra
  la numeración de USER_ERRORS.
- ATTACH antes de los CREATE INDEX: el segundo falla con «ya existe». `PARTITION OF … FOR VALUES`
  obliga a filtrar lo que la partición recibe del padre sin ganar fidelidad.
