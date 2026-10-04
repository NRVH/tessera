# En macOS «Abrir con Tessera» es un `.workflow` en `~/Library/Services` cuya verdad es el disco

- **Estado:** vigente
- **Ámbito:** `src/main/shell/servicioFinder.ts`, `src/main/shell/ServicioFinderService.ts`

## Contexto

En Windows el menú contextual son claves de `HKCU` que se escriben y borran en caliente. macOS no
tiene registro, pero un bundle `.workflow` (acción rápida) en el HOME del usuario tiene las mismas
propiedades: no pide administrador, no toca el paquete, el Finder lo ofrece en el clic derecho, y
se registra y se retira con `pbs -flush` sin cerrar sesión. Se midió antes de escribirlo: la
entrada aparece y desaparece en `pbs -dump_pboard` y el guion recibe la ruta entera.

## Decisión

- Se instala copiando `Info.plist` y `document.wflow` (una sola acción «Run Shell Script», con los
  campos y UUID fijos que Automator valida: si falta uno, el servicio se registra y no hace nada).
- `inputMethod: 1` (argumentos, `"$@"`), no stdin: un salto de línea es legal en un nombre de
  carpeta y por stdin partiría la ruta en dos.
- `NSRequiredContext` = Finder: sin él la entrada sale en el menú «Servicios» de todas las apps.
- Solo `public.folder`: los archivos ya los cubre `CFBundleDocumentTypes` del paquete y duplicarlo
  daría dos entradas; lo que el paquete no cubre es la carpeta, que es el caso que más se usa.
- La ruta del `.app` se hornea en el guion, escapada en dos capas (shell dentro de XML) que se
  deshacen en orden inverso. Al arrancar se reconcilia: si el `.wflow` instalado apunta a otra
  copia se reescribe; nunca se crea por su cuenta, aunque el ajuste persistido diga «sí».
- El estado no vive en memoria: es «¿existe esa carpeta?», y leerlo cuesta un `stat`.
- Toda escritura (aplicar y reconciliar, también su lectura previa) pasa por una cola: dos clics
  seguidos, o un clic durante la reconciliación, dejaban un `.workflow` a medias que se registra
  y no hace nada. `pbs -flush` tarda hasta 10 s, así que la ventana no es teórica.
- El flush va siempre, también tras un fallo, y su error no se propaga: el servicio ya está
  escrito. El aviso de «apunta a otra copia» solo se limpia cuando se escribió lo correcto.

## Consecuencias

- Mover o actualizar la app (que sustituye el `.app`) exige la reconciliación; sin ella la acción
  rápida muere tras la primera actualización. Si el usuario borra la carpeta, se respeta: apagado.

## Descartes

- `open -b <bundle id>`: con dos copias de Tessera, Launch Services elige la que le parece.
