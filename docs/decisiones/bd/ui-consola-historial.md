# El historial de consultas es un popover que filtra en el main e inserta en el cursor, nunca desde una lista vieja

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/HistorialConsultas.tsx`, `consola/useHistorialConsultas.ts`, `consola/historialConsola.ts`,
  `consola/useAnclaHistorial.ts`, `documentos/useHistorialConsolaDocs.ts`, `shared/secretosMongo.ts`, `HistorialStore.ts`,
  `claves/ControladorClaves.ts`, `shared/secretosRedis.ts`, `claves/historialClaves.ts`,
  `claves/useHistorialConsolaClaves.ts`

## Contexto

El historial lo guarda el main fuera del espacio de datos ([explorador-historial.md](explorador-historial.md)).
El popover cuelga del botón del reloj de la barra por portal, y React burbujea las teclas del
portal hasta la sección de la consola, que tiene sus propios atajos.

## Decisión

- El molde del selector de esquema ([ui-consola-barra-y-pane.md](ui-consola-barra-y-pane.md)):
  `fixed` acotado al viewport y alineado por la derecha, foco en el filtro, ↑/↓ con
  `aria-activedescendant`. Clic fuera o Esc cierran sin hacer nada; todas las teclas se quedan
  en el popover, y el acorde que lo abre lo cierra.
- «Solo esta conexión», activado al abrir: casi siempre se busca lo que se hizo ahí. El filtro
  lo aplica el MAIN (sin caja ni tildes) tras 150 ms; se refresca al abrir, y la respuesta de
  una pregunta vieja o con el popover cerrado se tira.
- Elegir INSERTA en el cursor (en línea nueva si hay texto), terminado con `;`, `/` o `GO` según
  el divisor y con los saltos en el fin de línea del modelo.
- Enter no inserta de una lista vieja: con la respuesta de lo tecleado pendiente, espera e
  inserta la primera de la nueva; seguir tecleando retira la espera.
- «Borrar todo» pregunta EN LÍNEA (una franja con Cancelar / Borrar todo). Al quitar la franja,
  el foco vuelve al filtro antes de desmontar el botón: en `body`, fuera del popover, su
  teclado dejaría de responder.
- Borrar una: la papelera de la fila, o Supr / ⌘⌫ solo con el filtro vacío.
- Sin lista virtual: como mucho `LIMITE_HISTORIAL` (500) filas de texto.
- **Un historial por lenguaje**: el popover es el mismo en la consola SQL, en la de MongoDB y en la de Redis, y
  cada una pide y borra solo el suyo (`lenguaje`, `sql` o `mongosh`; las entradas sin marca son
  SQL). Una orden del shell insertada en SQL, o al revés, solo daría un error, y «Borrar todo»
  desde una consola se llevaría el historial de la otra. En MongoDB se termina con `;` salvo una
  orden de línea (`use x`, `show dbs`), y antes de guardar se tapan `pwd`, `password`, el segundo
  argumento de `changeUserPassword` y de `db.auth` y la clave de una URI.
- **Redis es un tercer lenguaje del almacén** (`comandos`: un comando por línea; no se llama `redis`
  para no confundir el lenguaje con el motor), con topes propios: llenar el historial de Redis no
  empuja fuera el de SQL ni el de MongoDB. Elegir un comando lo INSERTA en el cursor, sin terminador,
  en línea nueva si hay texto a los lados.
  - **Qué se anota**: lo que llegó al servidor, ok o error (también una respuesta de error de Redis
    como `WRONGTYPE`, que sí viajó), y lo cancelado. No se anotan las barreras de Tessera (no admitido,
    peligroso o producción sin confirmar, solo lectura: los códigos `TESSERA-…`) ni lo que no pudo
    enviarse. La base en la que corrió (la que dice el resultado, que un `SELECT` cambia) se guarda
    como «esquema» (`db3`).
  - **Las sesiones del explorador no son consolas.** Editar una clave o borrar por patrón envía por
    la misma consola del main con un `consolaId` que empieza por `visor-` (`PREFIJO_CONSOLA_VISOR`):
    no se anotan.
  - **Contraseñas**: antes de guardar se tapan (`taparSecretosRedis`) `AUTH`, `HELLO … AUTH`,
    `MIGRATE … AUTH/AUTH2`, el valor de `CONFIG SET requirepass/masterauth` y las contraseñas de
    `ACL SETUSER` (`>`, `<` y `#`).

## Descartes

- Un modal para confirmar «Borrar todo»: el clic en él contaría como clic fuera y cerraría el
  popover que se estaba confirmando.
- Normalizar a LF al guardar en el historial: cambiaba «lo que se envió».
- Un historial solo del renderer para Redis: se perdería al cerrar y el agente podría leerlo si
  viviera en el espacio de datos; el almacén del main ya resuelve las dos cosas.
- Anotar también las acciones del visor de claves: llenaría el historial de `HSET`/`UNLINK` que el
  usuario no escribió.
