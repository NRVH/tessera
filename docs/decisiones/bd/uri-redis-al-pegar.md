# «Pegar URI» de Redis lee las credenciales como ioredis y descarta las opciones

- **Estado:** vigente
- **Ámbito:** `src/shared/uriConexion.ts` (`descomponerUriRedis`, `validarBaseRedis`)

## Contexto

`redis://[usuario[:clave]@]host[:puerto][/base]` y `rediss://`. Entra por el mismo corte de la URI que
MongoDB (`partirUri`) pero no guarda opciones. La base la valida el formulario en vivo y el main al
guardar, con la misma función (`validarBaseRedis`).

## Decisión

- **Credenciales como las lee `ioredis`** (`parseURL` de la 6.0.0): usuario lo de antes de `:` y clave lo de
  después. `redis://:clave@h` es `AUTH` con la clave sola (el usuario `default` de las ACL) y queda con
  usuario vacío. `redis-cli` lee `redis://secreto@h` como contraseña, pero quien conecta es `ioredis`; si el
  formulario dijera otra cosa, la conexión guardada no sería la de la URI.
- La base es un entero de 0 a 9999 y se guarda normalizada (`/007` es `'7'`); una ruta que no lo es da error
  al pegar, porque `ioredis` la manda al `SELECT` y el servidor contesta «ERR invalid DB index» al conectar,
  que es tarde. `databases` de fábrica es 16: una base mayor que 9999 es casi siempre un número pegado en el
  campo equivocado.
- `rediss://` cifra y verifica (`tls: {}` en `ioredis`); `redis://` es el valor por defecto del motor (sin
  cifrar), no `TLS_POR_DEFECTO`.
- Todo lo de detrás de `?` se descarta y se dice (`descartadas`): el descriptor no declara `opcionesUri` y las
  opciones de `ioredis` (`family`, timeouts, `db=`) no cambian a qué servidor se conecta. Por eso no se
  validan: una `?foo` sin valor no es un error.
- Varios hosts es un error (Cluster y Sentinel no están soportados); IPv6 con corchetes y un socket local
  como en MongoDB.

## Descartes

- Honrar `?db=`: la base va en la ruta y dos sitios para lo mismo obligan a decidir cuál gana.
