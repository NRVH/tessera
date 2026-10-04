# El agente corre bajo `env -i`, con git preparado por un preludio y un bloque de memoria que no miente

- **Estado:** vigente
- **Ámbito:** `src/main/agents/{AgentLauncher,gitInContainer,sandboxMemory,sandboxMemoryBlock}.ts` (macOS: sin verificar aquí)

## Contexto

El agente corre en el contenedor como uid 1001 sobre repos de otro dueño, con credenciales por cuenta montadas en
caliente y sin poder adivinar qué puede hacer ahí.

## Decisión

- Entorno `env -i` construido a mano: nada del host ni del propio contenedor. Las credenciales de un agente se montan
  SOLO las suyas (en el camino one-shot, solo mientras dura el lanzamiento).
- Git: `safe.directory=*` por entorno (`GIT_CONFIG_*`, sin tocar `~/.gitconfig` ni la imagen); la identidad sigue en el
  `.git/config` del repo. El PRELUDIO copia las llaves del bind READ-ONLY a `~/.ssh_active` con 600 (el bind las
  expone con modos amplios y no se puede `chmod`) y genera un wrapper de ssh con `known_hosts` escribible fuera del
  bind y `accept-new`. Sin llaves, git local funciona y el push falla con un error claro.
- El bloque de memoria (`CLAUDE.md`/`AGENTS.md` en la carpeta de la cuenta, que sobrevive a recrear el contenedor)
  dice si hay `sudo` según la sonda, que lo instalado en caliente se pierde, cómo capturar un PDF o un Office y cómo
  usar Playwright. Es TEXTO que lee el agente: cambiar un byte cambia lo que hace (`test:sandbox-memory`).
- El bloque nombra el sistema anfitrión: la plataforma entra por parámetro. El aviso del `.mcp.json` se bifurca: en
  Windows una ruta del host rompe el JSON (barras invertidas); en macOS es JSON válido y falla tarde.
- Marcadores propios: las notas del usuario y el bloque de bases de datos conviven sin pisarse.

## Descartes

- `--append-system-prompt`: es de un solo CLI; un archivo de memoria lo leen los dos.
