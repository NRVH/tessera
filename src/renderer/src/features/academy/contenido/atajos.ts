// =============================================================================
// Tessera Academy · Atajos de teclado: los principales, con las teclas de cada plataforma en
// bloques propios (la familia de Ctrl y la de ⌘). Los acordes salen de `util/atajos.ts`: si
// cambia uno allí, cambia aquí.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Los atajos de teclado principales de Tessera, con las teclas de {tuEquipo}: algunos gestos cambian de tecla, no solo de modificador, para seguir las costumbres de cada sistema.',
  secciones: [
    {
      ancla: 'generales',
      titulo: 'Generales',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+,` abre **Configuración**.',
            '`Ctrl+Shift+F` abre **Buscar en archivos**.',
            '`Ctrl+N` crea un archivo nuevo, o una consola nueva en la vista de bases de datos.',
            '`Ctrl` y la tecla del acento grave muestran u ocultan el panel de terminal.',
            '`Ctrl+=`, `Ctrl+-` y `Ctrl+0` acercan, alejan y restablecen el zoom; también `Ctrl` y la rueda del ratón.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⌘,` abre **Configuración**.',
            '`⇧⌘F` abre **Buscar en archivos**.',
            '`⌘N` crea un archivo nuevo, o una consola nueva en la vista de bases de datos.',
            '`⌃` y la tecla del acento grave muestran u ocultan el panel de terminal: con `⌘` el sistema cambiaría de ventana.',
            '`⌘=`, `⌘-` y `⌘0` acercan, alejan y restablecen el zoom; también `⌘` y la rueda, o pellizcando en el trackpad.'
          ]
        }
      ]
    },
    {
      ancla: 'mosaico',
      titulo: 'Mosaico de agentes',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+Shift+M` entra en el [mosaico](mosaico) o sale de él.',
            '`Ctrl+1` a `Ctrl+6` enfocan una casilla.',
            '`Ctrl+Shift+Enter` amplía la casilla enfocada o la restaura.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⇧⌘M` entra en el [mosaico](mosaico) o sale de él.',
            '`⌘1` a `⌘6` enfocan una casilla.',
            '`⇧⌘↩` amplía la casilla enfocada o la restaura.'
          ]
        }
      ]
    },
    {
      ancla: 'terminal-y-git',
      titulo: 'Terminal y Git · Log',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+Shift+Enter`, con el foco en la terminal o en **Git · Log**, los pone a pantalla completa o los restaura.',
            '`Ctrl+C` copia lo seleccionado en la terminal (sin selección, interrumpe), `Ctrl+V` pega y `Ctrl+F` busca.',
            '`Ctrl+Alt+B` muestra u oculta el agente de la terminal a pantalla completa.',
            '`Ctrl+C` en la lista de **Git · Log** copia el hash del commit.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⇧⌘↩`, con el foco en la terminal o en **Git · Log**, los pone a pantalla completa o los restaura.',
            '`⌘C` copia lo seleccionado en la terminal, `⌘V` pega y `⌘F` busca; `⌃C` interrumpe.',
            '`⌥⌘B` muestra u oculta el agente de la terminal a pantalla completa.',
            '`⌘C` en la lista de **Git · Log** copia el hash del commit.'
          ]
        },
        { soloEn: ['windows', 'linux'], nota: 'Con el foco en la terminal, `Ctrl+N` es de la shell y no crea un archivo.' }
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
            '`F7` y `Shift+F7` saltan al cambio siguiente y al anterior de un diff.',
            '`Ctrl+C`, `Ctrl+X` y `Ctrl+V` copian, cortan y pegan archivos en el explorador, y `Ctrl+A` selecciona todo lo desplegado.',
            '`Supr` borra lo seleccionado en el explorador, siempre preguntando antes, y `Esc` vacía la selección.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⌘S` guarda el archivo.',
            '`F7` y `⇧F7` saltan al cambio siguiente y al anterior de un diff.',
            '`⌘C`, `⌘X` y `⌘V` copian, cortan y pegan archivos en el explorador, y `⌘A` selecciona todo lo desplegado.',
            '`⌘⌫` borra lo seleccionado en el explorador, siempre preguntando antes, y `Esc` vacía la selección.'
          ]
        },
        'Más sobre el editor y el explorador en [Editor y explorador](editor-y-explorador).'
      ]
    },
    {
      ancla: 'bases-de-datos',
      titulo: 'Bases de datos',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+Enter` ejecuta la sentencia del cursor, y `Alt+X` o `Ctrl+Shift+Enter`, la consola entera.',
            '`Ctrl+F2` detiene la ejecución.',
            '`Ctrl+Alt+Shift+K` confirma la transacción (commit) y `Ctrl+Alt+Shift+R` la deshace (rollback).',
            '`Ctrl+Shift+E` enseña el plan de ejecución, `Ctrl+Shift+H` el historial de consultas y `Ctrl+Alt+L` formatea el SQL.',
            '`Ctrl+W` cierra la pestaña y `Ctrl+Alt+B` muestra u oculta el agente de datos.',
            '`F4` o `Enter` abre el elemento elegido en el árbol.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⌘↩` ejecuta la sentencia del cursor, y `⌥X` o `⇧⌘↩`, la consola entera.',
            '`⌘.` detiene la ejecución.',
            '`⌥⇧⌘K` confirma la transacción (commit) y `⌥⇧⌘R` la deshace (rollback).',
            '`⇧⌘E` enseña el plan de ejecución, `⇧⌘H` el historial de consultas y `⌥⌘L` formatea el SQL.',
            '`⌘W` cierra la pestaña y `⌥⌘B` muestra u oculta el agente de datos.',
            '`F4`, `⌘↓` o `↩` abre el elemento elegido en el árbol.'
          ]
        },
        'Todo lo demás de la vista, en [Bases de datos](bases-de-datos).'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'The main keyboard shortcuts in Tessera, with the keys for {tuEquipo}. To follow the conventions of each operating system, some actions use a different key, not just a different modifier.',
  secciones: [
    {
      ancla: 'generales',
      titulo: 'General',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+,` opens **Settings**.',
            '`Ctrl+Shift+F` opens **Search in files**.',
            '`Ctrl+N` creates a new file, or a new console in the database view.',
            '`Ctrl` and the backtick key show or hide the terminal panel.',
            '`Ctrl+=`, `Ctrl+-`, and `Ctrl+0` zoom in, zoom out, and reset the zoom; `Ctrl` with the mouse wheel also zooms.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⌘,` opens **Settings**.',
            '`⇧⌘F` opens **Search in files**.',
            '`⌘N` creates a new file, or a new console in the database view.',
            '`⌃` and the backtick key show or hide the terminal panel; with `⌘`, macOS would switch windows instead.',
            '`⌘=`, `⌘-`, and `⌘0` zoom in, zoom out, and reset the zoom; `⌘` with the scroll wheel, or pinching on the trackpad, also zooms.'
          ]
        }
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
            '`Ctrl+1` to `Ctrl+6` move the focus to a tile.',
            '`Ctrl+Shift+Enter` enlarges the focused tile or restores it.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⇧⌘M` opens or closes the [mosaic](mosaico).',
            '`⌘1` to `⌘6` move the focus to a tile.',
            '`⇧⌘↩` enlarges the focused tile or restores it.'
          ]
        }
      ]
    },
    {
      ancla: 'terminal-y-git',
      titulo: 'Terminal and Git · Log',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+Shift+Enter`, when the terminal or **Git · Log** has focus, switches it to full screen or restores it.',
            '`Ctrl+C` copies the selection in the terminal (with nothing selected, it interrupts the program), `Ctrl+V` pastes, and `Ctrl+F` searches.',
            '`Ctrl+Alt+B` shows or hides the terminal agent in full screen.',
            '`Ctrl+C` in the **Git · Log** list copies the commit hash.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⇧⌘↩`, when the terminal or **Git · Log** has focus, switches it to full screen or restores it.',
            '`⌘C` copies the selection in the terminal, `⌘V` pastes, and `⌘F` searches; `⌃C` interrupts the program.',
            '`⌥⌘B` shows or hides the terminal agent in full screen.',
            '`⌘C` in the **Git · Log** list copies the commit hash.'
          ]
        },
        { soloEn: ['windows', 'linux'], nota: 'When the terminal has focus, `Ctrl+N` goes to the shell and does not create a file.' }
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
            '`Ctrl+C`, `Ctrl+X`, and `Ctrl+V` copy, cut, and paste files in the explorer, and `Ctrl+A` selects all expanded items.',
            '`Del` deletes the selection in the explorer, always after asking you, and `Esc` clears the selection.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⌘S` saves the file.',
            '`F7` and `⇧F7` go to the next and previous change in a diff.',
            '`⌘C`, `⌘X`, and `⌘V` copy, cut, and paste files in the explorer, and `⌘A` selects all expanded items.',
            '`⌘⌫` deletes the selection in the explorer, always after asking you, and `Esc` clears the selection.'
          ]
        },
        'For more about the editor and the explorer, see [Editor and explorer](editor-y-explorador).'
      ]
    },
    {
      ancla: 'bases-de-datos',
      titulo: 'Databases',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+Enter` runs the statement at the cursor, and `Alt+X` or `Ctrl+Shift+Enter` runs the whole console.',
            '`Ctrl+F2` stops the execution.',
            '`Ctrl+Alt+Shift+K` commits the transaction, and `Ctrl+Alt+Shift+R` rolls it back.',
            '`Ctrl+Shift+E` shows the execution plan, `Ctrl+Shift+H` shows the query history, and `Ctrl+Alt+L` formats the SQL.',
            '`Ctrl+W` closes the tab, and `Ctrl+Alt+B` shows or hides the data agent.',
            '`F4` or `Enter` opens the selected item in the tree.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⌘↩` runs the statement at the cursor, and `⌥X` or `⇧⌘↩` runs the whole console.',
            '`⌘.` stops the execution.',
            '`⌥⇧⌘K` commits the transaction, and `⌥⇧⌘R` rolls it back.',
            '`⇧⌘E` shows the execution plan, `⇧⌘H` shows the query history, and `⌥⌘L` formats the SQL.',
            '`⌘W` closes the tab, and `⌥⌘B` shows or hides the data agent.',
            '`F4`, `⌘↓`, or `↩` opens the selected item in the tree.'
          ]
        },
        'For everything else about this view, see [Databases](bases-de-datos).'
      ]
    }
  ]
}

export const txAtajos = crearTextos(es, en)
