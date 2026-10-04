# La hibernación del contenedor es manual y por perfil; el recuento de sesiones nunca para un contenedor

- **Estado:** vigente
- **Ámbito:** `src/main/hibernate/`, `src/main/sandbox/gestor/contenedores.ts`, `src/shared/hibernate-ipc.ts`

## Contexto

El contenedor (el recurso caro de memoria) es POR PERFIL y lo comparten todos sus proyectos. La terminal de abajo
sigue al proyecto activo y cierra su sesión en CADA cambio de perfil o de proyecto.

## Decisión

- Un contenedor para SOLO por hibernar su perfil (`stopContainer`) o por cerrar la app. Cambiar de perfil o de
  proyecto nunca detiene nada.
- `liveSessions` cuenta las sesiones de las dos terminales con claves `term:`/`agent:` (sus ids pueden coincidir) y es
  informativo: `releaseSession` solo apunta, y devolver «era la última» no para nada.
- Hibernar un perfil cierra sus sesiones en los dos controladores y hace un `stopContainer` de respaldo (idempotente y
  aislado a `tessera-<perfil>`). `HibernationController` es el único que conoce los dos controladores.
- El estado 'hibernated' lo marca y persiste el renderer; deshibernar es perezoso (entrar al perfil recrea).
- Lo manual es parar el CONTENEDOR. El agente de un proyecto NATIVO sí se cierra solo por inactividad, sin tocar
  contenedores ni terminales: `agentes/hibernacion-por-inactividad.md`.

## Consecuencias

`test:sandbox:hibernate` y `test:hibernate` (con Docker) fijan que liberar la última sesión no para el contenedor y que
hibernar A no toca B.

## Descartes

- Auto-stop al quedarse sin sesiones: mataría el agente del perfil anterior en cada cambio de perfil.
- Hibernar por proyecto: no libera el contenedor, que es lo caro, y añade superficie de error.
