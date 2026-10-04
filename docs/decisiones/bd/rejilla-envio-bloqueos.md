# «Enviar» espera los bloqueos con tope, por lotes y antes de escribir nada

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/edicionRejilla*.ts`, `motores/sesion*.ts`

## Contexto

Con otra transacción reteniendo la fila (típicamente una consola del propio usuario), «Enviar»
esperaba sin plazo, y en Oracle 12c+ el Stop no corta una espera de bloqueo: solo Forzar.

## Decisión

- La espera tiene tope (`ESPERA_BLOQUEO_ENVIO_S`). PG: `SET LOCAL lock_timeout` al principio de
  la transacción (cubre también el INSERT; vence con 55P03). SQLite: `busy_timeout` con la
  primera sentencia. Oracle: antes de ningún DML, `SELECT 1 … FOR UPDATE WAIT n` de las
  filas de todos los UPDATE y DELETE, por lotes (mil valores por sentencia por ORA-01795;
  con clave compuesta, las tuplas que quepan en mil binds), cada lote rellenado a una potencia de
  dos para no llenar la memoria compartida del servidor de textos de un solo uso. Solo la
  identidad: los originales ya los compara el DML. Al vencer, ORA-30006.
- Por lotes: con 2000 UPDATE (11.2 y 21c), fila a fila eran 4000 viajes y 1,7-2,3 s frente a
  0,8-1,2 s; y bloquear todo antes falla antes, sin UPDATE que revertir.
- Qué cambio tiene la fila bloqueada: por bisección con `FOR UPDATE NOWAIT` (ORA-00054 al
  instante, como mucho 20 sondas para mil filas, solo tras fallar el lote). Si ya no falla
  ninguna mitad, el error va en el primer cambio del lote y lo dice (`notaSinCulpable`).
- Límite medido: el FOR UPDATE no cubre las esperas por datos sin confirmar que no están en la
  fila (un INSERT o UPDATE a una UNIQUE ya insertada por otra transacción, o el borrado de un
  padre con un hijo sin confirmar). Ahí manda el Stop o Forzar.
- Los binds se adaptan a la columna: un texto largo hacia CLOB/NCLOB va como bind de LOB
  explícito, y hacia NCHAR/NVARCHAR2 como NVARCHAR (en una base no Unicode, como VARCHAR
  llegaría «?»); una clave binaria llega como `0x…` y cada motor la convierte.

## Consecuencias

Sin SELECT sobre la tabla (ORA-01031) no hay FOR UPDATE: el error va al primer cambio en unas
diez sondas. El resto de «Enviar», en [transacciones-enviar-todo-o-nada.md](transacciones-enviar-todo-o-nada.md).

## Descartes

- `SKIP LOCKED` para buscar la fila: obliga a casar las claves del servidor con las de la
  rejilla, y un fallo de formato señalaría la fila equivocada.
