; =============================================================================
; Hook de DESINSTALACIÓN de Tessera (electron-builder auto-incluye build/installer.nsh).
; -----------------------------------------------------------------------------
; Hace dos cosas, con guardas distintas porque son preguntas distintas:
;
;   A) RETIRA "Abrir con Tessera" del menú contextual del Explorador. Esas claves las
;      escribe la APP en HKCU (ver src/main/shell/), así que para cuando el
;      desinstalador corre ya no hay nadie que pueda borrarlas: si no se hace aquí,
;      quedan apuntando a un .exe que ya no existe y el menú del Explorador enseña una
;      entrada muerta para siempre. Se hace también en modo silencioso: `winget
;      uninstall` desinstala igual de en serio que el panel de control.
;
;   B) PREGUNTA si borrar los DATOS del usuario (perfiles, cuentas/credenciales y
;      sesiones), que viven en %APPDATA%\Tessera. Elegir "No" los conserva → una
;      reinstalación los recupera tal cual.
;
; TRIPLE GUARDA para NO borrar datos cuando NADIE ha pedido borrarlos. Basta con que se
; cumpla UNA de las tres:
;   1. `${ifNot} ${isUpdated}`: el instalador nuevo arranca al desinstalador viejo con
;      `--updated` SIEMPRE —no es un reenvío de la bandera que reciba él, es un `else`
;      incondicional en `app-builder-lib/templates/nsis/include/installUtil.nsh`—, así
;      que en CUALQUIER reinstalación (auto-update, relevo, o doble clic en el Setup
;      nuevo encima de la instalación vieja) esto ya es cierto y ni se llega al diálogo.
;   2. `${andIfNot} ${Silent}`: SI NO HAY NADIE MIRANDO, NO SE PREGUNTA. Cierra el único
;      hueco que quedaba: `QuietUninstallString` —la línea que usan winget, SCCM y las
;      herramientas de limpieza— se registra como `/currentuser /S` SIN `--updated`, así
;      que ahí la guarda 1 no aplica y todo colgaba del `/SD IDNO`.
;   3. `/SD IDNO`: red de NSIS por si el diálogo llegara a salir sin usuario detrás.
;
; El bloque A NO lleva la guarda del silencio, y es a propósito: retirar una entrada de
; menú no destruye nada del usuario, así que no hay nada que preguntar.
; =============================================================================
!macro customUnInstall
  ; ---------------------------------------------------------------------------
  ; A) Menú contextual del Explorador. Solo en una desinstalación DE VERDAD: durante
  ;    un update la app las reescribe sola al arrancar, y borrarlas aquí dejaría al
  ;    usuario sin "Abrir con Tessera" hasta el siguiente arranque.
  ; ---------------------------------------------------------------------------
  ${ifNot} ${isUpdated}
    Push $0
    Push $1
    Push $2

    ; Los cuatro verbos. El `*` es LITERAL: NSIS pasa la cadena a la API del registro
    ; sin expandir comodines.
    DeleteRegKey HKCU "Software\Classes\Directory\shell\Tessera"
    DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Tessera"
    DeleteRegKey HKCU "Software\Classes\Drive\shell\Tessera"
    DeleteRegKey HKCU "Software\Classes\*\shell\Tessera"
    ; La ficha de la app en el diálogo "Abrir con".
    DeleteRegKey HKCU "Software\Classes\Applications\Tessera.exe"

    ; Los ProgID de las extensiones asociadas (`Tessera.java`, `Tessera.sql`…). El
    ; desinstalador no sabe cuáles marcó el usuario, así que se ENUMERA
    ; `Software\Classes` y se borra todo lo que empiece por "Tessera.".
    ;
    ; OJO CON EL ÍNDICE: al borrar una clave, la enumeración se desplaza, así que tras
    ; un borrado se vuelve al bucle SIN incrementar. Incrementar ahí se saltaría una
    ; clave de cada dos.
    ;
    ; Lo que NO se toca: `Software\Classes\.java\OpenWithProgids`. Esa clave es del
    ; SISTEMA y dentro vive la lista de aplicaciones del usuario; borrarla le rompería
    ; asociaciones que Tessera nunca creó. Queda dentro nuestro valor huérfano, que
    ; Windows ignora al no existir ya el ProgID al que apunta.
    StrCpy $0 0
    tessera_progid_bucle:
      EnumRegKey $1 HKCU "Software\Classes" $0
      StrCmp $1 "" tessera_progid_fin
      StrCpy $2 $1 8
      StrCmp $2 "Tessera." 0 tessera_progid_siguiente
        DeleteRegKey HKCU "Software\Classes\$1"
        Goto tessera_progid_bucle
      tessera_progid_siguiente:
        IntOp $0 $0 + 1
        Goto tessera_progid_bucle
    tessera_progid_fin:

    Pop $2
    Pop $1
    Pop $0
  ${endIf}

  ; ---------------------------------------------------------------------------
  ; B) Datos del usuario.
  ; ---------------------------------------------------------------------------
  ${ifNot} ${isUpdated}
  ${andIfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION "¿Quieres borrar también tus datos de Tessera (perfiles, cuentas y sesiones guardadas)?$\n$\nElige No para conservarlos por si reinstalas más adelante." /SD IDNO IDYES tessera_delete_data IDNO tessera_keep_data
    tessera_delete_data:
      RMDir /r "$APPDATA\Tessera"
      Goto tessera_data_done
    tessera_keep_data:
    tessera_data_done:
  ${endIf}
!macroend
