// =============================================================================
// Tessera Academy · Continuar en otro agente o cuenta: la misma conversación en otra cuenta, o
// un traspaso a otro agente. Su forma es la de `modelo.ts` y el inglés repite la del español
// (`test-academy.mts`).
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Permite seguir un trabajo en otra cuenta del mismo agente, con la conversación completa, o pasarlo a otro agente con un resumen para que continúe.',
  secciones: [
    {
      ancla: 'dos-caminos',
      titulo: 'Dos formas de seguir',
      bloques: [
        {
          lista: [
            '**Conversación completa** (otra cuenta del mismo agente): Tessera copia la conversación a esa cuenta, donde continúa con todo su historial. Resulta útil, por ejemplo, cuando una cuenta agota su uso.',
            '**Solo un resumen** (otro agente): Claude Code pasa el trabajo a Codex, o a la inversa. Una conversación no se puede copiar de un agente a otro, así que el agente de destino empieza una conversación nueva con un resumen del trabajo, denominado [traspaso](glosario/traspaso).'
          ]
        },
        'Las dos opciones se encuentran en el botón **⇄** de la cabecera del agente, en el menú **Continuar esta conversación**. En ambos casos, la conversación de origen no cambia y sigue en su [historial](conversaciones).',
        {
          nota: 'El botón está desactivado si no hay una conversación abierta o durante una actualización de los agentes, y no aparece si no existe otra cuenta ni otro agente de destino. El agente de la terminal no dispone de este botón.'
        }
      ]
    },
    {
      ancla: 'otra-cuenta',
      titulo: 'La misma conversación en otra cuenta',
      bloques: [
        {
          pasos: [
            'En la cabecera del agente, haga clic en **⇄**.',
            'En el grupo del agente actual, marcado **Conversación completa**, seleccione la cuenta de destino.',
            'El agente pasa a esa cuenta, en la misma pestaña, y reanuda la conversación.'
          ]
        },
        'Esta opción funciona entre [cuentas](cuentas) de Docker y entre {tuEquipo} y Docker. A partir de ese momento existen dos copias: lo que se escriba en una no aparece en la otra.',
        { nota: 'Si el agente tiene un turno en marcha (está trabajando o espera una respuesta), Tessera pide confirmación antes: el turno se interrumpe y la conversación sigue en la otra cuenta desde el último punto guardado.' },
        { captura: 'continuar-conversacion', alt: 'El menú del botón ⇄, con las otras cuentas del mismo agente y las del otro agente' }
      ]
    },
    {
      ancla: 'otro-agente',
      titulo: 'Pasar el trabajo a otro agente',
      bloques: [
        'El grupo del otro agente, marcado **Solo un resumen**, aparece en el agente de un proyecto, fuera del [mosaico](mosaico), si el otro agente tiene una pestaña visible en ese proyecto.',
        {
          pasos: [
            'En la cabecera del agente, haga clic en **⇄**.',
            'En el grupo del otro agente, seleccione la cuenta con la que debe continuar.',
            'Tessera abre la pestaña de ese agente con una conversación nueva. Su primer mensaje le pide leer el traspaso con `tctx traspaso`, resumirlo y esperar sus instrucciones.'
          ]
        },
        'Ningún modelo redacta el traspaso: Tessera lo compone automáticamente con lo siguiente:',
        {
          lista: [
            'Los últimos mensajes de texto de la conversación con el agente, tantos como quepan. No incluye la actividad de las herramientas, ni imágenes, ni el razonamiento del agente.',
            'El estado de git del proyecto: los archivos modificados y los cinco últimos commits.'
          ]
        },
        { nota: 'Si el agente de destino tiene un turno en marcha en este proyecto (está trabajando o espera una respuesta), Tessera pide confirmación antes: el turno se interrumpe y su conversación queda en su historial. El agente de origen sigue abierto.' }
      ]
    },
    {
      ancla: 'cual-elegir',
      titulo: '¿Cuál elegir?',
      bloques: [
        'Si es posible seguir con el mismo agente, conviene cambiar de cuenta: el agente conserva la conversación completa, con todo lo que leyó y probó. El paso a otro agente solo lleva un resumen, por lo que conviene cuando se busca otra forma de trabajar o una segunda opinión y no hacen falta todos los detalles.'
      ]
    },
    {
      ancla: 'limites',
      titulo: 'Lo que conviene saber',
      bloques: [
        {
          lista: [
            'Todo ocurre dentro del mismo perfil y del mismo proyecto.',
            'Los [agentes propios](agentes/manuales) no pueden ser origen ni destino, porque Tessera no sabe leer sus conversaciones.',
            'Solo puede leer el traspaso la sesión que se abrió para recibirlo, y solo mientras esa sesión siga abierta. El traspaso no se guarda en disco ni en el repositorio.',
            'Codex en Docker necesita [acceso completo](nativo-o-docker/codex) para leer el traspaso.',
            'Si el destino no se abre en 10 minutos, la operación caduca y hay que volver a solicitarla desde **⇄**.',
            'Con una ruta de proyecto muy larga, Claude Code no puede seguir la conversación en otra cuenta. Tessera lo indica y se puede continuar con otro agente desde **⇄**.'
          ]
        }
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Continue your work in another account of the same agent, with the whole conversation, or pass it to another agent with a summary so that agent can continue it.',
  secciones: [
    {
      ancla: 'dos-caminos',
      titulo: 'Two ways to continue',
      bloques: [
        {
          lista: [
            '**Full conversation** (another account of the same agent): Tessera copies the conversation to that account, where it continues with its full history. This is useful, for example, when an account reaches its usage limit.',
            '**Summary only** (another agent): Claude Code passes the work to Codex, or the other way around. A conversation cannot be copied from one agent to the other, so the destination agent starts a new conversation with a summary of the work, called a [handoff](glosario/traspaso).'
          ]
        },
        'Both options are in the **⇄** button in the agent header, in the **Continue this conversation** menu. In both cases, the original conversation does not change and stays in its [history](conversaciones).',
        {
          nota: 'The button is disabled if no conversation is open or while the agents are updating, and it does not appear if there is no other account or agent to go to. The terminal agent does not have this button.'
        }
      ]
    },
    {
      ancla: 'otra-cuenta',
      titulo: 'The same conversation in another account',
      bloques: [
        {
          pasos: [
            'In the agent header, click **⇄**.',
            'In the group for the current agent, marked **Full conversation**, choose the destination account.',
            'The agent switches to that account, in the same tab, and resumes the conversation.'
          ]
        },
        'This works between Docker [accounts](cuentas), and between {tuEquipo} and Docker. From then on, there are two separate copies: what you write in one does not appear in the other.',
        { nota: 'If the agent has a turn running (it is working or waiting for a reply), Tessera asks you first: the turn stops, and the conversation continues in the other account from the last point saved.' },
        { captura: 'continuar-conversacion', alt: 'The ⇄ button menu, with the other accounts of the same agent and those of the other agent' }
      ]
    },
    {
      ancla: 'otro-agente',
      titulo: 'Pass the work to another agent',
      bloques: [
        'The group for the other agent, marked **Summary only**, appears for a project’s agent, outside the [mosaic](mosaico), if the other agent has a visible tab in that project.',
        {
          pasos: [
            'In the agent header, click **⇄**.',
            'In the group for the other agent, choose the account it should continue with.',
            'Tessera opens that agent’s tab with a new conversation. The first message asks the agent to read the handoff with `tctx traspaso`, summarize it, and wait for your instructions.'
          ]
        },
        'No model writes the handoff: Tessera assembles it automatically from the following:',
        {
          lista: [
            'Your most recent text messages and the agent’s, as many as fit. It does not include tool activity, images, or the agent’s reasoning.',
            'The project’s Git status: the changed files and the last five commits.'
          ]
        },
        { nota: 'If the destination agent has a turn running in this project (it is working or waiting for a reply), Tessera asks you first: that turn stops, and its conversation stays in its history. The original agent stays open.' }
      ]
    },
    {
      ancla: 'cual-elegir',
      titulo: 'Which option should I choose?',
      bloques: [
        'If you can keep the same agent, switch accounts: the agent keeps the whole conversation, including everything it read and tried. Moving to another agent passes only a summary, so it works best when you want a different approach or a second opinion and you do not need every detail.'
      ]
    },
    {
      ancla: 'limites',
      titulo: 'Limitations',
      bloques: [
        {
          lista: [
            'Everything stays within the same profile and the same project.',
            '[Custom agents](agentes/manuales) can be neither the origin nor the destination, because Tessera cannot read their conversations.',
            'Only the session opened to receive the handoff can read it, and only while that session stays open. The handoff is not saved to disk or to the repository.',
            'Codex in Docker needs [full access](nativo-o-docker/codex) to read the handoff.',
            'If the destination does not open within 10 minutes, the operation expires and you have to request it again from **⇄**.',
            'If the project path is very long, Claude Code cannot continue the conversation in another account. Tessera tells you, and you can continue with another agent from **⇄** instead.'
          ]
        }
      ]
    }
  ]
}

export const txContinuarEnOtroAgente = crearTextos(es, en)
