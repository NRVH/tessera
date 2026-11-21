# Cada perfil puede desacoplar su franja inferior en una ventana

- **Estado:** vigente
- **Ámbito:** `src/main/app/ventana.ts`, `src/main/app/gruposBarraTareas.ts`, `src/main/app/gruposBarraTareasPuro.ts`, `src/main/app/iconoFranja.ts`, `src/main/app/iconoFranjaPuro.ts`, `src/main/index.ts`, `src/shared/franja-ipc.ts`, `src/shared/contrasteColor.ts`, `src/preload/franja.ts`, `features/layout/` (`FranjaInferior.tsx`, `AnfitrionMovil.tsx`, `franjaDesacoplada.ts`, `useVistaFranjaConTransicion.ts`, `ventanasFranja.ts`, `documentoFranja.ts`, `IconosFranja.tsx`, `RielActividadPuro.tsx`, `useAtajosGlobales.ts`, `useAtajoPantallaCompleta.ts`), `features/terminales/` (`AccionesPanelTerminal.tsx`, `PanelTerminalesPuro.tsx`, `montajeXterm.ts`), `features/git/PanelLogGit.tsx`, `features/agentes/PanelCc.tsx`, `comun/BotonMaximizarPanel.tsx`, `comun/BotonDivididoMenu.tsx`, `comun/contextoDocumento.ts`, `util/ventanaDe.ts`, `features/terminales/ventanaXterm.ts`, `comun/movimiento.css`, `build/tessera-franja.ico`, `build/tessera-franja.png`, `build/tessera-franja-base.png`, `build/tessera-franja-insignia.png`, `e2e/desacoplar-franja.spec.ts`

## Contexto

La terminal, las pestañas SSH y SFTP, Git·Log y el agente de terminal tienen estado vivo. El búfer
de xterm vive en el renderer. Cambiar el destino de un portal de React desmonta sus componentes y
cierra sus sesiones.

## Decisión

- La cabecera de la terminal y la de Git·Log llevan, tras reiniciar o recargar y un filete,
  "Maximizar" como botón dividido: la parte principal maximiza y su flecha abre un menú con
  "Pantalla completa" (con su acorde) y "Desacoplar en una ventana". Con la franja a pantalla
  completa, donde maximizar y ocultar viven en el riel, "Desacoplar" queda como icono suelto tras
  el filete. La principal da todo el alto al centro y sustituye los dos botones del riel por
  "Acoplar" en ese perfil. La hija sigue el proyecto activo del perfil y lleva a su izquierda un
  riel estrecho con los conmutadores de Terminal y Git·Log arriba (mismos iconos, tooltips y estado
  activo que el riel de la principal) y "Acoplar" al final y aparte, con el mismo icono, tooltip y
  sitio que el botón del riel de la principal. Su barra de título está vacía. Al pie, la barra de
  estado muestra a la izquierda la pastilla del perfil en su color y el proyecto activo que sigue.
  A la derecha, el mismo conmutador de agente de la barra de estado principal muestra u oculta el
  agente del perfil de la hija; en la vista compacta no se pinta, porque el agente está oculto por
  definición, y entra y sale con el fundido de la casa. Mostrarlo lo prepara si hace falta;
  ocultarlo conserva su sesión. La vista completa restaura el agente pedido también cuando la
  principal está en otro perfil.
- Vista compacta ("Mostrar solo la terminal" / "Mostrar la vista completa"): en la vista completa
  es un icono suelto tras el filete de la cabecera (una ventana con el símbolo de terminal, que no
  se parece al de la columna del agente); en la compacta es el botón dividido "Vista": la parte
  principal vuelve a la vista completa, marcada como activa, y su flecha ofrece "Mostrar la vista
  completa" y "Acoplar a la ventana principal". Es el mismo botón con o sin flecha, para que el
  foco no se pierda al cambiar de vista. En compacta se ocultan por CSS sin desmontar nada el agente
  de la terminal, el riel de conexiones SSH y el riel lateral izquierdo (de ahí que "Acoplar" pase
  al menú); el conmutador al otro panel pasa a la cabecera como botón de solo icono. Funciona en
  cualquier tamaño de ventana y se impone sola por debajo de `ANCHO_COMPLETA_FRANJA_MIN`
  (`TERMINAL_JUNTO_AL_AGENTE + ANCHO_CC_MIN`, medido en el ancho de la hija): entonces la parte
  principal queda deshabilitada con el tooltip que lo explica, y la flecha sigue sirviendo para
  acoplar. La elección es por perfil y efímera: no se persiste, y acoplar y volver a desacoplar en
  la misma ejecución la conserva. La decisión de qué controles lleva cada cabecera y barra en cada
  caso (principal, principal a pantalla completa, hija completa, hija compacta pedida e impuesta) vive en las funciones
  puras `casoDeControlesFranja`, `controlesDeFranja` y `vistaDeFranjaDesacoplada`
  (`franjaDesacoplada.ts`, con sus casos en `test-franja-desacoplada.mts`). Las entradas y salidas
  siguen `movimiento.css`: cada cambio de vista (compacta, agente, panel) es una transición de vista del
  documento de la hija (`cambioDeVistaFranja` y `useVistaFranjaConTransicion`), más la entrada de paneles y
  `.control-plegable`. La cabecera de la terminal de la hija no repite el proyecto activo: lo dice su pie.
- En la barra de tareas de Windows, cada perfil desacoplado tiene su propio botón. El AppUserModelID
  de la franja lleva un sufijo derivado del id del perfil mediante un hash hexadecimal. Si se ancla
  el botón, abre Tessera sin argumentos o trae al frente la instancia abierta. En desarrollo el
  ejecutable es el de Electron, por lo que la entrada no lleva un comando de relanzamiento.
