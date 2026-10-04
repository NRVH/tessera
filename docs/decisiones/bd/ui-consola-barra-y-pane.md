# La consola SQL describe a la izquierda y actúa con iconos a la derecha, y sus popovers y diálogos van por portal

- **Estado:** vigente
- **Ámbito:** `features/bd/` `DbConsolaPane`, `BarraConsola`, `DbEsquemasPopover`, los diálogos de la
  consola, `SalidaConsola`, `useConsolasBd`, `consola.css` y sus piezas en `consola/`

## Contexto

Una consola puede estar oculta (`display:none`) cuando se pide cerrarla, y los popovers cuelgan
de ancestros que recortan. Ver [transacciones-produccion-y-manual.md](transacciones-produccion-y-manual.md)
y [sesiones-esquema-de-consola.md](sesiones-esquema-de-consola.md).

## Decisión

- **Barra:** a la izquierda solo texto (alias, entorno, esquema, modo, «RO agentes», estado); a la
  derecha iconos grises por grupos con filetes: ejecutar; plan e historial; el esquema (contexto de
  la ejecución); la transacción. El modo va en ⇄ (`aria-pressed`) y Ejecutar no va en verde (el color
  es de los estados). Deshabilitado, el motivo va en el `title` de `.btn-envoltura`: el control no da tooltip.
- Explicar se deshabilita con los motivos de Ejecutar (ocupa la sesión); el historial no (no la
  toca). Formatear no tiene botón: vive en el menú contextual y en su acorde, y un icono más en una
  barra de diez no se ganaba el sitio. Durante un lote el esquema no cambia (correría en dos).
- Rollback dice su nombre con las clases del botón de reiniciar, sin copiar su CSS. Producción:
  marca de entorno y franja roja arriba. «RO agentes» informa; no limita al usuario.
- **Pane:** el editor se crea en el primer `visible` con caja real (Monaco a 0 px se queda a
  cero); el modelo es del hook desde el montaje. El alto de resultados se acota al de la columna:
  al encoger la ventana, un reparto guardado que ya no cabe se comería el editor entero.
- **Portal a `body`** para diálogos y popovers: en un `display:none` la promesa del cierre no se
  resolvería, y un ancestro con `transform` o `contain` vuelve relativo el `fixed`. Los atajos de
  la sección no se atienden desde un diálogo ni desde un portal. Los popovers de esquemas, en
  [ui-consola-popovers.md](ui-consola-popovers.md).
- **Parámetros:** sin selector de tipo; NULL es una casilla. **Tx pendiente:** el foco arranca en
  Cancelar y, con la transacción fallida, no hay «Confirmar» (sería un ROLLBACK).
- **Salida:** autodesplazamiento salvo que el usuario subió a leer; sin lista virtual.
- **Lista de consolas:** por perfil, sin watcher (se relee al volver el foco); altas optimistas con
  reloj lógico y poda solo tras un listado bueno (si no, la primera alta de un perfil sin listar
  cerraría las demás pestañas).

## Descartes

- El esquema de la izquierda como combo pulsable: mezcla texto y botón.
