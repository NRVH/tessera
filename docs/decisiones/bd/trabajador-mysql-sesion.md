# La sesión MySQL sigue la transacción por el estado del servidor y Detener es un KILL QUERY desde otra conexión

- **Estado:** vigente
- **Ámbito:** `src/tdb/sesionMysql.cjs`

## Contexto

mysql2 no expone si hay una transacción abierta, y MySQL no tiene una variable de sesión que lo diga en
todas sus versiones. Una consulta en curso no se puede interrumpir por la misma conexión: hace falta
otra que pida `KILL QUERY <id>`.

## Decisión

- **Estado de la transacción**: el bit `SERVER_STATUS_IN_TRANS` de cada cabecera de OK (las de
  DML, DDL, SET, BEGIN, COMMIT y el final de un CALL). Un SELECT no la cambia en autocommit, que es
  como trabaja siempre la sesión. 'pendiente' se DEDUCE: dentro de una transacción, cualquier
  sentencia que no devuelve filas la marca (equivocarse hacia 'pendiente' solo cuesta un diálogo),
  salvo la que la abrió.
- **Manual** es un `START TRANSACTION` perezoso antes de la primera sentencia que no sea `sinBegin`;
  el modo de solo lectura, `START TRANSACTION READ ONLY` y ROLLBACK alrededor de cada sentencia.
- **Detener**: `KILL QUERY` desde una conexión aparte con la misma configuración (la sentencia
  falla con 1317 y la sesión y su transacción siguen). La sentencia siguiente espera a que ese KILL
  termine: uno que llegara tarde la cortaría a ella. Con una consulta que llena su página sin
  transacción abierta, el trabajador corta igual (el corte propio no es un error).
- **Varios conjuntos** (un CALL): el primero es el resultado y los demás van en `siguientes`.
- **Avisos del servidor**: si una cabecera dice que los hay, `SHOW WARNINGS` y van a la salida.
- Tras una rutina (`refijarFormatos`) se vuelven a quitar los modos SQL que cambian el léxico.
- Sin lectores vivos (`lectorPorId` y `mantenerCursor` a false): «Más» re-ejecuta y salta filas, y
  exportar una tabla va por páginas (su LIMIT no admite NULL).
