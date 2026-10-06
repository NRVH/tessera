# Tres atajos `tdb` (sh, PowerShell, cmd), versionados por carpeta y con permisos explícitos

- **Estado:** vigente
- **Ámbito:** `src/main/db/shims.ts`, `controlador/atajosTdb.ts`, `src/main/util/escrituraAtajos.ts` (macOS: sin verificar aquí)

## Contexto

El atajo era solo `tdb.ps1`, y `tdb` existía únicamente en PowerShell (medido en Windows 11): Git Bash no
resuelve un `.ps1` y cmd no trae `.PS1` en PATHEXT. La herramienta Bash de Claude Code en Windows corre sobre Git
Bash, así que el agente nunca pudo ejecutar `tdb`; Codex, igual.

## Decisión

- Tres atajos que conviven sin pisarse: PowerShell prefiere el `.ps1`, bash coge el que no tiene extensión y cmd el
  `.cmd`. La sospecha de que PATHEXT haría ganar al `.cmd` en PowerShell fue la que llevó a borrarlo, y no se sostiene.
- Viven en `bin/s<VERSION>/` y esa subcarpeta es la que se antepone al PATH. Dos instancias de la misma versión
  escriben contenido idéntico; con versiones distintas usan carpetas distintas. Antes compartían `bin/`, y una
  terminal abierta por la app instalada podía acabar invocando el árbol de desarrollo.
- Se reescriben en cada arranque (tras una actualización cambia la ruta del ejecutable) y de forma atómica: un corte
  a mitad dejaba un atajo truncado que fallaba sin apuntar a Tessera.
- El de `sh` va en LF: MSYS lo trata como ejecutable por empezar por `#!`, y un CR colado da «bad interpreter» sin
  mencionar el CR. Y con `chmod 755`: `writeFileAtomicSync` deja el modo del temporal (0644) y zsh, en macOS,
  respondía `zsh: permission denied: tdb` con el archivo ahí y bien escrito. En Windows es un no-op.
- El citado del ejecutable y la ruta está en `shared/citarShell.ts`: un usuario puede llamarse `O'Brien`.
- La escritura (crear la carpeta, la guarda de LF, la escritura atómica y el 0755) es una sola para los atajos de
  `tdb` y los de `tssh`: `util/escrituraAtajos.ts`. Lo que cambia entre los dos es solo el contenido.
- Un usuario con «ñ» (`C:\Users\Muñoz\…`): el `.ps1` va con BOM, porque PowerShell 5.1 lee uno sin BOM en la página
  ANSI y la ruta horneada llegaba cambiada; el `.cmd` escribe la ruta no ASCII con la variable de la carpeta del
  usuario (`%LOCALAPPDATA%\…`, `rutaParaCmd` de `shared/citarShell.ts`, la misma que usan los de `tssh`), que cmd
  expande ya en Unicode aunque lea el archivo en la página OEM.

## Consecuencias

- Un atajo de un contrato anterior se retira al arrancar (`bin/s*` que no es el actual y los sueltos de `bin/`):
  mientras `bin/tdb.ps1` existiera, una terminal con el `bin/` viejo ejecutaría lógica antigua contra un contrato nuevo.
