// =============================================================================
// Tessera Academy · Mosaico y ventanas de agente: varios agentes a la vista a la vez, y un agente
// en una ventana aparte, sin proyecto.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`).
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'El mosaico pone en una rejilla los agentes de varios proyectos para seguirlos a la vez. Una ventana de agente abre un agente aparte, sin proyecto.',
  secciones: [
    {
      ancla: 'entrar',
      titulo: 'Entrar y salir del mosaico',
      bloques: [
        'Pulsa **Mosaico de agentes** en la barra de título (cuando hay algún agente en marcha) o usa el teclado:',
        {
          lista: [
            '`Ctrl+Shift+M` entra en el mosaico y sale de él.',
            '`Ctrl+1` a `Ctrl+6` saltan a la casilla de ese número.',
            '`Ctrl+Shift+Enter` amplía la casilla en la que estás a todo el mosaico, y la devuelve a su sitio.'
          ],
          soloEn: ['windows', 'linux']
        },
        {
          lista: [
            '`⇧⌘M` entra en el mosaico y sale de él.',
            '`⌘1` a `⌘6` saltan a la casilla de ese número.',
            '`⇧⌘↩` amplía la casilla en la que estás a todo el mosaico, y la devuelve a su sitio.'
          ],
          soloEn: ['mac']
        },
        'Al entrar se ven los proyectos cuyo agente está trabajando; si no trabaja ninguno, el proyecto en el que estabas. Salir no cierra nada: cada agente sigue donde estaba.'
      ]
    },
    {
      ancla: 'casillas',
      titulo: 'Las casillas',
      bloques: [
        'Hay una casilla por proyecto, hasta seis, de cualquier perfil. El agente de bases de datos y el de la terminal de cada perfil cuentan como un proyecto más.',
        {
          lista: [
            'Su cabecera dice perfil, proyecto y agente. Púlsala para elegir qué proyecto se ve en esa casilla.',
            'Si otro agente del mismo proyecto trabaja, te espera o terminó, un botón de la cabecera lo trae a la casilla.',
            '**Ir al proyecto** sale del mosaico y te deja en ese proyecto. Un doble clic en la cabecera amplía la casilla.',
            'Un punto avisa de un agente que terminó y aún no revisas; se quita al ponerte en su casilla.'
          ]
        },
        { captura: 'mosaico', alt: 'El mosaico con cuatro agentes de dos perfiles en una rejilla de dos por dos' }
      ]
    },
    {
      ancla: 'elegir',
      titulo: 'Elegir qué se ve y cómo',
      bloques: [
        'El selector de la barra del mosaico marca qué proyectos se ven, como mucho seis. Los que no están en marcha arrancan al añadirlos, y los hibernados se reanudan. Ninguna casilla entra sola, y una que ya está no se va aunque su agente se pare: la quitas tú o se va al cerrar su proyecto.',
        '**Distribución** decide la forma de la rejilla: **Automático** (según cuántas haya y la forma de la ventana), **Cuadrícula**, **Columnas**, **Filas** o **Principal y pila**. Si la que eliges no cabe en la ventana, se usa **Automático** hasta que haya sitio.'
      ]
    },
    {
      ancla: 'ventana-de-agente',
      titulo: 'Una ventana de agente',
      bloques: [
        'Es lo mismo que abrir una terminal y escribir `claude` o `codex`, pero con todo lo de la columna del agente: historial, conversación nueva, uso de la cuenta y pegar imágenes. Sirve para preguntar algo rápido sin abrir un proyecto.',
        {
          lista: [
            'Corre siempre en {tuEquipo}, en tu carpeta de usuario y con la cuenta de {tuEquipo}. Ofrece Claude Code, Codex y los agentes que añadiste para {tuEquipo}.',
            'No tiene perfil ni proyecto: ni bases de datos, ni servidores SSH, ni reglas del perfil.',
            'Cada vez empieza con una conversación nueva.',
            'Sigue abierta aunque cierres la ventana principal, y cerrarla solo cierra sus agentes.'
          ]
        }
      ]
    },
    {
      ancla: 'abrir-ventana',
      titulo: 'Abrir una ventana de agente',
      bloques: [
        'Dentro de Tessera, con **Nueva ventana de agente**, al pie de la lista de conexiones SSH: en la **▾** de la terminal o en el riel de la terminal a pantalla completa.',
        { p: 'Con Tessera cerrada también: clic derecho en su icono de la barra de tareas › **Nueva ventana de agente**.', soloEn: ['windows'] },
        { p: 'También desde el menú del icono de Tessera en el Dock o desde **Ventana › Nueva ventana de agente**.', soloEn: ['mac'] },
        { p: 'Con Tessera cerrada también: clic derecho en Tessera en el lanzador de aplicaciones › **Nueva ventana de agente**.', soloEn: ['linux'] }
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
        'Click **Agent mosaic** in the title bar (available when at least one agent is running), or use the keyboard:',
        {
          lista: [
            '`Ctrl+Shift+M` opens and closes the mosaic.',
            '`Ctrl+1` to `Ctrl+6` go to the tile with that number.',
            '`Ctrl+Shift+Enter` enlarges the current tile to fill the mosaic, and restores it.'
          ],
          soloEn: ['windows', 'linux']
        },
        {
          lista: [
            '`⇧⌘M` opens and closes the mosaic.',
            '`⌘1` to `⌘6` go to the tile with that number.',
            '`⇧⌘↩` enlarges the current tile to fill the mosaic, and restores it.'
          ],
          soloEn: ['mac']
        },
        'When you open the mosaic, it shows the projects whose agent is working; if no agent is working, it shows the project you were in. Closing the mosaic does not close anything: each agent stays where it was.'
      ]
    },
    {
      ancla: 'casillas',
      titulo: 'Tiles',
      bloques: [
        'There is one tile per project, up to six, from any profile. The database agent and the terminal agent of each profile each count as one more project.',
        {
          lista: [
            'The tile header shows the profile, project, and agent. Click it to choose which project appears in that tile.',
            'If another agent in the same project is working, is waiting for you, or has finished, a button in the header shows that agent in the tile.',
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
        'The selector in the mosaic bar sets which projects appear, up to six. Agents that are not running start when you add them, and hibernated agents resume. Tiles are never added automatically, and a tile stays even if its agent stops: you remove it yourself, or it disappears when you close its project.',
        '**Layout** sets the shape of the grid: **Automatic** (based on the number of tiles and the shape of the window), **Grid**, **Columns**, **Rows**, or **Main and stack**. If the layout you choose does not fit in the window, Tessera uses **Automatic** until there is enough space.'
      ]
    },
    {
      ancla: 'ventana-de-agente',
      titulo: 'Agent windows',
      bloques: [
        'An agent window is like opening a terminal and typing `claude` or `codex`, but with everything the agent column offers: history, new conversation, account usage, and pasting images. It is useful for a quick question without opening a project.',
        {
          lista: [
            'It always runs on {tuEquipo}, in your user folder, with the account on {tuEquipo}. It offers Claude Code, Codex, and the agents you added for {tuEquipo}.',
            'It has no profile or project: no databases, no SSH servers, and no profile rules.',
            'It starts with a new conversation every time.',
            'It stays open even if you close the main window, and closing it closes only its own agents.'
          ]
        }
      ]
    },
    {
      ancla: 'abrir-ventana',
      titulo: 'Open an agent window',
      bloques: [
        'In Tessera, use **New agent window**, at the bottom of the SSH connections list: in the terminal’s **▾** menu or in the rail of the full-screen terminal.',
        { p: 'Even when Tessera is closed: right-click its taskbar icon and select **New agent window**.', soloEn: ['windows'] },
        { p: 'You can also use the menu of the Tessera icon in the Dock, or **Window › New agent window**.', soloEn: ['mac'] },
        { p: 'Even when Tessera is closed: right-click Tessera in the application launcher and select **New agent window**.', soloEn: ['linux'] }
      ]
    }
  ]
}

export const txMosaico = crearTextos(es, en)
