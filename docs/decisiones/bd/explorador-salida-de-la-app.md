# Al cerrar la app el diálogo es nativo, pregunta antes por los cambios sin enviar y nunca espera sin plazo

- **Estado:** vigente
- **Ámbito:** `controlador/salida.ts`, `salidaSinEnviar.ts`, `OpcionesExplorador` (`mostrarMensaje`, `emitir`)

## Contexto

Salir de la app puede perder dos cosas: transacciones abiertas en el servidor y cambios de la
rejilla que solo existen en el renderer. La salida no puede quedarse esperando a un renderer
colgado, y `main/index.ts` la invoca siempre, no solo cuando hay transacciones.

## Decisión

- **Diálogo NATIVO** (`dialog.showMessageBox` inyectado): se ve aunque el renderer esté colgado o
  la vista de bases de datos esté detrás de otra.
- **Primero se pregunta al renderer** (`EV_PEDIR_SIN_ENVIAR` con un `id`, respuesta `SIN_ENVIAR`)
  por las pestañas con cambios sin enviar, con plazo; sin respuesta se sigue sin saberlo. Solo vale
  la respuesta a la pregunta en curso.
- Sin transacciones, el diálogo es «Descartar y salir / Cancelar»; con ellas es el de siempre
  (Confirmar y salir / Revertir y salir / Cancelar) con los cambios sin enviar añadidos al texto,
  que dice que «Confirmar y salir» no los envía. No hay «Enviar y salir»: saltaría la vista previa
  y la confirmación de producción.
- «Confirmar» es un bloque: las fallidas se revierten (un COMMIT sobre una transacción abortada
  sería un ROLLBACK dado por bueno) y solo un COMMIT rechazado abre un segundo diálogo.
- Con algo que preguntar, la ventana se trae a la vista antes: cerrar minimizada dejaba el diálogo
  en la esquina de otro monitor (medido en Windows). Nunca lanza.
- `vaciarConsolas` y `pedirSinEnviar` responden al instante si no hay ventana viva.

## Consecuencias

`OpcionesExplorador` no pasa a un emisor de eventos genérico: sin ventana viva la salida esperaría
el plazo entero (3-15 s más al cerrar la app).
