# Los archivos `.tessera` se asocian a Tessera al instalar y el doble clic abre el importar

- **Estado:** vigente
- **Ámbito:** `electron-builder.yml`, `build/installer.nsh`, `src/shared/rutasDesdeArgv.ts`, `src/main/app/proceso.ts`, `src/main/configuracion/copiasPendientes.ts`, `src/main/shell/escritorioLinux.ts`, `src/renderer/src/features/ajustes/copia/ImportarDesdeSistema.tsx`

## Contexto

Una copia de la configuración (`exportar-importar.md`) se lleva a otro equipo como archivo, y lo
natural allí es hacerle doble clic. Sin asociarlo, ese archivo llega por la línea de órdenes como
cualquier otro y se abre en el editor, o no se asocia a nada.

## Decisión

- **Se asocia siempre al instalar, sin casilla:** la extensión solo la usa Tessera, así que no se le
  quita nada a nadie. Windows: `fileAssociations` del instalador, en `Software\Classes` del usuario
  (o de la máquina si se instala para todos) y lo quita el desinstalador. macOS: tipo exportado
  `com.noe.tessera.configuracion` y documento con rango `Owner` en el `Info.plist`. Linux (AppImage,
  sin instalador): el tipo `application/x-tessera` va con la integración de escritorio, que es
  opcional; sin ella el archivo se importa desde Configuración.
- **El ProgID de Windows lleva un punto interior** (`Tessera.Configuracion.1`): los de las
  extensiones que el usuario asocia son `Tessera.<extensión>` y una extensión no admite puntos, así
  que quitar una nunca borra este.
- **Icono propio de documento:** una hoja con la esquina doblada y la tesela de la marca, para que
  un `.tessera` no se confunda con la app. `build/tessera.ico` (Windows) y `tessera.icns` (macOS)
  van en `fileAssociations`; en Linux, `tessera-documento.png` viaja en los recursos y
  `escritorioLinux.ts` lo instala como `application-x-tessera` en el tema de tipos, con su XML.
- **Un `.tessera` no es una apertura:** el arranque, la segunda instancia y `open-file` reparten las
  rutas por la extensión; una carpeta que se llama solo `.tessera` sigue siendo un proyecto.
- **El main apunta la ruta y el renderer la recoge** cuando tiene ajustes y pestañas cargados (es
  contra lo que se fusiona), igual que la cola de «Abrir con Tessera». Se lee como al elegirla a
  mano, con el mismo error si no es una copia, y el modal se monta fuera de Configuración. Si llegan
  varias, gana la última: el importar abre un archivo a la vez, y con un importar ya abierto la que
  llega espera a que se cierre (recogerla soltaría el archivo que se está importando).
- **Del sistema solo se abre un archivo regular de este equipo** (`rutaCopiaSistema.ts`): nadie lo
  pidió dentro de Tessera, así que en Windows se rechaza una ruta de red o de dispositivo (leerla ya
  entrega las credenciales del usuario a ese servidor) y en todas lo que no es un archivo (un FIFO no
  acaba de leerse), también tras resolver enlaces. Elegida a mano en el diálogo, cualquier ruta vale.

## Consecuencias

- El texto del tipo en Windows y macOS es fijo en español: lo escribe el instalador, no la app.
- El portable de Windows no asocia nada.

## Descartes

- **Una casilla en el instalador o en Configuración:** pregunta algo cuya única respuesta útil es sí.
- **Abrir Configuración en su categoría:** obliga a pasar por el store de ajustes y el importar ya
  es un modal completo por sí solo.
