# La ventana nace donde se cerró (o maximizada en el monitor principal), se muestra aunque no llegue `ready-to-show` y se recupera sola

- **Estado:** vigente
- **Ámbito:** `src/main/app/ventana.ts`, `src/main/app/estadoVentana.ts`, `src/main/app/cierre.ts`, `src/main/app/cierrePrincipal.ts`, `src/main/app/instanciaUnica.ts`, `src/main/app/primerPlanoPuro.ts`

## Contexto

Una ventana que no se muestra es un proceso invisible sin rastro; un renderer que muere deja una ventana en blanco; y
un enlace dentro de un documento mostrado puede navegar la ventana entera fuera de la app.

## Decisión

- Recuerda su estado: posición, tamaño sin maximizar (`getNormalBounds`) y si estaba maximizada, en `ventana.json` de
  `userData`. Es un archivo propio y no parte del estado del workspace porque el renderer reescribe ese estado entero
  y borraría un campo que solo escribe el main. Se escribe de forma atómica 500 ms después del último `move`,
  `resize`, `maximize` o `unmaximize`, se fuerza al empezar el cierre, y no se guarda en pantalla completa ni
  minimizada. El modo captura no lee ni guarda nada. Sin maximizar se guardan los límites de ese momento y no los
  «normales»: en Linux, `getNormalBounds` sigue dando los de antes de la última maximización.
- Al arrancar, lo guardado se valida (`estadoVentana.ts`, puro): números finitos, tamaño no menor que el mínimo y al
  menos 100 × 100 px dentro del área útil de algún monitor de ahora. Si cae en parte fuera se recorta para caber en el
  monitor donde más se ve; si el monitor ya no está, o el archivo falta o está dañado, vale el arranque por defecto.
  Ya creada, se le vuelven a dar los límites recordados si no son los que tiene: con monitores de distinta escala, el
  tamaño de creación se aplica con la del principal y la ventana nacería más grande o más pequeña en el suyo.
- Por defecto nace en el monitor PRINCIPAL (no en el del cursor), con un tamaño restaurado del 80 % del área útil,
  centrado, y se maximiza justo antes de mostrarse. Con estado guardado, solo se maximiza si estaba maximizada.
- El re-encaje proporcional al pasar a otro monitor se conserva: otra densidad de píxeles o un área útil distinta hacen
  que el tamaño elegido ya no sirva. Se compara con el monitor donde nació la ventana (el del estado recordado), así
  que el tamaño recordado nunca se pisa al arrancar; un tamaño elegido a mano se respeta mientras siga en el mismo
  monitor.
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
- Solo se navega para recargar la propia página (`navegacionVentana.ts`): un `file:` tiene que ser el mismo archivo
  y el servidor de desarrollo, el mismo origen. Comparar orígenes no basta, porque con la app cargada desde disco el
  de cualquier `file:` es `null`, igual que el suyo, y una página local conservaría el preload. Lo demás se cancela;
  los enlaces `http(s)` van al navegador del sistema. `window.open` solo admite `about:blank` desde la principal
  para una [franja desacoplada](../layout/franja-desacoplada.md) por perfil, con un nombre de marco válido,
  sin opciones ni cuerpo de petición. Las demás aperturas se cancelan, con el mismo desvío.

## Consecuencias

El guardián a veces se adelanta en el primer arranque tras actualizar; es aceptado.

## Descartes

- Esperar a `ready-to-show` sin guardián: fue la mitad de un incidente «actualizó y no se abrió».
- `minimize()` + `restore()` para forzar el foco: ningún contrato lo garantiza y rompe el resize del overlay.
- `AllowSetForegroundWindow`: exige código nativo y el proceso viejo muere ~30 s antes de que arranque el nuevo.
