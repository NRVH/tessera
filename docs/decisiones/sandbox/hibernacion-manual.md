# La hibernación del contenedor es manual y por perfil; el recuento de sesiones nunca para un contenedor

- **Estado:** vigente
- **Ámbito:** `src/main/hibernate/`, `src/main/sandbox/gestor/contenedores.ts`, `src/shared/hibernate-ipc.ts`

## Contexto

Los contenedores (el recurso caro de memoria) son de cada cuenta de un perfil (`contenedor-por-cuenta.md`) y los
comparten todos sus proyectos. Cambiar de perfil o de proyecto es constante y no debe costar un arranque.

## Decisión

- Un contenedor para por hibernar su perfil (`stopContainer`), por cerrar la app, o por las reglas propias de los de
  cuenta: sin agentes a los 2 minutos, el límite y la saturación (`limite-de-contenedores.md`,
  `saturacion-de-docker.md`). Cambiar de perfil o de proyecto nunca detiene nada.
- `liveSessions` cuenta las sesiones de los agentes en Docker por id de contenedor de la cuenta: solo evita parar uno
  con sesiones al vencer su plazo de inactividad. `releaseSession` solo apunta, y devolver «era la última» no para
  nada. La terminal de abajo es nativa y no usa contenedor.
- Hibernar un perfil cierra sus sesiones en los dos controladores y hace `stopContainer` del perfil, que para los
  contenedores de todas sus cuentas (cerrar sesiones nunca para ninguno; idempotente, aislado a los del perfil).
  `HibernationController` es el único que conoce los dos controladores.
- El estado 'hibernated' lo marca y persiste el renderer; deshibernar es perezoso (entrar al perfil recrea).
- Lo manual es parar el CONTENEDOR. El agente NATIVO de un proyecto sí se cierra solo por inactividad, sin tocar
  contenedores ni terminales: `agentes/hibernacion-por-inactividad.md`.

## Consecuencias

`test:sandbox:hibernate` y `test:hibernate` (con Docker) fijan que liberar la última sesión no para el contenedor y que
hibernar A no toca B.

## Descartes

- Auto-stop al quedarse sin sesiones: mataría el agente del perfil anterior en cada cambio de perfil.
- Hibernar por proyecto: no libera el contenedor, que es lo caro, y añade superficie de error.
