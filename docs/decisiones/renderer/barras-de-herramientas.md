# Las barras llevan la identidad a la izquierda y acciones de icono a la derecha, y lo destructivo se distingue por su nombre, no por el color

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/styles.css` (`.btn-icon`, `.panel-actions`, `.panel-actions-sep`, `.boton-reinicio-etiqueta`, `--danger-*`, `--red-hi`), `features/terminales/reloadButton.ts`, `comun/contextMenuEstilos.ts`

## Contexto

Cabeceras y pies de panel se repiten en cada pantalla. Mezclar botones con y sin texto, o metadatos
entre los botones, hace que lo que pesa más a la vista no sea lo que más vale; y pintar en rojo las
acciones que borran convertía en lo más llamativo de la app justo lo más destructivo.

## Decisión

- IDENTIDAD a la izquierda (nombre y los metadatos que lo describen: estado, revisiones), ACCIONES a
  la derecha. Los metadatos no van entre los botones: describen lo que se mira, no son controles.
- En el CROMO (lo que se repite en cada pantalla) las acciones son de icono, con `title` y
  `aria-label`, agrupadas por función con `.panel-actions-sep`, ordenadas por frecuencia y con lo
  terminal (cerrar) al final y aislado. Dentro del CONTENIDO (estado vacío, error, modal) los botones
  conservan sus palabras: se leen una vez y a menudo son irreversibles.
- Un solo cromo para todas: `.btn-icon` (transparente, gris apagado, se rellena al pasar el ratón),
  también en los pies.
- Una acción destructiva de icono DICE SU NOMBRE al pasar el ratón (`.boton-reinicio-etiqueta`).
  Cuando la etiqueta deja de ser sinónimo del icono («Reintentar», «Recuperando… (1/2)») el botón
  crece fijo (`botonReinicio.soloIcono`): una señal de fallo no puede depender de apuntar con el ratón.
- El rojo RELLENO es para el ESTADO (borrado, conflicto, error). Una acción destructiva se anuncia
  con la palabra (`confirmLabel` dice lo que hace, nunca «Aceptar») y se marca con CONTORNO: filete y
  texto rojos, tinte al pasar el ratón con el texto en `--red-hi` (el rojo sobre su propio tinte
  cae por debajo de AA). Una sola familia `--danger-*` para todo lo que borra, republicada dentro de
  `.modal-overlay` porque sobre una superficie más clara el mismo alfa se ve menos.
- El anillo de foco sigue siendo azul también en lo destructivo: dice dónde está el teclado, no el
  peligro.

## Consecuencias

Un botón nuevo de cabecera usa `.btn-icon`; uno destructivo, la etiqueta al pasar el ratón; un
diálogo que borra, el contorno de `--danger-*`. Lo más llamativo de una pantalla no puede ser lo
más destructivo.

## Descartes

- Cuerpo de chip y color de acento en los botones de reiniciar: los destacaba por encima de las
  acciones que solo releen.
- Distinguir lo destructivo por el color del icono: el color no explica qué va a pasar.