- En Windows y Linux, el proceso principal compone el icono con el color guardado del perfil para el
  disco de la insignia y elige el tono de flecha con mayor contraste. Al guardar un cambio de color,
  actualiza la ventana desacoplada. Windows guarda el ICO de relanzamiento por color en
  `userData/iconos-franja`. Si falta el color, es inválido o falla la personalización, se registra
  el error y la ventana usa el icono fijo de reserva (`tessera-franja.ico` o `tessera-franja.png`).
  macOS conserva el icono único de la aplicación en el Dock.
- Hay un anfitrión por perfil para la franja y un anfitrión por pane del agente de la terminal. Cada
  portal conserva su propio contenedor. Se adopta el anfitrión entero a su nuevo documento y se
  cuelga del hueco que corresponde. El anfitrión avisa tras cada traslado y el montaje común llama
  a `open` en cada xterm vivo, incluidos los ocultos. Un xterm cuyo anfitrión nace directamente en
  una ventana hija (como el diálogo de inicio de sesión de cuenta) recibe `documentOverride` con el
  documento de su nodo y crea su `ResizeObserver` en su ventana desde el principio. El ajuste y el
  foco usan la ventana del pane; cada riel busca el panel solo en su propio documento. Los
  observadores de tamaño se recrean al cambiar de ventana. La visibilidad y los límites de tamaño
  se derivan de la ventana que lo aloja. Git·Log se monta bajo demanda y el pane se conserva al devolverlo aunque
  en la principal se esté viendo otro perfil.
- La principal abre `about:blank` con un nombre que identifica el perfil. La hija comparte el
  renderer, carece de API de preload y recibe del main el marco, su tamaño mínimo (460 × 280,
  suficiente para la vista compacta) y el zoom. El título del documento incluye siempre el perfil.
  Se reflejan hojas de estilo y atributos de la raíz sin copiar scripts ni las clases de transición de
  la principal. El `base` conserva las rutas de los recursos y la tinta sale del perfil dueño. La barra
  de título queda vacía y sirve para arrastrar la ventana y alojar los botones del sistema.
- Atajos: en la principal, con la franja del perfil activo desacoplada, `Ctrl` + `` ` `` cambia la
  hija a la terminal si mostraba Git·Log, la trae al frente a través del main
  (`CANALES_FRANJA.TRAER_AL_FRENTE`, validando que la petición llega del marco principal y apunta a
  una hija registrada) y enfoca la terminal. En la hija, Ctrl+Alt+B / ⌥⌘B conmuta el agente del
  perfil en vista completa. `Mod+Shift+↩` se consume sin efecto para que el Intro no llegue al pty.
- El riel de la principal, el de la hija, el menú de la vista compacta y su cierre nativo ejecutan el mismo acople. Para la ✕, el main
  cancela el cierre nativo y pide el acople a la principal, salvo durante el cierre de la app.
  El renderer devuelve los anfitriones y confirma que se puede destruir la hija. Una recarga
  devuelve los anfitriones cuando sale el documento principal y destruye las hijas al confirmarse
  la navegación. Al acoplar se restaura el panel que se veía sin pantalla completa.
  Las hijas duran lo que la principal y quedan fuera del censo de ventanas de agente.
- La baja de una hija devuelve a la principal los diálogos globales y los avisos pendientes.
  El portal de cada diálogo conserva sus nodos, sus datos y su sesión.
- El lanzador de conexiones SSH se abre y se cierra por perfil.
- Desde Git·Log desacoplado, el historial de un archivo abre un diálogo con su lista y su diff
  en la principal y la trae al frente. El visor usa las hojas dinámicas y el entorno de Monaco
  de esa ventana.
- El agente de terminal desacoplado queda fuera del mosaico. Su pane visible participa en el
  despertar al empezar a mostrarse y en la actividad cuando su ventana tiene el foco. La vista
  compacta oculta ese pane también para la actividad y la gestión de WebGL. Su cabecera
  permite ampliar el agente y restaurar las terminales en la hija, o terminar solo la sesión del
  agente. Al cerrar la última terminal con el agente visible, la terminal se pliega y el agente
  ocupa el espacio restante. Cada xterm devuelve su contexto WebGL al ocultarse y puede recuperarlo
  al mostrarse en cualquiera de las ventanas.
- El desacople es efímero y cada arranque empieza acoplado.

## Verificación

El spec comprueba la identidad de las sesiones y el pintado de shell y agente después de mover los
panes y de cambiar de proyecto o perfil. Cubre el título del documento, la barra de título vacía,
el conmutador del agente, el cierre de la última terminal, el pie y la cabecera a 460 px, los
controles de cada cabecera y del riel en cada caso y el icono de la vista frente al de la columna
del agente. El movimiento de cada cambio de vista, a mitad de transición y con las animaciones encendidas,
está en `e2e/movimiento.spec.ts`. Cubre también la
navegación cancelada, el diálogo SSH que vuelve al acoplar, el lanzador por perfil, el historial de
archivo en la principal y la salida nueva del pty en la hija con la principal minimizada o tapada
(en Linux, solo tapada: su suite corre en Xvfb, sin gestor de ventanas que minimice).
La suite incluye la adopción del xterm y los gestos de teclado en Windows, Linux y macOS.
En macOS y Linux quedan por verificar en el paquete el renderizado WebGL, el zoom y los
controles de ventana.
