# Redis explora con SCAN, mueve bytes, confirma siempre lo peligroso y guarda la lista de comandos una sola vez en el trabajador

- **Estado:** vigente
- **Ámbito:** `src/shared/db-claves-ipc.ts`, `src/main/db/explorador/claves/` (`ControladorClaves.ts`,
  `ipc.ts`, `GestorClaves.ts`)

## Contexto

Redis no se parece a SQL ni a documentos: no hay catálogo, las claves y los valores son bytes, un
comando normal no se cancela en el servidor, SCAN no deja estado en él y hay comandos que no se
pueden repetir a ciegas. Comparte con los otros contratos la conexión, `DbRespuesta`, `DbErrorSql`,
`CANCELAR`, `DESCONECTAR`, `SESIONES` y los archivos de consola, y comparte el esqueleto del
controlador de documentos.

## Decisión

- Explorar es `SCAN` con cursor, nunca `KEYS` (bloquea el servidor). El renderer guarda el `cursor`
  de cada página y lo pasa en la siguiente; `'0'` es el fin. `TYPE` y `PTTL` van en la misma tubería.
  Todos los canales nombran su conexión y el visor pide los trozos con su propio `desde`, así que
  no hay lectores en el main.
- Las claves y los valores son bytes: el main los lee con `callBuffer` (con `call`, lo que no es
  UTF-8 se corrompe) y los manda como `DbKvBytes`, con el texto si es UTF-8 válido y el base64
  siempre, para no perder un byte al pedir la clave de vuelta.
- `DbKvBases.conteosDesconocidos`: con un ACL de solo lectura (`+@read`) `INFO keyspace` da
  `NOPERM`; sin esta marca el árbol pondría 0 claves en todas las bases y no escanearía ninguna.
- Los valores de texto llegan con `truncado` (un string llega a 512 MB; el visor pide un trozo con
  `GETRANGE`), y `{ tipo: 'noExiste' }` cubre la clave borrada o caducada entre el `SCAN` y el visor.
- El visor no tiene canal de escritura propio: sus ediciones van por la consola.
- `atender` valida la conexión (existe, es de claves, es del perfil), la FORMA (la base es un entero
  entre 0 y `MAX_BASE_CLAVES`, la clave va en base64 porque una clave de Redis no tiene por qué ser
  UTF-8, la cuenta de SCAN y los trozos del visor acotados, el cursor son cifras) y decide la
  política como en documentos más `confirmadoPeligroso`. El trabajador la aplica con las marcas de
  `COMMAND INFO`.
- Lo peligroso (`FLUSHALL`, `FLUSHDB`, `KEYS`, `CONFIG`, `SHUTDOWN`, `DEBUG`) se confirma SIEMPRE,
  también sin solo lectura: sin `confirmadoPeligroso` el main responde `motivo: 'peligroso'` y la
  interfaz pregunta; en solo lectura se rechaza siempre (`'soloLectura'`).
- **La lista blanca de comandos vive UNA vez**, en `redisComun.cjs`, compartida con `tdb`: dos copias
  de una regla de seguridad divergen. Este controlador no clasifica comandos.
- **Cada consola es una conexión propia** en el trabajador (su `SELECT`, su `MULTI`, su `CLIENT ID`
  para desbloquear). Cancelar va por `CANCELAR` y abandona la conexión o, si el comando bloquea
  (BLPOP), lo suelta con `CLIENT UNBLOCK` ([trabajador-redis-cancelar.md](trabajador-redis-cancelar.md)).
- **Errores:** los mismos `TESSERA-*` que documentos, más «peligroso» y «no admitido» (SUBSCRIBE,
  MONITOR… no se pueden pintar). Un error del servidor a un comando de la consola (`WRONGTYPE`,
  `NOPERM`…) es `ok: false` con `motivo: 'servidor'`, para poder parar una ejecución de varios
  comandos; `{ tipo: 'error' }` queda para los errores anidados de un `EXEC`. La posición de un
  error de sintaxis se pasa de puntos de código a UTF-16 y se hace relativa a la consola sumando
  `desplazamiento`.

## Consecuencias

El contrato es hoja del grafo de imports (solo `import type`) y ES2020. Las lecturas del árbol y del
visor se reintentan una vez si se perdió la sesión; la consola nunca. No hay un esqueleto genérico
compartido con documentos: solo comparten lo que ya vive en `familias.ts` y `politicaDe`.
