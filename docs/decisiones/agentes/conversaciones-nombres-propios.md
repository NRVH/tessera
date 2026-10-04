# Los nombres propios de las conversaciones viven en un JSON de Tessera y nunca se escriben en el transcript

- **Estado:** vigente
- **Ámbito:** `src/main/conversations/conversationTitles.ts` y `ServicioConversaciones`

## Contexto

El transcript lo escriben Claude Code y Codex. Una reanudación lo reescribe (y Claude regenera su
línea `ai-title`), Codex ni siquiera tiene concepto de título y mutar ficheros de otro programa
acopla a un formato que no se controla.

## Decisión

- El nombre vive en `conversation-titles.json`, en `userData`, con clave `<agente>:<sessionId>` (el
  id es un UUID: no hace falta perfil ni cuenta, y el nombre sobrevive si la conversación cambia de
  cuenta) y se aplica encima del título derivado al listar, en el servicio y no en el lector: así la
  caché del lector sigue siendo el resumen puro del transcript y renombrar no la invalida.
- Estado en memoria sembrado perezosamente del disco, escritura atómica (`.tmp` + `rename`) y
  serializada en una cadena; un archivo corrupto arranca con el mapa vacío (se pierden los nombres,
  nunca las conversaciones).
- `crearTitulosConversacion(archivo)` no importa `electron`: la ruta la calcula `index.ts`, una vez,
  al construir. Tiene que ser una sola instancia por archivo: dos se pisarían la cadena de escrituras.
- Borrar una conversación olvida su nombre para que el archivo no acumule huérfanos.

## Consecuencias

- Renombrar es una operación de solo metadatos y funciona igual en los dos agentes.
- La ruta se fija al construir: depende de que el aislamiento de `userData` en desarrollo ocurra al
  cargar el módulo principal, antes de crear la instancia.
