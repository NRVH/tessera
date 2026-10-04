# En macOS el proceso main toma su PATH del shell de login e interactivo una vez al arrancar

- **Estado:** vigente
- **Ámbito:** `src/main/util/pathDeLogin.ts`

## Contexto

Una `.app` lanzada desde el Finder o el Dock la arranca `launchd` con el PATH mínimo del sistema
(`/usr/bin:/bin:/usr/sbin:/sbin`). Ahí no está `/usr/local/bin`, donde Docker Desktop deja su
`docker`, y todos los `spawn('docker', …)` del main mueren con `ENOENT` mientras Docker corre a la
vista del usuario. Bajo `npm run dev` no se ve: el proceso hereda el PATH de la terminal.

## Decisión

- Antes de construir nada que lance `docker`, `asegurarPathDelHost` pregunta al shell de login
  del usuario su PATH y lo fusiona con el del proceso: primero el del shell, luego lo que el
  proceso ya tenía, luego los extras que falten; sin duplicados ni segmentos vacíos.
- Interactivo Y de login (`-ilc`): `-l` por `.zprofile` y `path_helper`; `-i` porque `.zshrc` es
  donde vive el PATH que el usuario se puso a mano (nvm, pyenv, `~/.local/bin`).
- El PATH viaja entre dos marcadores (un `.zshrc` puede imprimir banners) y se resuelve en cuanto
  llegan, sin esperar a que se cierren los stdio: un demonio lanzado desde `.zshrc` heredando
  stdout mantenía el pipe abierto y el arranque sin ventana hasta el tope.
- Respaldo fijo si el shell falla o no trae marcadores: se añaden igual las carpetas donde suele
  estar `docker` (`/usr/local/bin`, `/opt/homebrew/bin`, `~/.docker/bin`, el `Docker.app`).
- El comando no interpola variables del shell, para valer también en `fish`.
- El delimitador del PATH tiene un solo dueño (`delimitadorPath`, de las terminales).

## Consecuencias

- El PATH del main se congela al arrancar: es el del `spawn` del proceso, que no tiene shell
  delante. El de la terminal nativa lo resuelve su propio shell de login en cada apertura
  (`terminales/pty-shell-nativo-y-entorno.md`).
- En Windows no hace nada: el proceso hereda el PATH del sistema.

## Descartes

- `fix-path` / `shell-env`: una dependencia de producción con su árbol para cuarenta líneas que
  además hay que poder probar sin shell.
- Solo los extras fijos sin preguntar al shell: bastaría para `docker`, no para `git`, `java` o lo
  que el usuario tenga por nvm o sdkman.
