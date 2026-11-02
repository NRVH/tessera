// =============================================================================
// Tessera Academy · Glosario: una sección por término; el ancla es el término y los demás
// artículos enlazan aquí (`glosario/<término>`). El primer bloque de cada término es su
// definición: es lo que enseña el `title` de un enlace al glosario.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen: 'Las palabras con un sentido propio en Tessera, en una frase cada una.',
  secciones: [
    {
      ancla: 'perfil',
      titulo: 'Perfil',
      bloques: [
        'Un espacio de trabajo con su nombre, su color, sus proyectos y las cuentas de sus agentes. Ver [Perfiles](perfiles).'
      ]
    },
    {
      ancla: 'proyecto',
      titulo: 'Proyecto',
      bloques: [
        'Una carpeta abierta en un perfil: un repositorio o una carpeta que contiene varios. Ver [Proyectos](proyectos).'
      ]
    },
    {
      ancla: 'agente',
      titulo: 'Agente',
      bloques: [
        'Un asistente de programación que corre en una terminal: Claude Code, Codex o cualquier otro que añadas. Ver [Claude Code, Codex y otros agentes](agentes).'
      ]
    },
    {
      ancla: 'cuenta',
      titulo: 'Cuenta',
      bloques: [
        'La sesión con la que trabaja un agente. La de tu equipo es la misma en todos los perfiles; una de Docker es solo de su perfil. Ver [Cuentas de los agentes](cuentas).'
      ]
    },
    {
      ancla: 'nativo',
      titulo: 'Nativo',
      bloques: [
        'Un agente que corre directamente en tu equipo, con tu cuenta y tus herramientas, y con el mismo acceso que tú. Es el modo por defecto. Ver [Nativo o en Docker](nativo-o-docker).'
      ]
    },
    {
      ancla: 'contenedor',
      titulo: 'Contenedor',
      bloques: [
        'Un entorno aislado de Docker donde corre un agente que no es nativo. Hay uno por cuenta de Docker y lo comparten los proyectos del perfil. Ver [Contenedores de Docker](contenedores-docker).'
      ]
    },
    {
      ancla: 'montar',
      titulo: 'Montar',
      bloques: [
        'Hacer visible algo dentro del contenedor de un agente: los proyectos se montan en `/workspace/<carpeta>`. Montar una base de datos o una conexión SSH es dejar que los agentes la usen con `tdb` o `tssh`.'
      ]
    },
    {
      ancla: 'hibernar',
      titulo: 'Hibernar',
      bloques: [
        'Cerrar lo que no estás usando para liberar memoria: un perfil entero a mano o un agente inactivo solo. Ver [Hibernar y reanudar](hibernar).'
      ]
    },
    {
      ancla: 'reanudar',
      titulo: 'Reanudar',
      bloques: [
        'Volver a abrir algo hibernado: cada agente retoma su conversación donde la dejó. Ver [Hibernar y reanudar](hibernar/reanudar).'
      ]
    },
    {
      ancla: 'mosaico',
      titulo: 'Mosaico',
      bloques: ['La rejilla con los agentes en marcha, para seguir varios proyectos a la vez. Ver [Mosaico y ventanas de agente](mosaico).']
    },
    {
      ancla: 'reglas',
      titulo: 'Reglas del perfil',
      bloques: [
        'Instrucciones que reciben todos los agentes de un perfil al arrancar. Ver [Reglas para los agentes](reglas-del-perfil).'
      ]
    },
    {
      ancla: 'traspaso',
      titulo: 'Traspaso',
      bloques: [
        'Seguir una conversación en otra cuenta o en otro agente sin perder el contexto. Ver [Continuar en otro agente o cuenta](continuar-en-otro-agente).'
      ]
    },
    {
      ancla: 'tdb',
      titulo: 'tdb, tssh y tctx',
      bloques: [
        'Los comandos que Tessera da a los agentes para consultar bases de datos, usar servidores SSH y buscar en el historial sin ver ninguna contraseña. Ver [tdb, tssh y tctx](herramientas-de-los-agentes).'
      ]
    },
    {
      ancla: 'huella',
      titulo: 'Huella',
      bloques: [
        'El identificador de un servidor SSH. La aceptas tú la primera vez que te conectas; sin ella, ni tú ni los agentes se conectan. Ver [Conexiones SSH](ssh).'
      ]
    },
    {
      ancla: 'produccion',
      titulo: 'Producción',
      bloques: [
        'La marca de una conexión de base de datos con datos reales: Tessera la pinta en rojo y pide confirmar cada escritura antes de enviarla. Ver [Bases de datos](bases-de-datos).'
      ]
    }
  ]
}

