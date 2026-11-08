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
- El briefing va por `--append-system-prompt` en Claude Code y por `-c developer_instructions=…` en
  Codex (no tiene el otro), aplanado a una línea en las dos formas; en blanco no produce flag. En
  Codex lleva el prefijo fijo «Avisos de Tessera:» (`-c` toma el valor como TOML si se puede, y una
  palabra no lo es) y una frase más: su sandbox suele ir sin red, así que pida salir de él para
  `tdb`, `tssh` y `tctx`. Abrirle la red desde Tessera no: el sandbox es configuración del usuario. Tampoco
  se fuerza el acceso completo en el contenedor, donde el sandbox de Codex no puede arrancar porque Docker
  no deja crear espacios de nombres: lo elige el usuario y lo explica la Academy (`nativoODocker.ts`).
- Codex arranca siempre con `-c features.daemon_auto_start=false`: si no, en macOS y en Linux (y en
  el contenedor) arranca un servidor compartido por cuenta, fuera de la terminal, que corre las órdenes
  de todas sus sesiones con el entorno de la primera y no se para al cerrar la pestaña. En Windows no
  llega a arrancarlo desde la terminal de Tessera. Una clave de `features` desconocida solo deja un
  aviso en su registro, así que vale con cualquier versión; `--no-daemon` haría fallar a las anteriores.
  Un agente manual cuyo comando sea `codex` no la lleva: la línea de un manual es la del usuario, sin
  opciones añadidas, y puede ponerla él.
- El id de reanudación solo si tiene forma de UUID: acaba dentro de un `sh -c`.
- Claude Code graba el prompt de sistema en la primera petición y al reanudar reenvía el grabado aunque
  la línea traiga otro aviso. Al reanudar con aviso se le añade `--system-prompt-snapshot off`, para que
  lleguen las reglas vigentes y la frase de un traspaso, pero solo si su `--help` tiene la opción: una
  versión que no la conoce no arrancaría con ella, y esa tampoco graba. Se mira por forma y no por versión. En el
  contenedor, en la propia línea, que es bash (una décima de segundo), con `timeout 10`: la sustitución espera a que
  la ayuda acabe, y un binario que no saliera dejaría la sesión sin arrancar. En el equipo lo sondea el main una vez por la
  shell nativa (`sondaOpcionCli.ts`) y la línea lleva la opción tal cual: la shell del usuario puede ser fish, que no
  parte una sustitución en argumentos y, en sus versiones viejas, ni la entiende. Un «sí» se guarda; un «no» se
  vuelve a mirar a los diez minutos, por si el CLI se actualizó.
  Codex no graba el suyo: `-c developer_instructions` llega en cada arranque.
- En el contenedor, la configuración compartida de Docker entra también por la línea: `--settings <archivo>` en
  Claude Code y `-p tessera` en Codex, este solo si su `--help` describe los perfiles por archivo
  ([configuracion-editable.md](configuracion-editable.md)).

## Descartes

- Comillas dobles «universales»: los dos shells expanden `$` y backticks, y el briefing está
  lleno de backticks.
