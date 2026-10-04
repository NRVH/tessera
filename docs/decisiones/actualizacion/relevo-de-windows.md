# En Windows la actualización la aplica un relevo: una copia de la app fuera de la carpeta de instalación que supervisa al instalador y cuenta cómo acabó

- **Estado:** vigente
- **Ámbito:** `src/main/update/stagingRelevo.ts`, `installDirLock*.ts`, `installDirPaths.ts`, `procesosSistema.ts`, `src/main/relevo/`

## Contexto

Quien lanza el instalador deja de existir y no puede contar el desenlace. El desinstalador de NSIS renombra la
carpeta de instalación a un temporal y falla con «…: 2» por dos causas distintas con el mismo mensaje: un proceso
con un archivo abierto bajo la carpeta (el helper de ConPTY que node-pty carga desde ahí) o una ruta que, al crecer
unos 12 caracteres en el renombrado, pasa de MAX_PATH (260, sin prefijo `\\?\`).

## Decisión

- El relevo es el mismo binario copiado con `robocopy /MIR` a `%LOCALAPPDATA%\tessera-updater\relevo`. La variable va
  antes que `appData/../Local`, que queda solo de respaldo si falta: con redirección de carpetas puede caer en una
  ajena y `/MIR` la vaciaría. Se copia al terminar la DESCARGA, se reutiliza mientras la versión no cambie, y la copia en vuelo se espera hasta 20 s antes de instalar
  (robocopy tiene handles sobre la carpeta mientras la recorre). Códigos 0-7 de robocopy son éxito.
- robocopy y el relevo arrancan con `cwd` fuera de la carpeta de instalación: el directorio actual de un proceso es
  un handle abierto sobre ella.
- Solo con `relanzar` (el botón): al cerrar, el usuario no pidió una ventana que sobreviva a la app. Va DESPUÉS de
  liberar la carpeta y del pre-vuelo de MAX_PATH, y sin relevo se sigue por `quitAndInstall`.
- Liberar la carpeta: se enumera por RUTA con `Get-CimInstance Win32_Process` (`tasklist` no da ruta ni padre;
  `wmic` está retirado), con salida en UTF-8 (sin eso una ruta con tilde no casaba y el proceso no se mataba) y
  `windowsHide`. Se mata todo lo que corra desde la carpeta salvo la propia app (mismo ejecutable) y se sondea 8 s.
- MAX_PATH: se borran los restos de versiones viejas bajo appPath (`.tessera`) y, si queda una ruta condenada, se
  ABORTA con su nombre en vez de ceder el control.
- El supervisor abre su registro antes de leer el encargo (derivado de la ruta del encargo), consume el encargo,
  espera a que muera el pid, comprueba que la carpeta se puede RENOMBRAR (no «¿queda algún proceso?») y lanza
  `/S --updated` sin `--force-run`: relanza el usuario con el botón. `--updated` mata la app y conserva accesos.
- La ventana es HTML en una URL `data:` sin React ni archivos de la app (se está borrando debajo). Los botones avisan
  por `console.log` de una marca leída en `console-message` (del objeto del evento). Los pintados van encolados.

## Consecuencias

El relevo no puede vivir en lo que reemplaza ni tener su `cwd` ahí. Las esperas no son condiciones: agotadas, se sigue.

## Descartes

- Avisar con `location.hash` y `did-navigate-in-page`: Chromium bloquea la navegación de fragmento en una URL `data:`.
