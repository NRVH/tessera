// =============================================================================
// Tessera Academy · Atajos de teclado: los principales, con las teclas de cada plataforma en
// bloques propios (la familia de Ctrl y la de ⌘). Los acordes salen de `util/atajos.ts`: si
// cambia uno allí, cambia aquí.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Los principales atajos de teclado de Tessera, con las teclas de {tuEquipo}. Para respetar las convenciones de cada sistema, algunas acciones usan otra tecla además de otro modificador. Un mismo atajo puede hacer cosas distintas según dónde esté el foco; cada apartado lo indica.',
  secciones: [
    {
      ancla: 'generales',
      titulo: 'Generales',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+,` abre o cierra **Configuración**.',
            '`Ctrl+Mayús+F` abre **Buscar en archivos**.',
            '`Ctrl+N` abre una pestaña de archivo sin título o, en la vista de bases de datos, crea una consola nueva.',
            '`Ctrl` y la tecla del acento grave muestran u ocultan el panel de terminal. En la vista de bases de datos, cambian a la vista de archivos y abren el panel.',
            '`Ctrl+=`, `Ctrl+-` y `Ctrl+0` acercan, alejan y restablecen el zoom; `Ctrl` con la rueda del ratón también cambia el zoom.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⌘,` abre o cierra **Configuración**.',
            '`⇧⌘F` abre **Buscar en archivos**.',
            '`⌘N` abre una pestaña de archivo sin título o, en la vista de bases de datos, crea una consola nueva.',
            '`⌃` y la tecla del acento grave muestran u ocultan el panel de terminal: con `⌘`, el sistema cambiaría de ventana. En la vista de bases de datos, cambian a la vista de archivos y abren el panel.',
            '`⌘=`, `⌘-` y `⌘0` acercan, alejan y restablecen el zoom; `⌘` con la rueda, o el gesto de pellizcar en el trackpad, también cambia el zoom.'
          ]
        },
        { nota: 'Con el [mosaico](glosario/mosaico) activo no tienen efecto los atajos de **Buscar en archivos**, de la pestaña o consola nueva ni del panel de terminal.' }
      ]
    },
    {
      ancla: 'mosaico',
      titulo: 'Mosaico de agentes',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+Mayús+M` entra en el [mosaico](mosaico) o sale de él.',
            '`Ctrl+1` a `Ctrl+6`, dentro del mosaico, llevan el foco a una casilla.',
            '`Ctrl+Mayús+Intro`, dentro del mosaico, amplía la casilla enfocada o la restaura.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⇧⌘M` entra en el [mosaico](mosaico) o sale de él.',
            '`⌘1` a `⌘6`, dentro del mosaico, llevan el foco a una casilla.',
            '`⇧⌘↩`, dentro del mosaico, amplía la casilla enfocada o la restaura.'
          ]
        }
      ]
    },
    {
      ancla: 'terminal-y-git',
      titulo: 'Terminal y Git · Historial',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+Mayús+Intro`, con el foco en la terminal o en **Git · Historial**, pone el panel a pantalla completa o lo restaura.',
            '`Ctrl+C` copia lo seleccionado en la terminal (sin selección, interrumpe el programa en curso) y `Ctrl+V` pega.',
            '`Ctrl+F` busca en la salida de una terminal de shell o SSH; en la terminal de un agente, la tecla llega al agente.',
            '`Ctrl+Alt+B`, con la terminal a pantalla completa, muestra u oculta el [agente de la terminal](glosario/agente-de-la-terminal).',
            '`Ctrl+C` en la lista de **Git · Historial** copia el hash completo del commit.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⇧⌘↩`, con el foco en la terminal o en **Git · Historial**, pone el panel a pantalla completa o lo restaura.',
            '`⌘C` copia lo seleccionado en la terminal y `⌘V` pega; `⌃C` interrumpe el programa en curso.',
            '`⌘F` busca en la salida de una terminal de shell o SSH; en la terminal de un agente, la tecla llega al agente.',
            '`⌥⌘B`, con la terminal a pantalla completa, muestra u oculta el [agente de la terminal](glosario/agente-de-la-terminal).',
            '`⌘C` en la lista de **Git · Historial** copia el hash completo del commit.'
          ]
        },
        { soloEn: ['windows', 'linux'], nota: 'Con el foco en la terminal, `Ctrl+N` llega a la shell y no abre una pestaña de archivo.' }
      ]
    },
    {
      ancla: 'editor-y-explorador',
      titulo: 'Editor y explorador',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+S` guarda el archivo.',
            '`F7` y `Mayús+F7` saltan al cambio siguiente y al anterior de un diff.',
            '`Ctrl+C`, `Ctrl+X` y `Ctrl+V` copian, cortan y pegan archivos en el explorador, y `Ctrl+A` selecciona todos los elementos visibles del árbol.',
            '`Supr` elimina lo seleccionado en el explorador, siempre con confirmación previa, y `Esc` vacía la selección.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⌘S` guarda el archivo.',
            '`F7` y `⇧F7` saltan al cambio siguiente y al anterior de un diff.',
            '`⌘C`, `⌘X` y `⌘V` copian, cortan y pegan archivos en el explorador, y `⌘A` selecciona todos los elementos visibles del árbol.',
            '`⌘⌫` elimina lo seleccionado en el explorador, siempre con confirmación previa, y `Esc` vacía la selección.'
          ]
        },
        'Puede encontrar más información en [Editor y explorador](editor-y-explorador).'
      ]
    },
    {
      ancla: 'bases-de-datos',
      titulo: 'Bases de datos',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+Intro` ejecuta la selección o la sentencia en la que está el cursor; `Alt+X` o `Ctrl+Mayús+Intro` ejecutan toda la consola.',
            '`Ctrl+F2` detiene la ejecución.',
            '`Ctrl+Alt+Mayús+K` confirma la transacción (commit) y `Ctrl+Alt+Mayús+R` la revierte (rollback).',
            '`Ctrl+Mayús+E` muestra el plan de ejecución sin ejecutar la sentencia, `Ctrl+Mayús+H` abre el historial de consultas y `Ctrl+Alt+L` da formato al SQL.',
            '`Ctrl+W` cierra la pestaña y `Ctrl+Alt+B` muestra u oculta el [agente de datos](glosario/agente-de-datos). Los dos atajos actúan solo en la vista de bases de datos.',
            '`F4` o `Intro` abre el elemento seleccionado en el árbol.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⌘↩` ejecuta la selección o la sentencia en la que está el cursor; `⌥X` o `⇧⌘↩` ejecutan toda la consola.',
            '`⌘.` detiene la ejecución.',
            '`⌥⇧⌘K` confirma la transacción (commit) y `⌥⇧⌘R` la revierte (rollback).',
            '`⇧⌘E` muestra el plan de ejecución sin ejecutar la sentencia, `⇧⌘H` abre el historial de consultas y `⌥⌘L` da formato al SQL.',
            '`⌘W` cierra la pestaña y `⌥⌘B` muestra u oculta el [agente de datos](glosario/agente-de-datos). Los dos atajos actúan solo en la vista de bases de datos.',
            '`F4`, `⌘↓` o `↩` abre el elemento seleccionado en el árbol.'
          ]
        },
        'El resto de la vista se explica en [Bases de datos](bases-de-datos).'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'The main keyboard shortcuts in Tessera, with the keys for {tuEquipo}. To follow the conventions of each operating system, some actions use a different key, not just a different modifier. The same shortcut can do different things depending on where the focus is; each section says so.',
  secciones: [
    {
      ancla: 'generales',
      titulo: 'General',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+,` opens or closes **Settings**.',
            '`Ctrl+Shift+F` opens **Search in files**.',
            '`Ctrl+N` opens an untitled file tab or, in the database view, creates a new console.',
            '`Ctrl` and the backtick key show or hide the terminal panel. In the database view, they switch to the files view and open the panel.',
            '`Ctrl+=`, `Ctrl+-`, and `Ctrl+0` zoom in, zoom out, and reset the zoom; `Ctrl` with the mouse wheel also changes the zoom.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⌘,` opens or closes **Settings**.',
            '`⇧⌘F` opens **Search in files**.',
            '`⌘N` opens an untitled file tab or, in the database view, creates a new console.',
            '`⌃` and the backtick key show or hide the terminal panel; with `⌘`, the system would switch windows instead. In the database view, they switch to the files view and open the panel.',
            '`⌘=`, `⌘-`, and `⌘0` zoom in, zoom out, and reset the zoom; `⌘` with the scroll wheel, or pinching on the trackpad, also changes the zoom.'
          ]
        },
        { nota: 'While the [mosaic](glosario/mosaico) is active, the shortcuts for **Search in files**, the new tab or console, and the terminal panel have no effect.' }
      ]
    },
    {
      ancla: 'mosaico',
      titulo: 'Agent mosaic',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+Shift+M` opens or closes the [mosaic](mosaico).',
            '`Ctrl+1` to `Ctrl+6`, inside the mosaic, move the focus to a tile.',
            '`Ctrl+Shift+Enter`, inside the mosaic, enlarges the focused tile or restores it.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⇧⌘M` opens or closes the [mosaic](mosaico).',
            '`⌘1` to `⌘6`, inside the mosaic, move the focus to a tile.',
            '`⇧⌘↩`, inside the mosaic, enlarges the focused tile or restores it.'
          ]
        }
      ]
    },
    {
      ancla: 'terminal-y-git',
      titulo: 'Terminal and Git · History',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+Shift+Enter`, when the terminal or **Git · History** has focus, switches the panel to full screen or restores it.',
            '`Ctrl+C` copies the selection in the terminal (with nothing selected, it interrupts the running program), and `Ctrl+V` pastes.',
            '`Ctrl+F` searches the output of a shell or SSH terminal; in an agent’s terminal, the key goes to the agent.',
            '`Ctrl+Alt+B`, with the terminal in full screen, shows or hides the [terminal agent](glosario/agente-de-la-terminal).',
            '`Ctrl+C` in the **Git · History** list copies the full commit hash.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⇧⌘↩`, when the terminal or **Git · History** has focus, switches the panel to full screen or restores it.',
            '`⌘C` copies the selection in the terminal, and `⌘V` pastes; `⌃C` interrupts the running program.',
            '`⌘F` searches the output of a shell or SSH terminal; in an agent’s terminal, the key goes to the agent.',
            '`⌥⌘B`, with the terminal in full screen, shows or hides the [terminal agent](glosario/agente-de-la-terminal).',
            '`⌘C` in the **Git · History** list copies the full commit hash.'
          ]
        },
        { soloEn: ['windows', 'linux'], nota: 'When the terminal has focus, `Ctrl+N` goes to the shell and does not open a file tab.' }
      ]
    },
    {
      ancla: 'editor-y-explorador',
      titulo: 'Editor and explorer',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+S` saves the file.',
            '`F7` and `Shift+F7` go to the next and previous change in a diff.',
            '`Ctrl+C`, `Ctrl+X`, and `Ctrl+V` copy, cut, and paste files in the explorer, and `Ctrl+A` selects all visible items in the tree.',
            '`Del` deletes the selection in the explorer, always after asking for confirmation, and `Esc` clears the selection.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⌘S` saves the file.',
            '`F7` and `⇧F7` go to the next and previous change in a diff.',
            '`⌘C`, `⌘X`, and `⌘V` copy, cut, and paste files in the explorer, and `⌘A` selects all visible items in the tree.',
            '`⌘⌫` deletes the selection in the explorer, always after asking for confirmation, and `Esc` clears the selection.'
          ]
        },
        'For more information, see [Editor and explorer](editor-y-explorador).'
      ]
    },
    {
      ancla: 'bases-de-datos',
      titulo: 'Databases',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+Enter` runs the selection or the statement at the cursor; `Alt+X` or `Ctrl+Shift+Enter` runs the whole console.',
            '`Ctrl+F2` stops the execution.',
            '`Ctrl+Alt+Shift+K` commits the transaction, and `Ctrl+Alt+Shift+R` rolls it back.',
            '`Ctrl+Shift+E` shows the execution plan without running the statement, `Ctrl+Shift+H` opens the query history, and `Ctrl+Alt+L` formats the SQL.',
            '`Ctrl+W` closes the tab, and `Ctrl+Alt+B` shows or hides the [data agent](glosario/agente-de-datos). Both shortcuts act only in the databases view.',
            '`F4` or `Enter` opens the selected item in the tree.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⌘↩` runs the selection or the statement at the cursor; `⌥X` or `⇧⌘↩` runs the whole console.',
            '`⌘.` stops the execution.',
            '`⌥⇧⌘K` commits the transaction, and `⌥⇧⌘R` rolls it back.',
            '`⇧⌘E` shows the execution plan without running the statement, `⇧⌘H` opens the query history, and `⌥⌘L` formats the SQL.',
            '`⌘W` closes the tab, and `⌥⌘B` shows or hides the [data agent](glosario/agente-de-datos). Both shortcuts act only in the databases view.',
            '`F4`, `⌘↓`, or `↩` opens the selected item in the tree.'
          ]
        },
        'For everything else about this view, see [Databases](bases-de-datos).'
      ]
    }
  ]
}

export const txAtajos = crearTextos(es, en)
