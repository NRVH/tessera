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
- **Registro de canales**: [`ipc.ts`](./ipc.ts) — `registrarIpcTerminal` (lo llama `src/main/index.ts`).
- **Puente tipado**: [`src/preload/index.ts`](../../preload/index.ts) → `window.tessera.terminal`.

API expuesta (`window.tessera.terminal`):

| Método | Dirección | Descripción |
|---|---|---|
| `open({ profileId, projectHostPath })` | invoke | Abre sesión: `checkDocker → ensureContainer → addProject → createSession`. Devuelve `{ sessionId, workspacePath, … }`. |
| `bootstrapTerminalSession()` | invoke | `open()` con el perfil de arranque y el proyecto de prueba local (`docker/sandbox/proyecto-demo`). |
| `write({ sessionId, data })` | send | stdin hacia el shell. |
| `resize({ sessionId, cols, rows })` | send | Reflow del pty. |
| `close(sessionId)` | invoke | Cierra la sesión (el contenedor sigue vivo). |
| `onData(cb) => unsub` | evento | Salida (stdout/stderr) del shell. |
| `onExit(cb) => unsub` | evento | El shell terminó. |

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

Se prueba con `test:terminal` y `test:onexit`.
