# El modo nativo lanza un shell de login e interactivo en macOS y fusiona el PATH según el sistema

- **Estado:** vigente
- **Ámbito:** `src/main/terminals/shellNativo.ts` y `terminals/entornoPty.ts`

## Contexto

El modo nativo corre fuera del contenedor, con cwd en la ruta real del proyecto. En Windows un
proceso hereda el PATH del sistema. En macOS una app lanzada desde el Finder la arranca `launchd`,
que no lee `~/.zprofile` ni `~/.zshrc`: su PATH es `/usr/bin:/bin:/usr/sbin:/sbin`, sin Homebrew ni
nvm, y `node`, `claude` o `codex` dan «command not found» aunque funcionen en cualquier terminal.
Un `zsh -lc` es login pero no interactivo: carga `.zprofile` y nunca `.zshrc`, donde viven nvm,
`~/.local/bin` y a menudo Homebrew. Reproducido con el entorno de launchd: `-lc` no encuentra
`claude`; `-ilc` sí.

## Decisión

- En macOS los argumentos llevan `-il` siempre, también para el agente (`-ilc <cmd>`); sin `$SHELL`
  se usa `/bin/zsh`. En Windows el agente va con `-NoProfile`. Dos decisiones opuestas, la misma
  intención: que el comando se encuentre.
- La fusión de `extraEnv` antepone al PATH con el delimitador del sistema (`;` o `:`) y en Windows
  colapsa `Path`/`PATH` a una sola clave (la búsqueda es sin distinguir caja); en POSIX son
  variables distintas y una `Path` ajena no se toca.
- Las dos funciones son puras y reciben la plataforma como parámetro con la actual por defecto.

## Consecuencias

- Con un `;` fijo el PATH de macOS quedaba `…/bin/s2;/usr/bin:…` y `tdb` no se encontraba nunca
  mientras el log presumía de que el atajo había llegado.
- El PATH del pty se resuelve en cada apertura con el shell de login; el del proceso main lo lee
  `util/pathDeLogin.ts` una vez al arrancar.
- `fish` no se ha verificado: allí `-i` no debería cambiar nada.

## Descartes

- Leer el PATH con `zsh -lc 'echo $PATH'` al arrancar y metérselo al pty: congela un valor que el
  usuario cambia (instala Homebrew, cambia de node) y duplica la lógica.
- `path.delimiter` de Node: un test en un sistema solo comprobaría ese caso.
