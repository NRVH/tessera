// =============================================================================
// Tessera Academy · Git: los cambios, el descarte, ignorar, el historial, el historial de un
// archivo y los proyectos con varios repositorios.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`).
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Tessera muestra lo que cambió en el repositorio y su historial. Desde estas vistas se preparan, descartan e ignoran archivos; el commit se crea en la terminal o se solicita al agente.',
  secciones: [
    {
      ancla: 'cambios',
      titulo: 'Git · Cambios',
      bloques: [
        '**Git · Cambios**, en el [riel](glosario/riel), agrupa lo que cambió en cuatro secciones:',
        {
          lista: [
            '**Conflictos**: archivos con un conflicto de combinación sin resolver.',
            '**Preparados**: lo que entrará en el próximo commit. Preparar equivale a `git add`.',
            '**Cambios**: modificaciones de archivos que Git ya rastrea, todavía sin preparar. Un archivo preparado y modificado después aparece aquí y también en **Preparados**.',
            '**Sin versionar**: archivos nuevos que Git todavía no rastrea.'
          ]
        },
        'Un doble clic en un archivo abre su [diff](editor-y-explorador/diff).',
        {
          lista: [
            'Para actuar sobre varios archivos, márquelos con su casilla y use los botones de la sección, como **Preparar 3** o **Quitar 3 de preparados**. Quitar de preparados conserva los cambios en el disco.',
            'El clic derecho ofrece las mismas acciones para una fila. Si la fila está marcada, la acción se aplica a todas las filas marcadas de su sección.',
            'Después de resolver un conflicto en el archivo, use **Marcar como resuelto**. En esa sección no se ofrece descartar, porque se perdería la resolución.'
          ]
        },
        { nota: 'Tessera no incluye un cuadro para crear commits. Para confirmar lo preparado, use la [terminal](terminales) o solicítelo al agente del proyecto.' }
      ]
    },
    {
      ancla: 'descartar',
      titulo: 'Descartar: qué se pierde',
      bloques: [
        'Descartar devuelve un archivo a su versión del último commit. Los cambios sin confirmar del archivo se pierden, incluidos los ya preparados, y la acción no se puede deshacer.',
        {
          lista: [
            'Un archivo que existe en el último commit vuelve a esa versión.',
            'Un archivo que no existe en el último commit (un archivo nuevo, aunque esté preparado) se elimina del disco.'
          ]
        },
        'Tessera pide confirmación siempre, en un solo diálogo que separa los archivos que se restauran de los que se eliminan. Si el estado de un archivo cambia mientras el diálogo está abierto, ese archivo no se modifica y un aviso lo indica.',
        'La acción se llama **Descartar cambios (restaura la versión de Git)** en el menú contextual de una fila de **Cambios** o **Sin versionar** y en el menú del explorador, y hace lo mismo en ambos. No se ofrece para archivos en conflicto.'
      ]
    },
    {
      ancla: 'ignorar',
      titulo: 'Ignorar archivos',
      bloques: [
        'El menú contextual de un archivo sin versionar ofrece dos opciones:',
        {
          lista: [
            '**Agregar a .gitignore** añade el archivo a `.gitignore`. Ese cambio es un cambio más del repositorio: afecta a todas las personas que usan el repositorio cuando se confirma y se sube.',
            '**Ignorar solo en este equipo (.git/info/exclude)** lo ignora solo en su copia del repositorio y no se comparte.'
          ]
        },
        { nota: 'Estas opciones solo actúan sobre archivos que Git no rastrea. Si entre los elegidos hay alguno que Git ya rastrea, se omite y un aviso lo indica: dejar de rastrearlo exigiría quitarlo del repositorio, y el resto del equipo lo vería como un borrado.' }
      ]
    },
    {
      ancla: 'log',
      titulo: 'Git · Log: el historial',
      bloques: [
        '**Git · Log**, en el [riel](glosario/riel), abre el historial en el [panel inferior](glosario/panel-inferior), el mismo espacio que la terminal: se muestra uno u otro. A la izquierda aparecen las ramas; en el centro, los commits con su grafo; a la derecha, el detalle del commit seleccionado y sus archivos.',
        {
          lista: [
            'Para filtrar, haga clic en una rama del árbol (o en **Todas las ramas**) o use **Usuario**, **Fecha** o **Texto o hash**.',
            'Al seleccionar un commit con un clic o con las flechas, se abre el diff de su primer archivo.',
            '`Ctrl+C` o `⌘C` con el foco en la lista copia el hash completo del commit, salvo que haya texto seleccionado en ella.',
            'Para mantener la velocidad, solo se cargan los últimos commits. Los filtros de usuario, fecha y texto se aplican únicamente a lo cargado, y un aviso lo indica; el filtro de rama consulta siempre el repositorio. **Cargar el historial completo** carga el resto.'
          ]
        },
        'Para ampliarlo, use **Maximizar el panel de Git** o pulse `Ctrl+Mayús+Intro` (`⇧⌘↩`) con el foco en el historial. El panel ocupa toda el área de trabajo sin cerrar nada, y **Restaurar el panel de Git** lo devuelve a su lugar.',
        { captura: 'git-log-con-diff', alt: 'Git · Log con la columna de ramas, la lista de commits con su grafo y el detalle de un commit, y su diff abierto arriba.' }
      ]
    },
    {
      ancla: 'historial-de-archivo',
      titulo: 'El historial de un archivo',
      bloques: [
        {
          pasos: [
            'Haga clic derecho en un archivo del explorador y seleccione **Historial del archivo**. Se abre una pestaña junto a **Git · Log** con los commits que modificaron el archivo, incluidos los anteriores a un cambio de nombre.',
            'Revise el commit más reciente, que queda seleccionado automáticamente, o seleccione otro. El diff muestra qué cambió en ese commit.'
          ]
        },
        'En un commit en el que el archivo tenía otro nombre puede no haber un cambio que comparar con el nombre actual. En ese caso, un aviso lo indica en lugar del diff.'
      ]
    },
    {
      ancla: 'varios-repos',
      titulo: 'Varios repositorios en un proyecto',
      bloques: [
        'Una carpeta de proyecto puede contener varios repositorios, también agrupados en subcarpetas (hasta cuatro niveles). Si la propia carpeta del proyecto ya es un repositorio, solo se tienen en cuenta los repositorios de su primer nivel.',
        '**Git · Cambios** muestra los repositorios que tienen cambios o un error, cada uno con su rama y una casilla para marcar todos sus archivos. Con más de 50 repositorios los muestra todos.',
        'El historial muestra un repositorio cada vez. Para cambiarlo, selecciónelo en la columna de ramas o use el botón de su fila en **Git · Cambios**.'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Tessera shows what changed in the repository, and its history. From these views you can stage, discard, and ignore files. To commit, use the terminal or ask the agent.',
  secciones: [
    {
      ancla: 'cambios',
      titulo: 'Git · Changes',
      bloques: [
        '**Git · Changes**, in the [rail](glosario/riel), groups your changes into four sections:',
        {
          lista: [
            '**Conflicts**: files with an unresolved merge conflict.',
            '**Staged**: what will go into the next commit. Staging is the same as `git add`.',
            '**Changes**: modifications to files that Git already tracks, not yet staged. A file that was staged and then modified appears here and also in **Staged**.',
            '**Untracked**: new files that Git does not track yet.'
          ]
        },
        'Double-click a file to open its [diff](editor-y-explorador/diff).',
        {
          lista: [
            'To act on several files, select them with their check boxes and use the section buttons, such as **Stage 3** or **Unstage 3**. Unstaging keeps your changes on disk.',
            'Right-click a row for the same actions on that row. If the row is selected, the action applies to every selected row in its section.',
            'After you resolve a conflict in the file, use **Mark as resolved**. Discard is not available in that section, because you would lose the resolution.'
          ]
        },
        { nota: 'Tessera has no box for creating commits. To commit your staged changes, use the [terminal](terminales), or ask the project’s agent to do it.' }
      ]
    },
    {
      ancla: 'descartar',
      titulo: 'Discard: what you lose',
      bloques: [
        'Discarding reverts a file to its version in the last commit. The file’s uncommitted changes are lost, including staged ones, and you cannot undo this.',
        {
          lista: [
            'A file that exists in the last commit reverts to that version.',
            'A file that does not exist in the last commit (a new file, even if staged) is deleted from disk.'
          ]
        },
        'Tessera always asks for confirmation, in a single dialog that lists separately the files that are restored and the files that are deleted. If a file’s state changes while the dialog is open, that file is left untouched and a notice says so.',
        'The action is called **Discard changes (restore the Git version)** in the context menu of a row in **Changes** or **Untracked** and in the explorer menu, and it does the same in both. It is not available for files in conflict.'
      ]
    },
    {
      ancla: 'ignorar',
      titulo: 'Ignore files',
      bloques: [
        'The context menu of an untracked file offers two options:',
        {
          lista: [
            '**Add to .gitignore** adds the file to `.gitignore`. That is a change to the repository like any other: it affects everyone who uses the repository once it is committed and pushed.',
            '**Ignore on this computer only (.git/info/exclude)** ignores it only in your copy of the repository and is not shared.'
          ]
        },
        { nota: 'These options act only on files that Git does not track. If your selection includes a file that Git already tracks, Tessera skips it and a notice says so: to stop tracking it, you would have to remove it from the repository, and everyone else would see that as a deletion.' }
      ]
    },
    {
      ancla: 'log',
      titulo: 'Git · Log: the history',
      bloques: [
        '**Git · Log**, in the [rail](glosario/riel), opens the history in the [bottom panel](glosario/panel-inferior), the same space as the terminal, so you see one or the other. On the left are the branches; in the middle, the commits with their graph; on the right, the details and files of the selected commit.',
        {
          lista: [
            'To filter, click a branch in the tree (or **All branches**), or use **User**, **Date**, or **Text or hash**.',
            'When you select a commit with a click or the arrow keys, the diff of its first file opens.',
            '`Ctrl+C` or `⌘C` with the focus on the list copies the full hash of the commit, unless text is selected in the list.',
            'To stay fast, only the latest commits are loaded. The user, date, and text filters apply only to what is loaded, and a notice says so; the branch filter always queries the repository. **Load full history** loads the rest.'
          ]
        },
        'To enlarge it, use **Maximize Git panel**, or press `Ctrl+Shift+Enter` (`⇧⌘↩`) while the history has focus. The panel fills the whole work area without closing anything, and **Restore Git panel** puts it back.',
        { captura: 'git-log-con-diff', alt: 'Git · Log with the branches column, the commit list with its graph, the details of a commit, and its diff open above.' }
      ]
    },
    {
      ancla: 'historial-de-archivo',
      titulo: 'File history',
      bloques: [
        {
          pasos: [
            'Right-click a file in the explorer and select **File history**. A tab opens next to **Git · Log** with the commits that changed the file, including commits from before it was renamed.',
            'Review the most recent commit, which is selected automatically, or select another one. The diff shows what changed in that commit.'
          ]
        },
        'In a commit where the file had another name, there may be no change to compare with the current name. In that case, a notice says so instead of showing the diff.'
      ]
    },
    {
      ancla: 'varios-repos',
      titulo: 'Several repositories in one project',
      bloques: [
        'A project folder can contain several repositories, including repositories grouped in subfolders (up to four levels deep). If the project folder is itself a repository, only the repositories in its first level are considered.',
        '**Git · Changes** shows the repositories with changes or an error, each with its branch and a check box to select all its files. With more than 50 repositories, it shows all of them.',
        'The history shows one repository at a time. To change it, select it in the branches column, or use the button on its row in **Git · Changes**.'
      ]
    }
  ]
}

export const txGit = crearTextos(es, en)
