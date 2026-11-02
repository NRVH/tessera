// =============================================================================
// Tessera Academy · Claude Code, Codex y otros agentes: sus pestañas, la cabecera, ocultarlos,
// añadir uno propio por su comando y tenerlos al día.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`).
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Cada proyecto trae Claude Code y Codex, cada uno en una terminal de verdad, y puedes añadir cualquier otro agente de terminal por su comando.',
  secciones: [
    {
      ancla: 'pestanas',
      titulo: 'Un agente por pestaña',
      bloques: [
        'En la columna de la derecha, cada agente del proyecto tiene su pestaña. Cambiar de pestaña no cierra nada: cada agente sigue con su sesión y su conversación.',
        'Cada agente decide por su cuenta si corre en {tuEquipo} o en Docker, y con qué cuenta. Lo explican [Nativo o en Docker](nativo-o-docker) y [Cuentas de los agentes](cuentas).',
        'Si las pestañas te ocupan mucho, cámbialas por un desplegable en **Configuración › Agentes › Selector de agentes**.'
      ]
    },
    {
      ancla: 'cabecera',
      titulo: 'La cabecera y el pie del agente',
      bloques: [
        {
          lista: [
            '**Historial de conversaciones**: las anteriores de este proyecto, para retomar o borrar cualquiera. Ver [Conversaciones](conversaciones).',
            '**Nueva conversación**: la actual se cierra y queda en el historial.',
            'El botón de cuenta: dónde corre el agente y con qué cuenta. Ver [Elegir la cuenta](cuentas/elegir).',
            '**Maximizar**: el agente ocupa todo el espacio sin cerrar tus archivos.'
          ]
        },
        'Al pie ves el uso de la cuenta y cuánto contexto lleva la conversación. Puedes pegar imágenes y archivos en la terminal del agente; si está en Docker, Tessera los copia dentro de su contenedor para que pueda abrirlos.'
      ]
    },
    {
      ancla: 'ocultar',
      titulo: 'Ocultar y ordenar agentes',
      bloques: [
        'Con clic derecho en las pestañas de agente sale la lista de los agentes del proyecto: desmarca uno para ocultarlo y márcalo para volver a verlo. Un aviso con **Deshacer** te deja arrepentirte.',
        {
          lista: [
            'Lo oculto y el orden valen para todos los proyectos del perfil.',
            'Claude Code y Codex no se pueden eliminar, solo ocultar. Siempre queda al menos un agente a la vista.',
            'Arrastra las pestañas para ordenarlas, o usa **Ordenar y ocultar agentes en Configuración…**.'
          ]
        }
      ]
    },
    {
      ancla: 'manuales',
      titulo: 'Añadir cualquier otro agente',
      bloques: [
        'Si usas otro asistente que corre en una terminal, añádelo con el **+** de las pestañas de agente (**Añadir un agente propio (por su comando)**).',
        {
          pasos: [
            'Escribe su **Nombre** y su **Comando**, tal como lo teclearías en la terminal del proyecto.',
            'Elige **Dónde corre**: en {tuEquipo}, y lo verán todos los perfiles, o en Docker, con sus propias cuentas y solo en este perfil. Después no se puede cambiar.',
            'Si quieres, rellena **Cómo reanudar (opcional)** con la opción que retoma su última conversación; en Docker, también las **Órdenes de instalación (opcional)**, que Tessera mete en la imagen del perfil.',
            'Pulsa **Guardar**. En {tuEquipo} lo instalas tú: Tessera solo comprueba que tu shell lo encuentre.'
          ]
        },
        {
          nota: 'Tessera no conoce ese programa, así que un agente añadido a mano no tiene historial de conversaciones, uso de la cuenta, aviso de fin de turno ni hibernación automática. Si dice en JSON cuánto contexto lleva, puedes indicarlo en **Contexto (opcional)** y saldrá al pie.'
        }
      ]
    },
    {
      ancla: 'editar-manual',
      titulo: 'Editar o eliminar un agente propio',
      bloques: [
        'Con clic derecho en su pestaña: **Editar…**, **Copiar definición (JSON)** para llevarlo a otro equipo (allí se usa **Pegar definición**) y **Eliminar…**.',
        {
          lista: [
            'Uno que corre en {tuEquipo} se quita de todos los perfiles; lo que guardó en tu carpeta personal se conserva.',
            'Uno de Docker se quita de este perfil y se borran sus cuentas y lo que guardó en sus carpetas. Los archivos de los proyectos no se tocan.'
          ]
        },
        'Con **Activar en la terminal** también se puede elegir como agente de la [terminal](terminales) a pantalla completa.'
      ]
    },
    {
      ancla: 'al-dia',
      titulo: 'Tenerlos al día',
      bloques: [
        'Claude Code y Codex en {tuEquipo} se actualizan desde un botón de la barra de título, y los de Docker con **Actualizar agentes** en la cabecera del agente. Lo explica [Actualizaciones](actualizaciones).'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Every project includes Claude Code and Codex, each in a real terminal. You can add any other terminal-based agent by its command.',
  secciones: [
    {
      ancla: 'pestanas',
      titulo: 'One agent per tab',
      bloques: [
        'In the right column, each agent in the project has its own tab. Switching tabs does not close anything: each agent keeps its session and its conversation.',
        'Each agent has its own setting for where it runs, on {tuEquipo} or in Docker, and for which account it uses. For details, see [Native or in Docker](nativo-o-docker) and [Agent accounts](cuentas).',
        'If the tabs take up too much space, replace them with a drop-down in **Settings › Agents › Agent selector**.'
      ]
    },
    {
      ancla: 'cabecera',
      titulo: 'The agent header and footer',
      bloques: [
        {
          lista: [
            '**Conversation history**: the earlier conversations in this project, which you can resume or delete. See [Conversations](conversaciones).',
            '**New conversation**: closes the current conversation and keeps it in the history.',
            'The account button: where the agent runs and which account it uses. See [Choose the account](cuentas/elegir).',
            '**Maximize**: the agent fills the whole window without closing your files.'
          ]
        },
        'The footer shows the account usage and how much context the conversation uses. You can paste images and files into the agent’s terminal; if the agent runs in Docker, Tessera copies them into its container so the agent can open them.'
      ]
    },
    {
      ancla: 'ocultar',
      titulo: 'Hide and reorder agents',
      bloques: [
        'Right-click the agent tabs to see the agents in the project. Clear an agent’s check box to hide it, and select it again to show the agent. A notification with **Undo** lets you reverse the change.',
        {
          lista: [
            'Hidden agents and the tab order apply to all the projects in the profile.',
            'You cannot delete Claude Code or Codex, only hide them. At least one agent always stays visible.',
            'To reorder the tabs, drag them, or use **Reorder and hide agents in Settings…**.'
          ]
        }
      ]
    },
    {
      ancla: 'manuales',
      titulo: 'Add any other agent',
      bloques: [
        'If you use another assistant that runs in a terminal, add it with the **+** in the agent tabs (**Add custom agent (by command)**).',
        {
          pasos: [
            'Enter its **Name** and its **Command**, exactly as you would type it in the project terminal.',
            'Choose **Where it runs**: on {tuEquipo}, where every profile can use it, or in Docker, with its own accounts and only in this profile. You cannot change this later.',
            'Optionally, fill in **How to resume (optional)** with the option that resumes its last conversation. For Docker, you can also fill in **Install commands (optional)**; Tessera adds them to the profile’s image.',
            'Click **Save**. On {tuEquipo}, you install the agent yourself: Tessera only checks that your shell can find it.'
          ]
        },
        {
          nota: 'Tessera does not know this program, so an agent you add yourself has no conversation history, account usage, end-of-turn notification, or automatic hibernation. If the agent reports its context usage in JSON, you can specify how to read it in **Context (optional)**, and the usage appears in the footer.'
        }
      ]
    },
    {
      ancla: 'editar-manual',
      titulo: 'Edit or delete your own agent',
      bloques: [
        'Right-click its tab for **Edit…**, **Copy definition (JSON)** to move it to another computer (where you use **Paste definition**), and **Delete…**.',
        {
          lista: [
            'An agent that runs on {tuEquipo} is removed from every profile; the data it saved in your home folder is kept.',
            'A Docker agent is removed from this profile, and Tessera deletes its accounts and the data it saved in its folders. Project files are not affected.'
          ]
        },
        'If you turn on **Enable in the terminal**, you can also choose it as the full-screen [terminal](terminales) agent.'
      ]
    },
    {
      ancla: 'al-dia',
      titulo: 'Keep agents up to date',
      bloques: [
        'To update Claude Code and Codex on {tuEquipo}, use the button in the title bar. To update the Docker agents, use **Update agents** in the agent header. For details, see [Updates](actualizaciones).'
      ]
    }
  ]
}

export const txAgentes = crearTextos(es, en)
