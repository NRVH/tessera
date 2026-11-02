// =============================================================================
// Tessera Academy · Cuentas de los agentes: la de tu equipo, las de Docker, el selector de cuenta
// y lo que es de cada cuenta (conversaciones y uso).
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`).
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Cada agente trabaja con una cuenta: la de tu equipo o una de Docker. Con cuentas de Docker puedes usar varias suscripciones del mismo agente a la vez.',
  secciones: [
    {
      ancla: 'tu-equipo',
      titulo: 'La cuenta de tu equipo',
      bloques: [
        'Es la sesión que ya tienes iniciada en Claude Code o Codex en {tuEquipo}. La usan los agentes que corren [nativos](glosario/nativo), y es la misma en todos los perfiles: cambiarla fuera de Tessera la cambia para todos.',
        'Es la opción por defecto: un agente nuevo empieza con ella.'
      ]
    },
    {
      ancla: 'docker',
      titulo: 'Las cuentas de Docker',
      bloques: [
        'Una cuenta de Docker es una sesión aparte, guardada por Tessera y propia de su perfil: ningún otro perfil la ve. Cada una corre en su propio [contenedor](glosario/contenedor), así que dos cuentas del mismo agente trabajan a la vez sin pisarse.',
        {
          lista: [
            'Le pones un nombre para reconocerla, por ejemplo «Trabajo» o «Pruebas».',
            'La usan los agentes en Docker de todos los proyectos del perfil que la elijan.',
            'La primera vez, el panel del agente ofrece **Iniciar sesión**. Con Codex se inicia en tu navegador, y solo una cuenta a la vez.',
            'Cada contenedor cuenta para el límite de **Configuración › Contenedores Docker**. Ver [Contenedores de Docker](contenedores-docker).'
          ]
        }
      ]
    },
    {
      ancla: 'elegir',
      titulo: 'Elegir la cuenta',
      bloques: [
        'El botón de cuenta está en la cabecera del agente: su icono es una pantalla si corre en {tuEquipo} y un cubo si corre en Docker. Al pulsarlo se abre el selector:',
        {
          lista: [
            '**En tu equipo**: una tarjeta con la cuenta de {tuEquipo}. Elegirla pasa el agente a nativo.',
            '**Cuentas aisladas (Docker)**: una tarjeta por cuenta de Docker del perfil. Elegir una pasa el agente a Docker con ella.',
            'La tarjeta marcada es la que usa el agente ahora. La elección se recuerda por agente y proyecto.',
            '**Nueva cuenta de Docker…**, al pie, crea una cuenta, le pide un nombre y pasa el agente a usarla.'
          ]
        },
        'Al pasar por una tarjeta aparece su botón **⋯** con sus acciones: **Continuar esta conversación en…** (llevarte la conversación a esa cuenta), **Renombrar**, **Cerrar sesión…** y, aparte y al final, **Eliminar cuenta…**. Un clic en la tarjeta solo elige: nunca cae en una acción.',
        { captura: 'selector-de-cuenta', alt: 'El selector de cuenta abierto, con la tarjeta de tu equipo, dos cuentas de Docker y el menú ⋯ de una de ellas' }
      ]
    },
    {
      ancla: 'administrar',
      titulo: 'Renombrar, cerrar sesión o eliminar',
      bloques: [
        {
          lista: [
            '**Renombrar** cambia solo la etiqueta: la sesión y las conversaciones siguen igual.',
            '**Cerrar sesión…** te obliga a iniciar sesión otra vez para volver a usarla.',
            '**Eliminar cuenta…** borra de {tuEquipo} su sesión y todas sus conversaciones, sin vuelta atrás. Tu cuenta en el proveedor no cambia.'
          ]
        },
        'Si otros agentes abiertos usan esa cuenta, el diálogo lo avisa y sus sesiones se cierran. La cuenta **Predeterminada** no se renombra ni se elimina.',
        {
          nota: 'De un agente que añadiste a mano no se puede cerrar sesión, porque Tessera no sabe qué archivos son su credencial: sus cuentas solo se eliminan.'
        }
      ]
    },
    {
      ancla: 'conversaciones-y-uso',
      titulo: 'Conversaciones y uso, por cuenta',
      bloques: [
        'Cada cuenta tiene sus propias conversaciones. Al cambiar de cuenta, el agente se abre con las de la otra; para llevarte la que tienes abierta, usa **Continuar esta conversación en…**. Ver [Continuar en otro agente o cuenta](continuar-en-otro-agente).',
        'El pie del agente enseña el uso de su cuenta con los límites que tenga su plan: el de cada 5 horas, el semanal y el de un modelo concreto, si los hay.'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Each agent works with an account: the account on your computer or a Docker account. With Docker accounts, you can use several subscriptions of the same agent at once.',
  secciones: [
    {
      ancla: 'tu-equipo',
      titulo: 'The account on your computer',
      bloques: [
        'This is the session you are already signed in to in Claude Code or Codex on {tuEquipo}. [Native](glosario/nativo) agents use it, and it is the same in every profile: if you change it outside Tessera, it changes for all profiles.',
        'This is the default: every new agent starts with this account.'
      ]
    },
    {
      ancla: 'docker',
      titulo: 'Docker accounts',
      bloques: [
        'A Docker account is a separate session that Tessera stores and that belongs to one profile: no other profile can see it. Each Docker account runs in its own [container](glosario/contenedor), so two accounts of the same agent can work at the same time without interfering with each other.',
        {
          lista: [
            'You give it a name so you can recognize it, for example “Work” or “Testing”.',
            'Any Docker agent in any project of the profile can use it: just choose it for that agent.',
            'The first time, the agent panel offers **Sign in**. For Codex, you sign in through your browser, one account at a time.',
            'Each container counts toward the limit in **Settings › Docker containers**. See [Docker containers](contenedores-docker).'
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
            '**Isolated accounts (Docker)**: one card for each Docker account in the profile. Choose one to move the agent to Docker with that account.',
            'The selected card shows the account the agent uses now. Tessera remembers the choice for each agent and project.',
            '**New Docker account…**, at the bottom, creates an account, asks you for a name, and switches the agent to it.'
          ]
        },
        'When you hover over a card, its **⋯** button appears with these actions: **Continue this conversation in…** (moves the conversation to that account), **Rename**, **Sign out…**, and, separated at the end, **Delete account…**. Clicking the card only selects the account; it never triggers an action.',
        { captura: 'selector-de-cuenta', alt: 'The open account selector, with the card for your computer, two Docker accounts, and the ⋯ menu of one of them' }
      ]
    },
    {
      ancla: 'administrar',
      titulo: 'Rename, sign out, or delete',
      bloques: [
        {
          lista: [
            '**Rename** changes only the label: the session and the conversations stay the same.',
            '**Sign out…** means you have to sign in again to use the account.',
            '**Delete account…** permanently deletes its session and all its conversations from {tuEquipo}. Your account with the provider does not change.'
          ]
        },
        'If other open agents use that account, the dialog tells you, and Tessera closes their sessions. You cannot rename or delete the **Default** account.',
        {
          nota: 'You cannot sign out of an agent you added yourself, because Tessera does not know which files hold its credentials. You can only delete its accounts.'
        }
      ]
    },
    {
      ancla: 'conversaciones-y-uso',
      titulo: 'Conversations and usage per account',
      bloques: [
        'Each account has its own conversations. When you switch accounts, the agent opens with the conversations of the other account. To bring the open conversation with you, use **Continue this conversation in…**. See [Continue in another agent or account](continuar-en-otro-agente).',
        'The agent footer shows the usage of its account with the limits its plan has: the 5-hour limit, the weekly limit and the limit for a specific model, if there are any.'
      ]
    }
  ]
}

export const txCuentas = crearTextos(es, en)
