# En Redis cancelar es soltar el comando bloqueado o abandonar la conexión

- **Estado:** vigente
- **Ámbito:** `src/tdb/sesionRedis.cjs`

## Contexto

Redis es de un hilo: no hay «cancela esta sentencia». El adaptador del CLI y su guardia están en
`adaptador-redis-solo-lectura-y-texto.md`; aquí, la sesión larga del explorador.

## Decisión

- Una conexión por sesión (`meta`, `datos`, `consola:<id>`), cada una con su base (`SELECT` solo si la petición
  trae otra), su MULTI y su `CLIENT ID`, que es lo que hace falta para soltarla desde otra.
- La política la aplica el trabajador: el main manda `politica` y aquí `aplicarPolitica` la aplica ANTES de
  mandar el comando, con las marcas de `COMMAND` guardadas por sesión. Una política que falta responde
  `protocolo`, y un campo que no es booleano cuenta como el caso SEGURO. Un error del SERVIDOR al comando de la
  consola (WRONGTYPE, NOPERM…) LANZA, para que el renderer pare un lote en el primero que falla.
- Cancelar: si el comando puede estar BLOQUEADO (BLPOP, XREAD BLOCK… o la marca `blocking` de `COMMAND`),
  `CLIENT UNBLOCK <id> ERROR` desde una conexión auxiliar: termina con un error y la conexión sigue viva. Un Lua
  o una función, con `SCRIPT KILL` / `FUNCTION KILL` (solo si no escribió).
- Si no se pudo soltar (no estaba bloqueado todavía, sin permiso para `CLIENT UNBLOCK`), se ABANDONA: se cierra la
  conexión y la operación siguiente abre otra con las mismas opciones, sin pedir el secreto otra vez. El mensaje
  dice que el servidor puede terminar el comando igual.
- Cada operación lleva su testigo (`enCurso`): una cancelación que llega TARDE no toca la operación nueva.
- El error del comando soltado llega por la conexión de la sesión, a menudo ANTES que el `:1` del `CLIENT UNBLOCK`
  por la auxiliar: la operación espera a saber si se soltó (`en.soltando`) antes de elegir el mensaje. Sin eso,
  una de cada tres decía «el servidor puede haberlo terminado» de un comando que se había soltado limpio.
- Pérdida: si la conexión se cierra sin que la cerremos nosotros se avisa con `alPerder`; la abandonada por
  cancelar NO es una pérdida.

## Descartes

- Decir solo «cancelada» tras abandonar: en Redis haría creer que el comando no se aplicó.
