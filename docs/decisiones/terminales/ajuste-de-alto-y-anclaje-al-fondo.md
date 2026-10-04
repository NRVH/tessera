# El alto del xterm se ajusta a su lienzo y el fit conserva el anclaje al fondo

- **Estado:** vigente
- **Ámbito:** `features/terminales/altoXterm.ts`, `comportamientoTerminal.ts` y las terminales que los usan

## Contexto

`FitAddon` calcula las filas redondeando hacia abajo, así que sobran unos píxeles dentro del
viewport de xterm, bajo la última fila. xterm desplaza en unidades de fila: su posición «al fondo»
deja el contenido esos píxeles por encima, y el renglón donde se escribe queda partido contra el
borde. Al teclear, `scrollOnUserInput` (que sí usa píxeles exactos) lo recoloca: por eso «se sube
sola». Además el fit ocurre continuamente (ResizeObserver, mostrar y ocultar, cambio de fuente) y
puede dejar la vista fuera del fondo.

## Decisión

- Tras cada fit se fija al `.xterm` el alto exacto de `.xterm-screen`; el sobrante sale del
  viewport y queda como canalón del mismo color que el hueco (`--bg-terminal`).
- Antes del fit se anota si la vista estaba al fondo (`estaAlFondo`, con `>=`) y solo entonces se
  reancla después. Quien subió a leer se queda donde estaba.

## Consecuencias

- El ajuste no realimenta el ResizeObserver: `FitAddon` mide el padre, no el `.xterm`.
- El buffer alterno no tiene scrollback: `baseY` es 0 y reanclar es un no-op barato.
- El color del hueco y el del tema de xterm deben seguir siendo el mismo.

## Descartes

- `scrollToBottom()` tras cada escritura: pelea con la sincronización de xterm en cada `write`,
  devuelve el corte si llega salida sin teclear y rompe «si subiste a leer, subido te quedas».
