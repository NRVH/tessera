# En Linux «Abrir con Tessera» es un `tessera.desktop` propio en `$XDG_DATA_HOME/applications`

- **Estado:** vigente
- **Ámbito:** `src/main/shell/escritorioLinux.ts`, `src/main/shell/EscritorioLinuxService.ts`, `src/main/shell/carpetasPorDefecto.ts`,
  `src/shared/escritorio-linux-ipc.ts`, `src/main/app/proceso.ts` (`setDesktopName`)

## Contexto

En Windows el menú contextual son claves de `HKCU` y en macOS un `.workflow` en el HOME. En Linux
el «Abrir con» de una carpeta lo arma cada gestor de archivos a partir de las entradas de
escritorio (Desktop Entry) que declaran `MimeType=inode/directory`. Una entrada en la carpeta de
aplicaciones del usuario no pide administrador, vale en cualquier escritorio que siga la
especificación y se quita borrando un archivo.

## Decisión

- El interruptor escribe la entrada `<XDG_DATA_HOME>/applications/tessera.desktop`
  (`~/.local/share` si la variable falta o no es absoluta), y copia el PNG de la marca a
  `<XDG_DATA_HOME>/icons/hicolor/512x512/apps/tessera.png`. El PNG viaja en `resources/` solo en
  Linux (`linux.extraResources`): dentro de un AppImage el del paquete vive en un montaje temporal.
  Junto a él deja el tipo `.tessera` (`mime/packages/tessera.xml`) y su icono de documento (ver
  `configuracion/archivos-tessera-del-sistema.md`); apagar borra los tres.
- `Exec` lanza `$APPIMAGE` si existe (el `execPath` de un AppImage es su montaje temporal) y si no
  `process.execPath`, con `%F`. El argumento va entre comillas dobles con `"`, `` ` ``, `$` y `\`
  escapados, `%` doblado y, encima, el escapado de valores string: una `\` acaba en cuatro. Una
  ruta con caracteres de control no se instala.
- `X-Tessera-Instalado=true` marca el nuestro. Un `tessera.desktop` sin esa clave no se pisa al
  encender ni se borra al apagar, y la interfaz lo dice.
- `StartupWMClass=Tessera` (Electron pone el nombre de la app en `WM_CLASS`) y
  `app.setDesktopName('tessera.desktop')` solo en Linux, que fija el identificador de la ventana
  en Wayland: así el lanzador agrupa la ventana bajo esta entrada.
- La entrada lleva la acción `ventana-agente` (clic derecho en el lanzador: el mismo `Exec` con
  `--ventana-agente`), igual que el `.desktop` del AppImage (`agentes/ventana-de-agente.md`).
- Tras escribir o borrar se llama a `update-desktop-database` y `update-mime-database` si están; su
  fallo no es error.
- Como en macOS: la verdad es el disco, las escrituras van en cola, y al arrancar se reescribe el
  nuestro si apunta a otro ejecutable (el AppImage se movió o cambió de nombre) o no es el que escribe
  esta versión (le falta el tipo `.tessera` o su icono); nunca se crea.
- Sin aplicación por defecto declarada para `inode/directory` (lo normal con un solo gestor de
  archivos), el escritorio la elige entre las que la admiten y la carpeta de aplicaciones del
  usuario va primero: la entrada recién escrita pasaba a abrir las carpetas, también con doble clic
  (medido con `gio mime` y `xdg-mime`). Antes de escribirla se fija en `$XDG_CONFIG_HOME/mimeapps.list`
  la aplicación que las abría (`carpetasPorDefecto.ts`) y la entrada lo recuerda en
  `X-Tessera-Carpetas-Fijadas`. Al apagar se quita esa línea, solo si sigue tal cual. Si el usuario ya
  había elegido una, no se toca nada.

## Consecuencias

- Tessera aparece también en el lanzador de aplicaciones mientras el interruptor está encendido.
- Lo que haga doble clic sobre una carpeta no cambia: sigue siendo la elección del usuario, aunque
  no la hubiera declarado nunca.
- Si el usuario borra el archivo a mano, el interruptor aparece apagado.

## Descartes

- `xdg-mime default tessera.desktop inode/directory`: convertiría a Tessera en la aplicación por
  defecto de TODAS las carpetas, incluido el doble clic en el gestor de archivos.
- Scripts del gestor de archivos y menús de servicio de cada escritorio: uno por gestor, con su
  formato y su carpeta, y ninguno vale en los demás. La entrada de escritorio es la pieza común.
