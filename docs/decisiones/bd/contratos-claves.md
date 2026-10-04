# El contrato de claves explora con SCAN, mueve bytes y confirma lo peligroso

- **Estado:** vigente
- **Ámbito:** `src/shared/db-claves-ipc.ts`, `src/main/db/claves/`

## Contexto

Redis no se parece a SQL ni a documentos: no hay catálogo, las claves y los valores son bytes y un
comando normal no se cancela en el servidor. Comparte con los otros contratos la conexión,
`DbRespuesta`, `DbErrorSql`, `CANCELAR`, `DESCONECTAR`, `SESIONES` y los archivos de consola.

## Decisión

- Explorar es `SCAN` con cursor, nunca `KEYS` (bloquea el servidor). El renderer guarda el `cursor`
  de cada página y lo pasa en la siguiente; `'0'` es el fin. `TYPE` y `PTTL` van en la misma tubería.
- Las claves y los valores son bytes: el main los lee con `callBuffer` (con `call`, lo que no es
  UTF-8 se corrompe) y los manda como `DbKvBytes`, con el texto si es UTF-8 válido y el base64
  siempre, para no perder un byte al pedir la clave de vuelta.
- `DbKvBases.conteosDesconocidos`: con un ACL de solo lectura (`+@read`) `INFO keyspace` da
  `NOPERM`; sin esta marca el árbol pondría 0 claves en todas las bases y no escanearía ninguna.
- Los valores de texto llegan con `truncado` (un string llega a 512 MB; el visor pide un trozo con
  `GETRANGE`), y `{ tipo: 'noExiste' }` cubre la clave borrada o caducada entre el `SCAN` y el visor.
- El visor es de lectura: se escribe por la consola.
- Un error del servidor a un comando de la consola (`WRONGTYPE`, `NOPERM`…) es `ok: false` con
  `motivo: 'servidor'`, para poder parar una ejecución de varios comandos. `{ tipo: 'error' }` queda
  para los errores anidados de un `EXEC`.
- Cancelar va por `CANCELAR` como en los demás contratos; qué hace el trabajador está en
  [trabajador-redis-cancelar.md](trabajador-redis-cancelar.md).
- Lo peligroso (`FLUSHALL`, `FLUSHDB`, `KEYS`, `CONFIG`, `SHUTDOWN`, `DEBUG`) se confirma: sin
  `confirmadoPeligroso` el main responde `motivo: 'peligroso'` y la interfaz pregunta; en solo
  lectura se rechaza siempre (`'soloLectura'`).

## Consecuencias

Hoja del grafo de imports (solo `import type`) y ES2020. Controlador: [claves-controlador.md](claves-controlador.md).
