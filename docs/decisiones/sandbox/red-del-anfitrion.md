# La red del anfitrión se MIDE con una sonda real; el prevuelo informa y no bloquea

- **Estado:** vigente
- **Ámbito:** `src/main/sandbox/redAnfitrion.ts`, `gestor/red.ts`, `gestor/contenedores.ts`, `sandbox/ipc.ts` (macOS: sin verificar aquí)

## Contexto

`docker run --network host` en Docker Desktop NO falla con la función apagada (viene así de fábrica): arranca,
devuelve 0 y los puertos se quedan en la VM. El éxito del comando no prueba nada.

## Decisión

- El prevuelo toma medidas (motor, versión, ajustes de Docker Desktop, modo de WSL, sonda) y `evaluarPrevuelo`, puro
  y con la plataforma SIN valor por defecto, las redacta en el main: el renderer solo pinta (no tiene `process`).
- 'falla' es «apagado» y 'desconocido' es «no se pudo saber»: la clave del fichero de ajustes es indocumentada y ya
  cambió de nombre, así que es PISTA, nunca veredicto. Decide la sonda: un contenedor efímero `--network host`
  (`--pull=never`) escucha en `127.0.0.1:<puerto libre>` y contesta un TOKEN que el main exige (un puerto reciclado
  por otro proceso daría un falso verde). Nombre y token únicos por sonda; el `rm -f` va en el `finally` del bloque.
- La sonda corre también tras (re)crear un contenedor con `redHost` (una vez por proceso: es una propiedad de la
  máquina) y avisa una vez por perfil. `null` no avisa: callar es mejor que inventar.
- Modo de WSL preguntado a `wslinfo`, no al `.wslconfig` (la intención no es lo efectivo); es la nota del egress.
- Puerto 1455 del login de Codex: publicado en `127.0.0.1` solo en `bridge`, con un forwarder `eth0 → 127.0.0.1` dentro
  del contenedor. Con `--network host` Docker descarta `-p` y no admite `--hostname`. Si otro perfil tiene el 1455, se
  avisa (`choque-1455`) y se crea sin publicarlo, sin fallar. Las sondas nunca usan el 1455.
- Tessera no escribe en los ajustes de Docker Desktop: explica dónde está el interruptor. El usuario manda aunque el
  prevuelo salga en rojo.

## Consecuencias

`test:red-anfitrion` fija filas y textos de las dos plataformas desde cualquiera; la sonda real solo con Docker. El
diálogo que pinta el prevuelo y confirma antes de persistir: `renderer/red-del-contenedor.md`.

## Descartes

- Pedir iniciar sesión en Docker Desktop: dejó de hacer falta en la 4.35.
