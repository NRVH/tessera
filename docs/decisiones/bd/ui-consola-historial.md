# El historial de consultas es un popover que filtra en el main e inserta en el cursor, nunca desde una lista vieja

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/HistorialConsultas.tsx`, `consola/useHistorialConsultas.ts`, `consola/historialConsola.ts`

## Contexto

El historial lo guarda el main fuera del espacio de datos ([explorador-historial.md](explorador-historial.md)).
El popover cuelga del botón del reloj de la barra por portal, y React burbujea las teclas del
portal hasta la sección de la consola, que tiene sus propios atajos.

## Decisión

- El molde del selector de esquema ([ui-consola-barra-y-pane.md](ui-consola-barra-y-pane.md)):
  `fixed` acotado al viewport y alineado por la derecha, foco en el filtro, ↑/↓ con
  `aria-activedescendant`. Clic fuera o Esc cierran sin hacer nada; todas las teclas se quedan
  en el popover, y el acorde que lo abre lo cierra.
- «Solo esta conexión», activado al abrir: casi siempre se busca lo que se hizo ahí. El filtro
  lo aplica el MAIN (sin caja ni tildes) tras 150 ms; se refresca al abrir, y la respuesta de
  una pregunta vieja o con el popover cerrado se tira.
- Elegir INSERTA en el cursor (en línea nueva si hay texto), terminado con `;`, `/` o `GO` según
  el divisor y con los saltos en el fin de línea del modelo.
- Enter no inserta de una lista vieja: con la respuesta de lo tecleado pendiente, espera e
  inserta la primera de la nueva; seguir tecleando retira la espera.
- «Borrar todo» pregunta EN LÍNEA (una franja con Cancelar / Borrar todo). Al quitar la franja,
  el foco vuelve al filtro antes de desmontar el botón: en `body`, fuera del popover, su
  teclado dejaría de responder.
- Borrar una: la papelera de la fila, o Supr / ⌘⌫ solo con el filtro vacío.
- Sin lista virtual: como mucho `LIMITE_HISTORIAL` (500) filas de texto.

## Descartes

- Un modal para confirmar «Borrar todo»: el clic en él contaría como clic fuera y cerraría el
  popover que se estaba confirmando.
- Normalizar a LF al guardar en el historial: cambiaba «lo que se envió».
