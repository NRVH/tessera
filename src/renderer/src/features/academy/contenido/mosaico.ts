// =============================================================================
// Tessera Academy · Mosaico y ventanas de agente: varios agentes visibles al mismo tiempo, y un
// agente en una ventana aparte, sin proyecto.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`).
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'El mosaico muestra en una rejilla los agentes de varios proyectos para seguirlos simultáneamente. Una ventana de agente abre un agente por separado, sin proyecto.',
  secciones: [
    {
      ancla: 'entrar',
      titulo: 'Entrar y salir del mosaico',
      bloques: [
        'Haga clic en el primer botón de la barra de título, a la izquierda, para abrir el mosaico (el texto emergente indica «Mosaico de agentes: todas las terminales en ejecución visibles», seguido del atajo). No está disponible sin agentes en ejecución; antes debe [abrir un proyecto](proyectos/abrir) o [mostrar un agente de datos](bases-de-datos/agente-de-datos). También puede usar el teclado:',
        {
          lista: [
            '`Ctrl+Mayús+M` abre y cierra el mosaico.',
            '`Ctrl+1` a `Ctrl+6` llevan a la casilla con ese número, dentro del mosaico.',
            '`Ctrl+Mayús+Intro` amplía la casilla activa a todo el mosaico; la misma combinación la restaura.'
          ],
          soloEn: ['windows', 'linux']
        },
        {
          lista: [
            '`⇧⌘M` abre y cierra el mosaico.',
            '`⌘1` a `⌘6` llevan a la casilla con ese número, dentro del mosaico.',
            '`⇧⌘↩` amplía la casilla activa a todo el mosaico; la misma combinación la restaura.'
          ],
          soloEn: ['mac']
        },
        'Al abrirlo se muestran los proyectos cuyo agente está trabajando; si ninguno trabaja, el proyecto en el que se encontraba. Salir del mosaico no cierra nada: cada agente sigue como estaba.'
      ]
    },
    {
      ancla: 'casillas',
      titulo: 'Las casillas',
      bloques: [
        'Hay una casilla por proyecto, hasta seis, de cualquier perfil. El agente de la vista de bases de datos y el de la terminal de cada perfil cuentan como un proyecto más.',
        {
          lista: [
            'Su cabecera indica el perfil, el proyecto y el agente. Haga clic en el nombre del proyecto para elegir cuál se muestra en esa casilla.',
            'Si el proyecto tiene otro agente, la etiqueta del agente es un botón que lo muestra en la casilla; un punto en ella indica si ese otro agente trabaja, espera su respuesta o terminó.',
            '**Ir al proyecto** sale del mosaico y abre ese proyecto. Un doble clic en la cabecera amplía la casilla.',
            'Un punto señala un agente que terminó y aún no se ha revisado; desaparece al pasar a su casilla.'
          ]
        },
        { captura: 'mosaico', alt: 'El mosaico con cuatro agentes de dos perfiles en una rejilla de dos por dos' }
      ]
    },
    {
      ancla: 'elegir',
      titulo: 'Elegir qué se ve y cómo',
      bloques: [
        'El botón de la barra del mosaico con el número de casillas elegidas y el total de proyectos disponibles (por ejemplo, **2 de 8**) marca qué proyectos se muestran, como máximo seis. Si ya hay seis, añadir otro sustituye al usado hace más tiempo. Los proyectos sin agente en ejecución lo inician al añadirse, y los hibernados se reanudan. Ninguna casilla se añade automáticamente, y una casilla permanece aunque su agente se detenga: solo desaparece si usted la quita o si su proyecto se cierra o se hiberna.',
        'Los botones de icono de distribución de la barra del mosaico eligen la forma de la rejilla. Al pasar el puntero, cada botón indica su función: **Automático: distribuye según el número de agentes y la forma de la ventana**, **Cuadrícula: filas y columnas equilibradas (4 en 2 × 2, 6 en 3 × 2), aunque Automático prefiera otra forma**, **Columnas: todas lado a lado**, **Filas: todas una debajo de otra** o **Principal y pila: la primera grande a la izquierda y las demás apiladas a la derecha**. Si la seleccionada no cabe en la ventana, se usa el modo automático hasta que haya espacio disponible.'
      ]
    },
    {
      ancla: 'ventana-de-agente',
      titulo: 'Una ventana de agente',
      bloques: [
        'Una ventana de agente equivale a abrir una terminal y escribir `claude` o `codex`, pero con las funciones de la columna del agente: historial, conversación nueva, uso de la cuenta y pegado de imágenes. Sirve para una consulta rápida sin abrir un proyecto.',
        {
          lista: [
            'Siempre se ejecuta en {tuEquipo}, en su carpeta de usuario y con la cuenta de {tuEquipo}. Ofrece Claude Code, Codex y los [agentes propios](agentes/manuales) añadidos para {tuEquipo}.',
            'No tiene perfil ni proyecto: ni bases de datos, ni servidores SSH, ni reglas del perfil.',
            'Cada agente empieza con una conversación nueva, salvo al restaurarse la ventana tras reiniciar Tessera para actualizarla.',
            'La ventana sigue abierta aunque se cierre la ventana principal, y cerrarla solo cierra sus agentes.'
          ]
        }
      ]
    },
    {
      ancla: 'abrir-ventana',
      titulo: 'Abrir una ventana de agente',
      bloques: [
        'Dentro de Tessera, use **Nueva ventana de agente**, al pie de la lista de conexiones SSH: en el menú **▾** de la terminal o en el riel de la terminal a pantalla completa.',
        { p: 'También con Tessera cerrada: haga clic con el botón derecho en su icono de la barra de tareas y seleccione **Nueva ventana de agente**.', soloEn: ['windows'] },
        { p: 'También desde el menú del icono de Tessera en el Dock o desde **Ventana › Nueva ventana de agente**. Con Tessera cerrada no hay acceso directo.', soloEn: ['mac'] },
        { p: 'También con Tessera cerrada: haga clic con el botón derecho en Tessera en el lanzador de aplicaciones y seleccione **Nueva ventana de agente**.', soloEn: ['linux'] }
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'The mosaic shows the agents of several projects in a grid, so you can follow them all at once. An agent window opens a standalone agent, without a project.',
  secciones: [
    {
      ancla: 'entrar',
      titulo: 'Open and close the mosaic',
      bloques: [
        'Click the first button on the left of the title bar to open the mosaic (its tooltip says “Agent mosaic: every running terminal in view”, followed by the shortcut). It is unavailable without running agents; first [open a project](proyectos/abrir) or [show a data agent](bases-de-datos/agente-de-datos). You can also use the keyboard:',
        {
          lista: [
            '`Ctrl+Shift+M` opens and closes the mosaic.',
            '`Ctrl+1` to `Ctrl+6` go to the tile with that number, inside the mosaic.',
            '`Ctrl+Shift+Enter` enlarges the current tile to fill the mosaic; the same keys restore it.'
          ],
          soloEn: ['windows', 'linux']
        },
        {
          lista: [
            '`⇧⌘M` opens and closes the mosaic.',
            '`⌘1` to `⌘6` go to the tile with that number, inside the mosaic.',
            '`⇧⌘↩` enlarges the current tile to fill the mosaic; the same keys restore it.'
          ],
          soloEn: ['mac']
        },
        'When you open the mosaic, it shows the projects whose agent is working; if no agent is working, it shows the project you were in. Closing the mosaic does not close anything: each agent stays as it was.'
      ]
    },
    {
      ancla: 'casillas',
      titulo: 'Tiles',
      bloques: [
        'There is one tile per project, up to six, from any profile. The agent of the database view and the terminal agent of each profile each count as one more project.',
        {
          lista: [
            'The tile header shows the profile, project, and agent. Click the project name to choose which one appears in that tile.',
            'If the project has another agent, the agent label is a button that shows it in the tile; a dot on the label shows whether that other agent is working, is waiting for your reply, or has finished.',
            '**Go to project** closes the mosaic and opens that project. Double-click the header to enlarge the tile.',
            'A dot marks an agent that has finished when you have not reviewed its work yet; the dot disappears when you move to its tile.'
          ]
        },
        { captura: 'mosaico', alt: 'The mosaic with four agents from two profiles in a two-by-two grid' }
      ]
    },
    {
      ancla: 'elegir',
      titulo: 'Choose what appears and how',
      bloques: [
        'The button in the mosaic bar showing the selected tile count and the total available projects (for example, **2 of 8**) sets which projects appear, up to six. If there are already six, adding another replaces the least recently used one. Projects with no running agent start it when you add them, and hibernated ones resume. Tiles are never added automatically, and a tile stays even if its agent stops: it disappears only if you remove it or its project closes or hibernates.',
        'The layout icon buttons in the mosaic bar choose the grid shape. On hover, each button describes its function: **Automatic: arranges them by how many there are and the shape of the window**, **Grid: balanced rows and columns (4 in 2 × 2, 6 in 3 × 2), even if Automatic prefers another shape**, **Columns: all side by side**, **Rows: all one below the other**, or **Main and stack: the first one large on the left and the rest stacked on the right**. If the chosen layout does not fit in the window, the automatic layout is used until there is enough space.'
      ]
    },
    {
      ancla: 'ventana-de-agente',
      titulo: 'Agent windows',
      bloques: [
        'An agent window is like opening a terminal and typing `claude` or `codex`, but with the features of the agent column: history, new conversation, account usage, and pasting images. It is useful for a quick question without opening a project.',
        {
          lista: [
            'It always runs on {tuEquipo}, in your user folder, with the account on {tuEquipo}. It offers Claude Code, Codex, and the [custom agents](agentes/manuales) you added for {tuEquipo}.',
            'It has no profile or project: no databases, no SSH servers, and no profile rules.',
            'Each agent starts with a new conversation, except when the window is restored after Tessera restarts to update.',
            'The window stays open even if you close the main window, and closing it closes only its own agents.'
          ]
        }
      ]
    },
    {
      ancla: 'abrir-ventana',
      titulo: 'Open an agent window',
      bloques: [
        'In Tessera, use **New agent window**, at the bottom of the SSH connections list: in the terminal’s **▾** menu or in the rail of the full-screen terminal.',
        { p: 'Also when Tessera is closed: right-click its taskbar icon and select **New agent window**.', soloEn: ['windows'] },
        { p: 'You can also use the menu of the Tessera icon in the Dock, or **Window › New agent window**. There is no shortcut when Tessera is closed.', soloEn: ['mac'] },
        { p: 'Also when Tessera is closed: right-click Tessera in the application launcher and select **New agent window**.', soloEn: ['linux'] }
      ]
    }
  ]
}

export const txMosaico = crearTextos(es, en)
