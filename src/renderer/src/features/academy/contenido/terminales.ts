// =============================================================================
// Tessera Academy · Terminales: el panel de abajo, sus pestañas, copiar y pegar, el resaltado,
// la pantalla completa con su agente y las terminales SSH del perfil.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`).
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'El panel inferior es su propia terminal: {shellNativa} en la carpeta del proyecto, con varias pestañas que siguen en ejecución aunque no estén visibles en pantalla.',
  secciones: [
    {
      ancla: 'panel',
      titulo: 'El panel de terminal',
      bloques: [
        'Para abrirlo, haga clic en **Terminal** en la barra de iconos de la izquierda, o pulse `Ctrl` y la tecla del acento grave (también `Ctrl`, no `⌘`, en Mac). Cada proyecto tiene sus terminales, que se inician en su carpeta.',
        'La terminal es siempre [nativa](glosario/nativo), aunque el agente del proyecto se ejecute en Docker: usa las herramientas instaladas en el equipo y tiene el mismo acceso que usted.',
        'El panel comparte la franja inferior con **Git · Log**: abrir uno sustituye al otro. Ocultar el panel no cierra nada, y las terminales siguen en ejecución.'
      ]
    },
    {
      ancla: 'pestanas',
      titulo: 'Pestañas, reiniciar y cerrar',
      bloques: [
        {
          lista: [
            '**Nueva terminal** abre otra pestaña; las demás siguen en ejecución.',
            'Haga doble clic en una pestaña para cambiarle el nombre.',
            '**Reiniciar terminal** cierra la shell y lo que se ejecuta en ella, y abre una nueva en la misma pestaña, con la pantalla limpia.',
            'Cerrar una pestaña detiene lo que se esté ejecutando en ella.'
          ]
        },
        'Cambiar de proyecto o de perfil no cierra las terminales: siguen en segundo plano. [Hibernar el perfil](hibernar/perfil) sí las cierra, y al reanudarlo vuelven vacías.'
      ]
    },
    {
      ancla: 'copiar-y-pegar',
      titulo: 'Copiar, pegar y buscar',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+C` con texto seleccionado copia; sin selección, interrumpe el programa, como en cualquier terminal.',
            '`Ctrl+V` pega y `Ctrl+F` busca en la salida de la terminal.',
            'Con el foco en la terminal, `Ctrl+N` llega a la shell y no crea un archivo.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⌘C` copia lo seleccionado; `⌃C` sigue interrumpiendo el programa.',
            '`⌘V` pega y `⌘F` busca en la salida de la terminal; `⌃V` y `⌃F` llegan a la shell.',
            '`⌘N` crea un archivo nuevo aunque el foco esté en la terminal.'
          ]
        },
        'Al pegar un archivo o una imagen, se escribe su ruta. El clic derecho ofrece **Copiar** y **Pegar**, salvo si el programa en ejecución usa el ratón: en ese caso, el clic llega al programa, y el menú se abre con `Mayús` y clic derecho.'
      ]
    },
    {
      ancla: 'resaltado',
      titulo: 'Logs con color',
      bloques: [
        'La salida sin color se resalta: los errores en rojo, los avisos en amarillo, lo que terminó bien en verde, y las fechas, los procesos, las rutas y las direcciones IP en su propio color. También ocurre en las sesiones SSH.',
        'El texto no cambia, así que se copia exactamente lo que salió. El resaltado no afecta a la salida que ya trae color ni a los programas que ocupan toda la terminal. Se desactiva en **Configuración › Terminales › Resaltar logs y salidas**, donde también se eligen la fuente y el tamaño.'
      ]
    },
    {
      ancla: 'pantalla-completa',
      titulo: 'Pantalla completa y su agente',
      bloques: [
        '**Maximizar el panel de terminal**, o `Ctrl+Mayús+Intro` (`⇧⌘↩`) con el foco en la terminal, extiende la terminal a toda el área de trabajo sin cerrar nada de lo que queda oculto. El mismo botón o la misma combinación de teclas la restaura.',
        'A pantalla completa, la barra de proyectos se oculta para dejar más alto a la terminal, y en la barra de iconos de la izquierda solo queda la flecha **Volver al proyecto**, que cierra la terminal. Al volver a abrirla, sigue a pantalla completa. **Git · Log** se comporta igual.',
        'A pantalla completa, a la derecha está el agente de la terminal: un agente propio del perfil, con su carpeta y su historial, al que se puede pedir ayuda con sus servidores sin abrir un proyecto. Llega a los servidores con [tssh](herramientas-de-los-agentes/tssh).',
        {
          lista: [
            'Se muestra y se oculta con `Ctrl+Alt+B` (`⌥⌘B`) o desde la barra de estado. Ocultarlo, o salir de la pantalla completa, no lo cierra.',
            '**Cerrar el agente de la terminal** termina su sesión y libera su memoria; la conversación queda en el historial.'
          ]
        },
        { captura: 'terminal-pantalla-completa', alt: 'La terminal a pantalla completa, con la lista de conexiones SSH a la izquierda y el agente de la terminal a la derecha.' }
      ]
    },
    {
      ancla: 'ssh',
      titulo: 'Terminales SSH',
      bloques: [
        'Las conexiones SSH pertenecen al perfil: sus pestañas se ven en todos sus proyectos, incluso sin ningún proyecto abierto. Para abrirlas, use **Conexiones SSH** en la cabecera del panel o, a pantalla completa, la lista fija de la izquierda.',
        'Si la sesión se corta, pulse Intro en ella o haga clic en **Reconectar**. Al abrir Tessera se restauran las pestañas, pero cada una no se conecta hasta que se selecciona. El resto se explica en [Conexiones SSH](ssh).'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'The bottom panel is your own terminal: {shellNativa} in the project folder, with several tabs that keep running even when they are not visible on screen.',
  secciones: [
    {
      ancla: 'panel',
      titulo: 'The terminal panel',
      bloques: [
        'To open it, click **Terminal** in the icon bar on the left, or press `Ctrl` and the backtick key (also `Ctrl`, not `⌘`, on a Mac). Each project has its own terminals, which start in the project folder.',
        'The terminal is always [native](glosario/nativo), even if the project’s agent runs in Docker: it uses your tools and has the same access you have.',
        'The panel shares the bottom strip with **Git · Log**: opening one replaces the other. Hiding the panel does not close anything, and the terminals keep running.'
      ]
    },
    {
      ancla: 'pestanas',
      titulo: 'Tabs, restart, and close',
      bloques: [
        {
          lista: [
            '**New terminal** opens another tab; the other tabs keep running.',
            'Double-click a tab to rename it.',
            '**Restart terminal** closes the shell and anything running in it, and opens a new shell in the same tab, with a clear screen.',
            'Closing a tab stops anything that is running in it.'
          ]
        },
        'Switching projects or profiles does not close the terminals: they keep running in the background. [Hibernating the profile](hibernar/perfil) does close them, and they return empty when you resume the profile.'
      ]
    },
    {
      ancla: 'copiar-y-pegar',
      titulo: 'Copy, paste, and search',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+C` copies the selected text; with nothing selected, it interrupts the program, as in any terminal.',
            '`Ctrl+V` pastes, and `Ctrl+F` searches the terminal output.',
            'When the terminal has focus, `Ctrl+N` goes to the shell and does not create a file.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⌘C` copies the selection; `⌃C` still interrupts the program.',
            '`⌘V` pastes, and `⌘F` searches the terminal output; `⌃V` and `⌃F` go to the shell.',
            '`⌘N` creates a new file even when the terminal has focus.'
          ]
        },
        'Pasting a file or an image types its path. Right-click to see **Copy** and **Paste**, unless the running program uses the mouse: in that case, the click goes to the program, and you open the menu with `Shift` and right-click.'
      ]
    },
    {
      ancla: 'resaltado',
      titulo: 'Colored logs',
      bloques: [
        'Output without color is highlighted: errors in red, warnings in yellow, successes in green, and dates, processes, paths, and IP addresses in their own colors. This also applies to SSH sessions.',
        'The text itself does not change, so you copy exactly what was printed. Highlighting does not affect output that already has color or programs that take over the whole terminal. To turn it off, go to **Settings › Terminals › Highlight logs and output**, where you can also choose the font and size.'
      ]
    },
    {
      ancla: 'pantalla-completa',
      titulo: 'Full screen and the terminal agent',
      bloques: [
        '**Maximize terminal panel**, or `Ctrl+Shift+Enter` (`⇧⌘↩`) while the terminal has focus, expands the terminal over the whole work area without closing anything it covers. The same button or key combination restores it.',
        'In full screen, the project bar is hidden to give the terminal more height, and the icon bar on the left keeps only the **Back to the project** arrow, which closes the terminal. When you open it again, it is still in full screen. **Git · Log** works the same way.',
        'In full screen, the terminal agent is on the right: a profile-level agent, with its own folder and history, that you can ask for help with your servers without opening a project. It reaches the servers through [tssh](herramientas-de-los-agentes/tssh).',
        {
          lista: [
            'Show or hide it with `Ctrl+Alt+B` (`⌥⌘B`) or from the status bar. Hiding it, or leaving full screen, does not close it.',
            '**Close the terminal agent** ends its session and frees its memory; the conversation stays in the history.'
          ]
        },
        { captura: 'terminal-pantalla-completa', alt: 'The terminal in full screen, with the list of SSH connections on the left and the terminal agent on the right.' }
      ]
    },
    {
      ancla: 'ssh',
      titulo: 'SSH terminals',
      bloques: [
        'SSH connections belong to the profile: their tabs appear in all the profile’s projects, even when no project is open. To open them, use **SSH connections** in the panel header or, in full screen, the fixed list on the left.',
        'If the session drops, press Enter in it or click **Reconnect**. When Tessera opens, the tabs are restored, but each one does not connect until you select it. For everything else, see [SSH connections](ssh).'
      ]
    }
  ]
}

export const txTerminales = crearTextos(es, en)