const en: Articulo = {
  resumen: 'Terms that have a specific meaning in Tessera, each defined in one sentence.',
  secciones: [
    {
      ancla: 'perfil',
      titulo: 'Profile',
      bloques: [
        'A workspace with its own name, color, projects, and agent accounts. See [Profiles](perfiles).'
      ]
    },
    {
      ancla: 'proyecto',
      titulo: 'Project',
      bloques: [
        'A folder open in a profile: a repository, or a folder that contains several repositories. See [Projects](proyectos).'
      ]
    },
    {
      ancla: 'agente',
      titulo: 'Agent',
      bloques: [
        'A coding assistant that runs in a terminal: Claude Code, Codex, or any other agent you add. See [Claude Code, Codex, and other agents](agentes).'
      ]
    },
    {
      ancla: 'cuenta',
      titulo: 'Account',
      bloques: [
        'The session an agent works with. An account on your computer is the same in every profile; a Docker account belongs to one profile only. See [Agent accounts](cuentas).'
      ]
    },
    {
      ancla: 'nativo',
      titulo: 'Native',
      bloques: [
        'An agent that runs directly on your computer, with your account, your tools, and the same access you have. This is the default mode. See [Native or in Docker](nativo-o-docker).'
      ]
    },
    {
      ancla: 'contenedor',
      titulo: 'Container',
      bloques: [
        'An isolated Docker environment where a non-native agent runs. Each Docker account has one container, and all the projects in the profile share it. See [Docker containers](contenedores-docker).'
      ]
    },
    {
      ancla: 'montar',
      titulo: 'Mount',
      bloques: [
        'To make something visible inside an agent’s container: projects are mounted at `/workspace/<folder>`. Mounting a database or an SSH connection lets the agents use it through `tdb` or `tssh`.'
      ]
    },
    {
      ancla: 'hibernar',
      titulo: 'Hibernate',
      bloques: [
        'To close what you are not using and free memory: a whole profile, which you hibernate manually, or an idle agent, which hibernates automatically. See [Hibernate and resume](hibernar).'
      ]
    },
    {
      ancla: 'reanudar',
      titulo: 'Resume',
      bloques: [
        'To reopen something that is hibernated: each agent resumes its conversation from where it stopped. See [Hibernate and resume](hibernar/reanudar).'
      ]
    },
    {
      ancla: 'mosaico',
      titulo: 'Mosaic',
      bloques: ['The grid of running agents, which lets you follow several projects at once. See [Mosaic and agent windows](mosaico).']
    },
    {
      ancla: 'reglas',
      titulo: 'Profile rules',
      bloques: [
        'Instructions that every agent in a profile receives when it starts. See [Rules for agents](reglas-del-perfil).'
      ]
    },
    {
      ancla: 'traspaso',
      titulo: 'Handoff',
      bloques: [
        'Continuing a conversation in another account or another agent without losing its context. See [Continue in another agent or account](continuar-en-otro-agente).'
      ]
    },
    {
      ancla: 'tdb',
      titulo: 'tdb, tssh, and tctx',
      bloques: [
        'The commands that Tessera gives the agents to query databases, use SSH servers, and search the history without seeing any passwords. See [tdb, tssh, and tctx](herramientas-de-los-agentes).'
      ]
    },
    {
      ancla: 'huella',
      titulo: 'Fingerprint',
      bloques: [
        'The identifier of an SSH server. You accept it the first time you connect; until you do, neither you nor the agents can connect. See [SSH connections](ssh).'
      ]
    },
    {
      ancla: 'produccion',
      titulo: 'Production',
      bloques: [
        'A label for a database connection that holds real data: Tessera shows it in red and asks you to confirm each write before it sends it. See [Databases](bases-de-datos).'
      ]
    }
  ]
}

export const txGlosario = crearTextos(es, en)
