# Proyectos y credenciales se montan en caliente con un helper privilegiado efímero

- **Estado:** vigente
- **Ámbito:** `src/main/sandbox/gestor/montajes.ts`, `gestor/credenciales.ts`, `gestor/barrido.ts`

## Contexto

Recrear el contenedor para añadir un proyecto o una credencial mataría la sesión del agente. Los binds se hacen en el
namespace de montaje del daemon, que solo alcanza root.

## Decisión

- Única puerta al privilegio: un contenedor `alpine` EFÍMERO `--privileged --pid=host` que ejecuta `nsenter -t 1 -m
  -- sh -c <ops>` (por argv, sin shell del host) y muere al terminar. Nunca queda privilegio residente.
- Las raíces del perfil se preparan como `rshared` ANTES del `docker run`; `/workspace` y `/agent-config` se montan con
  `bind-propagation=rshared` y los binds posteriores aparecen dentro en caliente.
- Proyectos en `/workspace/<nombre>` (colisión de basename: `-2`, `-3`… por orden de alta); credenciales por
  (agente, cuenta) en `/agent-config/<tipo>/<cuenta>`, siempre bajo la raíz del PROPIO perfil. Al desmontar la
  última cuenta de un agente, desaparece también `/agent-config/<tipo>`.
- Todo montaje es idempotente y va bajo el `profileLock`: apilar binds llenó una vez la VM de montajes.
- El buzón del puente de BD cuelga de `/agent-config/dbbridge` (solo se propaga bajo una raíz `rshared`) y se monta en
  `ensureContainer`, el embudo de apertura, recarga y despertar; es best-effort y se olvida al parar.
- Un contenedor perdido fuera de nuestro control deja PIZARRA LIMPIA: desmontar y olvidar sus mapas; si no, la
  idempotencia saltaría los montajes y el agente arrancaría sin credenciales.

## Consecuencias

`test:sandbox`, `test:sandbox:multi` y `test:agents` (con Docker) lo fijan; la limpieza, `limpieza-de-montajes.md`.
