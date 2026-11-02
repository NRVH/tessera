// =============================================================================
// Tessera Academy · Editor y explorador: el editor, los visores, el diff, el explorador de
// archivos y la búsqueda en archivos.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`).
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'El editor abre el código con resaltado y los documentos con su visor, y el explorador crea, mueve, copia y borra los archivos del proyecto. Todo sin salir de Tessera.',
  secciones: [
    {
      ancla: 'editor',
      titulo: 'El editor',
      bloques: [
        'Un clic en un archivo del explorador lo abre en una pestaña del proyecto. El editor resalta la sintaxis de muchos lenguajes, busca y reemplaza, y guarda con `Ctrl+S` o `⌘S`.',
        {
          lista: [
            'La barra de estado enseña la codificación y el fin de línea del archivo; con un clic lo reabres con otra codificación o lo conviertes.',
            'Si un agente u otro programa cambia el archivo, la pestaña se actualiza sola. Si tienes cambios sin guardar, no se tocan.',
            'Si el archivo se borra del disco, la pestaña se queda con el nombre tachado y tus cambios siguen ahí: guardar lo vuelve a crear.',
            '`Ctrl+N` o `⌘N` abre una pestaña **Sin título-1**; se guarda con **Guardar como…** en el menú de su pestaña.'
          ]
        },
        { nota: 'Un archivo de más de 2 MiB se abre truncado y no se puede guardar: se perdería lo que no se cargó.' }
      ]
    },
    {
      ancla: 'visores',
      titulo: 'Visores y vista previa',
      bloques: [
        'Un Markdown tiene tres modos: **Solo editor**, **Editor y vista previa** (con el scroll sincronizado) y **Solo vista previa**, con los diagramas Mermaid dibujados. Un HTML se previsualiza aislado: su JavaScript no se ejecuta y un aviso dice qué recursos no se cargan.',
        'Sin instalar nada se ven PDF, Word (`.docx`), ZIP, imágenes con zoom, audio y vídeo. Los `.jar`, `.war`, `.ear` y `.aar` se abren en el explorador como carpetas, y los `.class` se descompilan al abrirlos.',
        { nota: 'Los visores muestran hasta 50 MiB. Si algo no se ve como esperas, **Abrir externamente** lo abre con su aplicación del sistema.' },
        { captura: 'editor-markdown-dividido', alt: 'Un Markdown en modo Editor y vista previa: el código a la izquierda y la vista renderizada a la derecha.' }
      ]
    },
    {
      ancla: 'diff',
      titulo: 'Comparar cambios',
      bloques: [
        'Un diff se abre desde [Git](git): doble clic en un archivo de **Git · Cambios** o en uno de un commit. Si hay sitio se ve lado a lado y, en una columna estrecha, unificado; el botón de su cabecera cambia de modo al momento.',
        {
          lista: [
            '`F7` y `Shift+F7` saltan al cambio siguiente y al anterior.',
            '**Colapsar los fragmentos sin cambios** deja a la vista solo lo que cambió.',
            '**Saltar al fuente** abre el archivo en la línea que estás mirando.',
            'Una imagen se compara **Antes** y **Después**, y un comprimido o un `.jar`, por entradas.'
          ]
        },
        'En el diff de tus cambios sin confirmar, el lado derecho se puede editar: es el mismo archivo que su pestaña normal, así que guardar en cualquiera de los dos guarda los dos. Los diffs del índice y del historial son de solo lectura.'
      ]
    },
    {
      ancla: 'explorador',
      titulo: 'El explorador de archivos',
      bloques: [
        'El explorador enseña el proyecto en árbol, con el color de estado de git en archivos y carpetas. El clic derecho crea, renombra, copia la ruta o abre el elemento en {gestorArchivos}.',
        {
          lista: [
            '`Ctrl`-clic o `⌘`-clic añade o quita un elemento de la selección, y `Mayús`-clic selecciona un rango.',
            'Arrastra para mover. Si algún nombre ya existe en el destino no se mueve nada, y te dice cuáles chocan.',
            'Suelta archivos desde {gestorArchivos} para copiarlos al proyecto; si ya existen, pregunta antes de reemplazarlos.',
            'También puedes arrastrar archivos del explorador hacia {gestorArchivos} o hacia otra aplicación.'
          ]
        }
      ]
    },
    {
      ancla: 'copiar-y-borrar',
      titulo: 'Copiar, pegar y borrar',
      bloques: [
        'Copiar, cortar y pegar funcionan dentro del explorador con el menú o con el teclado (`Ctrl+C`, `Ctrl+X`, `Ctrl+V`, o con `⌘`). Si pegas donde ya hay un archivo con ese nombre, la copia se renombra y no pisa nada.',
        'Lo que copias en {gestorArchivos} se pega en Tessera, y una imagen copiada se pega con **Pegar imagen**. Al revés no: copiar en Tessera deja las rutas como texto, para pegarlas en el editor o en un agente.',
        { nota: '**Eliminar archivo…** (o la tecla de borrar) pregunta siempre y borra del disco sin pasar por {papelera}: no se puede deshacer.' },
        'Con un archivo modificado, el menú ofrece también **Descartar cambios (vuelve a la versión de git)**; qué se pierde lo explica [Git](git/descartar).'
      ]
    },
    {
      ancla: 'buscar',
      titulo: 'Buscar en archivos',
      bloques: [
        '`Ctrl+Shift+F` o `⇧⌘F` abre **Buscar en archivos**, que busca mientras escribes. Elige **En el proyecto** o **En una carpeta**, de cualquier proyecto abierto; elegir una carpeta de otro proyecto lo activa.',
        {
          lista: [
            'Aa distingue mayúsculas, y también puedes buscar la palabra completa o una expresión regular.',
            'Encuentra también por nombre de archivo, dentro de los `.jar` y en las clases compiladas.',
            '↑ y ↓ recorren los resultados con la vista previa en vivo; Enter o doble clic abre el archivo en la coincidencia, y Esc cierra.'
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
            'The status bar shows the file’s encoding and line endings; click them to reopen the file with another encoding or to convert it.',
            'If an agent or another program changes the file, the tab updates automatically. If you have unsaved changes, Tessera keeps them.',
            'If the file is deleted from disk, the tab stays open with its name struck through, and your changes are kept: saving creates the file again.',
            '`Ctrl+N` or `⌘N` opens an **Untitled-1** tab; to save it, use **Save as…** in its tab menu.'
          ]
        },
        { nota: 'A file larger than 2 MiB opens truncated and cannot be saved, because the part that was not loaded would be lost.' }
      ]
    },
    {
      ancla: 'visores',
      titulo: 'Viewers and preview',
      bloques: [
        'A Markdown file has three modes: **Editor only**, **Editor and preview** (with synchronized scrolling), and **Preview only**, and Mermaid diagrams are rendered. An HTML file is previewed in isolation: its JavaScript does not run, and a notice lists the resources that were not loaded.',
        'PDF, Word (`.docx`), ZIP, images (with zoom), audio, and video files open without installing anything. `.jar`, `.war`, `.ear`, and `.aar` files open in the explorer as folders, and `.class` files are decompiled when you open them.',
        { nota: 'Viewers can display files up to 50 MiB. If a file does not look as expected, **Open externally** opens it in its default system application.' },
        { captura: 'editor-markdown-dividido', alt: 'A Markdown file in Editor and preview mode: the source on the left and the rendered view on the right.' }
      ]
    },
    {
      ancla: 'diff',
      titulo: 'Compare changes',
      bloques: [
        'You open a diff from [Git](git): double-click a file in **Git · Changes** or in a commit. When there is enough space, the diff is side by side; in a narrow column, it is unified. The button in its header switches between the two modes.',
        {
          lista: [
            '`F7` and `Shift+F7` go to the next and previous change.',
            '**Collapse unchanged sections** shows only what changed.',
            '**Jump to source** opens the file at the line you are viewing.',
            'Images are compared **Before** and **After**, and archives or `.jar` files are compared entry by entry.'
          ]
        },
        'In the diff of your uncommitted changes, you can edit the right side: it is the same file as its regular tab, so saving in either place saves both. Diffs of the index and of the history are read-only.'
      ]
    },
    {
      ancla: 'explorador',
      titulo: 'The file explorer',
      bloques: [
        'The explorer shows the project as a tree, with Git status colors on files and folders. Right-click an item to create, rename, copy its path, or open it in {gestorArchivos}.',
        {
          lista: [
            '`Ctrl`+click or `⌘`+click adds an item to the selection or removes it, and `Shift`+click selects a range.',
            'Drag items to move them. If any name already exists at the destination, nothing is moved, and Tessera tells you which names conflict.',
            'Drop files from {gestorArchivos} to copy them into the project; if they already exist, Tessera asks before replacing them.',
            'You can also drag files from the explorer to {gestorArchivos} or to another application.'
          ]
        }
      ]
    },
    {
      ancla: 'copiar-y-borrar',
      titulo: 'Copy, paste, and delete',
      bloques: [
        'Copy, cut, and paste work inside the explorer from the menu or the keyboard (`Ctrl+C`, `Ctrl+X`, `Ctrl+V`, or the same keys with `⌘`). If you paste where a file with the same name already exists, the copy is renamed, and nothing is overwritten.',
        'Files you copy in {gestorArchivos} can be pasted into Tessera, and a copied image can be pasted with **Paste image**. The reverse does not work: copying in Tessera copies the paths as text, so you can paste them into the editor or an agent.',
        { nota: '**Delete file…** (or the Delete key) always asks you first, and then deletes from disk without using {papelera}. You cannot undo it.' },
        'For a modified file, the menu also offers **Discard changes (restore the Git version)**; [Git](git/descartar) explains what you lose.'
      ]
    },
    {
      ancla: 'buscar',
      titulo: 'Search in files',
      bloques: [
        '`Ctrl+Shift+F` or `⇧⌘F` opens **Search in files**, which searches as you type. Choose **In the project** or **In a folder**, in any open project; if you choose a folder in another project, that project becomes the active one.',
        {
          lista: [
            'Aa matches case, and you can also search for whole words or use a regular expression.',
            'It also finds files by name, and searches inside `.jar` files and compiled classes.',
            '↑ and ↓ move through the results with a live preview; Enter or a double-click opens the file at the match, and Esc closes the search.'
          ]
        }
      ]
    }
  ]
}

export const txEditorYExplorador = crearTextos(es, en)
