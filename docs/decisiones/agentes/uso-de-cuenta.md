# El uso de cuenta se cachea con suelo de red y backoff, y una ventana vencida se pone a 0 % marcada

- **Estado:** vigente
- **Ámbito:** `src/main/usage/UsageReader.ts`, `usage/caducidad.ts`, `usage/UsageWatcher.ts`

## Contexto

Claude Code consulta un endpoint OAuth que limita por token y responde 429 al insistente; Codex lee
el último `token_count` de su rollout, que no cambia si no hay peticiones. La interfaz sondea. Sin
límites, un hover nervioso o una ráfaga de turnos cortos se convierte en una tanda de 429; y ninguna
parte comparaba el `resets_at` con la hora, así que una ventana ya reiniciada seguía enseñando el
85 % con un «se reinicia ya» que nunca llegaba.

## Decisión

- Caché por (cuenta, agente) con TTL (Claude 180 s, Codex 15 s, fallo 30 s), lecturas en vuelo
  coalescidas y un suelo de 20 s de red para Claude que gana a `force` y al fin de turno.
- Un 429 impone `retryAt` (el `Retry-After` o un backoff que se duplica con cada 429 seguido, y
  solo con 429: la red caída o un 500 no cuentan, hasta 10 min) que gana a todo.
  Un fallo transitorio sirve el último dato bueno marcado `stale`, no una barra en blanco, y lo
  servido durante el castigo se caduca a la hora de servirlo.
- Una ventana con `resets_at` vencido se pone a 0 % y se marca `reiniciada`, por ventana y no por
  snapshot (la de 5 h vence cada 5 h; la semanal no). Su `resets_at` se retira: la ventana nueva
  cuenta desde la próxima petición y cualquier fecha sería inventada. Se guarda la lectura cruda.
- `UsageWatcher` vigila con `fs.watch` recursivo; Claude se estrecha a `projects/` (su base nativa
  tiene un `file-history/` que se reescribe en cada edición) y Codex vigila su base entera porque su
  lector también lee `archived_sessions/`. Sobrevive 30 s a su último panel (cambiar de pane lo
  soltaba y lo volvía a pedir en el mismo commit); si muere con un 'error' se suelta sin perder la
  cuenta de paneles, y antes de borrar una cuenta se cierra ya (`cerrar`): abierto, impide borrarla.

## Consecuencias

- Un vigilante más estrecho que su lector deja el dato viejo sin que nadie lo sepa.
- El User-Agent `claude-code/<versión>` es obligatorio: sin él la petición cae en un bucket con 429
  constantes.

## Descartes

- Esconder la ventana vencida con un guion (dice «no sé» cuando sí se sabe) o dejar el 85 % con un
  aviso debajo (el número grande sigue mintiendo).
