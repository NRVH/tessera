# El agente corre bajo `env -i`, con git preparado por un preludio y un bloque de memoria que no miente

- **Estado:** vigente
- **Ámbito:** `src/main/agents/{lineaArranqueAgente,gitInContainer,sandboxMemory,sandboxMemoryBlock}.ts`

## Contexto

El agente corre en el contenedor como uid 1001 sobre repos de otro dueño, con credenciales por cuenta montadas en
caliente y sin poder adivinar qué puede hacer ahí.

## Decisión

- Entorno `env -i` construido a mano: nada del host ni del propio contenedor. Las credenciales de un agente se montan
  SOLO las suyas (en el camino one-shot, solo mientras dura el lanzamiento).
- Git: `safe.directory=*` por entorno (`GIT_CONFIG_*`, sin tocar `~/.gitconfig` ni la imagen); la identidad sigue en el
  `.git/config` del repo. El preludio prepara un socket de agente SSH mediante el buzón y recibe únicamente config,
  públicas y `known_hosts`. Las privadas permanecen en el host y cada firma exige el permiso vigente del perfil
  (`../ssh/agente-del-contenedor.md`). Sin identidades autorizadas, git local funciona y SSH rechaza la autenticación.
- El bloque de memoria (`CLAUDE.md`/`AGENTS.md` en la carpeta de la cuenta, que sobrevive a recrear el contenedor)
  dice si hay `sudo` según la sonda, que lo instalado en caliente se pierde, cómo capturar un PDF o un Office y cómo
  usar Playwright. También lo que el contenedor no tiene y un agente solo descubre fallando: que dentro no hay Docker,
  que los servicios del equipo están en `host.docker.internal` (solo con Docker Desktop: el motor de Linux no lo da sin
  pedirlo), el tope de 8 MiB de `tdb` y, con anfitrión Windows, los finales de línea CRLF y los binarios de las
  carpetas de compilación. Va aquí y no en las reglas del usuario: es del producto, solo vale en Docker y cambia con
  cada versión. Es TEXTO que lee el agente: cambiar un byte cambia lo que hace (`test:sandbox-memory`).
- El bloque nombra el sistema anfitrión: la plataforma entra por parámetro. El aviso del `.mcp.json` se bifurca: en
  Windows una ruta del host rompe el JSON (barras invertidas); en macOS es JSON válido y falla tarde.
- Marcadores propios: las notas del usuario y el bloque de bases de datos conviven sin pisarse.

## Descartes

- `--append-system-prompt`: es de un solo CLI; un archivo de memoria lo leen los dos.
