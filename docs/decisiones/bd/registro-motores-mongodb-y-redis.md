# Los descriptores de MongoDB y Redis: sin usuario obligatorio, sin TLS por defecto y solo lectura por lista blanca

- **Estado:** vigente
- **Ámbito:** `src/shared/motores/mongodb.ts`, `src/shared/motores/redis.ts`, `src/tdb/mongoComun.cjs`, `src/tdb/redisComun.cjs`

## Contexto

Son los motores de las familias `documentos` y `claves` (`familia` en `tipos.ts`). Ninguno impone el
solo lectura en el servidor: la garantía de verdad es un usuario con rol `read` (MongoDB) o un usuario
ACL de lectura (Redis), y Tessera pone su propia guardia (`candadoSoloLectura: 'listaBlanca'`).

## Decisión

- `obligatorios` sin `user`: se conectan sin autenticar si el servidor lo permite (desarrollo sin
  `--auth`), y Redis admite la clave sin usuario (`AUTH <clave>`, el usuario `default`). El usuario va
  en `opcionales` y la contraseña se guarda si se escribe (`credenciales: 'usuarioClave'`).
- `tlsPorDefecto` propio y **sin cifrar**: `TLS_POR_DEFECTO` (cifrar y verificar) es el de SQL Server y
  un MongoDB local o un Redis de la LAN no cifran. «Pegar URI» lo enciende (`mongodb+srv://` y
  `rediss://`).
- `soloLecturaPorDefecto: true`, como todos.
- **MongoDB**: la base es opcional (`nivelBases: 'sinBaseFija'`): con ella el árbol empieza en sus
  colecciones; sin ella, en las bases autorizadas (con rol `read` en una sola base `listDatabases`
  enseña esa y no falla, medido). `srv` y `opcionesUri` (lista blanca) los rellena «Pegar URI»;
  `directConnection=true` con un solo host lo añade el trabajador. Consola del shell interpretada sin
  evaluar JavaScript; edición por `_id`; «Enviar» todo o nada donde hay transacciones.
- **Redis**: solo standalone. Árbol por `:` con `SCAN` paginado (nunca `KEYS`) y selector de base. La
  marca `readonly` de `COMMAND INFO` y no estar en la lista de peligrosos deciden el solo lectura; lo
  peligroso se confirma. `database` es el número de la base (0 si va vacío) en el campo de texto de
  siempre para no cambiar la forma en disco. `basesPorDefecto: 16`: el `databases` de fábrica si
  `CONFIG GET databases` da `NOPERM`. Sin `opcionesUri`: lo que se pegue tras `?` se descarta y se dice.

## Descartes

- Cluster y Sentinel de Redis: fuera de alcance.
- Ejecutar JavaScript en la consola de MongoDB: se interpreta la notación del shell y se rechaza lo demás.

## Consecuencias

Contratos IPC: [contratos-documentos.md](contratos-documentos.md), [contratos-claves.md](contratos-claves.md).
