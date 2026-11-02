// =============================================================================
// Tessera Academy · Qué es Tessera: la idea, la ventana y los primeros pasos.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Tessera junta en una ventana tus proyectos y las cuentas de IA con que trabajas en ellos, cada cosa en su sitio.',
  secciones: [
    {
      ancla: 'idea',
      titulo: 'La idea',
      bloques: [
        'Trabajas en varios proyectos y con varias cuentas de Claude Code o Codex. Tessera los ordena en [perfiles](perfiles): cada perfil tiene su color, sus proyectos y las cuentas que usan sus agentes, así que siempre sabes con qué cuenta está trabajando cada uno.',
        'Dentro de cada proyecto tienes el agente, el editor, el explorador de archivos, git, terminales, bases de datos y conexiones SSH, sin cambiar de aplicación.'
      ]
    },
    {
      ancla: 'ventana',
      titulo: 'La ventana',
      bloques: [
        {
          lista: [
            '**Arriba**, la barra de perfiles y, debajo, las pestañas de los proyectos del perfil abierto.',
            '**A la izquierda**, el riel: **Archivos**, **Git · Cambios** y **Conexiones a bases de datos** cambian la vista lateral; **Terminal** y **Git · Log** abren la franja de abajo. Sus iconos se pueden arrastrar de un grupo a otro.',
            '**En el centro**, el editor o la vista que elijas; **a la derecha**, la columna del agente del proyecto.',
            '**Abajo**, la terminal o el historial de git, a todo el ancho.'
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
            'Una instalación nueva arranca con el perfil **Personal**. Crea más con el **+** del final de la barra de perfiles.',
            'Abre un proyecto con el **+** de la barra de proyectos y elige su carpeta.',
            'Elige la cuenta del agente con el botón de cuenta de su cabecera: en tu equipo o en Docker. Lo explica [Cuentas de los agentes](cuentas).',
            'Escribe al agente. Cuando vuelvas al proyecto, retomará su última conversación.'
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
            '[Nativo o en Docker](nativo-o-docker): dónde corre cada agente y qué puede tocar.',
            '[Hibernar y reanudar](hibernar): cómo devolver memoria a tu equipo sin perder nada.',
            '[tdb, tssh y tctx](herramientas-de-los-agentes): bases de datos, servidores e historial para los agentes, sin darles contraseñas.',
            'El [glosario](glosario) explica las palabras propias de Tessera.'
          ]
        },
        { nota: 'Los botones **ⓘ** de los diálogos traen aquí, a la parte que explica ese diálogo.' }
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
        'You work on several projects with several Claude Code or Codex accounts. Tessera organizes them into [profiles](perfiles). Each profile has its own color, its own projects, and the accounts its agents use, so you always know which account each agent is using.',
        'Each project includes the agent, the editor, the file explorer, Git, terminals, databases, and SSH connections, so you don’t need to switch apps.'
      ]
    },
    {
      ancla: 'ventana',
      titulo: 'The window',
      bloques: [
        {
          lista: [
            '**At the top**, the profile bar and, below it, the tabs for the projects in the open profile.',
            '**On the left**, the rail: **Files**, **Git · Changes**, and **Database connections** change the side panel; **Terminal** and **Git · Log** open the bottom strip. You can drag its icons from one group to the other.',
            '**In the center**, the editor or the view you choose; **on the right**, the agent column for the project.',
            '**At the bottom**, the terminal or the Git history, across the full width.'
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
            'A new installation starts with the **Personal** profile. To create more profiles, click the **+** at the end of the profile bar.',
            'To open a project, click the **+** in the project bar and choose its folder.',
            'Choose the agent’s account with the account button in the agent header: an account on your computer or in Docker. For details, see [Agent accounts](cuentas).',
            'Send the agent a message. When you return to the project, the agent resumes its last conversation.'
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
            '[Native or in Docker](nativo-o-docker): where each agent runs and what it can touch.',
            '[Hibernate and resume](hibernar): how to free memory on your computer without losing any work.',
            '[tdb, tssh, and tctx](herramientas-de-los-agentes): databases, servers, and history for the agents, without giving them passwords.',
            'The [glossary](glosario) defines the terms that are specific to Tessera.'
          ]
        },
        { nota: 'The **ⓘ** button in a dialog opens this guide at the section that explains that dialog.' }
      ]
    }
  ]
}

export const txBienvenida = crearTextos(es, en)
