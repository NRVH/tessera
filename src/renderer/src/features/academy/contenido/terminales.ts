// =============================================================================
// Tessera Academy · Terminales: el panel de abajo, sus pestañas, copiar y pegar, el resaltado,
// la pantalla completa con su agente y las terminales SSH del perfil.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`).
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'La terminal de abajo es la tuya: {shellNativa} en la carpeta del proyecto, con varias pestañas que siguen corriendo aunque no las mires.',
  secciones: [
    {
      ancla: 'panel',
      titulo: 'El panel de terminal',
      bloques: [
        'Ábrelo con **Terminal** en el riel de la izquierda, o con `Ctrl` y la tecla del acento grave (también `Ctrl`, no `⌘`, en Mac). Cada proyecto tiene sus terminales, que arrancan en su carpeta.',
        'Es siempre [nativa](glosario/nativo), aunque el agente del proyecto corra en Docker: usa tus herramientas y tiene el mismo acceso que tú.',
        'Comparte la franja de abajo con **Git · Log**: abrir uno sustituye al otro. Ocultar el panel no cierra nada; las terminales siguen corriendo.'
      ]
    },
    {
      ancla: 'pestanas',
      titulo: 'Pestañas, reiniciar y cerrar',
      bloques: [
        {
          lista: [
            '**Nueva terminal** abre otra pestaña; las demás siguen corriendo.',
            'Doble clic en una pestaña para renombrarla.',
            '**Reiniciar terminal** cierra la shell y lo que corre en ella, y abre una nueva en la misma pestaña, con la pantalla limpia.',
            'Cerrar una pestaña mata lo que esté corriendo dentro.'
          ]
        },
        'Cambiar de proyecto o de perfil no las cierra: siguen en segundo plano. [Hibernar el perfil](hibernar/perfil) sí las cierra, y al reanudarlo vuelven vacías.'
      ]
    },
    {
      ancla: 'copiar-y-pegar',
      titulo: 'Copiar, pegar y buscar',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+C` con texto seleccionado copia; sin selección interrumpe el programa, como siempre.',
            '`Ctrl+V` pega y `Ctrl+F` busca en lo que ha salido por la terminal.',
            'Con el foco en la terminal, `Ctrl+N` es de la shell y no crea un archivo.'
          ]
        },
        {
          soloEn: ['mac'],
          lista: [
            '`⌘C` copia lo seleccionado; `⌃C` sigue interrumpiendo el programa.',
            '`⌘V` pega y `⌘F` busca en lo que ha salido por la terminal; `⌃V` y `⌃F` llegan a la shell.',
            '`⌘N` crea un archivo nuevo aunque el foco esté en la terminal.'
          ]
        },
        'Pegar un archivo o una imagen escribe su ruta. El clic derecho ofrece **Copiar** y **Pegar**, salvo si el programa de dentro usa el ratón: entonces el clic es suyo, y el menú sale con `Mayús` y clic derecho.'
      ]
    },
    {
      ancla: 'resaltado',
      titulo: 'Logs con color',
      bloques: [
        'Lo que llega sin color se resalta: errores en rojo, avisos en amarillo, lo que fue bien en verde, y fechas, procesos, rutas e IPs en su color, también por SSH.',
        'El texto no cambia, así que copias lo mismo que salió. No toca lo que ya trae color ni los programas a pantalla completa. Se apaga en **Configuración › Terminales › Resaltar logs y salidas**, donde también eliges la fuente y el tamaño.'
      ]
    },
    {
      ancla: 'pantalla-completa',
      titulo: 'Pantalla completa y su agente',
      bloques: [
        '**Maximizar el panel de terminal**, o `Ctrl+Shift+Enter` (`⇧⌘↩`) con el foco en la terminal, la extiende a toda el área de trabajo sin cerrar nada de lo que tapa. El mismo botón o acorde la restaura.',
        'A pantalla completa la barra de proyectos se aparta para dejarle su alto, y en la barra lateral solo queda la flecha **Volver al proyecto**, que cierra la terminal. Al volver a abrirla, sigue a pantalla completa. Git · Log se comporta igual.',
        'A pantalla completa tienes a la derecha el agente de la terminal: uno propio del perfil, con su carpeta y su historial, para pedir ayuda con tus servidores sin abrir un proyecto. Llega a ellos con [tssh](herramientas-de-los-agentes/tssh).',
        {
          lista: [
            'Se muestra y se oculta con `Ctrl+Alt+B` (`⌥⌘B`) o desde la barra de estado. Ocultarlo, o salir de pantalla completa, no lo cierra.',
            '**Cerrar el agente de la terminal** termina su sesión y libera su memoria; la conversación queda en el historial.'
          ]
        },
        { captura: 'terminal-pantalla-completa', alt: 'La terminal a pantalla completa, con el riel de conexiones SSH a la izquierda y el agente de la terminal a la derecha.' }
      ]
    },
    {
      ancla: 'ssh',
      titulo: 'Terminales SSH',
      bloques: [
        'Las conexiones SSH son del perfil: sus pestañas se ven en todos sus proyectos, también sin proyecto abierto. Ábrelas con **Conexiones SSH** en la cabecera del panel o, a pantalla completa, desde el riel de la izquierda.',
        'Si la sesión se corta, pulsa Intro en ella o **Reconectar**. Al abrir Tessera vuelven las pestañas, pero no se conectan hasta que las miras. Todo lo demás está en [Conexiones SSH](ssh).'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'The terminal at the bottom is yours: {shellNativa} in the project folder, with several tabs that keep running even when you are not viewing them.',
  secciones: [
    {
      ancla: 'panel',
      titulo: 'The terminal panel',
      bloques: [
        'To open it, click **Terminal** in the left rail, or press `Ctrl` and the backtick key (also `Ctrl`, not `⌘`, on a Mac). Each project has its own terminals, which start in the project folder.',
        'The terminal is always [native](glosario/nativo), even if the project’s agent runs in Docker: it uses your tools and has the same access you have.',
        'It shares the bottom strip with **Git · Log**: opening one replaces the other. Hiding the panel does not close anything; the terminals keep running.'
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
        'Switching projects or profiles does not close the terminals: they keep running in the background. [Hibernating the profile](hibernar/perfil) does close them, and they reopen empty when you resume the profile.'
      ]
    },
    {
      ancla: 'copiar-y-pegar',
      titulo: 'Copy, paste, and search',
      bloques: [
        {
          soloEn: ['windows', 'linux'],
          lista: [
            '`Ctrl+C` copies the selected text; with nothing selected, it interrupts the program, as usual.',
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
        'Pasting a file or an image types its path. Right-click to see **Copy** and **Paste**, unless the program in the terminal uses the mouse: in that case, the program receives the click, and you open the menu with `Shift` and right-click.'
      ]
    },
    {
      ancla: 'resaltado',
      titulo: 'Colored logs',
      bloques: [
        'Output without color is highlighted: errors in red, warnings in yellow, successes in green, and dates, processes, paths, and IP addresses in their own colors, also over SSH.',
        'The text itself does not change, so you copy exactly what was printed. Output that already has color and full-screen programs are not highlighted. To turn this off, go to **Settings › Terminals › Highlight logs and output**, where you can also choose the font and size.'
      ]
    },
    {
      ancla: 'pantalla-completa',
      titulo: 'Full screen and the terminal agent',
      bloques: [
        '**Maximize terminal panel**, or `Ctrl+Shift+Enter` (`⇧⌘↩`) while the terminal has focus, expands the terminal over the whole work area without closing anything it covers. The same button or key combination restores it.',
        'In full screen the project bar steps aside to give the terminal its height, and the sidebar keeps only the **Back to the project** arrow, which closes the terminal. When you open it again, it is still in full screen. Git · Log works the same way.',
        'In full screen, the terminal agent is on the right: a profile-level agent, with its own folder and history, that you can ask for help with your servers without opening a project. It reaches the servers through [tssh](herramientas-de-los-agentes/tssh).',
        {
          lista: [
            'Show or hide it with `Ctrl+Alt+B` (`⌥⌘B`) or from the status bar. Hiding it, or leaving full screen, does not close it.',
            '**Close the terminal agent** ends its session and frees its memory; the conversation stays in the history.'
          ]
        },
        { captura: 'terminal-pantalla-completa', alt: 'The terminal in full screen, with the SSH connections rail on the left and the terminal agent on the right.' }
      ]
    },
    {
      ancla: 'ssh',
      titulo: 'SSH terminals',
      bloques: [
        'SSH connections belong to the profile: their tabs appear in all the profile’s projects, even when no project is open. Open them with **SSH connections** in the panel header or, in full screen, from the rail on the left.',
        'If the session drops, press Enter in the tab or click **Reconnect**. When Tessera opens, the tabs are restored, but they do not connect until you switch to them. For everything else, see [SSH connections](ssh).'
      ]
    }
  ]
}

export const txTerminales = crearTextos(es, en)
