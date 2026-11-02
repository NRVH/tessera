// =============================================================================
// Tessera Academy · Continuar en otro agente o cuenta: la misma conversación en otra cuenta, o
// un traspaso a otro agente. Su forma es la de `modelo.ts` y el inglés repite la del español
// (`test-academy.mts`).
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Sigue lo que estabas haciendo en otra cuenta del mismo agente, con la conversación entera, o pásaselo a otro agente con un resumen para que continúe.',
  secciones: [
    {
      ancla: 'dos-caminos',
      titulo: 'Dos formas de seguir',
      bloques: [
        {
          lista: [
            '**El mismo agente en otra cuenta**: la conversación se copia a esa cuenta y sigue allí con todo su historial. Sirve, por ejemplo, cuando a una cuenta se le acaba el uso.',
            '**Otro agente**: Claude Code le pasa el trabajo a Codex, o al revés. No se puede copiar una conversación de uno a otro, así que el agente nuevo empieza una conversación con un resumen de lo que se hizo.'
          ]
        },
        'En los dos casos la conversación de origen no cambia y sigue en su [historial](conversaciones).'
      ]
    },
    {
      ancla: 'otra-cuenta',
      titulo: 'La misma conversación en otra cuenta',
      bloques: [
        {
          pasos: [
            'En la cabecera del agente, pulsa el botón de la cuenta para abrir el selector.',
            'Pasa por la tarjeta de la cuenta a la que quieres ir y pulsa su **⋯**.',
            'Elige **Continuar esta conversación en…**: el agente pasa a esa cuenta y reanuda la conversación.'
          ]
        },
        'Vale entre [cuentas](cuentas) de Docker y entre {tuEquipo} y Docker. Desde ese momento hay dos copias: lo que hables en una no aparece en la otra.',
        { nota: 'Si el agente está trabajando, Tessera pregunta antes: su turno se corta y la conversación sigue en la otra cuenta desde lo último que alcanzó a guardar.' },
        { captura: 'continuar-menu-cuenta', alt: 'El selector de cuenta del agente con el menú ⋯ de una tarjeta abierto y la opción Continuar esta conversación en' }
      ]
    },
    {
      ancla: 'otro-agente',
      titulo: 'Pasar el trabajo a otro agente',
      bloques: [
        'Si el proyecto tiene pestaña para los dos agentes, la cabecera del agente (fuera del mosaico) enseña el botón **Continuar con Codex…** (o **Continuar con Claude Code…**). Elige con qué cuenta del otro agente seguir y Tessera abre su pestaña con una conversación nueva.',
        'Su primer mensaje le pide leer el traspaso con `tctx traspaso`, resumirlo y esperar tus instrucciones. El traspaso lleva:',
        {
          lista: [
            'Los últimos mensajes de texto tuyos y del agente, tantos como caben. No lleva lo que hicieron sus herramientas, ni imágenes, ni su razonamiento.',
            'El estado de git del proyecto: los archivos cambiados y los cinco últimos commits.'
          ]
        },
        { nota: 'Si el otro agente estaba trabajando en este proyecto, Tessera pregunta antes: su turno se corta y la conversación que tenía queda en su historial. El agente de origen sigue abierto.' }
      ]
    },
    {
      ancla: 'cual-elegir',
      titulo: '¿Cuál elegir?',
      bloques: [
        'Si puedes seguir con el mismo agente, cambia de cuenta: se lleva la conversación entera, con todo lo que leyó y probó. El paso a otro agente solo lleva un resumen, así que conviene cuando quieres otra forma de trabajar o una segunda opinión, y no cuando necesitas cada detalle.'
      ]
    },
    {
      ancla: 'limites',
      titulo: 'Lo que conviene saber',
      bloques: [
        {
          lista: [
            'Todo pasa dentro del mismo perfil y del mismo proyecto.',
            'Los agentes manuales no pueden ni dar ni recibir: Tessera no sabe leer sus conversaciones.',
            'El traspaso solo lo ve la sesión que se abrió para recibirlo, mientras siga abierta. No se guarda en disco ni en el repositorio.',
            'Si el destino no llega a abrirse en unos minutos, el traspaso caduca: vuelve a pedirlo.',
            'Con una ruta de proyecto muy larga, Claude Code no puede seguir la conversación en otra cuenta. Tessera lo dice y puedes usar **Continuar con…**.'
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
            '**The same agent in another account**: Tessera copies the conversation to that account, where it continues with its full history. This is useful, for example, when an account reaches its usage limit.',
            '**Another agent**: Claude Code passes the work to Codex, or the other way around. A conversation cannot be copied from one agent to the other, so the new agent starts a new conversation with a summary of the work so far.'
          ]
        },
        'In both cases, the original conversation does not change and stays in its [history](conversaciones).'
      ]
    },
    {
      ancla: 'otra-cuenta',
      titulo: 'The same conversation in another account',
      bloques: [
        {
          pasos: [
            'In the agent header, click the account button to open the selector.',
            'Hover over the card of the account you want to switch to, and click its **⋯** button.',
            'Choose **Continue this conversation in…**. The agent switches to that account and resumes the conversation.'
          ]
        },
        'This works between Docker [accounts](cuentas), and between {tuEquipo} and Docker. From then on, there are two separate copies: what you write in one does not appear in the other.',
        { nota: 'If the agent is working, Tessera asks you first: the agent’s current turn stops, and the conversation continues in the other account from the last point the agent saved.' },
        { captura: 'continuar-menu-cuenta', alt: 'The agent’s account selector, with the ⋯ menu of a card open and the Continue this conversation in option' }
      ]
    },
    {
      ancla: 'otro-agente',
      titulo: 'Pass the work to another agent',
      bloques: [
        'If the project has tabs for both agents, the agent header (outside the mosaic) shows the **Continue with Codex…** button (or **Continue with Claude Code…**). Choose which account of the other agent to use, and Tessera opens that agent’s tab with a new conversation.',
        'The first message asks the new agent to read the handoff with `tctx traspaso`, summarize it, and wait for your instructions. The handoff includes:',
        {
          lista: [
            'Your most recent text messages and the agent’s, as many as fit. It does not include tool activity, images, or reasoning.',
            'The project’s Git status: the changed files and the last five commits.'
          ]
        },
        { nota: 'If the other agent was working in this project, Tessera asks you first: that agent’s current turn stops, and its conversation stays in its history. The original agent stays open.' }
      ]
    },
    {
      ancla: 'cual-elegir',
      titulo: 'Which option should I choose?',
      bloques: [
        'If you can keep the same agent, switch accounts: the agent keeps the whole conversation, including everything it read and tried. Moving to another agent passes only a summary, so it works best when you want a different approach or a second opinion, and you do not need every detail.'
      ]
    },
    {
      ancla: 'limites',
      titulo: 'Limitations',
      bloques: [
        {
          lista: [
            'A handoff always stays within the same profile and the same project.',
            'Agents you add yourself can neither send nor receive a handoff, because Tessera cannot read their conversations.',
            'Only the session opened to receive the handoff can read it, and only while that session stays open. The handoff is not saved to disk or to the repository.',
            'If the destination agent does not open within a few minutes, the handoff expires: request it again.',
            'If the project path is very long, Claude Code cannot continue the conversation in another account. Tessera tells you, and you can use **Continue with…** instead.'
          ]
        }
      ]
    }
  ]
}

export const txContinuarEnOtroAgente = crearTextos(es, en)
