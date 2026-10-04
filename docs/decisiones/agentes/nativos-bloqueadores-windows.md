# Antes de reinstalar un CLI en Windows se avisa de quién tiene abierta su carpeta, por raíces y sin contar a Tessera

- **Estado:** vigente
- **Ámbito:** `src/main/agents/procesosBloqueo.ts` y su uso en `src/main/agents/nativos/`

## Contexto

En Windows un ejecutable vivo no se puede borrar ni renombrar: `npm i -g` falla con EBUSY/EPERM si
queda un `codex.exe` abierto fuera de Tessera (otra terminal, el `codex app-server` de una
extensión de editor). Lo honesto es decirlo antes de parar ninguna sesión.

## Decisión

- Bloquea todo proceso cuyo ejecutable cuelgue de una RAÍZ del paquete y que no descienda de los
  ptys de las sesiones que el flujo va a parar. Se pasan esos pids, no el del main: un `codex`
  lanzado a mano en la terminal de abajo no se para y sí bloquea.
- Varias raíces: la real del paquete y la del paquete del binario de la plataforma, que con npm
  queda anidado, con bun es un hermano y con pnpm otro directorio del almacén.
- Claude por npm cuenta también por LÍNEA DE COMANDOS: sus versiones viejas corrían como
  `node.exe <raiz>\cli.js`, con el ejecutable fuera de la raíz. Codex no (duplicaría cada proceso).
- Raíz con barra final (ni un hermano `codexfoo` ni la copia retirada `.codex-XXXX` casan), sin
  distinguir mayúsculas; una raíz vacía se descarta (casaría con todo el equipo).
- La vista previa excluye los ptys de ESE agente: un `codex.exe` colgado de una sesión de Claude
  (Codex como servidor MCP) no lo para el flujo de Codex. Tras parar se vuelve a mirar ~8 s y ya
  no se excluye a nadie: lo que siga vivo bloquea a npm sea de quien sea.
- Fuera de Windows la respuesta es []: POSIX desliga el inodo de un ejecutable en uso.

## Consecuencias

- Un pid reutilizado puede hacer pasar a un proceso ajeno por de Tessera: no se avisa antes, pero
  la instalación falla con EBUSY y `clasificarErrorInstalacion` dice qué cerrar.

## Descartes

- Validar cada eslabón de la cadena de padres con `CreationDate`: complica la consulta para un
  caso que ya tiene red debajo.
