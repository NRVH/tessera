# Sin menú en Windows, el mínimo en macOS, y los atajos de ventana por `before-input-event`

- **Estado:** vigente
- **Ámbito:** `src/main/app/ventana.ts`, `src/main/app/arranque.ts`, `src/main/app/menuAplicacion.ts` (macOS: sin verificar aquí)

## Contexto

El menú de aplicación traía aceleradores que disparan aunque la barra no se vea: `Ctrl+R` (recargar) se lo robaba a las
terminales y `Ctrl+W` cerraba la app entera, donde en un editor significa cerrar la pestaña.

## Decisión

- Windows y Linux: sin menú; copiar y pegar los resuelve Chromium en el motor. macOS: uno escrito a mano (Tessera,
  Edición, Ventana, en español) que SUSTITUYE al de fábrica, sin «Archivo» ni «Ver»: el de fábrica sigue en Cocoa
  aunque se ponga `null` y trae «Close Window» (`Cmd+W` cierra la ventana) y «Reload». No existe para el pegado:
  medido en la app empaquetada con teclas nativas, `Cmd+V` pega también con `null` (son acciones nativas de la cadena
  de respondedores). «Edición» se repone para no perderla al sustituir el de fábrica.
- Cada ítem lleva `label` y no se usan los roles-contenedor (`editMenu`, `windowMenu`, `appMenu`): sus rótulos salen en
  inglés y no se localizan. Se acepta perder la lista de ventanas (hay una) y los extras de edición; `appMenu`
  traería además el «Acerca de» nativo, duplicando la categoría de Configuración.
- Los atajos de ventana se atienden en `before-input-event` de la ventana, no con `globalShortcut` (sería de todo el
  sistema, sin foco incluido): `F11` pantalla completa; `F12` o Mod+Shift+I las herramientas de desarrollo, también
  empaquetada (único diagnóstico en la máquina del usuario); `F5` recargar SOLO en desarrollo.
- Recargar tira el renderer, que es donde vive lo que aún no está en disco (pestañas sucias y «sin título», que no
  tienen respaldo) y sin pasar por la confirmación de cerrar pestaña: en la app instalada no existe.
- El modificador es el principal de la plataforma y solo él (`meta` sin `control` en macOS, al revés en Windows), y la
  repetición del teclado se ignora.
- El chrome nativo que queda (overlay, menús contextuales, diálogos) va en modo oscuro.

## Consecuencias

`Ctrl+R` llega al pty (búsqueda inversa del shell). Quien añada un atajo de ventana lo hace aquí, no en un menú.
`test-menu-aplicacion.mts` mira la plantilla SIN expandir: si vuelve un rol-contenedor, hay que sondear con Electron
qué trae dentro (`close`, `reload`, `about`) antes de darlo por bueno.
