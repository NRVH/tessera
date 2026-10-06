# Integración de terminal en Electron

El `TerminalService` (pty vía `docker exec -it`, o nativo en el modo sin contenedor) vive en el
proceso **main** de Electron y se expone al renderer por **IPC tipado**. La UI (xterm.js,
`TerminalPane`) solo habla por esos canales.

---

## node-pty y el ABI de Electron

`node-pty@1.1.0` está construido sobre **N-API** (`node-addon-api`) y carga su binario desde
`node_modules/node-pty/prebuilds/<plataforma>/pty.node`. **Los binarios N-API son ABI-estables
entre Node y Electron**: no dependen de `NODE_MODULE_VERSION`, que es justo lo que rompe a los
módulos nativos clásicos (NAN). Por eso el prebuild carga bajo Electron **sin rebuild**, aunque
el ABI de Electron difiera del del Node del sistema.

El ruido `AttachConsole failed` que aparece al matar el pty en Windows es un artefacto conocido
de ConPTY (documentado en `TerminalService.ts`) e inofensivo.

### Rebuild (red de seguridad)

Hoy **no hace falta**, pero queda integrado para el día en que un nativo no sea N-API o falte su
prebuild:

```bash
npm run rebuild:native      # electron-rebuild --force --only node-pty
```

`@electron/rebuild` está en `devDependencies`. Recompila node-pty contra los headers de la
versión de Electron instalada y deja el `.node` en `node_modules/node-pty/build/Release/`, que
`node-pty` prioriza sobre `prebuilds/`. **Requiere toolchain de compilación nativa**, por eso NO
va en un `postinstall`: rompería el `npm install` de quien no la tenga, y para el prebuild N-API
actual es innecesario.

---

## Contrato IPC de terminal

Todo vive en el **main**; `node-pty` nunca se importa en el renderer. La ventana va con
`contextIsolation`, `sandbox` y `nodeIntegration: false`, todo por `contextBridge`.

- **Tipos y canales**: [`src/shared/terminal-ipc.ts`](../../shared/terminal-ipc.ts)
- **Orquestador en main**: [`TerminalController.ts`](./TerminalController.ts) — orquesta
  `SandboxManager` + `TerminalService` (no los reimplementa).
- **Registro de canales**: [`ipc.ts`](./ipc.ts) — `registrarIpcTerminal` (lo llama `src/main/agents/componer.ts`).
- **Sesiones SSH**: [`sesionSsh.ts`](./sesionSsh.ts) con lo que da el dominio SSH por
  [`lanzadorSsh.ts`](./lanzadorSsh.ts) (lo implementa `src/main/ssh/ControladorSsh.ts`).
- **Puente tipado**: [`src/preload/terminales.ts`](../../preload/terminales.ts) (`TerminalApi`, compuesto
  por [`src/preload/index.ts`](../../preload/index.ts)) → `window.tessera.terminal`.
- **Canales hermanos**: el agente de la terminal va por `agentTerminal:*`
  ([`agent-terminal-ipc.ts`](../../shared/agent-terminal-ipc.ts)) y el registro de conexiones SSH por
  [`ssh-ipc.ts`](../../shared/ssh-ipc.ts); este contrato es solo el de las sesiones de la terminal
  de la franja (shell del proyecto y SSH del perfil).
- **Decisiones**: `docs/decisiones/terminales/` (pestañas SSH del perfil, lanzador ▾, riel de
  conexiones) y `docs/decisiones/ssh/` (línea de ssh, huellas, contraseñas, `tssh`).

API expuesta (`window.tessera.terminal`):

| Método | Dirección | Descripción |
|---|---|---|
| `open({ profileId, projectHostPath })` | invoke | Abre sesión: `checkDocker → ensureContainer → addProject → createSession`. Devuelve `{ sessionId, workspacePath, … }`. |
| `openSsh({ profileId, conexionId })` | invoke | Abre una conexión SSH guardada del perfil: ssh directo en un pty del host (sin shell, cwd en HOME), sin entorno de BD. Devuelve `{ sessionId, … }` con `projectHostPath` y `workspacePath` vacíos. `close` y `reload` («Reconectar», con los datos vigentes) matan el árbol sin teclear nada; hibernar el perfil no la cierra. |
| `bootstrapTerminalSession()` | invoke | `open()` con el perfil de arranque y el proyecto de prueba local (`docker/sandbox/proyecto-demo`). |
| `write({ sessionId, data })` | send | stdin hacia el shell. |
| `resize({ sessionId, cols, rows })` | send | Reflow del pty. |
| `setFlow({ sessionId, paused })` | send | Contrapresión: pausa/reanuda la lectura del pty cuando xterm no da abasto. |
| `reload(sessionId, dbConnectionIds?)` | invoke | Relevanta el shell con el MISMO `sessionId` y suscriptores; en una sesión SSH es «Reconectar». |
| `close(sessionId)` | invoke | Cierra la sesión (el contenedor sigue vivo). |
| `onData(cb) => unsub` | evento | Salida (stdout/stderr) del shell. |
| `onExit(cb) => unsub` | evento | El shell terminó. En una sesión SSH que sale con 255 trae `reason` (huella cambiada, autenticación, inalcanzable, algoritmos u otro). |

El `onExit` es de primer nivel en `TerminalService` y sobrevive a `reloadSession()`, que cambia
la instancia del pty por debajo.

---

## Limpieza al cerrar

`before-quit` → `iniciarCierre()` (`app/cierre.ts`), que cierra los FSWatcher
(`FileService.dispose()`, `UsageWatcher.disposeAll()`) y luego mata TODO con
`SandboxManager.stopAllContainers()` (`docker rm -f` = SIGKILL, que arrastra los ptys y agentes
de dentro, desmonta y verifica). No se usa el cierre "elegante" de
`TerminalController.disposeAll()` (Ctrl-C/exit por sesión, lento y frágil): `rm -f` es completo
y rápido. `disposeAll()` sigue disponible para la hibernación por perfil. En el camino de
actualización, además, `forceKillPtys()` remata los ptys de Windows.

Se prueba con `test:terminal` y `test:onexit`; las sesiones SSH, con `test:sesion-ssh`.
