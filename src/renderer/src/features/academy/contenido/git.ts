// =============================================================================
// Tessera Academy · Git: los cambios, el descarte, ignorar, el historial, el historial de un
// archivo y los proyectos con varios repositorios.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`).
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Tessera enseña lo que cambió en tu repositorio y su historial. Desde aquí preparas, descartas e ignoras archivos; el commit lo haces en la terminal o se lo pides al agente.',
  secciones: [
    {
      ancla: 'cambios',
      titulo: 'Git · Cambios',
      bloques: [
        '**Git · Cambios**, en el riel de la izquierda, reparte lo que cambió en cuatro secciones: **Conflictos**, **Preparados**, **Cambios** y **Sin versionar**. Doble clic en un archivo abre su [diff](editor-y-explorador/diff).',
        {
          lista: [
            'Marca archivos con su casilla y usa los botones de la sección, como **Preparar 3** o **Quitar 3 de preparados**; quitar de preparados conserva los cambios.',
            'El clic derecho ofrece lo mismo para una fila; si la fila está marcada, actúa sobre todas las marcadas de su sección.',
            'Un archivo en conflicto se cierra con **Marcar como resuelto**. Ahí no se ofrece descartar: perderías la resolución.'
          ]
        },
        { nota: 'Tessera no tiene caja de commit: confirma lo preparado desde la [terminal](terminales) o pídeselo al agente del proyecto.' }
      ]
    },
    {
      ancla: 'descartar',
      titulo: 'Descartar: qué se pierde',
      bloques: [
        'Descartar devuelve un archivo a su versión del último commit. Lo que cambiaste sin confirmar se pierde y no se puede deshacer.',
        {
          lista: [
            'Un archivo que git ya conoce vuelve a su versión del último commit.',
            'Un archivo nuevo, sin versión a la que volver, se elimina del disco.'
          ]
        },
        'Siempre pregunta antes, en un solo diálogo que separa lo que vuelve atrás de lo que se borra. Si un archivo cambia mientras lo decides, ese no se toca y te lo dice.',
        'Lo mismo hace **Descartar cambios (vuelve a la versión de git)** en el menú del explorador.'
      ]
    },
    {
      ancla: 'ignorar',
      titulo: 'Ignorar archivos',
      bloques: [
        '**Agregar a .gitignore** lo ignora para todos los que usan el repositorio, porque ese archivo se sube con el resto. **Ignorar solo en este equipo (.git/info/exclude)** lo ignora solo en tu copia.',
        { nota: 'Un archivo que git ya sigue no se ignora así: se omite y te lo dice. Dejar de seguirlo sería sacarlo del repositorio, y los demás lo verían como un borrado.' }
      ]
    },
    {
      ancla: 'log',
      titulo: 'Git · Log: el historial',
      bloques: [
        '**Git · Log** abre el historial en la franja de abajo, en el mismo hueco que la terminal: se ve uno u otro. A la izquierda, las ramas; en el centro, los commits con su grafo; a la derecha, el detalle del commit elegido y sus archivos.',
        {
          lista: [
            'Filtra por rama (clic en una del árbol, o **Todas las ramas**), por **Usuario**, por **Fecha** o por **Texto o hash**.',
            'Al recorrer la lista con las flechas se abre el diff del commit en el que te paras.',
            '`Ctrl+C` o `⌘C` en la lista copia el hash completo del commit.',
            'Para ir rápido se cargan los últimos commits, y usuario, fecha y texto filtran solo lo cargado. **Cargar el historial completo** trae el resto.'
          ]
        },
        'Para verlo más grande, **Maximizar el panel de git** o `Ctrl+Shift+Enter` (`⇧⌘↩`) con el foco en el historial. Ocupa toda el área de trabajo sin cerrar nada.',
        { captura: 'git-log-con-diff', alt: 'Git · Log con la columna de ramas, la lista de commits con su grafo y el detalle de un commit, y su diff abierto arriba.' }
      ]
    },
    {
      ancla: 'historial-de-archivo',
      titulo: 'El historial de un archivo',
      bloques: [
        'Clic derecho en un archivo del explorador › **Historial del archivo** abre, junto al log, los commits que lo tocaron, también los de antes de un cambio de nombre. Elige uno para ver qué cambió en ese commit.'
      ]
    },
    {
      ancla: 'varios-repos',
      titulo: 'Varios repositorios en un proyecto',
      bloques: [
        'Si la carpeta del proyecto tiene varios repositorios dentro, también agrupados en subcarpetas (hasta cuatro niveles), **Git · Cambios** enseña solo los que tienen cambios, cada uno con su rama y una casilla para marcarlo entero.',
        'El historial es de un repositorio cada vez: elígelo en la columna de ramas o con el botón de su fila en **Git · Cambios**.'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Tessera shows what changed in your repository, and its history. Here you can stage, discard, and ignore files. To commit, use the terminal or ask the agent.',
  secciones: [
    {
      ancla: 'cambios',
      titulo: 'Git · Changes',
      bloques: [
        '**Git · Changes**, in the left rail, groups your changes into four sections: **Conflicts**, **Staged**, **Changes**, and **Untracked**. Double-click a file to open its [diff](editor-y-explorador/diff).',
        {
          lista: [
            'Select files with their check boxes and use the section buttons, such as **Stage 3** or **Unstage 3**; unstaging keeps your changes.',
            'Right-click a row for the same actions on that row; if the row is selected, the action applies to every selected row in its section.',
            'To close a conflict, use **Mark as resolved**. Discard is not available for conflicts, because you would lose the resolution.'
          ]
        },
        { nota: 'Tessera has no commit box: commit your staged changes from the [terminal](terminales), or ask the project’s agent to do it.' }
      ]
    },
    {
      ancla: 'descartar',
      titulo: 'Discard: what you lose',
      bloques: [
        'Discarding reverts a file to its version in the last commit. Any uncommitted changes are lost, and you cannot undo this.',
        {
          lista: [
            'A file that Git already tracks reverts to its version in the last commit.',
            'A new file, which has no earlier version, is deleted from disk.'
          ]
        },
        'Tessera always asks you first, in a single dialog that lists separately the files that revert and the files that are deleted. If a file changes while you decide, Tessera skips it and tells you.',
        '**Discard changes (restore the Git version)** in the explorer menu does the same.'
      ]
    },
    {
      ancla: 'ignorar',
      titulo: 'Ignore files',
      bloques: [
        '**Add to .gitignore** ignores the file for everyone who uses the repository, because that file is pushed with the rest of the repository. **Ignore on this computer only (.git/info/exclude)** ignores it only in your copy.',
        { nota: 'You cannot ignore a file that Git already tracks this way: Tessera skips it and tells you. To stop tracking it, you would have to remove it from the repository, and everyone else would see that as a deletion.' }
      ]
    },
    {
      ancla: 'log',
      titulo: 'Git · Log: the history',
      bloques: [
        '**Git · Log** opens the history in the bottom strip, in the same place as the terminal, so you see one or the other. On the left are the branches; in the middle, the commits with their graph; on the right, the details and files of the selected commit.',
        {
          lista: [
            'Filter by branch (click a branch in the tree, or **All branches**), by **User**, by **Date**, or by **Text or hash**.',
            'When you move through the list with the arrow keys, the diff of the commit you stop on opens.',
            '`Ctrl+C` or `⌘C` in the list copies the full hash of the commit.',
            'To stay fast, the log loads only the latest commits, and the user, date, and text filters apply only to what is loaded. **Load full history** loads the rest.'
          ]
        },
        'To enlarge it, use **Maximize Git panel**, or press `Ctrl+Shift+Enter` (`⇧⌘↩`) while the history has focus. The history fills the whole work area without closing anything.',
        { captura: 'git-log-con-diff', alt: 'Git · Log with the branches column, the commit list with its graph, the details of a commit, and its diff open above.' }
      ]
    },
    {
      ancla: 'historial-de-archivo',
      titulo: 'File history',
      bloques: [
        'Right-click a file in the explorer and select **File history** to see, next to the log, the commits that changed it, including commits from before it was renamed. Select a commit to see what changed in it.'
      ]
    },
    {
      ancla: 'varios-repos',
      titulo: 'Several repositories in one project',
      bloques: [
        'If the project folder contains several repositories, including repositories grouped in subfolders (up to four levels deep), **Git · Changes** shows only those with changes, each with its branch and a check box to select all its changes.',
        'The history shows one repository at a time: choose it in the branches column, or with the button on its row in **Git · Changes**.'
      ]
    }
  ]
}

export const txGit = crearTextos(es, en)
