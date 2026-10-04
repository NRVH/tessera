# La cabeza del transcript se lee por líneas y una línea gigante no descarta la conversación

- **Estado:** vigente
- **Ámbito:** `src/main/transcripts/cabezaJsonl.ts`, `ConversationsReader.readHead`

## Contexto

El historial resume cada transcript por sus primeros 256 KiB y tiraba la última línea si el corte
la partía. Una conversación que empieza pegando una imagen grande lleva el primer mensaje en una
sola línea de megas (la imagen en base64): no cabía, se tiraba, no quedaba ningún mensaje y la
conversación no salía en el panel. Auto-reanudar, que toma la más reciente con mensajes, retomaba
la anterior.

## Decisión

- Se lee por trozos y por líneas. El presupuesto (256 KiB en el historial, 64 KiB en el contexto,
  32 KiB en el vigilante de turnos) cuenta lo GUARDADO, no lo leído.
- Una línea de más de `min(64 KiB, presupuesto/4)` (64 KiB, 16 KiB y 8 KiB) se compacta: se le
  quitan las tiradas de 256 o más caracteres del alfabeto base64. Cada escape JSON (`\n`, `é`)
  se consume entero, también partido entre dos trozos, así que una tirada nunca se come su letra.
- Si compactada sigue sin caber en el presupuesto, se salta hasta su salto de línea. Si deja de
  ser JSON (un número enorme fuera de una cadena), también: la original ya no está, se compacta
  al leerla.
- Lo leído de más tiene tope: con 3 líneas compactadas o saltadas y 4× el presupuesto quitado, la
  siguiente línea gigante corta la lectura. Las primeras se leen enteras: ahí va el título.
- Lo leído se acota además a 32 MiB por transcript; el resumen se cachea por (mtime, size).

## Consecuencias

- Con líneas por debajo del umbral se lee y se devuelve exactamente lo mismo que el corte fijo.
- Una tirada larga de base64 tecleada a mano en el primer mensaje desaparece de su título.
- Un transcript casi todo capturas de 300 KB lee ~1 MiB por cabeza, no hasta los 32 MiB.

## Descartes

- Ampliar el tope de cabeza: cualquier tope lo supera una imagen, y encarece todos los transcripts.
- Extraer los campos de la línea partida a mano: depende del orden de las claves del agente.
- Compactar sobre la línea ya parseada: obliga a tener entera en memoria una línea de megas.
