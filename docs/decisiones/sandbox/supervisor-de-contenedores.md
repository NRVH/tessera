# Un supervisor escucha los eventos de Docker y las sesiones se recuperan solas, con esperas y al volver Docker

- **Estado:** vigente
- **Ámbito:** `src/main/sandbox/gestor/` (`supervisor.ts`, `eventosDocker.ts`, `diagnostico.ts`, `contenedores.ts`, `NucleoSandbox.ts`), `shared/sandbox-estado-ipc.ts`, `shared/esperasRecuperacion.ts` y `features/agentes/` (`sesionAgente.ts`, `useSesionAgente.ts`, `xtermAgente.ts`)

## Contexto

Un contenedor muere fuera del control de Tessera: Docker Desktop se cierra o reinicia, el usuario lo
borra, la máquina virtual se queda sin memoria. Si solo se supiera cuando muere el pty de una sesión,
cada sesión lanzaría su propio diagnóstico (con un `docker info` de hasta 30 s) y reintentaría por su
cuenta mientras Docker aún arranca.

## Decisión

- **Supervisor.** Desde el primer contenedor que crea Tessera, un `docker events` filtrado por la
  etiqueta de la instancia escucha `die`, `oom` y `destroy`. Un `die` del contenedor VIVO conocido (mismo
  Id) que no paró Tessera lo deja de dar por vivo al momento (fuera su handle: nadie hace un `exec` sobre
  él y el siguiente `ensureContainer` lo recrea con pizarra limpia) y apunta por qué. Lo que para Tessera
  (`stopContainer`, la pizarra limpia) va marcado en `paradasEsperadas` y no cuenta.
- **Memoria.** Un OOM dentro del contenedor no lo tumba: el kernel mata el proceso que más ocupa, un
  agente, y el `sleep` del contenedor sigue. Por eso el `oom` del contenedor vivo se apunta aparte y el
  diagnóstico de una sesión que acaba de morir por SIGKILL (137, o sin código) dice «sin-memoria», no
  «terminó»; una que salió por sí misma no. Esa sesión no se recrea sola: volvería a caer. Un `die`
  solo es por memoria si su OOM fue justo antes: uno viejo mató un proceso y el contenedor siguió.
- **Docker caído.** Si el `docker events` se corta, una sonda con esperas crecientes (2 a 30 s) decide:
  con Docker sin responder, avisa «caido» al renderer; cuando vuelve, «disponible» y vuelve a escuchar.
  Un diagnóstico que ve a Docker sin responder también lo da por caído y arranca la sonda: así
  «disponible» llega aunque el `docker events` no se cortara o Docker volviera antes de la primera.
  No es un `inspect` periódico (lo que el puente de BD descartó por coste): es un solo proceso parado.
- **Diagnóstico.** Usa lo que vio el supervisor antes de sondear, y las sesiones de un perfil comparten
  uno en vuelo.
- **Recuperación.** El agente reintenta con esperas de 0, 2, 5, 10 y 20 s. Con Docker
  caído, o con los intentos agotados, espera a «disponible» y se recupera solo; «Reintentar» y
  «Reabrir» siguen ahí.

## Consecuencias

- `test:supervisor-contenedores` fija la lectura de eventos, qué cuenta como muerte y la caída y vuelta
  con un `docker events` falso; con Docker, mata contenedores reales y provoca un OOM de verdad.
- Recrear un contenedor pierde lo que vivía solo en él (paquetes instalados a mano, procesos de fondo);
  las credenciales y los proyectos están en el host.

## Descartes

- Una política de reinicio de Docker (`--restart`): los montajes en caliente no sobreviven al reinicio
  y el contenedor volvería sin proyectos ni credenciales.
- Reintentar sin espera: con Docker Desktop arrancando, los intentos se agotaban antes de que estuviera listo.
