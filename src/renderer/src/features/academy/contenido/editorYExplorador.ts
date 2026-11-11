// =============================================================================
// Tessera Academy · Editor y explorador: el editor, los visores, el diff, el explorador de
// archivos y la búsqueda en archivos.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`).
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'El editor abre el código con resaltado de sintaxis y los documentos en un visor propio. El explorador crea, mueve, copia y elimina los archivos del proyecto. Nada de esto requiere salir de Tessera.',
  secciones: [
    {
      ancla: 'editor',
      titulo: 'El editor',
      bloques: [
        'Un clic en un archivo del explorador lo abre en una pestaña del proyecto. El editor resalta la sintaxis de muchos lenguajes, busca y reemplaza, y guarda con `Ctrl+S` o `⌘S`.',
        {
          lista: [
            'La barra de estado muestra la codificación y el fin de línea del archivo. Un clic en la codificación permite reabrir el archivo con otra o convertirlo; un clic en el fin de línea permite cambiarlo.',
            'Si un agente u otro programa modifica el archivo, la pestaña se actualiza automáticamente, salvo que tenga cambios sin guardar: en ese caso, su contenido no se modifica.',
            'Si el archivo se elimina del disco, la pestaña permanece abierta con el nombre tachado y conserva los cambios sin guardar. Al guardar, el archivo se crea de nuevo y la marca desaparece.',
            '`Ctrl+N` o `⌘N` abre una pestaña **Sin título-1**, que todavía no es un archivo en el disco. Para guardarla, use **Guardar como…** en el menú contextual de la pestaña.',
            'Al volver a abrir Tessera, cada proyecto recupera los archivos que tenía abiertos, con el que se estaba viendo, su modo de vista y la línea del cursor, y las carpetas desplegadas del explorador. Los archivos sin título, los diffs y los cambios sin guardar no se recuperan.',
            'El tema, la fuente y el tamaño del código se eligen en **Configuración › Apariencia › Editor de código**, con una vista previa del tema, y se aplican al momento al editor, a los diffs, a los visores, a los bloques de código de la vista previa de Markdown y a los editores de bases de datos. Un tema cambia los colores del texto: el fondo es siempre el de Tessera, y las terminales conservan sus colores. El tamaño de letra del explorador está en **Configuración › Apariencia › Tamaño y escala**.'
          ]
        },
        { nota: 'Un archivo de más de 2 MiB se abre truncado (solo su inicio) y no se puede guardar, porque se perdería la parte que no se cargó.' }
      ]
    },
    {
      ancla: 'visores',
      titulo: 'Visores y vista previa',
      bloques: [
        'En un archivo Markdown, los tres botones de icono de la derecha de la tira de pestañas eligen el modo (su nombre aparece al pasar el puntero): líneas de texto (**Solo editor**), panel dividido (**Editor y vista previa**, con el desplazamiento sincronizado) y página (**Solo vista previa**). La vista previa dibuja los diagramas Mermaid: con los colores de Tessera o, si el diagrama declara su propio tema, con los suyos y sobre su fondo.',
        'Un archivo HTML se previsualiza de forma aislada: su JavaScript no se ejecuta, y un aviso indica qué recursos no se cargan.',
        'Sin instalar nada se pueden ver PDF, Word (`.docx`), ZIP, imágenes con zoom, audio y vídeo. Los archivos `.jar`, `.war`, `.ear` y `.aar` se despliegan en el explorador como si fueran carpetas. Los archivos `.class` se descompilan al abrirlos, para lo cual se necesita Java instalado en {tuEquipo}.',
        { nota: 'Los visores admiten archivos de hasta 50 MiB. Si un archivo supera ese tamaño o no se muestra correctamente, **Abrir externamente** lo abre con su aplicación predeterminada del sistema.' },
        { captura: 'editor-markdown-dividido', alt: 'Un archivo Markdown en modo Editor y vista previa: el código a la izquierda y la vista renderizada a la derecha.' }
      ]
    },
    {
      ancla: 'diff',
      titulo: 'Comparar cambios',
      bloques: [
        'Un diff muestra dos versiones de un archivo con sus diferencias marcadas. Se abre desde [Git](git): con doble clic en un archivo de **Git · Cambios**, o en **Git · Historial**, con un clic en un commit o en uno de sus archivos.',
        'Si el espacio disponible es suficiente, el diff se muestra lado a lado; en una columna estrecha, unificado (las dos versiones en una sola columna). Los botones con dos columnas (**Vista lado a lado**) y una columna (**Vista unificada**) de su cabecera cambian el modo al instante; ese cambio se mantiene hasta que el ancho vuelve a cruzar el límite entre los dos modos. No están disponibles si un lado no existe, como en un archivo nuevo o eliminado.',
        {
          lista: [
            '`F7` y `Mayús+F7` saltan al cambio siguiente y al anterior.',
            'El botón de contraer de la cabecera (**Contraer los fragmentos sin cambios (4 líneas de contexto)**) queda pulsado mientras está activo y deja a la vista lo que cambió y unas pocas líneas alrededor. El mismo botón, **Mostrar el archivo completo**, deshace el efecto.',
            'El botón del lápiz (**Ir al archivo fuente (lo abre en la línea visible en pantalla)**), en la cabecera, abre el archivo en la línea visible en pantalla. No está disponible si el archivo se eliminó o si lo que se compara no es un archivo del proyecto. En un diff del historial, la línea corresponde a la revisión anterior y puede no coincidir exactamente.',
            'Una imagen se compara mostrando **Antes** y **Después**, y un archivo comprimido o un `.jar`, entrada por entrada.'
          ]
        },
        'En el diff de los cambios sin confirmar del disco, el lado derecho se puede editar. Es el mismo archivo que el de su pestaña normal, de modo que guardar en cualquiera de las dos guarda ambas. Los diffs de los archivos preparados y del historial son de solo lectura.'
      ]
    },
    {
      ancla: 'explorador',
      titulo: 'El explorador de archivos',
      bloques: [
        'El explorador muestra el proyecto en forma de árbol, con el color del estado de Git en archivos y carpetas. El clic derecho permite crear archivos y carpetas (sobre una carpeta o sobre el espacio vacío), renombrar, copiar la ruta o abrir el elemento en {gestorArchivos}.',
        {
          lista: [
            '`Ctrl`-clic o `⌘`-clic añade o quita un elemento de la selección, y `Mayús`-clic selecciona un rango. Estos clics no abren el archivo.',
            'Para mover elementos, arrástrelos a otra carpeta. Si algún nombre ya existe en el destino no se mueve ninguno, y un aviso indica qué nombres coinciden.',
            'Para copiar archivos al proyecto, suéltelos desde {gestorArchivos}. Si ya existen, Tessera pregunta antes de reemplazarlos, porque el contenido anterior no se puede recuperar.',
            'También se pueden arrastrar archivos del explorador hacia {gestorArchivos} o hacia otra aplicación.'
          ]
        }
      ]
    },
    {
      ancla: 'copiar-y-borrar',
      titulo: 'Copiar, pegar y borrar',
      bloques: [
        'Copiar, cortar y pegar funcionan dentro del explorador con el menú contextual o con el teclado (`Ctrl+C`, `Ctrl+X`, `Ctrl+V`, o las mismas teclas con `⌘`). Sobre una carpeta se pega dentro de ella; sobre un archivo, junto a él. Si en el destino ya existe un elemento con ese nombre, el elemento pegado se renombra y no se sobrescribe nada.',
        'Los archivos copiados en {gestorArchivos} se pueden pegar en Tessera, y una imagen copiada se pega con la opción **Pegar imagen** del menú contextual del explorador; esa opción solo aparece si hay una imagen en el portapapeles. En sentido inverso no ocurre lo mismo: copiar en Tessera deja las rutas como texto en el portapapeles, para pegarlas en el editor o en un agente.',
        { nota: '**Eliminar archivo…** (o la tecla `Supr`, o `⌘⌫`) pide confirmación siempre y borra del disco sin pasar por {papelera}. Esta acción no se puede deshacer.' },
        'En un archivo modificado que no está en conflicto, el menú contextual ofrece también **Descartar cambios (restaura la versión de Git)**. Qué se pierde lo explica [Git](git/descartar).'
      ]
    },
    {
      ancla: 'buscar',
      titulo: 'Buscar en archivos',
      bloques: [
        '`Ctrl+Mayús+F` o `⇧⌘F` abre **Buscar en archivos**, que muestra resultados a medida que se escribe. Seleccione **En el proyecto** para buscar en todo el proyecto, o **En una carpeta** para limitar la búsqueda a una carpeta de cualquier proyecto abierto. Si selecciona una carpeta de otro proyecto, ese proyecto pasa a ser el activo.',
        {
          lista: [
            'El botón Aa distingue mayúsculas de minúsculas. También se puede buscar la palabra completa o una expresión regular.',
            'La búsqueda encuentra también nombres de archivo, y busca dentro de los `.jar` y de las clases compiladas.',
            '↑ y ↓ recorren los resultados con una vista previa en vivo. Intro o doble clic abre el archivo en la coincidencia, y Esc cierra la búsqueda.'
          ]
        }
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'The editor opens code with syntax highlighting and documents in their own viewer. The explorer creates, moves, copies, and deletes project files. You can do all this without leaving Tessera.',
  secciones: [
    {
      ancla: 'editor',
      titulo: 'The editor',
      bloques: [
        'Click a file in the explorer to open it in a project tab. The editor highlights the syntax of many languages, supports find and replace, and saves with `Ctrl+S` or `⌘S`.',
        {
          lista: [
            'The status bar shows the file’s encoding and line endings. Click the encoding to reopen the file with another one or to convert it; click the line endings to change them.',
            'If an agent or another program changes the file, the tab updates automatically, unless it has unsaved changes: in that case, its content is left as it is.',
            'If the file is deleted from disk, the tab stays open with its name struck through and keeps any unsaved changes. Saving creates the file again and removes the mark.',
            '`Ctrl+N` or `⌘N` opens an **Untitled-1** tab, which is not yet a file on disk. To save it, use **Save as…** in the tab’s context menu.',
            'When Tessera opens again, each project gets back the files it had open, with the one in view, its view mode and the cursor line, and the explorer folders that were expanded. Untitled files, diffs and unsaved changes are not brought back.',
            'Choose the code theme, font and size in **Settings › Appearance › Code editor**, with a preview of the theme; they apply at once to the editor, diffs, viewers, the code blocks in the Markdown preview and the database editors. A theme changes the text colors: the background is always Tessera’s, and the terminals keep their colors. The explorer font size is in **Settings › Appearance › Size and scale**.'
          ]
        },
        { nota: 'A file larger than 2 MiB opens truncated (only its beginning) and cannot be saved, because the part that was not loaded would be lost.' }
      ]
    },
    {
      ancla: 'visores',
      titulo: 'Viewers and preview',
      bloques: [
        'In a Markdown file, the three icon buttons on the right of the tab strip choose the mode (their names appear on hover): text lines (**Editor only**), a split panel (**Editor and preview**, with synchronized scrolling), and a page (**Preview only**). The preview renders Mermaid diagrams: with Tessera’s colors or, if the diagram declares its own theme, with its own colors on its own background.',
        'An HTML file is previewed in isolation: its JavaScript does not run, and a notice lists the resources that are not loaded.',
        'PDF, Word (`.docx`), ZIP, images (with zoom), audio, and video files open without installing anything. `.jar`, `.war`, `.ear`, and `.aar` files expand in the explorer as if they were folders. `.class` files are decompiled when you open them, which requires Java installed on {tuEquipo}.',
        { nota: 'Viewers support files up to 50 MiB. If a file exceeds that size or does not display correctly, **Open externally** opens it in its default system application.' },
        { captura: 'editor-markdown-dividido', alt: 'A Markdown file in Editor and preview mode: the source on the left and the rendered view on the right.' }
      ]
    },
    {
      ancla: 'diff',
      titulo: 'Compare changes',
      bloques: [
        'A diff shows two versions of a file with their differences marked. You open it from [Git](git): double-click a file in **Git · Changes**, or in **Git · History**, click a commit or one of its files.',
        'When there is enough space, the diff is side by side; in a narrow column, it is unified (both versions in one column). The two-column (**Side-by-side view**) and single-column (**Unified view**) buttons in its header switch the mode immediately; that choice lasts until the width crosses the limit between the two modes again. They are unavailable when one side does not exist, as with a new or deleted file.',
        {
          lista: [
            '`F7` and `Shift+F7` go to the next and previous change.',
            'The collapse button in the header (**Collapse unchanged sections (4 lines of context)**) stays pressed while active and leaves visible what changed and a few lines around it. The same button, **Show full file**, reverses the effect.',
            'The pencil button (**Jump to source (opens the file at the line you are viewing)**), in the header, opens the file at the line visible on screen. It is not available if the file was deleted or if what is being compared is not a project file. In a diff from the history, the line belongs to the older revision and may not match exactly.',
            'Images are compared by showing **Before** and **After**, and archives or `.jar` files are compared entry by entry.'
          ]
        },
        'In the diff of uncommitted changes on disk, you can edit the right side. It is the same file as its regular tab, so saving in either place saves both. Diffs of staged files and of the history are read-only.'
      ]
    },
    {
      ancla: 'explorador',
      titulo: 'The file explorer',
      bloques: [
        'The explorer shows the project as a tree, with Git status colors on files and folders. Right-click to create files and folders (on a folder or on empty space), rename, copy the path, or open the item in {gestorArchivos}.',
        {
          lista: [
            '`Ctrl`+click or `⌘`+click adds an item to the selection or removes it, and `Shift`+click selects a range. These clicks do not open the file.',
            'To move items, drag them to another folder. If any name already exists at the destination, nothing is moved, and a notice lists the names that conflict.',
            'To copy files into the project, drop them from {gestorArchivos}. If they already exist, Tessera asks before replacing them, because the previous content cannot be recovered.',
            'You can also drag files from the explorer to {gestorArchivos} or to another application.'
          ]
        }
      ]
    },
    {
      ancla: 'copiar-y-borrar',
      titulo: 'Copy, paste, and delete',
      bloques: [
        'Copy, cut, and paste work inside the explorer from the context menu or the keyboard (`Ctrl+C`, `Ctrl+X`, `Ctrl+V`, or the same keys with `⌘`). On a folder, items are pasted inside it; on a file, next to it. If an item with the same name already exists at the destination, the pasted item is renamed, and nothing is overwritten.',
        'Files you copy in {gestorArchivos} can be pasted into Tessera, and a copied image can be pasted with the **Paste image** option in the explorer’s context menu; that option appears only when the clipboard contains an image. The reverse does not work the same way: copying in Tessera puts the paths on the clipboard as text, so you can paste them into the editor or an agent.',
        { nota: '**Delete file…** (or the `Del` key, or `⌘⌫`) always asks for confirmation and deletes from disk without using {papelera}. This cannot be undone.' },
        'For a modified file that is not in conflict, the context menu also offers **Discard changes (restore the Git version)**. [Git](git/descartar) explains what you lose.'
      ]
    },
    {
      ancla: 'buscar',
      titulo: 'Search in files',
      bloques: [
        '`Ctrl+Shift+F` or `⇧⌘F` opens **Search in files**, which shows results as you type. Select **In the project** to search the whole project, or **In a folder** to limit the search to a folder in any open project. If you select a folder in another project, that project becomes the active one.',
        {
          lista: [
            'The Aa button matches case. You can also search for whole words or use a regular expression.',
            'The search also finds file names, and looks inside `.jar` files and compiled classes.',
            '↑ and ↓ move through the results with a live preview. Enter or a double-click opens the file at the match, and Esc closes the search.'
          ]
        }
      ]
    }
  ]
}

export const txEditorYExplorador = crearTextos(es, en)
