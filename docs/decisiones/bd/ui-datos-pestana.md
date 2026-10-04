# La pestaña de datos es la dueña de la lectura y de lo pendiente, y sus acciones asíncronas solo leen un núcleo estable

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/DbDatosPane.tsx`, `rejilla/{datos*,Datos*,useDatos*}.ts(x)`

## Contexto

Las invocaciones al main tardan (VPN, bloqueos): hay que descartar la respuesta de lo que ya no se
quiere, no perder un Stop y no dar nada por enviado antes de tiempo. La rejilla solo pinta.

## Decisión

- `abrirTabla` con un `peticionId` NUEVO por consulta: la respuesta que llega tras otra se descarta y
  su lector se cierra (si no, pisaba a la nueva y dejaba el cursor abierto). «Más filas» y «Contar»
  llevan SU id, que es lo que Detener cancela. Nada se pide antes del primer `visible`.
- Filtro: Intro aplica y Esc vuelve al último que FUNCIONÓ; un error de un campo sale bajo él sin
  tirar los datos; uno que no lo es sustituye la rejilla por un aviso con el siguiente paso. El orden
  es del SERVIDOR y se consulta con el filtro aplicado, no con lo escrito a medias. Exportar manda los
  mismos campos, de la misma función, con lo APLICADO; los INSERT van a la tabla REAL calificada.
- Se edita solo con identidad de fila y nunca mientras llega otro resultado (`sePuedeEditar`). La
  casilla «Solo lectura» de la conexión no cuenta: es de los agentes. La columna oculta del ROWID
  sigue en el resultado, fuera de la rejilla, de «Copiar todo» y de la cabecera.
- Consultar otra vez (Refrescar, filtro, orden, «Volver a ejecutar», «Revertir») y cerrar preguntan
  «Descartar N cambios» por portal; cerrar y salir lo hacen por `registroEdicion.ts`.
- «Enviar»: los cambios en el orden de `aCambiosFila` y la vista previa del constructor del main;
  `SIN_CAMBIOS` solo con `hecho`, que relee conservando el sitio. Con error, `cancelada` o COMMIT
  incierto los cambios se quedan; la pestaña cerrada se mira antes de tocar estado y `enviando`
  impide un doble envío.
- Lo escrito tras un `await` va en el mismo turno. Las acciones asíncronas leen el NÚCLEO (refs y
  setters, siempre el mismo objeto): nada de un render viejo, y envoltorios estables para deps y `edicion`.

## Consecuencias

Memoria: [ui-rejilla-modelo-memoria.md](ui-rejilla-modelo-memoria.md); bloqueos: [ui-rejilla-modelo-panes.md](ui-rejilla-modelo-panes.md).

## Descartes

- Traducir lo escrito al pasar del guiado al WHERE: un WHERE con los valores pegados es lo que evita.
- Devolver el foco a mano en `responderDescarte`: corría ANTES del desmontaje, `useDialogo` lo pisaba
  después (sin `preventScroll`) y `resolver` puede moverlo a otro sitio al cerrar la pestaña.
