# La sesión de MongoDB aplica la política, guarda lectores por id y envía todo o nada según haya transacciones

- **Estado:** vigente
- **Ámbito:** `src/tdb/sesionMongodb.cjs`, `src/tdb/protocoloMongodb.cjs`, `src/tdb/cambiosMongodb.cjs`

## Contexto

`sesion.cjs` despacha aquí `abrir`, `cancelar`, `cerrar` y la op `docs` (`bases`, `colecciones`, `detalle`,
`consultar`, `mas`, `cerrarLector`, `consola`, `enviar`; tipos en `protocoloTrabajador.ts`). Las operaciones
SQL del protocolo responden `protocolo`: si llegan, el main enrutó mal, y decirlo claro es mejor que
intentar algo.

## Decisión

- **La política la aplica el trabajador**: el main manda `politica` (`soloLectura`, `produccion`,
  `confirmado`) y aquí se clasifica la sentencia antes de tocar el servidor. Solo lectura da la clase
  `soloLectura`; producción sin confirmar, `protocolo` con `TESSERA-PRODUCCION`; sin transacciones y con más
  de un cambio sin confirmar, `protocolo` con `TESSERA-SIN-TX`. Una política ausente o mal formada responde
  `protocolo`, y un campo que no es booleano cuenta como el caso seguro (solo lectura y producción).
- **Lectores**: cada página con más documentos deja su cursor vivo por id, con un tope de 8 por sesión (el
  más viejo se cierra). Cada lector lleva su `AbortController`: cancelar un `mas` mata el cursor y el lector
  desaparece. Si el servidor lo mató por inactividad (`CursorNotFound`, 43, a los 10 min), `mas` lo relanza
  saltándose lo ya entregado (`reabrir`).
- **«Enviar»**: todo se interpreta antes de enviar nada, para no dejar medio lote aplicado por un texto que
  no se entiende. Con transacciones, `withTransaction`: todo o nada. Sin ellas, los cambios van en orden y se
  para en el primero que falla, diciendo cuántos entraron. Un `_id` que ya no existe es un fallo del cambio
  (y en transacción deshace el resto). Con la red caída a mitad no se sabe qué quedó: es una pérdida, no un
  «no se aplicó nada».

## Descartes

- `bulkWrite` ordenado: no dice qué cambio no casó con ningún documento (el `_id` que ya no existe), y un
  «actualizado» que no actualizó nada es lo que «Enviar» no debe callar. Uno a uno tiene el mismo orden y la
  misma parada.
