// =============================================================================
// Tessera Academy · Cuentas de los agentes: la del equipo, las de Docker, el selector de cuenta
// y lo que es de cada cuenta (conversaciones y uso).
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`).
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Cada agente trabaja con una cuenta, la sesión iniciada con la que accede a su proveedor: la de su equipo o una de Docker. Las cuentas de Docker permiten usar varias suscripciones del mismo agente al mismo tiempo.',
  secciones: [
    {
      ancla: 'tu-equipo',
      titulo: 'La cuenta de su equipo',
      bloques: [
        'Es la sesión ya iniciada en Claude Code o Codex en {tuEquipo}. La usan los agentes [nativos](glosario/nativo), es decir, los que se ejecutan directamente en su equipo, y es la misma en todos los perfiles: si se cambia fuera de Tessera, cambia para todos.',
        'Es la opción predeterminada: un agente nuevo empieza con esta cuenta.'
      ]
    },
    {
      ancla: 'docker',
      titulo: 'Las cuentas de Docker',
      bloques: [
        'Una cuenta de Docker es una sesión independiente que Tessera guarda y que pertenece a un agente de un perfil: ningún otro perfil puede verla. Cada cuenta se ejecuta en su propio [contenedor](glosario/contenedor), de modo que dos cuentas del mismo agente pueden trabajar al mismo tiempo sin interferir entre sí.',
        {
          lista: [
            'Tiene un nombre para reconocerla, por ejemplo «Trabajo» o «Pruebas».',
            'Ese agente puede usarla en cualquier proyecto del perfil.',
            'La primera vez, el panel del agente ofrece **Iniciar sesión**. En Codex, el inicio de sesión se completa en el navegador y solo puede haber uno en curso al mismo tiempo; las cuentas que ya tienen la sesión iniciada pueden trabajar simultáneamente.',
            'Cada contenedor cuenta para el límite de **Configuración › Contenedores Docker**. Consulte [Contenedores de Docker](contenedores-docker).'
          ]
        },
        'También puede [delegar tareas en estas cuentas](delegar-tareas) desde un agente nativo o una terminal de Tessera, sin abrir la ventana de la cuenta.',
        'Para crear una cuenta de Docker:',
        {
          pasos: [
            'En la cabecera del agente, a la derecha, haga clic en el botón de la pantalla (o del cubo, en Docker) y seleccione **Nueva cuenta de Docker…**. Antes debe tener [Docker en ejecución](nativo-o-docker/requisitos). Se abre el diálogo **Nueva cuenta de Docker**.',
            'En **Agente de la cuenta**, elija Claude Code o Codex si aparece esa opción. Escriba un nombre para reconocerla y haga clic en **Crear e iniciar sesión**.',
            'Si eligió el mismo agente, la pestaña pasa a usar la cuenta nueva, con su propio historial, y solicita el inicio de sesión. Si eligió el otro agente, esta pestaña sigue igual: se crea la cuenta y se abre su inicio de sesión; la cuenta queda disponible para las pestañas de ese agente y para `tctx delegar`.'
          ]
        }
      ]
    },
    {
      ancla: 'elegir',
      titulo: 'Elegir la cuenta',
      bloques: [
        'El botón de cuenta está en la cabecera del agente. Su icono es una pantalla si el agente se ejecuta en {tuEquipo} y un cubo si se ejecuta en Docker. Al hacer clic en él se abre el selector:',
        {
          lista: [
            '**En su equipo**: una tarjeta con la cuenta de {tuEquipo}. Al seleccionarla, el agente pasa a ser nativo.',
            '**Cuentas de Docker**: una tarjeta por cada cuenta de Docker de ese agente en el perfil. Al seleccionar una, el agente pasa a Docker con esa cuenta.',
            'La tarjeta marcada es la que el agente usa en ese momento. Tessera recuerda la selección por agente y proyecto.',
            '**Nueva cuenta de Docker…**, al pie del selector, abre **Nueva cuenta de Docker** para elegir el agente y el nombre; la pestaña cambia de cuenta solo si se crea para el mismo agente.'
          ]
        },
        'Al pasar el puntero por una tarjeta de Docker aparece su botón **⋯**, con las acciones **Editar configuración…**, **Renombrar**, **Cerrar sesión…** y, separada al final, **Eliminar cuenta…**. Un clic en la tarjeta solo selecciona la cuenta; nunca ejecuta una acción.',
        'Al pie del selector, **Administrar las cuentas…**, con un engranaje, abre **Configuración › Agentes**. Cada agente de serie, aunque esté oculto, tiene un botón con el icono del contenedor y el número de cuentas. Haga clic para desplegar **Cuentas de Docker**, con **Iniciar sesión**, **Nueva cuenta…** y el menú **⋯** de cada cuenta para renombrarla, cerrar sesión, eliminarla o editar su configuración. Para iniciar sesión desde Configuración, antes debe [abrir un proyecto](proyectos/abrir) de este perfil.',
        {
          nota: 'El agente de la terminal y los [agentes propios](agentes/manuales) que se ejecutan en {tuEquipo} no tienen botón de cuenta. En un agente propio en Docker, el selector solo muestra **Cuentas** y **Nueva cuenta…**, porque no puede pasar a nativo.'
        },
        { captura: 'selector-de-cuenta', alt: 'El selector de cuenta abierto, con la tarjeta de su equipo y dos cuentas de Docker' }
      ]
    },
    {
      ancla: 'configuracion',
      titulo: 'Editar la configuración de una cuenta',
      bloques: [
        'Cada cuenta de Claude Code y Codex tiene sus propios archivos, también las de Docker. Para editarlos, use **Editar configuración…** en el menú **⋯** de una cuenta de Docker, o, en el [contexto de los agentes](reglas-del-perfil), la **Configuración de Docker** de su perfil, eligiendo la cuenta en **Se aplica a**. Los agentes nativos de {tuEquipo} están en **En su equipo**.',
        {
          lista: [
            '**Configuración**: `settings.json` en Claude Code y `config.toml` en Codex. Controla el modelo, la ventana de contexto y las demás opciones que admita su versión.',
            '**Instrucciones**: `CLAUDE.md` en Claude Code y `AGENTS.md` en Codex. Son indicaciones para el agente, por ejemplo, el estilo de sus respuestas. En una cuenta de Docker, Tessera mantiene ahí un bloque entre marcas con los avisos del contenedor: escriba fuera de esas marcas.'
          ]
        },
        'Son los archivos reales de la cuenta. Tessera no añade ni cambia opciones: **Referencia de opciones** abre la documentación oficial de cada agente.',
        {
          lista: [
            'Al guardar la configuración se comprueba su sintaxis. Si hay un error, se indica la línea y el archivo no cambia.',
            'Si el archivo cambió desde que se abrió, nada se guarda hasta que elija entre cargar esa versión o sobrescribirla.',
            '**Recuperar la versión anterior** carga en el editor lo que había antes del último guardado desde Tessera.'
          ]
        },
        {
          nota: 'Los cambios se aplican con certeza en las sesiones que se abran después de guardar. Los archivos con credenciales y el estado interno de los agentes no se muestran.'
        },
        'Lo que quiere igual en varias cuentas, como la ventana de contexto, se escribe una sola vez en la **Configuración de Docker** del contexto global o de un perfil. Al abrir una sesión en Docker, cada cuenta lo recibe en este orden:',
        {
          pasos: [
            '**Global**: lo que vale para las cuentas de Docker de todos los perfiles que usan el contexto global.',
            'El perfil: lo que ese perfil cambia sobre el global. Si una clave está en los dos, prevalece la del perfil. El interruptor **Usar el contexto global en este perfil** decide si el perfil recibe el global.',
            'Cada cuenta: lo propio de esa cuenta, en sus archivos, que Tessera no modifica. Al abrir una sesión, el agente aplica encima lo de los niveles anteriores: si una clave está en la cuenta y en uno de ellos, prevalece ese nivel.'
          ]
        },
        {
          lista: [
            'Las tablas del global y del perfil se combinan: lo que el global tiene dentro de una tabla y el perfil no menciona se conserva. Una lista se sustituye entera.',
            'Con la cuenta las combina el propio agente. En Claude Code, las listas de permisos se suman: los permisos propios de la cuenta se mantienen.',
            'En Claude Code, esta configuración prevalece también sobre la del proyecto (`.claude/settings.json`). En Codex se aplica con las versiones que admiten perfiles por archivo; con una anterior, el agente arranca con la configuración de la cuenta.',
            'Quitar una clave o desactivar el interruptor se nota en la próxima sesión: en la cuenta no queda nada escrito.',
            'Las reglas no van en estos archivos: son parte del contexto y llegan a cada sesión al iniciarse.',
            'Al editar una cuenta, un aviso indica qué claves aplica Tessera encima y si son globales o del perfil.'
          ]
        }
      ]
    },
    {
      ancla: 'administrar',
      titulo: 'Renombrar, cerrar sesión o eliminar',
      bloques: [
        {
          lista: [
            '**Renombrar** cambia solo la etiqueta: la sesión y las conversaciones no cambian.',
            '**Cerrar sesión…** cierra la sesión de esa cuenta; para volver a usarla hay que iniciar sesión otra vez.',
            '**Eliminar cuenta…** borra de {tuEquipo} su sesión y todas sus conversaciones, de forma definitiva. La cuenta en el proveedor no cambia.'
          ]
        },
        'Si otros agentes abiertos usan esa cuenta, el diálogo avisa de ello y sus sesiones se cierran. La cuenta **Predeterminada**, que existe si el perfil ya tenía una sesión iniciada, no se puede renombrar ni eliminar.',
        {
          nota: 'En un [agente propio](agentes/manuales) no se puede cerrar sesión, porque Tessera no sabe qué archivos contienen su credencial. Las cuentas que se le crearon solo se pueden eliminar.'
        }
      ]
    },
    {
      ancla: 'conversaciones-y-uso',
      titulo: 'Conversaciones y uso, por cuenta',
      bloques: [
        'Cada cuenta tiene sus propias conversaciones. Al cambiar de cuenta, el agente se abre con las conversaciones de la otra cuenta. Para llevar a la otra cuenta la conversación abierta, use el botón **⇄** de la cabecera. Consulte [Continuar en otro agente o cuenta](continuar-en-otro-agente).',
        'El pie del agente muestra el uso de su cuenta con los límites que tenga su plan: el de cada 5 horas, el semanal y el de un modelo concreto, si existen.'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Each agent works with an account, the signed-in session it uses to reach its provider: the account on your computer or a Docker account. With Docker accounts, you can use several subscriptions of the same agent at once.',
  secciones: [
    {
      ancla: 'tu-equipo',
      titulo: 'The account on your computer',
      bloques: [
        'This is the session you are already signed in to in Claude Code or Codex on {tuEquipo}. [Native](glosario/nativo) agents, which run directly on your computer, use it, and it is the same in every profile: if you change it outside Tessera, it changes for all profiles.',
        'This is the default: every new agent starts with this account.'
      ]
    },
    {
      ancla: 'docker',
      titulo: 'Docker accounts',
      bloques: [
        'A Docker account is a separate session that Tessera stores and that belongs to one agent in one profile: no other profile can see it. Each Docker account runs in its own [container](glosario/contenedor), so two accounts of the same agent can work at the same time without interfering with each other.',
        {
          lista: [
            'It has a name so you can recognize it, for example “Work” or “Testing”.',
            'That agent can use it in any project of the profile.',
            'The first time, the agent panel offers **Sign in**. For Codex, you complete the sign-in in your browser, and only one sign-in can be in progress at a time; accounts that are already signed in can work simultaneously.',
            'Each container counts toward the limit in **Settings › Docker containers**. See [Docker containers](contenedores-docker).'
          ]
        },
        'You can also [delegate tasks to these accounts](delegar-tareas) from a native agent or a Tessera terminal, without opening the account’s window.',
        'To create a Docker account:',
        {
          pasos: [
            'On the right of the agent header, click the screen button (or the cube, in Docker) and select **New Docker account…**. First, you must have [Docker running](nativo-o-docker/requisitos). The **New Docker account** dialog opens.',
            'In **Account agent**, choose Claude Code or Codex if that option appears. Enter a name to recognize it and click **Create and sign in**.',
            'If you chose the same agent, the tab switches to the new account, with its own history, and asks you to sign in. If you chose the other agent, this tab stays as it is: the account is created and its sign-in opens; the account becomes available to that agent’s tabs and to `tctx delegar`.'
          ]
        }
      ]
    },
    {
      ancla: 'elegir',
      titulo: 'Choose the account',
      bloques: [
        'The account button is in the agent header. Its icon is a screen if the agent runs on {tuEquipo}, and a cube if it runs in Docker. Click it to open the selector:',
        {
          lista: [
            '**On your computer**: a card with the account on {tuEquipo}. Choose it to make the agent native.',
            '**Docker accounts**: one card for each Docker account of that agent in the profile. Choose one to move the agent to Docker with that account.',
            'The selected card shows the account the agent uses now. Tessera remembers the choice for each agent and project.',
            '**New Docker account…**, at the bottom, opens **New Docker account** to choose the agent and name; the tab switches accounts only if you create one for the same agent.'
          ]
        },
        'When you hover over a Docker card, its **⋯** button appears with these actions: **Edit configuration…**, **Rename**, **Sign out…**, and, separated at the end, **Delete account…**. Clicking the card only selects the account; it never triggers an action.',
        'At the bottom of the selector, **Manage accounts…**, with a gear icon, opens **Settings › Agents**. Each built-in agent, including hidden ones, has a button with a container icon and its account count. Click it to expand **Docker accounts**, with **Sign in**, **New account…**, and each account’s **⋯** menu to rename it, sign out, delete it, or edit its configuration. To sign in from Settings, first [open a project](proyectos/abrir) in this profile.',
        {
          nota: 'The terminal agent and [custom agents](agentes/manuales) that run on {tuEquipo} have no account button. For a custom agent in Docker, the selector shows only **Accounts** and **New account…**, because it cannot become native.'
        },
        { captura: 'selector-de-cuenta', alt: 'The open account selector, with the card for your computer and two Docker accounts' }
      ]
    },
    {
      ancla: 'configuracion',
      titulo: 'Edit the configuration of an account',
      bloques: [
        'Each Claude Code and Codex account has its own files, including Docker accounts. To edit them, use **Edit configuration…** in the **⋯** menu of a Docker account, or, in the [agent context](reglas-del-perfil), the **Docker configuration** of its profile, choosing the account in **Applies to**. The native agents on {tuEquipo} are under **On your computer**.',
        {
          lista: [
            '**Configuration**: `settings.json` in Claude Code and `config.toml` in Codex. It controls the model, the context window, and the other options its version accepts.',
            '**Instructions**: `CLAUDE.md` in Claude Code and `AGENTS.md` in Codex. These are directions for the agent, for example, the style of its answers. In a Docker account, Tessera keeps a block there, between markers, with the container notices: write outside those markers.'
          ]
        },
        'These are the actual files of the account. Tessera does not add or change options: **Options reference** opens the official documentation of each agent.',
        {
          lista: [
            'Saving the configuration checks its syntax. If there is an error, the line is shown and the file does not change.',
            'If the file changed after it was opened, nothing is saved until you choose to load that version or overwrite it.',
            '**Recover the previous version** loads into the editor what was there before you last saved from Tessera.'
          ]
        },
        {
          nota: 'Changes are guaranteed to apply to sessions opened after saving. Files with credentials and the internal state of the agents are not shown.'
        },
        'What you want the same in several accounts, such as the context window, is written once in the **Docker configuration** of the global context or of a profile. When a session opens in Docker, each account receives it in this order:',
        {
          pasos: [
            '**Global**: what applies to the Docker accounts of every profile that uses the global context.',
            'The profile: what that profile changes over global. If a key is in both, the profile prevails. The **Use the global context in this profile** switch decides whether the profile receives the global one.',
            'Each account: what belongs to that account, in its files, which Tessera does not change. When a session opens, the agent applies the previous levels on top: if a key is in the account and in one of them, that level prevails.'
          ]
        },
        {
          lista: [
            'The global and profile tables are combined: whatever global has inside a table and the profile does not mention is kept. A list is replaced as a whole.',
            'The agent itself combines them with the account. In Claude Code, permission lists are added together: the account’s own permissions are kept.',
            'In Claude Code, this configuration also prevails over the project’s (`.claude/settings.json`). In Codex it applies with versions that support file-based profiles; with an earlier one, the agent starts with the account configuration.',
            'Removing a key or turning the switch off takes effect in the next session: nothing is left written in the account.',
            'The rules are not in these files: they are part of the context and reach each session when it starts.',
            'When you edit an account, a notice shows which keys Tessera applies on top and whether they are global or from the profile.'
          ]
        }
      ]
    },
    {
      ancla: 'administrar',
      titulo: 'Rename, sign out, or delete',
      bloques: [
        {
          lista: [
            '**Rename** changes only the label: the session and the conversations stay the same.',
            '**Sign out…** closes that account’s session; you have to sign in again to use the account.',
            '**Delete account…** permanently deletes its session and all its conversations from {tuEquipo}. Your account with the provider does not change.'
          ]
        },
        'If other open agents use that account, the dialog tells you, and Tessera closes their sessions. The **Default** account, which exists if the profile already had a signed-in session, cannot be renamed or deleted.',
        {
          nota: 'You cannot sign out of a [custom agent](agentes/manuales), because Tessera does not know which files hold its credentials. The accounts you created for it can only be deleted.'
        }
      ]
    },
    {
      ancla: 'conversaciones-y-uso',
      titulo: 'Conversations and usage per account',
      bloques: [
        'Each account has its own conversations. When you switch accounts, the agent opens with the conversations of the other account. To bring the open conversation with you, use the **⇄** button in the header. See [Continue in another agent or account](continuar-en-otro-agente).',
        'The agent footer shows the usage of its account with the limits its plan has: the 5-hour limit, the weekly limit, and the limit for a specific model, if there are any.'
      ]
    }
  ]
}

export const txCuentas = crearTextos(es, en)
