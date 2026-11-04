// =============================================================================
// Tessera Academy · Glosario: una sección por término; el ancla es el término y los demás
// artículos enlazan aquí (`glosario/<término>`). El primer bloque de cada término es su
// definición: es lo que enseña el `title` de un enlace al glosario.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen: 'Los términos que tienen un significado propio en Tessera. Cada definición se entiende por sí sola.',
  secciones: [
    {
      ancla: 'perfil',
      titulo: 'Perfil',
      bloques: [
        'Un espacio de trabajo con nombre y color propios, que reúne sus proyectos, sus cuentas de Docker, sus conexiones SSH y de bases de datos y las reglas de sus agentes. Lo que pertenece a un perfil no se comparte con los demás. Ver [Perfiles](perfiles).'
      ]
    },
    {
      ancla: 'proyecto',
      titulo: 'Proyecto',
      bloques: [
        'Una carpeta abierta en un perfil, con su agente, su editor y sus terminales. Puede ser un repositorio, una carpeta que contiene varios o una carpeta sin Git. Ver [Proyectos](proyectos).'
      ]
    },
    {
      ancla: 'riel',
      titulo: 'Riel',
      bloques: [
        'La barra vertical de iconos del borde izquierdo de la ventana. Abre los archivos, Git · Cambios, las conexiones a bases de datos, la terminal y Git · Log. Ver [Qué es Tessera](bienvenida).'
      ]
    },
    {
      ancla: 'panel-inferior',
      titulo: 'Panel inferior',
      bloques: [
        'El área de la parte inferior de la ventana donde se muestra la terminal o Git · Log, uno de los dos cada vez. Ver [Terminales](terminales) y [Git · Log](git/log).'
      ]
    },
    {
      ancla: 'agente',
      titulo: 'Agente',
      bloques: [
        'Un asistente de programación que se ejecuta en una terminal: Claude Code, Codex o cualquier otro que se añada. Ver [Claude Code, Codex y otros agentes](agentes).'
      ]
    },
    {
      ancla: 'agente-de-datos',
      titulo: 'Agente de datos',
      bloques: [
        'El agente de la vista de bases de datos de un perfil. No pertenece a ningún proyecto y trabaja con las bases que tiene montadas. Ver [Atajos de teclado](atajos/bases-de-datos).'
      ]
    },
    {
      ancla: 'agente-de-la-terminal',
      titulo: 'Agente de la terminal',
      bloques: [
        'El agente que acompaña a la terminal cuando está a pantalla completa. No pertenece a ningún proyecto. Ver [Atajos de teclado](atajos/terminal-y-git).'
      ]
    },
    {
      ancla: 'cuenta',
      titulo: 'Cuenta',
      bloques: [
        'La sesión iniciada con la que trabaja un agente. La cuenta de {tuEquipo} es la misma en todos los perfiles; una cuenta de Docker pertenece a un solo perfil. Ver [Cuentas de los agentes](cuentas).'
      ]
    },
    {
      ancla: 'nativo',
      titulo: 'Nativo',
      bloques: [
        'Un agente que se ejecuta directamente en {tuEquipo}, con la cuenta y las herramientas de la persona que lo usa y con su mismo acceso. Es el modo predeterminado. Ver [Nativo o en Docker](nativo-o-docker).'
      ]
    },
    {
      ancla: 'contenedor',
      titulo: 'Contenedor',
      bloques: [
        'Un entorno aislado de Docker donde se ejecuta un agente que no es nativo. Hay uno por cada cuenta de Docker, y lo comparten los proyectos del perfil que usan esa cuenta. Ver [Contenedores de Docker](contenedores-docker).'
      ]
    },
    {
      ancla: 'montar',
      titulo: 'Montar',
      bloques: [
        'Poner algo al alcance de un agente. Un proyecto se monta dentro del contenedor de un agente en Docker, en `/workspace/<carpeta>`. Una base de datos se monta en un proyecto para que sus agentes, nativos o en Docker, la consulten con `tdb`. Ver [Dar una base a los agentes](bases-de-datos/agentes).'
      ]
    },
    {
      ancla: 'hibernar',
      titulo: 'Hibernar',
      bloques: [
        'Cerrar lo que no se está usando para liberar memoria. Un perfil entero se hiberna manualmente; el agente nativo de un proyecto que no está visible se hiberna automáticamente tras un tiempo sin actividad. Ver [Hibernar y reanudar](hibernar).'
      ]
    },
    {
      ancla: 'reanudar',
      titulo: 'Reanudar',
      bloques: [
        'Volver a abrir algo hibernado. Cada agente retoma su conversación donde la dejó; las terminales se abren de nuevo vacías. Ver [Hibernar y reanudar](hibernar/reanudar).'
      ]
    },
    {
      ancla: 'mosaico',
      titulo: 'Mosaico',
      bloques: ['La rejilla que muestra los agentes de hasta seis proyectos, de cualquier perfil, para seguirlos al mismo tiempo. Ver [Mosaico y ventanas de agente](mosaico).']
    },
    {
      ancla: 'reglas',
      titulo: 'Reglas del perfil',
      bloques: [
        'Un texto con instrucciones que reciben al iniciarse todos los agentes de serie de un perfil. Los agentes añadidos manualmente no lo reciben, pero pueden leerlo con `tctx`. Ver [Reglas para los agentes](reglas-del-perfil).'
      ]
    },
    {
      ancla: 'traspaso',
      titulo: 'Traspaso',
      bloques: [
        'Continuar un trabajo en otro agente mediante un resumen con los últimos mensajes y el estado de Git. Si solo cambia la cuenta del mismo agente, la conversación se copia entera. Ver [Continuar en otro agente o cuenta](continuar-en-otro-agente).'
      ]
    },
    {
      ancla: 'tdb',
      titulo: 'tdb, tssh y tctx',
      bloques: [
        'Los comandos que Tessera proporciona a los agentes: `tdb` consulta las bases de datos montadas, `tssh` usa servidores SSH y `tctx` da acceso a las reglas, los traspasos y el historial de conversaciones. Los agentes los usan sin ver ninguna contraseña. Ver [tdb, tssh y tctx](herramientas-de-los-agentes).'
      ]
    },
    {
      ancla: 'huella',
      titulo: 'Huella',
      bloques: [
        'El identificador criptográfico de un servidor SSH, que permite comprobar que sigue siendo el mismo. Una persona la acepta la primera vez que se conecta, desde la terminal de Tessera o con la prueba de la conexión; hasta entonces, los agentes y los túneles no pueden usar ese servidor. Si la huella cambia, Tessera rechaza la conexión. Ver [Conexiones SSH](ssh).'
      ]
    },
    {
      ancla: 'consola',
      titulo: 'Consola',
      bloques: [
        'Una pestaña de la vista de bases de datos donde se escriben y ejecutan consultas contra una conexión. Se guarda como un archivo del perfil. Ver [El árbol, los datos y las consolas](bases-de-datos/explorador).'
      ]
    },
    {
      ancla: 'produccion',
      titulo: 'Producción',
      bloques: [
        'El valor del campo Entorno que identifica una conexión de base de datos con datos reales. Tessera la marca en rojo, inicia sus consolas nuevas en modo de transacción manual y pide confirmación antes de cada escritura. Ver [Conexiones de producción](bases-de-datos/produccion).'
      ]
    }
  ]
}

