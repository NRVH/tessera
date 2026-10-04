# La línea de arranque del agente es una función pura que entrecomilla el briefing según la shell que la recibe

- **Estado:** vigente
- **Ámbito:** `src/main/agents/lineaArranqueAgente.ts`

## Contexto

La línea del contenedor acaba en el `bash -c` de un `docker exec`; la nativa, en `powershell
-Command` (Windows) o `$SHELL -ilc` (macOS). Con la regla de PowerShell en macOS, `'a''b'` es `ab`:
cada apóstrofo del briefing desaparecía y el `<<'SQL'` que el briefing enseña quedaba sin
entrecomillar, con `$` y backticks expandidos. Sin error visible.

## Decisión

- Pura y fuera del controlador: todo llega por parámetro, y la prueba EJECUTA la línea con un
  binario sustituto en `sh`, `zsh` y `bash` en vez de solo mirarla.
- Contenedor: POSIX siempre. Nativa: PowerShell (`''`) en Windows y POSIX (`'\''`) en el resto;
  la plataforma es el último parámetro con la actual por defecto. Las dos reglas viven en
  `shared/citarShell.ts`; aquí solo se elige.
- El contenedor corre bajo `env -i`, que borra los `-e` de `docker exec`: las variables de bases
  se re-inyectan en la propia línea o el agente no ve `tdb`.
- El briefing va por `--append-system-prompt` solo en Claude Code (Codex no lo tiene), aplanado a
  una línea en las dos formas; en blanco no produce flag.
- El id de reanudación solo si tiene forma de UUID: acaba dentro de un `sh -c`.

## Descartes

- Comillas dobles «universales»: los dos shells expanden `$` y backticks, y el briefing está
  lleno de backticks.
