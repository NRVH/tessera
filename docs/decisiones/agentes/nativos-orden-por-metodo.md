# La orden de actualización sale de la tabla método × plataforma, y en Windows Codex nunca se actualiza a sí mismo

- **Estado:** vigente
- **Ámbito:** `src/main/agents/comandoActualizacion.ts`

## Contexto

Actualizar mal un CLI nativo deja una segunda copia vieja en el PATH, un Codex sin binario o una
carpeta bloqueada, con el botón diciendo que fue bien.

## Decisión

- Codex: el método lo dice su raíz REAL de paquete (la que el shim exporta como
  `CODEX_MANAGED_PACKAGE_ROOT`), con las marcas del shim en su orden (Vite+, pnpm, bun). npm solo
  si la raíz es EXACTAMENTE `<npm prefix -g>/[lib/]node_modules/@openai/codex`: si vive en otro
  sitio, `npm i -g` instalaría una segunda copia y la del PATH seguiría vieja.
- Claude: manda la ruta física (Homebrew, gestores del sistema) sobre `installMethod`, que puede
  haber quedado atrás; la huella del instalador nativo solo sin configuración.
- La tabla:

  | | Windows | macOS |
  |---|---|---|
  | Claude nativo | `claude update`, sin parar | igual |
  | Claude npm | `npm install -g …@X`, PARAR | igual, sin parar |
  | Codex npm/pnpm/bun | su gestor con `@X`, PARAR | `codex update`, sin parar |
  | Codex otro | a mano; nunca `codex update` | `codex update` |

- En Windows `codex update` lo ejecutaría el propio `codex.exe`, el ejecutable vivo que bloquea la
  carpeta: ni se ejecuta ni se sugiere. `claude update` renombra su `.exe` en uso y no hace parar.
- La versión llega de la red y acaba en una orden de shell: sin `esVersionExacta` no hay orden, y
  se entrecomilla con la regla de la shell que la recibe (en PowerShell, `@` inicial es splatting).
- EPERM en Windows es ambiguo (ejecutable vivo o prefijo protegido): lo desempatan los
  bloqueadores; sin ninguno se habla de permisos y de ejecutar como administrador.

## Descartes

- «Contiene node_modules» como marca de npm: confunde otra instalación con la del prefijo.
