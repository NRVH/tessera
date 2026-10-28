# Lo que Tessera lee de Claude Code y Codex se reconoce por su forma, se vigila en uso y se sondea contra los CLIs instalados

- **Estado:** vigente
- **Ámbito:** `src/main/transcripts/vigiaContratos.ts`, los lectores que lo usan (`conversations/ConversationsReader.ts`,
  `context/ContextReader.ts`, `agents/TurnWatcher.ts`), su destino en `app/arranque.ts` y
  `scripts/pruebas/sonda-agentes.mts`

## Contexto

Tessera no configura nada dentro de los CLIs: lee lo que escriben y les pasa unos pocos argumentos. Los dos
cambian a menudo, y lo que escriben no es una interfaz pública: un día los mensajes de un transcript llegan
con otra forma y el lector, que por diseño falla en silencio (mejor un anillo vacío que un error), deja de
entenderlos sin que nada lo diga. Las pruebas de cada lector usan transcripts escritos a mano con la forma que
había al escribirlas, así que siguen en verde.

## Decisión

- **Por forma, no por versión.** Cada lector reconoce las formas que conoce por los campos que trae y acepta
  varias a la vez (los mensajes de Codex como `user_message` o como `item_completed`, los límites de Claude
  Code como `limits[]` o como ventanas sueltas, el fin de turno por `turn_duration` o por `stop_reason`). Ningún
  lector mira la versión del CLI: un usuario puede tener cualquiera y un transcript reanudado mezcla varias.
- **Un vigía en la app.** Cuando un lector se encuentra un transcript que por tamaño o contenido debería decir
  algo y no le saca nada, lo anota una vez por (agente, contrato, versión) en el registro de incidentes con la
  etiqueta `contrato-cli`:
  - historial: un transcript de 64 KiB o más sin ningún mensaje legible;
  - contexto: turnos del asistente sin uso de tokens legible (Claude Code) o `token_count` con `info` sin
    tokens (Codex);
  - cabecera: varias líneas leídas y ningún `cwd`, así que sus turnos no llegan a ninguna sesión.
  Es la única forma de enterarse de lo que pasa con versiones que no están en la máquina donde se prueba.
- **Una sonda contra los CLIs instalados** (`npm run sonda:agentes`). Pasa los transcripts reales más
  recientes de la máquina (los del sistema y los de cada cuenta de cada perfil) por los mismos lectores de
  Tessera y dice qué contrato entiende en cuántos. Solo lectura: no ejecuta los CLIs, no gasta tokens y no
  imprime contenido. Mira también que el binario de cada uno (el nativo más nuevo de Claude Code, el de la
  instalación global de npm de Codex) siga hablando el protocolo de estado. Sale con 1 si un contrato no se entiende en ningún transcript.

## Contratos

| Qué se lee | De dónde | Lo usa | Lo comprueba |
|---|---|---|---|
| Mensajes, título, `cwd` e id de la conversación | Cabeza del transcript; en Codex, `session_meta` y los mensajes, también de los rollouts que comprime (`.jsonl.zst`, zstd) | Historial y reanudar | Sonda, vigía, `test:conversations` |
| `cwd` de la cabecera | Primeras líneas (Codex: la primera, que pesa decenas de KiB) | Atribuir turnos al proyecto | Sonda, vigía, `test:vigilante-turnos` |
| Marcas de turno (`turn_duration`, `stop_reason`, `task_started`/`task_complete`/`turn_aborted`) | Cola del transcript | Punto de estado | Sonda, `test:turnos` |
| Tareas en segundo plano | Resultados de herramientas y avisos de tarea de Claude Code | Veto de la hibernación | `test:segundo-plano` |
| Uso de tokens y compactación; `token_count` | Cola del transcript | Anillo de contexto | Sonda, vigía, `test-context` |
| Ventana por modelo | Tabla propia en `ContextReader` | Anillo de contexto | Nadie: un modelo nuevo cae al escalón por defecto |
| `rate_limits` de `token_count` | Cola del rollout de Codex | Uso de la cuenta | Sonda, `test-usage` |
| Uso de la cuenta de Claude Code | Su API de uso con el token de `.credentials.json` | Uso de la cuenta | `test-usage` con un cuerpo capturado; errores visibles |
| Protocolo de estado (OSC 7501); en Codex, sin sonda y con `app=codex` | Flujo del pty | Punto de estado y «te espera» | Sonda (el binario de cada uno lo emite), `test-agent-activity-tracker`, agente falso en `e2e/` |
| Reanudar, aviso de arranque y carpeta de la cuenta (`--resume`, `resume`, `--append-system-prompt`, `-c developer_instructions`, `-c features.daemon_auto_start=false`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`) | Línea de arranque | Abrir y aislar cuentas | `test-linea-arranque-agente`; un flag desconocido da error visible al arrancar |
| `--version`, método de instalación, canal y registros de versiones | CLI, `.claude.json`, `settings.json`, npm | Actualizar los nativos | `test-agentes-nativos`; los fallos se ven en el botón |

## Consecuencias

- Una forma nueva se añade al lector sin quitar la anterior, con su caso en la prueba copiado de un transcript
  real recortado.
- Lo que la sonda no puede ver sin ejecutar el CLI (los flags, la API de uso, el comportamiento en vivo del
  protocolo de estado) da un error visible cuando falla, o lo cubre su prueba.
- El vigía no avisa de un chat recién abierto: por debajo de 64 KiB un transcript sin mensajes es normal.
- Una sola línea del transcript de Claude Code puede ocupar más que la cola que se lee: guarda la petición
  entera a la API, de cientos de KiB, y mientras el modelo piensa es la última. Quien busca una línea concreta
  en la cola (el anillo, el último turno con uso) la pide con `hastaQue` y la cola crece hasta encontrarla,
  con tope (`util/jsonlCola.ts`).

## Descartes

- **Elegir el lector por la versión del CLI:** obliga a conocer de antemano en qué versión cambió cada cosa
  y falla con cualquier versión nueva, que es justo cuando hace falta.
- **Ejecutar los CLIs en la sonda:** gasta tokens y cuenta, necesita sesión iniciada y no añade nada que no
  digan ya sus transcripts.
