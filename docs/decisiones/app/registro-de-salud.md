# Las versiones alpha graban un registro local de salud; la pública no graba nada

- **Estado:** vigente
- **Ámbito:** `src/shared/salud.ts`, `src/shared/salud-ipc.ts`, `src/main/salud/`, `src/renderer/src/util/vigiaRendimiento.ts`, `scripts/pruebas/salud.mjs`, ajuste `registroSalud`

## Contexto

El banco de rendimiento mide una sesión corta; una fuga lenta (~100 MB al día) solo se ve con días de uso real.
Las versiones alpha las usa el propio equipo de Tessera, y son el sitio natural para medirlo sin tocar a quien usa
la versión estable.

## Decisión

- Solo graba si la versión tiene prerelease `alpha` Y el ajuste `registroSalud` está encendido (por defecto sí).
  En la pública y en desarrollo no existe: ni graba ni enseña el interruptor, ni en el buscador de Configuración.
- El interruptor vive en la categoría «Experimental» de Configuración, que solo tiene ajustes de alpha: en la
  pública se queda sin filas y el catálogo la poda entera. Apagarlo no exige compilar otra versión.
- El renderer sabe que es alpha por un argumento de la ventana (`--tessera-alpha`) que lee el preload; el
  renderer no tiene `process` ni la versión.
- Una muestra cada 5 minutos con un `setTimeout` re-armable y sin retener el proceso (no `setInterval`: tras una
  suspensión dispararía en ráfaga), más una línea por suspensión, reanudación y proceso caído. JSON por línea en
  `logs/salud.jsonl`, con rotación a `salud.1.jsonl` a los 5 MB.
- Solo números y tipos: nunca órdenes, rutas, nombres ni datos. Nada sale del equipo.
- Lo de Electron entra por dependencias (`DepsRegistroSalud`), así que la lógica se prueba sin Electron.
- El análisis agrupa por número de sesiones abiertas antes de calcular la pendiente de cada proceso.

### Bloqueos (para saber por qué la ventana se atasca con el equipo cargado)

Las muestras de cada 5 minutos no ven un parón de unos segundos, y el volcado solo sale si un proceso cae. Para
encontrar la causa antes de arreglar nada, el registro anota además, con el contexto de ese instante (estado y
monitor de la ventana con su escala y frecuencia, memoria libre del equipo y procesos):

- **Bloqueos del bucle del main** (`bloqueo-main`): un vigía de `INTERVALO_VIGIA_MS` mira cuánto llega tarde; por
  encima de `UMBRAL_BLOQUEO_MS` anota el parón y las peticiones de la ventana que se solapan con él. Para eso
  `instrumentarIpc` envuelve `ipcMain.handle` al arrancar (antes de registrar ningún canal) y apunta canal, inicio y
  fin en un anillo acotado; las lentas (`IPC_LENTO_MS`) salen por canal en cada muestra.
- **Ventana sin respuesta** (`sin-respuesta` / `responde`, con lo que duró), cambios de monitor y de sus métricas
  (`pantalla`), minimizar, restaurar, ocultar y mostrar (`ventana`), y la GPU por ids una vez por arranque (`gpu`).
- **Desde la ventana**: tareas largas, fotogramas largos y entradas (teclas, clics) que tardaron en pintarse, que
  el navegador ya mide (`PerformanceObserver`), en un resumen por minuto solo si hubo algo (`renderer-lento`), y si
  la ventana quedó tapada o vuelve a verse. La ventana es un proceso de menos confianza: el main sanea (solo números
  con tope) y anota solo si está grabando. No se pide ningún fotograma ni se sondea: un bucle de
  `requestAnimationFrame` gastaría GPU en lo mismo que intenta medir.
- No hay pila de JS de la ventana colgada: esta versión de Electron no la ofrece.

`scripts/pruebas/salud.mjs` resume todo esto en el mismo informe.

## Consecuencias

El ajuste se persiste siempre pero solo tiene efecto en alpha. Apagar el interruptor quita temporizador y oyentes
al momento, y el cierre ordenado los quita también. `test:salud` y `test:registro-salud` fijan las reglas.

## Descartes

- Grabar también en la pública, con permiso: es telemetría de usuarios, y el registro es solo para quien prueba alpha.
- Enviar el registro a un servidor: nada sale del equipo.
- Forzar el recolector de basura en cada muestra: alteraría lo que se mide.
- Contar procesos hijos del main: caro en Windows y poco útil frente al working set por tipo.
