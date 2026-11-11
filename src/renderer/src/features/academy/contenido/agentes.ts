// =============================================================================
// Tessera Academy · Claude Code, Codex y otros agentes: sus pestañas, la cabecera, ocultarlos,
// añadir uno propio por su comando y tenerlos al día.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`).
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Cada proyecto incluye Claude Code y Codex, cada uno en una terminal real, y se puede añadir cualquier otro agente de terminal indicando su comando.',
  secciones: [
    {
      ancla: 'pestanas',
      titulo: 'Un agente por pestaña',
      bloques: [
        'En la columna derecha, cada [agente](glosario/agente) del proyecto tiene su pestaña. Cambiar de pestaña no cierra nada: cada agente conserva su sesión y su conversación.',
        'Para cada agente se elige por separado si se ejecuta en {tuEquipo} o en Docker, y con qué cuenta. Consulte [Nativo o en Docker](nativo-o-docker) y [Cuentas de los agentes](cuentas).',
        'Si las pestañas ocupan demasiado espacio, se pueden sustituir por una lista desplegable en **Configuración › Agentes › Selector de agentes**.',
        'Un agente nativo también puede [delegar tareas en cuentas de Docker](delegar-tareas) de Claude Code o Codex del perfil, sobre el mismo proyecto, sin abrir sus ventanas.'
      ]
    },
    {
      ancla: 'cabecera',
      titulo: 'La cabecera y el pie del agente',
      bloques: [
        {
          lista: [
            'El botón del reloj con flecha (**Historial de conversaciones de este proyecto**), a la izquierda de la cabecera: las conversaciones anteriores de este proyecto, para retomarlas o eliminarlas. Consulte [Conversaciones](conversaciones).',
            'El botón del bocadillo con + (**Nueva conversación: la actual se cierra y queda en el historial**), junto al reloj: la conversación actual se cierra y queda en el historial.',
            'El botón del cilindro (**Dar al agente acceso a bases de datos**), a la derecha de la cabecera: qué bases de datos puede usar el agente. Si ya hay bases montadas, muestra su número y el texto emergente indica cuántas puede consultar el agente. Consulte [tdb](herramientas-de-los-agentes/tdb).',
            'El botón de las dos flechas cruzadas (**Continuar en otra cuenta o con Codex**, si usa Claude Code y puede pasar a Codex), junto al de cuenta: continúa la conversación en otra cuenta o pasa el trabajo a otro agente. Consulte [Continuar en otro agente o cuenta](continuar-en-otro-agente).',
            'El botón de la pantalla o del cubo, a la derecha de la cabecera (el texto emergente indica el agente y la cuenta): indica dónde se ejecuta el agente y con qué cuenta. Consulte [Elegir la cuenta](cuentas/elegir).',
            'El botón de maximizar, a la derecha de la cuenta (por ejemplo, **Maximizar: Claude Code ocupa todo el espacio (sin cerrar archivos)**): el agente ocupa todo el espacio sin cerrar los archivos abiertos.',
            'El botón ✕ (**Cerrar el agente de la terminal: termina su sesión y libera la memoria que ocupa (la conversación queda en el historial)**), al extremo derecho: solo aparece en el agente de la terminal.'
          ]
        },
        'Los botones del pie aparecen al pasar el puntero o al recibir el foco. Los de la cabecera permanecen visibles. El pie muestra el uso de la cuenta y cuánto contexto lleva la conversación. En la terminal del agente se pueden pegar imágenes y archivos; si el agente está en Docker, Tessera los copia dentro de su contenedor para que pueda abrirlos.'
      ]
    },
    {
      ancla: 'ocultar',
      titulo: 'Ocultar y ordenar agentes',
      bloques: [
        'Haga clic con el botón derecho en las pestañas de agente para ver la lista de agentes del proyecto. Desmarque un agente para ocultarlo y márquelo para volver a mostrarlo. El aviso que aparece al ocultarlo incluye **Deshacer** para revertir el cambio.',
        {
          lista: [
            'Los agentes ocultos y el orden se aplican a todos los proyectos del perfil.',
            'Claude Code y Codex no se pueden eliminar, solo ocultar. Siempre queda al menos un agente visible.',
            'Para ordenar las pestañas, arrástrelas o use **Ordenar y ocultar agentes en Configuración…**.'
          ]
        }
      ]
    },
    {
      ancla: 'manuales',
      titulo: 'Añadir cualquier otro agente',
      bloques: [
        'Si utiliza otro asistente que se ejecute en una terminal, añádalo con el **+** de las pestañas del agente de un proyecto (**Añadir un agente propio (por su comando)**). También puede abrir **Configuración › Agentes** y seleccionar **Añadir un agente propio (por su comando)…**. Un agente añadido de esta forma se denomina agente propio. Si el selector de agentes está en modo lista, la misma opción aparece en su desplegable.',
        {
          pasos: [
            'Escriba su **Nombre** y su **Comando**, tal como se escribiría en la terminal del proyecto.',
            'Seleccione **Dónde se ejecuta**: en {tuEquipo}, disponible en todos los perfiles, o en Docker, con sus propias cuentas y solo en este perfil. Esta elección no se puede cambiar después.',
            'De forma opcional, complete **Cómo reanudar (opcional)** con la opción que retoma su última conversación. Si se ejecuta en Docker, también puede completar **Órdenes de instalación (opcional)**, que Tessera incorpora a la imagen del perfil.',
            'Haga clic en **Guardar**. El agente aparece como una pestaña nueva. Si se ejecuta en {tuEquipo}, debe instalarlo usted: Tessera solo comprueba que su shell lo encuentre.'
          ]
        },
        {
          nota: 'Tessera no conoce ese programa, por lo que un agente propio no tiene historial de conversaciones, uso de la cuenta, aviso de fin de turno ni hibernación automática. Si el programa informa en JSON de cuánto contexto lleva usado, se puede indicar en **Contexto (opcional)** y el dato aparece al pie del agente.'
        }
      ]
    },
    {
      ancla: 'editar-manual',
      titulo: 'Editar o eliminar un agente propio',
      bloques: [
        'Haga clic con el botón derecho en su pestaña para ver **Editar…**, **Copiar definición (JSON)** y **Eliminar…**. La definición copiada permite añadir el agente en otro equipo con **Pegar definición**, en el formulario de agente nuevo.',
        {
          lista: [
            'Si se ejecuta en {tuEquipo}, se quita de todos los perfiles; lo que guardó en su carpeta personal se conserva.',
            'Si se ejecuta en Docker, se quita de este perfil y se borran sus cuentas y lo que guardó en sus carpetas. Los archivos de los proyectos no se modifican.'
          ]
        },
        'Active el interruptor **Activar en la terminal** del formulario del agente para poder elegirlo también como agente de la [terminal](terminales/pantalla-completa) a pantalla completa.'
      ]
    },
    {
      ancla: 'al-dia',
      titulo: 'Tenerlos al día',
      bloques: [
        'Claude Code y Codex, en {tuEquipo} y en Docker, se actualizan con el botón **Actualizar todos sus agentes** de la barra de título. Consulte [Actualizaciones](actualizaciones).'
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
        'In the right column, each [agent](glosario/agente) in the project has its own tab. Switching tabs does not close anything: each agent keeps its session and its conversation.',
        'For each agent, you choose separately where it runs, on {tuEquipo} or in Docker, and which account it uses. For details, see [Native or in Docker](nativo-o-docker) and [Agent accounts](cuentas).',
        'If the tabs take up too much space, replace them with a drop-down in **Settings › Agents › Agent selector**.',
        'A native agent can also [delegate tasks to Docker accounts](delegar-tareas) for Claude Code or Codex in the profile, on the same project, without opening their windows.'
      ]
    },
    {
      ancla: 'cabecera',
      titulo: 'The agent header and footer',
      bloques: [
        {
          lista: [
            'The clock with an arrow button (**Conversation history of this project**), on the left of the header: the earlier conversations in this project, which you can resume or delete. See [Conversations](conversaciones).',
            'The speech bubble with a + button (**New conversation: closes the current one and keeps it in the history**), next to the clock: closes the current conversation and keeps it in the history.',
            'The cylinder button (**Give the agent access to databases**), on the right of the header: which databases the agent can use. If databases are already mounted, it shows their number and its tooltip says how many the agent can query. See [tdb](herramientas-de-los-agentes/tdb).',
            'The crossed arrows button (**Continue in another account or with Codex**, when using Claude Code with Codex available), next to the account button: continues the conversation in another account or passes the work to another agent. See [Continue in another agent or account](continuar-en-otro-agente).',
            'The screen or cube button, on the right of the header (its tooltip identifies the agent and account): where the agent runs and which account it uses. See [Choose the account](cuentas/elegir).',
            'The maximize button, to the right of the account (for example, **Maximize: Claude Code takes all the space (without closing files)**): the agent fills the whole space without closing your open files.',
            'The ✕ button (**Close the terminal agent: ends its session and frees the memory it uses (the conversation stays in the history)**), at the far right: only in the terminal agent.'
          ]
        },
        'Footer buttons appear on hover or keyboard focus. Header buttons stay visible. The footer shows the account usage and how much context the conversation uses. You can paste images and files into the agent’s terminal; if the agent runs in Docker, Tessera copies them into its container so the agent can open them.'
      ]
    },
    {
      ancla: 'ocultar',
      titulo: 'Hide and reorder agents',
      bloques: [
        'Right-click the agent tabs to see the agents in the project. Clear an agent’s check box to hide it, and select it again to show the agent. The notification that appears when you hide it includes **Undo** to reverse the change.',
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
        'If you use another assistant that runs in a terminal, add it with the **+** in a project’s agent tabs (**Add custom agent (by command)**). You can also open **Settings › Agents** and select **Add custom agent (by command)…**. An agent added this way is called a custom agent. If the agent selector is in list mode, the same option appears in its drop-down.',
        {
          pasos: [
            'Enter its **Name** and its **Command**, exactly as you would type it in the project terminal.',
            'Choose **Where it runs**: on {tuEquipo}, where every profile can use it, or in Docker, with its own accounts and only in this profile. You cannot change this later.',
            'Optionally, fill in **How to resume (optional)** with the option that resumes its last conversation. If it runs in Docker, you can also fill in **Install commands (optional)**; Tessera adds them to the profile’s image.',
            'Click **Save**. The agent appears as a new tab. If it runs on {tuEquipo}, you install it yourself: Tessera only checks that your shell can find it.'
          ]
        },
        {
          nota: 'Tessera does not know this program, so a custom agent has no conversation history, account usage, end-of-turn notification, or automatic hibernation. If the program reports its context usage in JSON, you can specify how to read it in **Context (optional)**, and the usage appears in the agent footer.'
        }
      ]
    },
    {
      ancla: 'editar-manual',
      titulo: 'Edit or delete a custom agent',
      bloques: [
        'Right-click its tab for **Edit…**, **Copy definition (JSON)**, and **Delete…**. With the copied definition, you can add the agent on another computer by using **Paste definition** in the new agent form.',
        {
          lista: [
            'If it runs on {tuEquipo}, it is removed from every profile; the data it saved in your home folder is kept.',
            'If it runs in Docker, it is removed from this profile, and Tessera deletes its accounts and the data it saved in its folders. Project files are not affected.'
          ]
        },
        'Turn on the **Enable in the terminal** switch in the agent form to also choose it as the full-screen [terminal](terminales/pantalla-completa) agent.'
      ]
    },
    {
      ancla: 'al-dia',
      titulo: 'Keep agents up to date',
      bloques: [
        'To update Claude Code and Codex, on {tuEquipo} and in Docker, use the **Update all your agents** button in the title bar. For details, see [Updates](actualizaciones).'
      ]
    }
  ]
}

export const txAgentes = crearTextos(es, en)
