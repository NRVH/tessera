# Las sondas y órdenes de los agentes nativos van por la shell de las sesiones, con tope propio y muerte del árbol

- **Estado:** vigente
- **Ámbito:** `src/main/agents/ejecutorShell.ts`

## Contexto

La versión que importa es la que ven las sesiones, que arrancan por la shell nativa. En macOS el
PATH del main no es el de la terminal del usuario (nvm, `~/.local/bin` y Homebrew viven en su
`.zshrc`): un `spawn('codex')` directo podría medir otro binario, o ninguno.

## Decisión

- Windows: `powershell.exe -NoLogo -NoProfile -NonInteractive -Command <guion>`. El guion fija la
  salida en UTF-8 (PowerShell 5.1 escribe en la página OEM) y un código de salida que no miente:
  `$LASTEXITCODE` a `$null` antes y, después, ese número o 0/1 según `$?`.
- POSIX: `$SHELL -ilc`, la misma shell de las sesiones. Los ficheros de inicio pueden imprimir
  cualquier cosa, así que las sondas van entre dos marcadores (`printf`, sin variables: válidos
  también en fish) y las órdenes son `printf <marca>; exec <cmd> 2>&1` para que el código sea el
  del CLI. `<cmd>` tiene que ser un comando simple.
- `spawn` y un temporizador propio que resuelve sin esperar a 'exit' ni a 'close' y mata el árbol:
  `taskkill /T /F` en Windows; en POSIX el hijo va `detached` y se mata su grupo con `kill(-pid)`.
  `execFile` con `timeout` espera a que el nieto suelte el stdout heredado.
- Tras 'exit' se espera medio segundo a 'close' (un demonio hijo puede retener el pipe) y no se le
  mata: puede ser legítimo.
- Salida con tope (1 MiB) sin dejar de leer el pipe; `cwd` en el HOME (el de Tessera retendría su
  carpeta de instalación). Nunca rechaza.

## Consecuencias

- Sin verificar en Mac: que un `$SHELL -i` sin TTY no active el control de trabajos (si lo hiciera,
  `kill(-pid)` no alcanzaría a los nietos). Es el bloque 6 de `test:ejecutor-shell`.

## Descartes

- `-EncodedCommand`: es la firma clásica de malware y los antivirus lo marcan.
