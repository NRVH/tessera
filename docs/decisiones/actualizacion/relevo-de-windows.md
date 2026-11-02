# En Windows la actualización la aplica un relevo: una copia de la app fuera de la carpeta de instalación que supervisa al instalador y cuenta cómo acabó

- **Estado:** vigente
- **Ámbito:** `src/main/update/stagingRelevo.ts`, `installDirLock*.ts`, `installDirPaths.ts`, `procesosSistema.ts`, `src/main/relevo/`, `src/shared/relevo.ts`

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
- Siempre que se instala, con el botón o al cerrar con una preparada: el instalador desinstala la versión vieja antes
  de poner la nueva, y sin una ventana el usuario se queda ese rato sin la app, sin saber qué pasa ni cómo acabó. El
  relevo nunca relanza solo: al terminar ofrece **Abrir Tessera**. Se lanza al
  EMPEZAR el cierre (`anticiparRelevo`), tras la pregunta de salida y antes de matar terminales y contenedores: el
  proceso de Tessera llegó a morir a mitad del cierre sin dejar rastro (sin volcado, sin evento del sistema) justo
  después de matar las pseudoconsolas, y con el relevo al final eso era «se cerró y no pasó nada». Como el relevo
  solo espera a que desaparezca el pid, sigue aunque la app muera, y su ventana sale en el acto. Espera hasta 3 min
  (el cierre entero, Docker incluido); agotada, instala igual y el instalador cierra la app que siga viva. Si el
  cierre se aborta (un pre-vuelo, plan C) se CANCELA: si no, instalaría encima de la app abierta. Si la copia no
  estaba lista al empezar, se lanza tras liberar la carpeta y el pre-vuelo de MAX_PATH, y sin relevo se sigue por
  `quitAndInstall`, que entonces lo cancela antes (serían dos instaladores).
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
- Tras un fallo se COMPRUEBA si el ejecutable sigue en su sitio (el código de salida no lo dice: el instalador pudo
  fallar después de desinstalar) y se ofrecen tres salidas, una a la vez y sin botones mientras trabaja:
  **Reintentar** (la carpeta y el instalador otra vez; sin carpeta, la prueba de renombrado la da por libre),
  **Volver a la versión anterior** y **Abrir el instalador** (sin `/S`, con su asistente). Si lo que falla es abrir
  Tessera tras una instalación buena, la ventana se queda en el final bueno: las salidas de un fallo desharían algo
  que funciona.
- Volver a la anterior: si la prueba de renombrado la dejó apartada (`.relevo-tmp`), se devuelve a su nombre; si
  no, se COPIA encima la copia del relevo, que es esa versión entera (`robocopy /E /IS /IT`, sin el encargo ni el
  marcador de versión), y se abre. Sirve con la carpeta borrada, a medias o intacta. Nunca `/MIR`: el instalador
  deja elegir la carpeta, puede ser una del usuario, y `/MIR` borraría lo que no esté en la copia; lo que la nueva
  dejara de más no estorba a la anterior. Ni aun así se copia sobre la raíz de una unidad o de un recurso, la propia
  copia o una carpeta que contenga a la otra o esté dentro (`destinoRestaurable`). Los accesos directos sobreviven
  porque la desinstalación por actualización los conserva; la ficha de aplicaciones instaladas la borra el
  desinstalador y la repone la siguiente actualización.
- El aviso de cierre solo promete la ventana si el relevo ya está en marcha; sin copia preparada se instala por el
  camino de siempre y dice que la versión nueva estará lista al volver a abrir.

## Consecuencias

El relevo no puede vivir en lo que reemplaza ni tener su `cwd` ahí. Las esperas no son condiciones: agotadas, se sigue.

## Descartes

- Avisar con `location.hash` y `did-navigate-in-page`: Chromium bloquea la navegación de fragmento en una URL `data:`.
- Instalar en silencio al cerrar: la app desaparece durante la instalación sin ninguna señal, y un fallo a mitad
  deja al usuario sin ella hasta que alguien la reinstale.
- Volver a la anterior con el instalador que NSIS guarda en `tessera-updater\installer.exe`: lo reescribe cada
  instalación, también la que acaba de fallar, así que puede ser ya el de la versión nueva.
