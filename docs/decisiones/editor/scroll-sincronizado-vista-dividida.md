# En la vista dividida de un Markdown, mover un lado mueve el otro a la misma fracción de su recorrido

- **Estado:** vigente
- **Ámbito:** `features/editor/scrollSincronizado.ts`, `useScrollSincronizado.ts`, `EditorPane.tsx`

## Contexto

Con el editor y la vista renderizada lado a lado, bajar por el código dejaba la vista quieta (y
al revés): había que llevar las dos a mano para leer lo que se está escribiendo.

## Decisión

- Con las dos a la vista (`dividida` y una vista de Markdown o de diagrama; la de HTML va en un
  marco aislado y queda fuera), el lado que se mueve lleva al otro a la MISMA FRACCIÓN de su
  recorrido (`top / (alto − visible)`), acotada. Es proporcional, no por línea: el renderizado no
  mide lo mismo que el texto, pero el principio, el final y la mitad coinciden, y no exige un
  mapa de líneas a elementos que habría que mantener con cada clase de bloque.
- El movimiento que provocamos en el otro lado vuelve como evento suyo: se reconoce por su
  VALOR (el que le pusimos) y se ignora. Por valor y no por tiempo: el gesto del usuario sobre
  Monaco llega animado, fotograma a fotograma, y cada uno es un movimiento real que la vista
  sigue. Si lo que vuelve trae otro valor (un refresco lo pisó), el eco se da por perdido y no se
  guarda. Un movimiento que ya deja al otro en su sitio no se aplica. Reglas puras.
- Un `scroll` en el que cambió la MEDIDA del lado (alto o visible) y no su posición es un
  repintado, no un gesto, y no se propaga: la vista se refresca al escribir y el navegador acota
  y repone su scroll; un diagrama mide 0 hasta dibujarse. Sin esta regla, escribir movía el código
  solo. El siguiente gesto real vuelve a casar los lados.
- Se suscribe al editor (`onDidScrollChange`) y al `scroll` del contenedor de la vista, solo en
  el pane visible, y se re-suscribe si el pane cambia de modelo.

## Consecuencias

- Un documento con imágenes o tablas grandes no coincide línea a línea; coincide en proporción.
- Con un lado sin recorrido (cabe entero) el otro se queda donde está: no hay fracción que seguir.

## Descartes

- Mapa de líneas a elementos (como hacen algunos editores): más exacto, pero exige marcar cada bloque del HTML
  con su línea de origen y mantenerlo con cada clase nueva; para un visor, la proporción basta.
