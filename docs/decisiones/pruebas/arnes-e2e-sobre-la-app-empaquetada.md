# Las pruebas de interfaz conducen la app EMPAQUETADA, con todo lo del usuario aislado y una sola app a la vez

- **Estado:** vigente
- **Ámbito:** `e2e/tessera.ts`, `e2e/agenteFalso.ts`, `playwright.config.ts` y todo `e2e/*.spec.ts`

## Contexto

Los fallos de la frontera con el sistema solo existen en el paquete: la `.app` lanzada por
`launchd` no hereda el PATH del usuario, la firma ad-hoc solo se manifiesta al distribuir, y
`process is not defined` en el renderer pasa `typecheck`, `lint` y los `test-*.mts` (corren
bajo `node`) y solo revienta empaquetado. La app real guarda perfiles, credenciales de agente y
`workspace-state.json` en `userData`, lee `~/.claude` y `~/.codex` y consulta los registros de
versiones. El teclado, el menú de aplicación y el semáforo son globales del sistema.

## Decisión

- Se arranca el mismo artefacto que se publica (`dist/mac-arm64/Tessera.app`,
  `dist/win-unpacked/Tessera.exe`), nunca `npm run dev`.
- `--user-data-dir` apunta a un temporal. Funciona porque en el paquete
  `aislarUserDataEnDesarrollo` se retira (`app.isPackaged`); de paso aísla el cerrojo de
  instancia única, así que las pruebas corren con la Tessera del usuario abierta al lado.
- `CLAUDE_CONFIG_DIR` y `CODEX_HOME` van dentro de ese temporal y los registros de versiones a
  una dirección que no responde, salvo que el spec traiga el suyo: `agenteFalso.ts` pone
  `claude`, `codex` y `npm` falsos por delante en el PATH y un registro HTTP local. Las sondas
  `--version` no cuentan como arranque; en Mac `SHELL` apunta a un guion sin perfiles, porque
  un shell de login reconstruiría el PATH y podría poner delante un `claude` de verdad. En
  Windows, `TESSERA_SHELL_AISLADA=1` (solo pruebas) arranca la PowerShell interactiva sin perfil
  y con el historial de PSReadLine apagado; `%APPDATA%` no sirve, porque no desvía esa carpeta.
- El chequeo de actualizaciones de la propia app se aplaza un día (`TESSERA_PRIMER_CHEQUEO_MS`): a los
  8 s de fábrica fallaba (el paquete de `pack:dir` no lleva `app-update.yml`) y cambiaba el icono de
  la barra a mitad de un spec. `actualizacion.spec.ts` lanza la app con su propio entorno.
- El cierre de cada prueba tiene tope (90 s, por debajo del plazo del hook): si vence, se imprime el
  `cierre.log`, se mata el árbol de la app y el hook queda en rojo (`expect.soft`, para que el resto
  de su limpieza siga).
- `workers: 1`, `fullyParallel: false` y `retries: 0`. Lo que solo vale en una plataforma se
  salta con `test.skip(PLATAFORMA !== …)` y su motivo: `grep PLATAFORMA e2e/` lista lo bifurcado.

## Consecuencias

- Tras tocar código de aplicación hay que rehacer el paquete, o se prueba un binario viejo.
- Un reintento no se añade: verdearía justo la clase de intermitente que estas pruebas cazan.
- Un spec que necesite escribir fuera de su temporal (el portapapeles del sistema,
  `~/Library/Services`) lo dice en su cabecera y lo deja como estaba; si no puede, no pulsa.

## Descartes

- `npm run dev`: los dos peores fallos del port a macOS desaparecen bajo él. Paralelismo: con
  dos apps a la vez los fallos de teclado aparecen y desaparecen sin patrón.
