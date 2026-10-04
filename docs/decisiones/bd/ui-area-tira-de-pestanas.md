# La tira de BD reutiliza la del editor, con un indicador por pestaña y un arrastre que solo acepta lo suyo

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/DbTabs*.tsx`, `useArrastrePestanas.ts`, `area.css`

## Contexto

Es la misma pieza de la ventana que la tira de Archivos y tiene que verse idéntica: altura de la
escalera de tamaños, acento del perfil en la activa y hueco fijo para el aspa. Encima lleva lo
propio de BD: el alias, el estado de cada pestaña, el entorno y el reordenar.

## Decisión

- Sobre las clases del editor (`.editor-tabs`, `.editor-tab*`); `area.css` solo AÑADE, siempre
  calificado por `.db-area .db-tabs` porque la hoja global carga después y gana a igual
  especificidad.
- UN solo indicador, en el hueco del aspa (como el punto de «sin guardar»): en reposo se ve el
  indicador y al pasar el ratón cede su sitio al aspa. Dos a la vez no se leen en 160 px.
- Título `NOMBRE [ALIAS]` con el nombre recortado por el CENTRO: en nombres de tabla distingue el
  prefijo y el sufijo, y el recorte por la derecha se comía el sufijo. El tooltip lo dice entero.
- Reordenar con DnD HTML5 y una RAYA de inserción (pseudo-elemento, no borde: no mueve el texto):
  antes de la pestaña en su mitad izquierda, después en la derecha, y el modelo recibe «antes de
  cuál». Solo se acepta el tipo propio (`application/x-tessera-db-pestana`), un soltar que no
  mueve nada no pinta raya y arrastrar no activa. El navegador solo arranca un arrastre tras
  mover unos píxeles con el botón principal: el clic, el central y el menú siguen igual. Es el
  mismo DnD en las dos plataformas, y solo `move` (sin copiar con ⌥). Sin teclado para reordenar.
- Clic CENTRAL cierra, en `onAuxClick`, y se anula su `mousedown`, que en Windows arrancaría el
  autodesplazamiento. Cerrar pide cerrar (`onCerrar`) y las guardas son del área.
- En una consola el icono es la marca del motor de su conexión: es una sesión, no un objeto.
- El entorno es una FRANJA al PIE de la pestaña (`MarcaEntorno` compacta) y, en producción, la
  pestaña entera teñida. Al pie porque arriba está el acento del perfil; el nombre del entorno
  va con palabras en el tooltip y en el nombre accesible.

## Consecuencias

Un estilo sin calificar lo pisa la hoja global; aceptar arrastres ajenos reordenaría con un archivo.

## Descartes

- Unas clases propias para la tira: acabaría divergiendo de la de Archivos.
