# La política de transacciones vive en una máquina de estados pura

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/maquinaSesion.ts`, `sesiones/transacciones.ts` y `sesiones/NucleoSesiones.ts`

## Contexto

Abrir, ejecutar, confirmar, revertir, perder la sesión, cerrar por inactividad o cerrar la app
tienen reglas que protegen trabajo del usuario, y repartidas por el gestor se contradecían.

## Decisión

- UNA función pura, `transicion(estado, evento) -> { estado, efectos }`. El gestor aplica eventos
  y ejecuta los efectos EN EL ORDEN en que vuelven; si una regla parece faltar en el gestor,
  está en la máquina. Sin reloj propio (`ahora` llega en cada evento); si nada cambia devuelve
  el MISMO objeto (el gestor emite solo cuando cambia la referencia); un rechazo es un efecto.
- Invariantes (las fija `test-maquina-sesion`, también con un paseo aleatorio): sin sesión no hay
  transacción; `soloLectura ⇒ Auto ∧ sin tx`; `ocupada ⇔ ocupadaDesde`; el modo de Tx sobrevive
  a la pérdida, la inactividad y el cierre (es de la consola, no de la sesión).
- Dos fases: COMMIT, ROLLBACK y Manual→Auto con tx viva salen como efecto `tx` y la máquina
  aplica lo de detrás (`tras`: cambiar a Auto, cerrar) solo con el resultado REAL (`txResuelta`).
- Una tx FALLIDA solo se revierte: el COMMIT de PG sobre ella es un ROLLBACK que el servidor da
  por bueno. Se rechaza (`txFallida`) salvo EN BLOQUE (desconectar, salir de la app), donde
  «Confirmar» confirma lo que se puede y revierte las fallidas (`accionEnBloque`), y lo dice.
- `detenida`: el Stop que mata el proceso (SQLite) no es una pérdida; la sesión queda cerrada.
- Lo único que depende del motor (qué se confirma solo en Manual, `confirmaEnVuelo`) lo deciden
  dos capacidades del descriptor: `ddlConfirmaImplicito` y `rutinasConfirmanPorDentro`.

## Consecuencias

- `transicion` se parte en una función por evento, pero el orden de los casos y de los efectos
  devueltos es la política: no se reordena.
- COMMIT, ROLLBACK, pasar a Auto, cerrar, desconectar, borrar la consola, Forzar y salir pasan
  todos por la máquina y por `ejecutarTx`/`resolverEnBloque`/`resolverTodas`.

## Descartes

- Cambiar el modo antes de saber si el COMMIT fue bien (en Oracle, el siguiente `execute` con
  autoCommit confirmaba sin avisar). Un estado `obsoleta` para una conexión editada con tx
  pendiente: editar se bloquea antes. Contar sentencias por clase: la tx la lee el servidor.
