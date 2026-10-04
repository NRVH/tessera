# El token de Claude Code sale del llavero solo en macOS y en modo host, y el fallo no es lo mismo que la ausencia

- **Estado:** vigente
- **Ámbito:** `src/main/usage/credencialesClaude.ts` y su consumidor `UsageReader`

## Contexto

En un Mac en modo host las barras de uso enseñaban «uso —» para siempre mientras el anillo de
contexto, que lee la misma carpeta, funcionaba. En macOS Claude Code no escribe `.credentials.json`:
guarda el mismo bloque JSON en el llavero de inicio de sesión (servicio `Claude Code-credentials`).
El llavero es uno por usuario del Mac: consultarlo para una cuenta de contenedor devolvería el token
de otra cuenta, y el perfil enseñaría el consumo de la personal.

## Decisión

- El llavero solo se mira en macOS y en modo host. Con el sandbox, cada cuenta tiene su fichero
  montado y sale siempre de él; en el resto de plataformas nunca se toca el llavero.
- Con la base nativa (`~/.claude`) manda el llavero y el fichero es el respaldo (un fichero viejo
  daría un token caducado). Con una base propia (`CLAUDE_CONFIG_DIR`) el orden se invierte: su
  fichero primero y el llavero después, para que este no tape las credenciales de otra carpeta.
- Se distinguen tres clases: `ausente` es un estado de la cuenta; `fallo` (timeout de un diálogo,
  llavero bloqueado) es un accidente que llega al lector como `error` y conserva el último dato
  bueno. `security` sale con 44 si el ítem no existe, 0 si lo encuentra y otro valor si falla.
- Cada fuente se consulta en su propio `try`: una que reviente no impide mirar la otra.
- Solo se lee: ni se escribe en el llavero, ni se renueva el token, ni se guarda.

## Consecuencias

- Tratar todo fallo como «no existe» borraba unas barras correctas hasta que se arreglara solo.
- La consulta lleva un tope de 10 s por si el llavero abre un diálogo de autorización.

## Descartes

- Una librería de llavero (`keytar`): es un binario nativo que hay que recompilar por versión de
  Electron, para lanzar el mismo `security` que ya trae el sistema.
- No mirar el llavero con `CLAUDE_CONFIG_DIR`: rompe el caso frecuente, la carpeta sin fichero.
