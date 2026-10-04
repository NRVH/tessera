# El hueco de los botones de la ventana lo mide Chromium; el renderer solo marca el lado y si hay semáforo

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/theme/chromeVentana.ts` y la regla `.titlebar` de `styles.css`

## Contexto

Los botones de la ventana los pinta el sistema encima del contenido web: a la derecha en
Windows (`env(titlebar-area-width)`), a la izquierda en macOS (`env(titlebar-area-x)`, solo si
la ventana se crea con `titleBarOverlay`). En pantalla completa de Mac el semáforo se esconde,
`env()` desaparece y el CSS caía a su fallback de 80 px: un hueco vacío. El CSS no puede
detectarlo: `display-mode: fullscreen` no casa en Electron (medido).

## Decisión

- El ancho sale solo del `env()`. El módulo marca el `<html>` (`data-plataforma`) para que el
  lado del hueco sea una regla de CSS normal, y en Mac `seguirSemaforo` marca
  `data-semaforo="oculto"` cuando el overlay no está visible.
- Se lee `visible` al nacer el documento Y se escucha `geometrychange`, porque ninguna basta
  sola (medido): una recarga en pantalla completa nace con `visible: false` y sin evento; el
  arranque en frío nace con `false` y recibe el evento. El overlay llega después de que nazca
  el documento, así que leer al nacer no marca el arranque en frío.
- En Windows no se hace nada: queda sin medir si su overlay pasa a `visible: false` con F11.

## Consecuencias

No hay ancho fijo en el renderer: cualquier número aquí sería un gemelo de la posición del
semáforo que fija `main/index.ts` en otro proceso, sin nada que los sincronice.

## Descartes

- `ANCHO_SEMAFORO` (78) dividido por el factor de zoom: el `env()` ya lo mide Chromium.
- Eventos `enter-full-screen`/`leave-full-screen` del main por IPC: un gemelo del estado del
  overlay en otro proceso, con un canal y una carrera nuevos para lo que Chromium ya cuenta.
