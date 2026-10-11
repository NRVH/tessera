# En MySQL el «esquema» de la consola es la base (`USE`), y la rejilla no edita lo que su texto no escribe

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/motores/sesionMysql.ts`

## Decisión

- El selector de la consola hace `` USE `base` `` (una que no existe da 1049 y una sin permiso 1044:
  las dos son «ya no vale» al reabrir) y se lee con `DATABASE()`. Volver «al de la conexión» es
  volver a su base; sin base en la conexión no hay a qué volver y la sesión sigue donde esté.
- Edición: identidad por la PK o, sin ella, por el índice ÚNICO más corto con todas sus columnas
  NOT NULL y sin partes funcionales. No se editan las columnas generadas, las binarias, las BIT (su
  texto no es su valor: se escriben `b'…'` desde la consola) ni las espaciales (`ST_GeomFromText`).
- La clave binaria viaja en hexadecimal y la convierte `UNHEX(?)`.
- «Enviar» espera como mucho el tope con `SET SESSION innodb_lock_wait_timeout` (de la sesión, que
  en «Enviar» es efímera); vence con 1205.
- InnoDB lee sin esperar a un escritor: ningún error de leer es «bloqueado».
- Explain: `EXPLAIN FORMAT=JSON` con los valores de los parámetros. No ejecuta, y un error de MySQL no
  deshace la transacción del usuario: no hace falta un punto de guardado. Los nodos salen del JSON
  (consulta, tablas con su acceso, ordenación, agrupación…) y el texto es el JSON entero.
