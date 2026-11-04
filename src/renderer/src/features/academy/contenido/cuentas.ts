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
        'Para crear una cuenta de Docker:',
        {
          pasos: [
            'En la cabecera del agente, haga clic en el botón de cuenta y seleccione **Nueva cuenta de Docker…**.',
            'Escriba un nombre para reconocerla y haga clic en **Crear e iniciar sesión**.',
            'El agente pasa a usar la cuenta nueva, con su propio historial, y solicita el inicio de sesión.'
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
            '**Cuentas aisladas (Docker)**: una tarjeta por cada cuenta de Docker de ese agente en el perfil. Al seleccionar una, el agente pasa a Docker con esa cuenta.',
            'La tarjeta marcada es la que el agente usa en ese momento. Tessera recuerda la selección por agente y proyecto.',
            '**Nueva cuenta de Docker…**, al pie del selector, crea una cuenta, solicita un nombre y cambia el agente a esa cuenta.'
          ]
        },
        'Al pasar el puntero por una tarjeta de Docker aparece su botón **⋯**, con las acciones **Renombrar**, **Cerrar sesión…** y, separada al final, **Eliminar cuenta…**. Un clic en la tarjeta solo selecciona la cuenta; nunca ejecuta una acción.',
        {
          nota: 'El agente de la terminal y los [agentes propios](agentes/manuales) que se ejecutan en {tuEquipo} no tienen botón de cuenta. En un agente propio en Docker, el selector solo muestra **Cuentas** y **Nueva cuenta…**, porque no puede pasar a nativo.'
        },
        { captura: 'selector-de-cuenta', alt: 'El selector de cuenta abierto, con la tarjeta de su equipo y dos cuentas de Docker' }
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
        'To create a Docker account:',
        {
          pasos: [
            'In the agent header, click the account button and choose **New Docker account…**.',
            'Enter a name to recognize it and click **Create and sign in**.',
            'The agent switches to the new account, with its own history, and asks you to sign in.'
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
            '**Isolated accounts (Docker)**: one card for each Docker account of that agent in the profile. Choose one to move the agent to Docker with that account.',
            'The selected card shows the account the agent uses now. Tessera remembers the choice for each agent and project.',
            '**New Docker account…**, at the bottom, creates an account, asks you for a name, and switches the agent to it.'
          ]
        },
        'When you hover over a Docker card, its **⋯** button appears with these actions: **Rename**, **Sign out…**, and, separated at the end, **Delete account…**. Clicking the card only selects the account; it never triggers an action.',
        {
          nota: 'The terminal agent and [custom agents](agentes/manuales) that run on {tuEquipo} have no account button. For a custom agent in Docker, the selector shows only **Accounts** and **New account…**, because it cannot become native.'
        },
        { captura: 'selector-de-cuenta', alt: 'The open account selector, with the card for your computer and two Docker accounts' }
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
