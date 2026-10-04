# El anillo mide el chat vivo elegido por el ancla, por la cola del transcript, sin retroceder y con la ventana estimada

- **Estado:** vigente
- **Ámbito:** `src/main/context/ContextReader.ts`

## Contexto

El contexto es por conversación (cada proyecto abierto tiene el suyo), no por cuenta. Ambos agentes
escriben en su transcript los tokens de cada turno. El riesgo del lector no es el parseo sino qué
conversación mide y con qué números.

## Decisión

1. **Qué chat.** El mtime no dice cuál se escribe: el CLI reescribe punteros (`last-prompt`,
   `ai-title`) en chats muertos y se han visto transcripts con mtime de hoy y último evento de
   hace seis días. El mtime solo criba (los 24 más recientes, más el anclado si quedó fuera); decide
   el ancla (`anclaConversacion.ts`) y, sin ella, la marca de tiempo interna. Se descartan los
   rollouts de subagente de Codex, que declaran el mismo `cwd` que su padre.
2. **Sin retroceso.** Un transcript sin turnos es lo que deja `/clear`: se responde `no-data`, no el
   porcentaje del chat que se acaba de tirar.
3. **Por la cola.** El dato es el último turno; la cabeza se lee aparte solo para el `cwd`, con su
   caché (no cambia jamás).
4. **Compactar vacía la ventana.** `system/compact_boundary` trae `postTokens` y manda si es
   posterior al último turno; sin mirarlo el anillo se quedaba en el valor previo dos minutos.
5. **La ventana de Claude se estima** por modelo (el transcript no la publica); si lo observado la
   supera, se promociona al siguiente escalón conocido para no pintar un 300 %, y el snapshot lo marca
   (`windowEstimated`). En Codex `model_context_window` viene en el evento.

## Consecuencias

- El contexto de Claude es la suma de las cuatro cuentas del turno (`input`, `cache_creation`,
  `cache_read` y `output`): solo `input_tokens` daría casi cero en un chat largo. En Codex, el
  acumulado `total_token_usage` no es el contexto.
- Las líneas `isSidechain` no cuentan: es otra ventana.
- Hay que actualizar la tabla de ventanas por modelo cuando salga un modelo con otro tamaño.
