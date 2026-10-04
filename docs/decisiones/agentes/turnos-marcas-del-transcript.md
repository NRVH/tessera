# El fin de turno se lee del transcript por orden, sin marca no se inventa y los subagentes no cuentan

- **Estado:** vigente
- **Ámbito:** `src/main/transcripts/`, `agents/TurnWatcher.ts`

## Contexto

Los dos CLIs escriben el fin de turno en su transcript: Codex con `task_started`, `task_complete` y
`turn_aborted`; Claude Code con una línea `system` `turn_duration` y, de respaldo, un `assistant`
con `stop_reason: end_turn`. En rollouts reales hay `task_started` huérfanos (3 aperturas para 2
cierres) y sesiones interrumpidas que nunca escriben su fin. Codex escribe los rollouts de sus
subagentes en la misma carpeta `sessions/` y con el mismo `cwd` que el padre.

## Decisión

- Se decide por orden: se recorre la cola hacia atrás y manda la primera marca conocida. Emparejar
  aperturas y cierres (o casar `turn_id`) se desincroniza el primer día.
- Sin marca se devuelve `null`, no una suposición: si una versión futura deja de escribirlas, el
  rastreador se queda con su red de seguridad (el silencio absoluto).
- Un subagente no cuenta: en Claude Code sus líneas van marcadas `isSidechain`; en Codex se detecta
  de forma positiva (`thread_source`, `parent_thread_id` o `source.subagent`, cualquiera) y no
  exigiendo `thread_source: 'user'`, que dejaría sin anillo a un CLI viejo.
- El criterio de proyecto y de subagente vive en `formatoTranscript.ts` y lo comparten el anillo de
  contexto, el vigilante de turnos y el historial.
- `TurnWatcher` rebota 250 ms y `UsageWatcher` 2,5 s: no se fundieron. La latencia del primero apaga
  el punto del perfil; bajar el rebote del segundo despertaría al main diez veces más.

## Consecuencias

- El `task_complete` de un subagente cerraría el turno del padre mientras sigue trabajando.
- Solo se lee el fichero que cambió, con la cabecera cacheada por fichero.
