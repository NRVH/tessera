# Las opciones de sesión de PostgreSQL van al constructor del cliente y el oyente de error antes de conectar

- **Estado:** vigente
- **Ámbito:** `src/tdb/postgres.cjs` (`abrir`) y quien le pasa `opciones`, `src/tdb/sesionPostgres.cjs`

## Contexto

El explorador abre un cliente `pg` por consola y lo deja vivo. `tdb` lo abre por invocación y no
pasa `opciones`: su comportamiento no puede cambiar. Un backend de PostgreSQL que muere con la
sesión ociosa emite `error` en el cliente; sin oyente, Node lo convierte en una excepción que
tumba el proceso entero y con él las transacciones de las demás consolas de la conexión.

## Decisión

- `statement_timeout`, `application_name` y `keepAlive` van AL CONSTRUCTOR del `Client`: son
  parámetros de arranque del protocolo, sin un `SET` posterior.
- `alError` se engancha nada más construir el cliente, ANTES de `connect()`.
- Sin `opciones` (el caso de `tdb`) rigen los valores de siempre: `application_name`
  `Tessera/tdb <usuario>@<alias>` y 60 s de tope por sentencia.

## Consecuencias

- Reordenar `cliente.on('error', …)` después de `connect()` deja una ventana en la que un fallo
  del backend mata el proceso de sesión.
- Un `SET` posterior costaría un viaje por sesión y dejaría una ventana sin el tope.

## Descartes

- `SET statement_timeout` tras conectar: un viaje de más y una ventana sin tope.
