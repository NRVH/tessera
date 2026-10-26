# La versión instalada la dice el binario, la última su canal y su método, y un candado retiene las aperturas

- **Estado:** vigente
- **Ámbito:** `src/main/agents/agentesNativos.ts` y `src/main/agents/nativos/`

## Contexto

El botón «actualizar los agentes de tu equipo» compara la versión de Claude Code y Codex nativos
con la última publicada, los instala y el renderer relanza las sesiones.

## Decisión

- La instalada sale de `<cli> --version` por la MISMA shell que las sesiones, nunca de una caché
  del CLI (`~/.codex/version.json` iba por detrás). Una sonda en vuelo por agente y sin caché de
  tiempo: una caché guardaría como versión de arranque una anterior a la real.
- La última, por canal y método: Claude nativo del servidor de versiones de su canal
  (`autoUpdatesChannel`), Claude por npm de su dist-tag; Codex de `latest` y solo «hay nueva» si el
  dist-tag `<so>-<arch>` ya apunta a ella (npm publica `latest` antes que los binarios) Y el
  registro sirve el documento de esa versión con su tarball: el dist-tag llega antes que el
  documento, y en ese hueco npm salta el binario como dependencia opcional, termina con 0 y deja
  Codex sin arrancar. Mientras, el estado lo marca `binarioPendiente` («aún no está lista»). Codex por
  Homebrew compara con el CASK, que va por detrás de npm; una fórmula viene de un tap sin API y no
  promete nada. Con `stable` la instalada puede ir por delante: solo cuenta «mayor que».
- Todo lo que llega de la red pasa por `esVersionExacta`. Un fallo de red deja la última en null,
  sin punto de aviso; no se conserva la anterior. `TESSERA_REGISTRO_NPM`, `TESSERA_RELEASES_CLAUDE`
  y `TESSERA_API_BREW` cambian las bases (solo http/https).
- `installMethod` está en `~/.claude.json` (en el HOME) o dentro de `CLAUDE_CONFIG_DIR`.
- El CANDADO: mientras se instala un CLI, abrir y reiniciar sesiones de ese agente esperan y sus
  sondas devuelven la última medida. `instalar` espera antes a la sonda que siguiera en vuelo.
- Instalar: candado → revalidar → parar el lote → esperar bloqueadores → orden (5 min) →
  re-sondear → soltar. El lote incluye las sesiones de las ventanas de agente: el orquestador de la
  principal las prepara y relanza por el main en la ventana dueña (`ventana-de-agente.md`). Si la orden sale bien y el CLI no responde o sigue en la misma versión, es
  FALLO: decir «actualizado» mentiría.
- REPARAR: un CLI que no responde a `--version` pero cuyo método se detecta sin ejecutarlo (Codex
  por npm, pnpm o bun) se ofrece como reinstalación de la última, con la orden del gestor en las
  dos plataformas: nunca `codex update`, que necesita un binario que arranque. Claude no se repara:
  su método puede salir de su configuración sin que el CLI esté en el PATH, y entonces «no
  responde» es «no está», y reinstalarlo devolvería un CLI que el usuario quitó. Si una instalación deja Codex sin responder, su binario vuelve a «pendiente» hasta
  que otra comprobación lo vea servido: el reintento no se ofrece a ciegas.
- Cadencia: primera a los 20 s, cada 4 h y al recuperar el foco si pasaron 30 min; un `setTimeout`
  que se re-arma (un `setInterval` acumula disparos al despertar). El rebote de los avisos de
  sesiones programa una emisión y no la reprograma, o con actividad continua no emitiría.

## Consecuencias

- Todas las dependencias entran inyectadas; `test-agentes-nativos.mts` lo prueba con falsos.

## Descartes

- Pedir npm y Homebrew a la vez para elegir después: una consulta de red de más en segundo plano.
