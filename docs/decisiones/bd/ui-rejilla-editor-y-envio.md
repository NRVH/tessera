# El editor de celda confirma sin robar el foco y el diálogo de «Enviar» no deja reenviar por reflejo

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/EditorCelda.tsx`, `DialogoEnvio.tsx`, `rejilla/rejillaAcciones.ts`

## Contexto

«Enviar» escribe en la base, a veces en producción, y con el COMMIT incierto un reenvío duplica
INSERTs. Lo que se aplica todo o nada lo decide el main ([transacciones-enviar-todo-o-nada.md](transacciones-enviar-todo-o-nada.md));
aquí va cómo el renderer lo presenta y cómo se edita una celda.

## Decisión

- Editor: `<textarea>`, no `<input type=text>` (su saneado quita los saltos y aplanaría en silencio
  una celda de varias líneas); crece hasta 8 líneas, Alt+Intro mete un salto. Vive en el lienzo, fuera
  de las filas con `transform`, para desplazarse con su celda y quedar tapado por la cabecera.
- Confirma al perder el foco salvo que lo pierda LA VENTANA (`document.hasFocus()`); un blur hacia
  otro control de la pestaña confirma sin devolver el foco a la rejilla (se robaría el clic).
- El puntero no sube a la rejilla; las teclas que no son del editor sí (cortarlas todas mataba los
  atajos de la app que escuchan en `window`).
- «Enviar» desde el editor se pide en el siguiente fotograma: el cambio recién escrito llega al dueño
  en ese mismo lote de React.
- Diálogo: en producción, franja «PRODUCCIÓN · alias» y botón «Ejecutar en producción» de contorno
  rojo literal (no el color del perfil); es la ÚNICA vía de `confirmado: true`. El foco arranca en
  Cancelar en producción y, en cualquier entorno, con el COMMIT incierto; al cerrar en ese estado va a
  la rejilla, no al botón «Enviar cambios» (Intro, Intro, Intro reenviaba). El botón sigue activo:
  Tessera informa, no prohíbe.
- Mientras envía no se cierra (ni Esc ni velo); solo «Detener», que cancela por el `peticionId` del
  envío. Si falla, sigue abierto con el error, la sentencia marcada y la fila señalada en la rejilla.
- El SQL va en un `<pre>` seleccionable con «Copiar» por el portapapeles de Tessera; va por portal.

## Consecuencias

La duda de un COMMIT incierto sobrevive al diálogo (`envioInciertoRef` en la pestaña) hasta que no
queda nada pendiente. Qué cambia y en qué orden, en [ui-rejilla-modelo-cambios.md](ui-rejilla-modelo-cambios.md).

## Descartes

- Volver a «Enviar» con el foco tras un fallo incierto para reintentar con Intro: reenviaba un lote
  quizá ya aplicado.
