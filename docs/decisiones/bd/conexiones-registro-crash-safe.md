# El registro de conexiones: «lo que no entiendo, no lo toco» y cada escritura, todo o nada

- **Estado:** vigente
- **Ámbito:** `src/main/db/ConnectionStore.ts`, `registroConexiones.ts`, `controlador/mensajesRegistro.ts`,
  `controlador/copiaIlegible.ts`, `controlador/validacionConexion.ts`

## Contexto

Con un registro de una versión más nueva, la primera escritura rutinaria (`marcarVerificada` al abrir una
sesión) borraba las conexiones de motores que esta versión no conoce, bajaba `version` y quitaba lo que no
entendía. Nadie avisaba: desde fuera es indistinguible de una avería. Además, un `db-connections.json` roto a
mano se tomaba por vacío y la siguiente escritura lo sobrescribía entero.

## Decisión

- Una sola lista de entradas, conocidas y ajenas mezcladas en su orden. Una entrada de motor desconocido, de
  forma que no se reconoce o con un id ya usado por otra conocida es ajena: se reescribe tal cual y en su sitio;
  la UI solo ofrece Eliminar. Lo que una conocida trae y esta versión no gobierna vuelve al disco con ella.
- `version` nunca baja. Un formato entero que no se sabe escribir, o un archivo que no se puede leer y sin `.bak`
  que lo supla, se bloquea (`formatoAjeno`): no se lista, no se escribe, no se poda, con un aviso que dice qué
  hacer. Un `.bak` legible se usa con el principal roto, pero la primera escritura guarda antes el roto aparte
  (`.ilegible`, con `wx` y `fsync`); si no puede, no escribe. Un principal que no se deja abrir se bloquea aunque
  haya `.bak`.
- La misma regla vale al escribir, no solo al arrancar: si el principal cambió por debajo (edición a mano con la
  app abierta) y no se puede sustituir sin perderlo, la escritura se niega (`avisoAlSobrescribir`).
- Cada escritura se aplica a una copia entera (`structuredClone`) y solo si sale bien pasa a ser el registro
  (`aplicar`): memoria y disco nunca divergen. Los errores de `fs` llegan al renderer sin la ruta del host.
- La contraseña va cifrada con el `CifradoSecretos` del sistema (DPAPI, Llavero) y, si no hay cifrado, se falla
  antes que guardarla en claro. `tdb` lee el mismo archivo pero nunca descifra: el secreto le llega por el puente.
- El main es la autoridad del registro: lo que el motor descarta al guardar (`descartarAlGuardar`) y lo que exige
  (`validarDestino`) se aplica aquí, no solo en el formulario, y se valida el destino ya limpio que se escribe.

## Descartes

- Negarse a escribir con `version` mayor: dejaría de poder verificar o editar en cuanto se abriera una versión nueva.
- Guardar la copia del roto como `.bak`: es lo que se rescata al leer, y con el roto ahí no habría nada legible.
