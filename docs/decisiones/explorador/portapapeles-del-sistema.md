# Los ficheros del portapapeles del sistema se leen en el main por los formatos registrados del Shell, con PowerShell de reserva

- **Estado:** vigente
- **Ámbito:** `src/main/clipboard/clipboardFiles.ts`, `adaptadores/portapapelesElectron.ts`, `ipc.ts`

## Contexto

«¿Hay algo pegable?» se pregunta en cada apertura del menú contextual y tiene que ser casi gratis;
«¿qué rutas son?» solo al pulsar Pegar y puede costar unos 250 ms. El renderer va con `sandbox` y
no ve `clipboard`; forzar un evento `paste` desde un clic de menú exige enfocar un textarea oculto,
y si ese foco no gana el pegado aterriza en el editor abierto y corrompe el fichero. Un fallo debe
ser «no pega», nunca «pierde datos».

## Decisión

- Sondeo: `availableFormats()` es la única API que en Windows refleja CF_HDROP, y sin adquirir el
  portapapeles. Si anuncia `text/uri-list`, se leen solo dos buffers de formatos REGISTRADOS por el
  Shell (`Shell IDList Array` para la cuenta, `Preferred DropEffect` para copiar o cortar). Ficheros
  ganan a imagen; solo texto es `none` con el texto adjunto. No se llama a `readImage()` para un sí/no.
- Rutas: con un elemento, `FileNameW` autovalidado con `existsSync`; con varios, PowerShell
  (`Get-Clipboard -Format FileDropList`) con `-EncodedCommand`, `-STA`, `ConvertTo-Json -InputObject`
  y salida UTF-8. `FileNameW` transfiere «a single file»: con cinco copiados daría el primero sin avisar.
- El efecto se prueba por BITS (el Explorador pone 5 al copiar y 2 al cortar) y ante ambigüedad gana
  copiar. En macOS no existe cortar ficheros (el Finder mueve al pegar) y el efecto es siempre `copy`;
  las rutas salen del plist de `NSFilenamesPboardType` o de `public.file-url`.
- Todo lo peligroso se decide en el main en el instante de pegar: el renderer solo dice DÓNDE, y el
  efecto no se recicla del sondeo que abrió el menú. Tras cortar se vacía el portapapeles.

## Consecuencias

Electron 44 cambia esta API entera (todo a Promise, sin `readBuffer` ni `availableFormats`): se
reescribe con `e2e/portapapeles-archivos.spec.ts` como red. `test-clipboard-files.mts` fija los parseos.

## Descartes (medidos en Chromium 130 / Electron 33; no se han vuelto a medir)

- `clipboard.has('text/uri-list')`: siempre false en Windows (registra un formato nuevo con ese nombre).
- `readBuffer('CF_HDROP')`: siempre vacío; es un formato predefinido (id 15) y ninguna cadena llega a él.
- `read('text/uri-list')`: cadena vacía (electron#39853). Parsear los PIDL del CIDA: formato sin
  documentar y roto con objetos virtuales. `document.execCommand('paste')`: muerto en Electron 33.
- `Add-Type System.Windows.Forms` antes de `Get-Clipboard`: la carga sola y cuesta el triple.
