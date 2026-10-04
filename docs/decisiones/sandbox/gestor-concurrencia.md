# El gestor del sandbox serializa por perfil, coalesce creaciones y builds, y no confunde «no sé» con «no existe»

- **Estado:** vigente
- **Ámbito:** `src/main/sandbox/SandboxManager.ts`, `src/main/sandbox/gestor/`, `src/main/sandbox/adaptadores/docker.ts`

## Contexto

La terminal de abajo y la del agente piden el contenedor del mismo perfil a la vez; restaurar un workspace abre
varios perfiles de golpe; un daemon colgado no responde nunca.

## Decisión

- `SandboxManager` es una FACHADA con la API de siempre sobre UN `NucleoSandbox` (todo el estado, una vez) y las
  operaciones de `gestor/`. Los delegados son `return this.x.m(…)` sin `async`: mismas microtareas.
- `ensureInFlight` coalesce las creaciones del MISMO perfil (se limpia al asentarse: no es una caché) y
  `profileLock` serializa por perfil crear, parar y montar: sin él, dos aperturas apilaban binds y una hibernación
  se colaba a mitad de un montaje. Los `…Inner` de credenciales no retoman el candado (sería interbloqueo).
- `imageInFlight` coalesce los builds por SELLO (versión + extras): dos perfiles no construyen el mismo tag a la vez
  y un cambio de extras no hereda un build que ya no sirve.
- Todo `docker` pasa por UN semáforo (8) con techo de tiempo y de salida; el build y la escritura por stdin llevan el
  suyo. Sin techo, una promesa colgada dejaba el perfil sin abrir hasta reiniciar.
- `inspect` devuelve `null` SOLO si Docker dice que no existe; si no se sabe, LANZA. Con `null` se desmontaba
  `/workspace` bajo un contenedor vivo. `capacidades` solo cachea respuestas concluyentes.
- `ensureContainer` espera el barrido de arranque; un contenedor distinto del conocido (otro Id) se trata con pizarra
  limpia: se desmontan sus binds y se olvidan sus mapas antes de recrear.
- Un contenedor del perfil que no es nuestro no se borra (`contenedores-propios.md`).

## Consecuencias

Un `await` nuevo dentro de una sección crítica abre carreras que solo ve `test:sandbox:race` (con Docker). Las
órdenes a Docker de la fachada se comparan byte a byte antes y después de cualquier reparto.
