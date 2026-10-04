# Un fallo va a `e2e/` solo si vive en la frontera con el sistema o dentro del renderer de verdad

- **Estado:** vigente
- **Ámbito:** `e2e/`, `e2e/monaco.ts`, `e2e/postgresEfimero.ts` y los `test-*.mts` co-ubicados

## Contexto

Los `test-*.mts` son puros (sin JSX, DOM ni Electron), rápidos y fijables desde cualquier
plataforma, pero no ven el despacho de un acorde por el sistema (un `setApplicationMenu(null)`
dejó ⌘V muerto con la plantilla del menú en verde), el hueco del semáforo, el PATH heredado, el
hook de React que conecta una decisión con la pantalla, ni la cadena hasta un servidor real.

## Decisión

- Una decisión de código va en su `test-*.mts`; a `e2e/` va lo que solo falla en esa frontera
  o solo existe dentro del renderer empaquetado. Cada spec dice en su cabecera qué caza que el
  puro no puede, y fija las mitades negativas.
- Dos capas de teclado. Playwright resuelve él mismo los comandos de edición de macOS
  (`macEditingCommands`): un ⌘V suyo pasa con menú y sin él, así que esa capa solo demuestra
  que nada en la app se traga el acorde. El menú se prueba con teclas nativas (`osascript` +
  System Events), que exigen Accesibilidad: sin permiso la prueba se salta diciéndolo.
- Escribir en Monaco va por `e2e/monaco.ts`: desde Chromium 130 Monaco recibe el texto por
  `EditContext` y la entrada sintética no se convierte en texto. Se localiza el editor por el
  fiber de React, por FORMA (`getModel` + `trigger`) y no por posición del hook, y se teclea
  con `trigger('keyboard', 'type')`, el camino de la tecla real. Los acordes van por `page.keyboard`.
- Las bases son servidores de verdad (PostgreSQL efímero en Docker, SQL Server propio, MongoDB y
  Redis compartidos por variable de entorno). Sin Docker, imagen o variable la prueba se SALTA
  con el motivo; un fallo de la siembra sí es rojo. Contenedores `pruebas-*`, nunca `tessera-*`.
- Los diálogos nativos (`showOpenDialog`, `showSaveDialog`, `showMessageBox`) se sustituyen en
  el main con `app.evaluate`: Playwright no conduce ventanas del sistema; se fija el flujo desde el IPC.

## Consecuencias

- Las ayudas compartidas van en archivos que no son spec: importar un spec registra sus pruebas.
- Las suites de una misma vista van en serie y comparten app; lo que una abre, lo recoge.

## Descartes

- Un trabajador simulado: pasaría en verde con el driver sin copiar al paquete.
- `page.keyboard.type` en Monaco: cinco teclas pulsadas, cero caracteres (medido).
