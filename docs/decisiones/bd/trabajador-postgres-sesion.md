# La sesión PostgreSQL lee con `pg-cursor` y lo cierra en el acto, refija formatos y cancela por CancelRequest

- **Estado:** vigente
- **Ámbito:** `src/tdb/sesionPostgres.cjs` y `erroresSesionPostgres`, `formatosSesionPostgres`, `clienteSesionPostgres`, `cursorSesionPostgres`, `salidaSesionPostgres`

## Contexto

El trabajador es tonto: el candado, el BEGIN y qué es releíble los decide el main y llegan en `opciones`.
Lo que sigue es lo que, sin embargo, tiene que cumplir el trabajador para que esas decisiones valgan.

## Decisión

- `pg-cursor` para TODA sentencia de usuario: `read(n+1)` y `close()` en el acto. Se sabe `hayMas` sin
  traer todo, y no queda un portal suspendido (no manda Sync): la sesión quedaría *idle in transaction*
  reteniendo AccessShareLock, con el `Client` ocupado y expuesta a 25P03. «Más» es re-ejecutar con
  `saltarFilas`. Excepción: exportar (`mantenerCursor`) deja UN cursor vivo mientras dura la exportación.
- Protocolo extendido en todo: el servidor rechaza varias sentencias en un mismo Parse, así que un `;` que
  se le escape al léxico del main no cuela un segundo comando.
- Texto crudo del servidor salvo bool (numeric/int8 exactos, timestamptz con la zona de la sesión). Al abrir
  se fijan DateStyle, IntervalStyle, bytea_output, extra_float_digits y `standard_conforming_strings` con
  `set_config` en UN viaje. Este último importa: con `off` el servidor lee `'a\'; …'` como una cadena y el
  léxico compartido como cadena más código, y el main clasificaría otra sentencia de la que corre.
- Segunda barrera por ParameterStatus: el rechazo del main mira `SET`/`RESET`, pero un `set_config` o una
  función lo cambian igual. El servidor INFORMA sin coste de tres de los formatos; si uno se aparta se
  refijan todos tras la sentencia y ANTES de la siguiente (un cursor vivo de exportación vuelve sin refijar).
- Solo lectura: además del candado de sesión, cada sentencia va en `BEGIN READ ONLY … ROLLBACK`, porque un
  `set_config('default_transaction_read_only','off')` desactiva el de sesión. Las `SET` de la lista blanca
  van fuera del envoltorio: dentro, el ROLLBACK las desharía.
- Manual = `BEGIN` perezoso si el estado es 'I', salvo `sinBegin`; estado exacto con `getTransactionStatus()`
  y, en 'T', `txid_current_if_assigned()` (nulo = `abierta`).
- Stop = CancelRequest del protocolo (sin credenciales ni sesión extra). Un cancel tardío puede caer en la
  sentencia SIGUIENTE: se espera a que el servidor cierre la conexión del cancel y el ROLLBACK se reintenta
  una vez si da 57014.
- `alError` va al constructor del `Client`: un backend terminado con la sesión ociosa emite 'error' y, sin
  oyente, tumbaba el proceso. Se convierte en el gancho `alPerder`.

## Descartes

- Envolver en `SELECT * FROM (…) LIMIT`: cambia la semántica (CTE con DML, SELECT INTO, SHOW) y descoloca la
  posición de los errores. `Client#cancel`: exige el `activeQuery` y avisa por stderr.
