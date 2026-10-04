# El cliente de Redis se configura contra los defectos de ioredis y lo que es lectura lo dicen las marcas

- **Estado:** vigente
- **Ámbito:** `src/tdb/redisComun.cjs` y sus piezas (`clienteRedis`, `comandosRedis`, `politicaRedis`,
  `ejecucionRedis`, `claveRedis`, `valoresRedis`, `erroresRedis`)

## Contexto

Medido con `ioredis` 6 (JavaScript puro): reintenta para siempre y encola los comandos sin conexión;
habla RESP3 por defecto; su comprobación de «listo» es un `INFO` que un ACL sin `+info` rechaza; traga el
`SELECT` del apretón de manos si la base no existe; aplica transformadores por nombre en minúscula
(`hgetall` sale como objeto); devuelve el estado (`+OK`) como Buffer igual que un bulk; y `connect()`
rechaza con «Connection is closed.» cuando el fallo real fue AUTH o TLS.

## Decisión

- Opciones fijas: `lazyConnect`, `retryStrategy: () => null`, `maxRetriesPerRequest: 0`,
  `enableOfflineQueue: false`, `enableReadyCheck: false`, `protocol: 2` (RESP2 vale desde 2.8, Valkey,
  KeyDB), `stringNumbers: true` y un oyente de `error` que guarda el último (es el motivo real del rechazo).
- Siempre `callBuffer` con el nombre en MAYÚSCULAS: claves y valores son bytes (`DbKvBytes`: `texto` si es
  UTF-8 válido, `base64` siempre). La conexión abre en la base 0 y hace un `SELECT` explícito, que sí lanza.
- Las marcas (`COMMAND`, ~400 en 6 ms) se piden todas de una vez y se cachean por conexión; nada se pide
  dentro de un MULTI (quedaría ENCOLADO). Lectura = marca `readonly` y no estar en `PELIGROSOS`; un comando
  que el servidor no conoce no es lectura. `LECTURA_SIN_MARCA` (SELECT, PING, INFO, MULTI/EXEC…) no toca
  datos aunque no esté marcado; `LECTURA_CONOCIDA` cubre un ACL que niega `COMMAND`. `CLIENT REPLY` no se
  admite: con `OFF` el servidor deja de contestar.
- Cómo se cancela (soltar o abandonar la conexión): [trabajador-redis-cancelar.md](trabajador-redis-cancelar.md).
- Nunca KEYS: SCAN con MATCH y `TYPE` + `PTTL` por clave en una tubería.

## Consecuencias

- Sin `enableReadyCheck: false`, un usuario de lectura sin `+info` no llegaba a conectar.
- El único error posible del estado como Buffer es pintar como estado un valor de un comando no listado que
  valga exactamente «OK».

## Descartes

- Parchear el decodificador de ioredis (no está exportado). Pedir `COMMAND INFO` por comando cuando el ACL
  niega `COMMAND`: lo niega también, y en un MULTI desalinearía el EXEC.
