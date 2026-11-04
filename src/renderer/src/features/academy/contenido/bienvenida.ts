// =============================================================================
// Tessera Academy · Qué es Tessera: la idea, la ventana y los primeros pasos.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Tessera reúne en una sola ventana sus proyectos y las cuentas de IA con las que trabaja en ellos, y mantiene separado lo que corresponde a cada uno.',
  secciones: [
    {
      ancla: 'idea',
      titulo: 'La idea',
      bloques: [
        'Tessera es un entorno de desarrollo para quien trabaja en varios proyectos con varias cuentas de Claude Code o Codex. Cada uno de estos asistentes de programación se ejecuta en una terminal dentro de Tessera y recibe el nombre de [agente](glosario/agente).',
        'Tessera organiza el trabajo en [perfiles](perfiles). Cada perfil tiene su color, sus proyectos y las cuentas que usan sus agentes, de modo que siempre se puede saber con qué cuenta trabaja cada agente.',
        'Cada [proyecto](proyectos) incluye el agente, el editor, el explorador de archivos, git, terminales, bases de datos y conexiones SSH, sin necesidad de cambiar de aplicación.'
      ]
    },
    {
      ancla: 'ventana',
      titulo: 'La ventana',
      bloques: [
        {
          lista: [
            'Arriba: la barra de perfiles y, debajo, las pestañas de los proyectos del perfil abierto.',
            'A la izquierda: el riel, una columna estrecha de iconos. **Archivos**, **Git · Cambios** y **Conexiones a bases de datos** cambian la vista lateral; **Terminal** y **Git · Log** abren la franja inferior. Los iconos se pueden arrastrar de un grupo a otro.',
            'En el centro: el editor o la vista seleccionada. A la derecha: la columna del agente del proyecto.',
            'Abajo: la franja inferior, con la terminal o el historial de git, que ocupa el ancho de la vista lateral, el centro y la columna del agente.'
          ]
        },
        { captura: 'ventana', alt: 'La ventana de Tessera con un perfil, sus proyectos, el editor y el agente' }
      ]
    },
    {
      ancla: 'primeros-pasos',
      titulo: 'Primeros pasos',
      bloques: [
        {
          pasos: [
            'Una instalación nueva se inicia con el perfil **Personal**. Para crear otro perfil, haga clic en el **+** del final de la barra de perfiles.',
            'Para abrir un proyecto, haga clic en el **+** de la barra de proyectos y seleccione su carpeta. La carpeta aparece como una pestaña y su agente se inicia en ella.',
            'Seleccione la cuenta del agente con el botón de cuenta de su cabecera: la de {tuEquipo} o una de Docker. [Cuentas de los agentes](cuentas) explica la diferencia.',
            'Escriba su petición al agente. Cuando vuelva más adelante al proyecto, el agente retomará su última conversación.'
          ]
        }
      ]
    },
    {
      ancla: 'seguir',
      titulo: 'Por dónde seguir',
      bloques: [
        {
          lista: [
            '[Nativo o en Docker](nativo-o-docker): dónde se ejecuta cada agente y a qué puede acceder.',
            '[Hibernar y reanudar](hibernar): cómo liberar memoria de su equipo sin perder el trabajo.',
            '[tdb, tssh y tctx](herramientas-de-los-agentes): los comandos con los que los agentes usan bases de datos, servidores e historial sin recibir contraseñas.',
            'El [glosario](glosario) explica los términos propios de Tessera.'
          ]
        },
        { nota: 'El botón **ⓘ** de un diálogo abre esta guía en la sección que explica ese diálogo.' }
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Tessera brings your projects and the AI accounts you use for them into one window, and keeps each one in its place.',
  secciones: [
    {
      ancla: 'idea',
      titulo: 'The idea',
      bloques: [
        'Tessera is a development environment for people who work on several projects with several Claude Code or Codex accounts. Each of these coding assistants runs in a terminal inside Tessera and is called an [agent](glosario/agente).',
        'Tessera organizes your work into [profiles](perfiles). Each profile has its own color, its own projects, and the accounts its agents use, so you always know which account each agent is using.',
        'Each [project](proyectos) includes the agent, the editor, the file explorer, Git, terminals, databases, and SSH connections, so you don’t need to switch apps.'
      ]
    },
    {
      ancla: 'ventana',
      titulo: 'The window',
      bloques: [
        {
          lista: [
            'At the top: the profile bar and, below it, the tabs for the projects in the open profile.',
            'On the left: the rail, a narrow column of icons. **Files**, **Git · Changes**, and **Database connections** change the side panel; **Terminal** and **Git · Log** open the bottom strip. You can drag the icons from one group to the other.',
            'In the center: the editor or the view you choose. On the right: the agent column for the project.',
            'At the bottom: the bottom strip, with the terminal or the Git history, spanning the side panel, the center, and the agent column.'
          ]
        },
        { captura: 'ventana', alt: 'The Tessera window with a profile, its projects, the editor and the agent' }
      ]
    },
    {
      ancla: 'primeros-pasos',
      titulo: 'Get started',
      bloques: [
        {
          pasos: [
            'A new installation starts with the **Personal** profile. To create another profile, click the **+** at the end of the profile bar.',
            'To open a project, click the **+** in the project bar and choose its folder. The folder appears as a tab, and its agent starts there.',
            'Choose the agent’s account with the account button in the agent header: the account on {tuEquipo} or a Docker account. For the difference, see [Agent accounts](cuentas).',
            'Send the agent your request. When you return to the project later, the agent resumes its last conversation.'
          ]
        }
      ]
    },
    {
      ancla: 'seguir',
      titulo: 'Where to go next',
      bloques: [
        {
          lista: [
            '[Native or in Docker](nativo-o-docker): where each agent runs and what it can access.',
            '[Hibernate and resume](hibernar): how to free memory on your computer without losing any work.',
            '[tdb, tssh, and tctx](herramientas-de-los-agentes): the commands agents use to reach databases, servers, and history without receiving passwords.',
            'The [glossary](glosario) defines the terms that are specific to Tessera.'
          ]
        },
        { nota: 'The **ⓘ** button in a dialog opens this guide at the section that explains that dialog.' }
      ]
    }
  ]
}

export const txBienvenida = crearTextos(es, en)