const en: Articulo = {
  resumen: 'Terms that have a specific meaning in Tessera. Each definition can be understood on its own.',
  secciones: [
    {
      ancla: 'perfil',
      titulo: 'Profile',
      bloques: [
        'A workspace with its own name and color that brings together its projects, its Docker accounts, its SSH and database connections, and the rules for its agents. What belongs to a profile is not shared with the others. See [Profiles](perfiles).'
      ]
    },
    {
      ancla: 'proyecto',
      titulo: 'Project',
      bloques: [
        'A folder open in a profile, with its agent, editor, and terminals. It can be a repository, a folder that contains several repositories, or a folder without Git. See [Projects](proyectos).'
      ]
    },
    {
      ancla: 'riel',
      titulo: 'Rail',
      bloques: [
        'The vertical bar of icons on the left edge of the window. It opens the files, Git · Changes, the database connections, the terminal, and Git · Log. See [What is Tessera?](bienvenida).'
      ]
    },
    {
      ancla: 'panel-inferior',
      titulo: 'Bottom panel',
      bloques: [
        'The area at the bottom of the window that shows the terminal or Git · Log, one of the two at a time. See [Terminals](terminales) and [Git · Log](git/log).'
      ]
    },
    {
      ancla: 'agente',
      titulo: 'Agent',
      bloques: [
        'A coding assistant that runs in a terminal: Claude Code, Codex, or any other agent that is added. See [Claude Code, Codex, and other agents](agentes).'
      ]
    },
    {
      ancla: 'agente-de-datos',
      titulo: 'Data agent',
      bloques: [
        'The agent of a profile’s databases view. It does not belong to any project and works with the databases mounted for it. See [Keyboard shortcuts](atajos/bases-de-datos).'
      ]
    },
    {
      ancla: 'agente-de-la-terminal',
      titulo: 'Terminal agent',
      bloques: [
        'The agent that accompanies the terminal when it is in full screen. It does not belong to any project. See [Keyboard shortcuts](atajos/terminal-y-git).'
      ]
    },
    {
      ancla: 'cuenta',
      titulo: 'Account',
      bloques: [
        'The signed-in session an agent works with. The account on {tuEquipo} is the same in every profile; a Docker account belongs to one profile only. See [Agent accounts](cuentas).'
      ]
    },
    {
      ancla: 'nativo',
      titulo: 'Native',
      bloques: [
        'An agent that runs directly on {tuEquipo}, with the account and tools of the person using it and with the same access. This is the default mode. See [Native or in Docker](nativo-o-docker).'
      ]
    },
    {
      ancla: 'contenedor',
      titulo: 'Container',
      bloques: [
        'An isolated Docker environment where a non-native agent runs. Each Docker account has one container, and the profile’s projects that use that account share it. See [Docker containers](contenedores-docker).'
      ]
    },
    {
      ancla: 'montar',
      titulo: 'Mount',
      bloques: [
        'To put something within an agent’s reach. A project is mounted inside the container of a Docker agent, at `/workspace/<folder>`. A database is mounted in a project so that its agents, native or in Docker, can query it with `tdb`. See [Give the agents access to a database](bases-de-datos/agentes).'
      ]
    },
    {
      ancla: 'hibernar',
      titulo: 'Hibernate',
      bloques: [
        'To close what is not being used and free memory. A whole profile is hibernated manually; the native agent of a project that is not on screen hibernates automatically after a period without activity. See [Hibernate and resume](hibernar).'
      ]
    },
    {
      ancla: 'reanudar',
      titulo: 'Resume',
      bloques: [
        'To reopen something that is hibernated. Each agent resumes its conversation from where it stopped; terminals reopen empty. See [Hibernate and resume](hibernar/reanudar).'
      ]
    },
    {
      ancla: 'mosaico',
      titulo: 'Mosaic',
      bloques: ['The grid that shows the agents of up to six projects, from any profile, so you can follow them at the same time. See [Mosaic and agent windows](mosaico).']
    },
    {
      ancla: 'reglas',
      titulo: 'Profile rules',
      bloques: [
        'A text with instructions that every built-in agent in a profile receives when it starts. Manually added agents do not receive it, but they can read it with `tctx`. See [Rules for agents](reglas-del-perfil).'
      ]
    },
    {
      ancla: 'traspaso',
      titulo: 'Handoff',
      bloques: [
        'Continuing work in another agent through a summary with the latest messages and the Git status. If only the account of the same agent changes, the whole conversation is copied. See [Continue in another agent or account](continuar-en-otro-agente).'
      ]
    },
    {
      ancla: 'tdb',
      titulo: 'tdb, tssh, and tctx',
      bloques: [
        'The commands that Tessera gives the agents: `tdb` queries the mounted databases, `tssh` uses SSH servers, and `tctx` gives access to the rules, the handoffs, and the conversation history. The agents use them without seeing any passwords. See [tdb, tssh, and tctx](herramientas-de-los-agentes).'
      ]
    },
    {
      ancla: 'huella',
      titulo: 'Fingerprint',
      bloques: [
        'The cryptographic identifier of an SSH server, which makes it possible to check that it is still the same server. A person accepts it the first time they connect, from the Tessera terminal or with the connection test; until then, agents and tunnels cannot use that server. If the fingerprint changes, Tessera rejects the connection. See [SSH connections](ssh).'
      ]
    },
    {
      ancla: 'consola',
      titulo: 'Console',
      bloques: [
        'A tab in the databases view where you write and run queries against a connection. It is saved as a profile file. See [The tree, the data, and the consoles](bases-de-datos/explorador).'
      ]
    },
    {
      ancla: 'produccion',
      titulo: 'Production',
      bloques: [
        'The value of the Environment field that identifies a database connection with real data. Tessera marks it in red, starts its new consoles in manual transaction mode, and asks for confirmation before each write. See [Production connections](bases-de-datos/produccion).'
      ]
    }
  ]
}

export const txGlosario = crearTextos(es, en)
