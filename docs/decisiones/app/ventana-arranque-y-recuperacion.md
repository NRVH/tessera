# La ventana nace maximizada en el monitor principal, se muestra aunque no llegue `ready-to-show` y se recupera sola

- **Estado:** vigente
- **Ámbito:** `src/main/app/ventana.ts`, `src/main/app/instanciaUnica.ts`, `src/main/app/primerPlanoPuro.ts`

## Contexto

Una ventana que no se muestra es un proceso invisible sin rastro; un renderer que muere deja una ventana en blanco; y
un enlace dentro de un documento mostrado puede navegar la ventana entera fuera de la app.

## Decisión

- Nace en el monitor PRINCIPAL (no en el del cursor), con un tamaño restaurado del 80 % del área útil, centrado, y se
  maximiza justo antes de mostrarse. Si acaba en otro monitor se re-encaja; un tamaño elegido a mano se respeta
  mientras siga en el mismo monitor.
- Un solo sitio sabe mostrar, con cerrojo, y lo disparan `ready-to-show` o un guardián de 15 s. Medido: en templado
  `ready-to-show` llega en 0,4-1 s, pero el primer arranque tras escribir el bundle (antivirus escaneando) pasó de 15 s.
  Adelantarse solo enseña el color del chrome unos segundos; quedarse corto es no ver nada. Cada arranque deja una
  línea en el registro de actualización, y tras una actualización se trae la ventana al frente.
- Traer al frente es una ESCALERA, no un empujón: el proceso que lanza el instalador no tiene derechos de primer plano
  y Windows ignora `SetForegroundWindow`. Lo único que siempre concede es subir a topmost, así que `alwaysOnTop` va
  encendido en TODOS los empujones (apagarlo en el mismo tick lo anulaba); se reintenta con esperas crecientes y dos
  cotas (tiempo e intentos), se comprueba y se registra. Al rendirse, parpadeo del botón y techo al `alwaysOnTop`.
  `app.focus({ steal: true })` solo en macOS: en Windows no roba nada.
- Si el renderer muere (salvo salida limpia o muerte provocada, y nunca cerrando) se sueltan las sesiones huérfanas
  sin parar contenedores y se recarga la interfaz: el workspace se restaura de `workspace-state.json`.
- Navegar fuera del propio origen se cancela; los enlaces `http(s)` van al navegador del sistema. `window.open` se
  niega siempre, con el mismo desvío.

## Consecuencias

El guardián a veces se adelanta en el primer arranque tras actualizar; es aceptado.

## Descartes

- Esperar a `ready-to-show` sin guardián: fue la mitad de un incidente «actualizó y no se abrió».
- `minimize()` + `restore()` para forzar el foco: ningún contrato lo garantiza y rompe el resize del overlay.
- `AllowSetForegroundWindow`: exige código nativo y el proceso viejo muere ~30 s antes de que arranque el nuevo.
