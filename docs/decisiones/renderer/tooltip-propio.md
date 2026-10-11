# El `title` lo enseña la app, igual en las dos plataformas

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/comun/TooltipPropio.tsx`, `comun/posicionTooltip.ts`, `comun/tooltipPropio.css` y `App.tsx`

## Contexto

Los botones de icono dicen qué hacen con su `title`. En macOS la ventana de Tessera no enseña ese globo del sistema,
así que en Mac los botones no decían nada al apuntarlos. En Windows sí sale, con el aspecto y el retraso del sistema.

## Decisión

- Un solo componente en `App.tsx` escucha en el documento (`pointerover`/`pointerout` en captura) y enseña el `title`
  de lo que está bajo el ratón en una caja de la app, con la piel de los menús. Vale para cualquier `title` sin que
  quien lo pone haga nada: los botones existentes y los que vengan. También el de un botón desactivado, cuyo motivo va
  en su envoltorio (`btn-envoltura`).
- **Igual en las dos plataformas.** Montarlo solo en Mac dejaba en Windows dos globos a la vez (el del sistema y este),
  y el usuario eligió el de la app. Para que el sistema no pinte el suyo, mientras el ratón está encima el `title` de
  toda la cadena de ancestros con título se guarda en `data-titulo-propio` (guardar solo el del elemento haría que el
  sistema enseñara el del padre), y vuelve al salir, al pulsar o al perder el foco. Al pulsar vuelve en el acto: quien
  busque el `title` tras un clic (las pruebas, el propio código) lo encuentra. Al teclear o desplazar se oculta la caja
  pero el `title` sigue guardado hasta salir: devuelto con el ratón encima, el sistema pintaría el suyo. Un
  desplazamiento que no contiene el ancla (la salida de una terminal que corre) no la toca.
- Si el ancla desaparece de la página con el ratón encima (una lista que se repinta), no llega ningún `pointerout`:
  mientras la caja se ve, se comprueba cada 300 ms que siga ahí.
- Un `title` que React reescribe mientras el ratón está encima se vuelve a guardar (`MutationObserver`).
- Sale a los 500 ms con el ratón quieto, y sin esperar si el anterior SE VIO y se fue hace menos de 400 ms (pasar de un
  botón al de al lado); barrer una barra sin pararse no enseña ninguno. Va centrado debajo; encima si abajo no cabe; nunca fuera de la ventana.

## Consecuencias

- Si React quita un `title` (pasa a `undefined`) mientras está guardado, al salir vuelve el viejo hasta el siguiente
  render que lo toque: React no escribe nada en el DOM al quitar un atributo que ya no está, y no hay mutación que ver.
- Las pruebas que buscan un elemento por su `title` mientras el ratón está encima sin pulsar no lo encuentran: se
  busca por `aria-label` o se pulsa.

## Descartes

- El globo del sistema en Windows y el propio solo en Mac: dos aspectos para lo mismo, y el de la app es el que encaja con el resto de la interfaz.
- Una prop de tooltip en cada botón: cientos de sitios que tocar, y los nuevos lo olvidarían.
