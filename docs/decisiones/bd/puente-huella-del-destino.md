# Cada contraseña viaja con la huella de su destino

- **Estado:** vigente
- **Ámbito:** `src/main/db/huellaDestino.ts`, `dbBridge.ts`, `hostEnv.ts`; su copia en `src/tdb/tdb.cjs`

## Contexto

`tdb` lee el registro en cada invocación, pero la contraseña le llega por id y emitida antes: al abrir la
terminal (sin puente) o desde la memoria del main (con puente). Si entre medias la entrada de ese id deja de
ser la misma, la contraseña va a otro sitio: eliminar la original con una copia pegada a mano con el mismo id,
editar el destino con la terminal abierta, o editar el archivo a mano con Tessera abierta (medido en `test-shim`
con un PostgreSQL de mentira que apunta la contraseña que recibe).

## Decisión

- La huella es el SHA-256 de `[motor, host, port, database, sid, user]` en JSON (`undefined` como `null`),
  recortado a 32 hex. Solo entra lo que decide adónde va la contraseña y como quién: renombrar, cambiar entorno,
  notas, driver o solo lectura no la manda a otro sitio.
- El archivo (SQLite) entra como séptimo valor, `[instancia, autenticacion, dominio, tls]` como una lista más y
  `[srv, opcionesUri]` (MongoDB: con `srv` el host lleva a otros servidores) como otra, cada una solo si la entrada
  los trae: la huella de toda conexión sin ellos es la de antes al byte, y una terminal abierta
  antes de actualizar sigue casando.
- Los dos lados parten del mismo JSON, sin normalizar: normalizar en uno solo sería el desajuste que esto detecta.
  `tdb.cjs` lleva una copia (no puede importar TypeScript) y `test-shim` fija que dan lo mismo.
- Sin puente, junto a `TESSERA_DB_SECRET_<ID>` viaja `TESSERA_DB_DESTINO_<ID>`, siempre las dos; con puente, la
  respuesta lleva `huellas`. Es un campo nuevo: el protocolo no cambia de versión.

## Descartes

- El destino en claro (habría que escapar separadores en una variable de entorno); meter la huella en el valor
  del secreto (rompe a quien lo lee tal cual); un hash no criptográfico (alguien que edite el registro fabricaría
  otro destino con la misma huella); quitar el modo sin puente (es el respaldo si el pipe no levanta).
