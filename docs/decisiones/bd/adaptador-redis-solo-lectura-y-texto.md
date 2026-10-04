# En Redis el agente solo lee, con una guardia en dos tiempos, y el texto son comandos de redis-cli

- **Estado:** vigente
- **Ámbito:** `src/tdb/redis.cjs`, `src/tdb/entradaRedis.cjs` y lo común en `src/tdb/redisComun.cjs`

## Contexto

En Redis un comando de escritura es de un solo golpe y sin vuelta atrás (un `DEL`, un `FLUSHDB`), y
qué es lectura lo dicen unas marcas que solo da el servidor (`COMMAND INFO`). Si el explorador y el
agente clasificaran distinto, uno de los dos mentiría. `tdb` abre y cierra la conexión en cada comando.

## Decisión

- SIEMPRE solo lectura para el agente, también con una conexión marcada de escritura
  (`soloLecturaSiempre`, que `tdb.cjs` lee para poner la guardia delante). Las escrituras se hacen
  desde la consola de Redis de Tessera, que pregunta. Producción queda cubierta: nunca se escribe.
- La guardia va en dos tiempos. `guardiaSoloLectura` (pura, antes de conectar) rechaza un texto
  vacío o que no se entiende, lo no admitido (SUBSCRIBE, MONITOR: dejarían la conexión escuchando) y
  lo peligroso (KEYS, CONFIG, FLUSHALL…, aunque KEYS sea `readonly`). Lo demás pasa por
  `aplicarPolitica` con `soloLectura: true` y las marcas, antes de mandar cada línea.
- El texto son comandos de redis-cli, uno por línea; se ignoran las vacías y las que empiezan por
  `#`. Se ejecutan en orden sobre la misma conexión y se para en el primer error. `SELECT n` lo hace
  `tdb` mismo (vale para las líneas siguientes) y no depende de la marca de SELECT, que no es
  `readonly`.
- La salida es la de redis-cli. `--limit` acota los elementos de primer nivel de cada respuesta y hay
  un tope de 64 Ki caracteres; los dos se dicen. `--json` lleva `valor`, `filas` y `respuestas`
  (con los bytes en base64).
- `schema` son las claves (SCAN acotado con tipo y TTL), nunca KEYS. `describe` y las foráneas no
  aplican: se dice cómo mirar una clave.

## Consecuencias

- La garantía de verdad es un usuario con ACL de lectura; Tessera informa de ello en el rechazo.

## Descartes

- Una lista propia de escrituras conocidas (SET, DEL…) para rechazar antes de conectar: sería un
  segundo clasificador que acabaría divergiendo del de las marcas.
