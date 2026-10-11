# La consola de Redis tiene historial (el de las otras consolas, por lenguaje) y completa el nombre del comando

- **Estado:** vigente
- **Ámbito:** `HistorialStore.ts`, `claves/ControladorClaves.ts`, `shared/secretosRedis.ts`,
  `claves/historialClaves.ts`, `claves/useHistorialConsolaClaves.ts`, `claves/autocompletadoClaves.ts`,
  `claves/comandosRedisCatalogo.ts`, `claves/proveedorClavesMonaco.ts`

## Contexto

Las consolas de SQL y de documentos tienen historial y autocompletado; la de Redis no. El historial es un
almacén del main, por perfil y por lenguaje ([ui-consola-historial.md](ui-consola-historial.md)).

## Decisión

- **Un tercer lenguaje en el almacén** (`comandos`: un comando por línea; no se llama `redis` para no
  confundir el lenguaje con el motor), con sus topes propios: llenar el historial de Redis no
  empuja fuera el de SQL ni el de MongoDB, y «Borrar todo» de una consola solo borra el suyo. El popover es
  el mismo (`HistorialConsultas`); elegir un comando lo INSERTA en el cursor, sin terminador (un comando por
  línea), en línea nueva si hay texto a los lados.
- **Qué se anota**: lo que llegó al servidor, ok o error (también una respuesta de error de Redis como
  `WRONGTYPE`, que sí viajó), y lo cancelado. No se anotan las barreras de Tessera (no admitido, peligroso o
  producción sin confirmar, solo lectura: los códigos `TESSERA-…`) ni lo que no pudo enviarse. La base en la que
  corrió (la que dice el resultado, que un `SELECT` cambia) se guarda como «esquema» (`db3`).
- **Las sesiones del explorador no son consolas.** Editar una clave o borrar por patrón envía por la misma
  consola del main con un `consolaId` que empieza por `visor-` (`PREFIJO_CONSOLA_VISOR`): no se anotan.
- **Contraseñas**: antes de guardar se tapan (`taparSecretosRedis`) `AUTH`, `HELLO … AUTH`, `MIGRATE … AUTH/AUTH2`,
  el valor de `CONFIG SET requirepass/masterauth` y las contraseñas de `ACL SETUSER` (`>`, `<` y `#`).
- **Autocompletado**: solo el NOMBRE del comando (y de su subcomando) en la primera palabra de cada línea, con su
  sintaxis al lado, desde un catálogo propio. No se piden las claves: un servidor puede tener millones, y
  navegar por ellas es lo que hace el árbol. No se pregunta al servidor qué comandos tiene (`COMMAND`): un
  usuario sin ese permiso también completa, y completar no es validar.
- **Historial y atajo**: el botón del reloj de la barra y el acorde de las otras consolas (⌘⇧H / Ctrl+Mayús+H).

## Descartes

- Un historial solo del renderer: se perdería al cerrar y el agente podría leerlo si viviera en el espacio de
  datos; el almacén del main ya resuelve las dos cosas.
- Anotar también las acciones del visor: llenaría el historial de `HSET`/`UNLINK` que el usuario no escribió.
