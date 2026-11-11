# Cada proyecto recuerda dónde se quedó: pestañas del editor, carpetas del explorador y terminales

- **Estado:** vigente
- **Ámbito:** `src/shared/sesionProyecto.ts`, el slice `sesiones` de `src/shared/workspace-state-ipc.ts` y de `src/main/workspace/workspaceStateStore.ts`, `src/renderer/src/features/sesion/`, `features/editor/cursorPorArchivo.ts`, el modo inicial del pane (`EditorPane`, `useVistaDelPane`, `useCargaDelPane`), la poda por pane de `useEditorApp.ts`, `features/explorador/store.ts`, `restaurarTerminales` de `features/terminales/shellTerminalsModel.ts` y `e2e/sesion-proyecto.spec.ts`

## Contexto

Los proyectos abiertos de cada perfil ya volvían al arrancar, pero vacíos: sin los archivos que se
estaban leyendo, con el árbol plegado y con una sola terminal. Volver a encontrar el sitio cada
mañana es justo lo que un IDE evita.

## Decisión

- **Qué se recuerda, por perfil y proyecto** (`perfil|ruta`): las pestañas de archivo del editor en
  su orden, la activa, el modo de vista de cada una cuando no es el de serie y la posición del
  cursor; las carpetas desplegadas del explorador; y las terminales locales, cuántas, sus nombres,
  la activa y su sitio en la tira, intercaladas con las SSH
  ([terminales/pestanas-ssh-del-perfil.md](../terminales/pestanas-ssh-del-perfil.md)). Los shells
  vuelven nuevos: un proceso no se puede recuperar.
- **Qué no**: los diffs y los archivos sin título (no son un archivo que se pueda reabrir), el
  contenido sin guardar (el cierre ya pregunta), las pestañas de bases de datos
  (`bd/ui-area-estado-de-la-vista.md`) y lo que se maximizó.
- **Un tercer slice del archivo** (`sesiones`), con su canal (`LOAD_SESIONES`/`SAVE_SESIONES`), y no un
  ajuste más: así la feature no depende de Configuración (que ya depende de media aplicación) y no se
  cierra un ciclo entre barriles. El store del main preserva el slice al guardar los otros dos, y al
  guardar el esqueleto poda las sesiones de los proyectos que ya no están abiertos.
- **Todo lo que llega se sanea** (`normalizarSesion`): solo rutas relativas al proyecto, sin `..`,
  barras invertidas, unidades ni rutas absolutas; sin repetidas; con topes (50 pestañas, 500
  carpetas, 12 terminales). Las rutas se piden después por el camino de siempre (`resolveSafe`), así
  que un archivo editado a mano no puede abrir nada fuera del proyecto.
- **Al arrancar solo se carga el proyecto activo**: las pestañas de cada proyecto vuelven la primera
  vez que se ve, y las terminales, la primera vez que se ve con el panel abierto (en el mismo punto
  que la primera terminal de serie, así que restaurar no arranca shells que nadie mira). Hasta
  entonces su sesión se vuelve a guardar tal cual. Las carpetas se siembran todas: son datos.
- **Las pestañas restauradas se mezclan con las que ya haya** (un archivo abierto desde el sistema
  antes de que llegue la sesión): las guardadas que falten van delante y la activa sigue siendo la que
  ya lo era. Las terminales solo se recrean sobre la primera de serie, que conserva su id y su pane;
  nunca sobre terminales que el usuario ya tocó, ni en un proyecto en el que cerró todas.
- **El modo y el cursor viajan por el estado por pane**: el modo como modo inicial del pane (leído al
  montarse) y el cursor como un «revelar» que se aplica al cargar el archivo. La poda del estado por
  pane lee las pestañas del store y no de su render, porque corre justo después de restaurar con la
  lista anterior y se llevaría ese estado.
- **Cuándo se guarda**: con 300 ms de espera tras cada cambio de pestañas, modo, cursor, carpetas o
  terminales, y en el acto cuando empieza el cierre (el primer aviso de progreso del cierre), antes de
  que el main escriba el archivo. Antes de leer la sesión no se guarda nada: escribiría una vacía.
- La sesión no viaja en la copia de la configuración: sus rutas son de este equipo.

## Consecuencias

- `test-sesion-proyecto.mts` fija el saneado y la poda; `test-modelo-sesion.mts`, la traducción entre
  lo vivo y lo guardado y la recreación de las terminales; `e2e/sesion-proyecto.spec.ts`, el ciclo
  entero: dejar trabajo abierto, cerrar Tessera, reabrir con los mismos datos y encontrarlo igual.
- Algo nuevo que deba recordarse por proyecto es un campo más de `SesionProyecto`, con su saneado.

## Descartes

- Guardar la sesión dentro de los ajustes: obligaba a Configuración a conocer el editor, el explorador
  y las terminales, y cerraba un ciclo entre features.
- Restaurar todos los proyectos al arrancar: montaría un editor por cada archivo de cada proyecto.
- Conservar el contenido sin guardar en un archivo aparte: suma una vía de perder cambios sin que se vea.
