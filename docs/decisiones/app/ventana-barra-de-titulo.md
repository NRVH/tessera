# La barra de título la pinta el renderer y los botones los pone el sistema, alineados con el zoom

- **Estado:** vigente
- **Ámbito:** `src/main/app/ventana.ts`, `src/renderer/src/styles.css` (`--titlebar-h`), `src/renderer/src/theme/` (macOS: sin verificar aquí)

## Contexto

Sin marco nativo, el renderer dibuja la banda de la barra de título y el sistema sigue pintando encima sus botones
(Windows) o su semáforo (macOS). El renderer escala con el zoom; los botones del sistema se miden en píxeles y no se
enteran.

## Decisión

- 30 px de CSS, en una franja propia y no en la fila de los perfiles: fundidas, las pestañas perdían ~250 px y quedaba
  un socavón entre la última y el engranaje. `TITLEBAR_HEIGHT`, `CHROME_BG` y `CHROME_FG` son GEMELOS literales de
  `--titlebar-h`, `--bg-chrome` y `--fg` del renderer (otro proceso): si cambian allí, se cambian aquí.
- `titleBarStyle`: `hiddenInset` en macOS (admite `trafficLightPosition`; con `hidden` el semáforo se pega a la
  esquina) y `hidden` en Windows. Botones del sistema y no propios: conservan Snap Layouts, el hover y el semáforo real.
- `titleBarOverlay` en LAS DOS plataformas: en macOS solo con `height`, porque es lo que publica
  `env(titlebar-area-*)` y el `geometrychange` de pantalla completa; sin él el renderer adivinaba el ancho del
  semáforo. Visualmente no cambia nada (capturas a zoom 0, +2 y −2 idénticas).
- Al cambiar el zoom: Windows re-envía el overlay ENTERO (`setTitleBarOverlay` reemplaza, no fusiona); macOS mueve el
  semáforo con `setWindowButtonPosition`, centrado en la banda escalada y nunca con `y` negativa.
- `setTitleBarOverlay` no existe en macOS y lanzaba desde `ready-to-show`: nunca se llama allí.
- La alineación va DESPUÉS de `show()`: antes, el contenido web se quedaba clavado al tamaño de creación dentro de la
  ventana maximizada. Tras guardar los ajustes va en `try/catch`, para que un overlay fallido no haga mentir al guardado.

## Consecuencias

`test:chrome-ventana` lee `ventana.ts` y fija el ternario por plataforma de las opciones.

## Descartes

- Barra y perfiles en una sola fila de 38 px: ver arriba.
