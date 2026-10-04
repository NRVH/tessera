# El modificador principal es uno por plataforma, y hay gestos cuya tecla también cambia

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/util/atajos.ts` y quien lo llama

## Contexto

`e.ctrlKey || e.metaKey` parece suficiente al portar a Mac y falla en las dos plataformas: en
Windows deja pasar la tecla Windows como si fuera Ctrl (⊞+F abriría la búsqueda del sistema y la
de Tessera), y en Mac deja pasar Ctrl como si fuera ⌘, con lo que se roban Ctrl+A/E/K (edición
de línea del sistema) y todo Ctrl+letra que debe llegar al pty. Además, en Mac Ctrl+clic es el
clic derecho: un «añadir a la selección» con Ctrl abriría el menú contextual.

## Decisión

- `esModPrincipal(e, plataforma)`: un modificador por plataforma, exclusivo (el otro, suelto). La
  etiqueta que se enseña sale de la misma decisión (`etiquetaModPrincipal`, `etiquetaAcorde`).
- Si la TECLA es otra, no solo el modificador, el gesto es un predicado con la plataforma como
  parámetro: borrar (`Supr` en Windows, `⌘⌫` en Mac; Shift y Alt anulan), detener una consulta
  (Ctrl+F2 / ⌘.) y abrir un nodo (Enter/F4, y además ⌘↓ en Mac, donde F4 exige fn).
- Ctrl+` (terminal) sigue en Control también en Mac (`esCtrlLiteral`): ⌘+` es «siguiente
  ventana» del sistema.
- Los acordes con ⌥ en Mac se leen por tecla física (`code`): ⌥ compone caracteres y `key`
  llega como '∫'. En Windows AltGr llega como Ctrl+Alt y anula.
- Las letras se leen por su nombre (`key`), y solo caen a `code` si `key` es una letra de otro
  alfabeto. No `key || code`: en Dvorak la tecla física de la W escribe ',' y Ctrl+, es Configuración.
- Los atajos del proceso main (F11, F12, F5, Mod+Shift+I) aplican la misma regla escrita a mano
  en `before-input-event`; al añadir uno, se copia allí.
- El menú contextual por teclado no tiene predicado: fuera de Mac Chromium ya emite `contextmenu`
  y un `preventDefault` en el keydown lo mataría; en Mac el sistema no tiene ese gesto.

## Consecuencias

`test-atajos.mts` fija cada predicado en las dos plataformas, con sus mitades negativas (qué
acorde NO debe hacerlo en cada una). Sin verificar en un Mac con teclado AZERTY (⌘.).

## Descartes

- Historial en Ctrl+Alt+E: AltGr+E escribe «€» en varias distribuciones y Monaco no distingue AltGr.
- ⌘F2 para detener en Mac: F2 exige fn en los teclados de Apple.
