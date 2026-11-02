// =============================================================================
// Tessera Academy · Conversaciones e historial: el historial por proyecto y `tctx buscar`.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Cada agente guarda sus conversaciones por proyecto y por cuenta. Desde su historial las reanudas, las renombras o las borras, y los agentes pueden buscar en lo que se habló.',
  secciones: [
    {
      ancla: 'historial',
      titulo: 'El historial de un proyecto',
      bloques: [
        'El botón del reloj de la cabecera del agente abre el **Historial de conversaciones de este proyecto**: las de ese agente en ese proyecto, con la cuenta que usa ahora, la más reciente arriba. Las de otras cuentas aparecen al cambiar a ellas.',
        'El cuadro **Buscar conversación…** filtra por el título. El agente de la terminal y el agente de datos tienen su propio historial.'
      ]
    },
    {
      ancla: 'reanudar',
      titulo: 'Reanudar y empezar otra',
      bloques: [
        'Haz clic en una conversación para seguirla en el agente. La que tenías abierta queda guardada en el historial.',
        '**Nueva conversación**, en la misma cabecera, cierra la actual y empieza una vacía; la anterior también queda en el historial.',
        { nota: 'Un agente [hibernado](hibernar/reanudar) vuelve a su conversación al reanudarlo: no hace falta buscarla aquí.' }
      ]
    },
    {
      ancla: 'renombrar-y-eliminar',
      titulo: 'Renombrar y eliminar',
      bloques: [
        {
          lista: [
            '**Renombrar conversación** le pone un nombre tuyo encima del título automático. Déjalo vacío para volver al automático. El nombre lo guarda Tessera aparte: la conversación no cambia.',
            '**Eliminar conversación** la borra de {tuEquipo} y no se puede recuperar. Tessera pregunta antes.'
          ]
        }
      ]
    },
    {
      ancla: 'buscar',
      titulo: 'Que los agentes busquen en lo hablado',
      bloques: [
        'Pídele a un agente que busque lo que se decidió, por ejemplo «busca qué dijimos de la migración de la base tienda». Usa `tctx buscar` y te da las coincidencias más recientes, con el agente, la cuenta, la fecha, el título y un trozo del mensaje.',
        {
          lista: [
            'Busca en las conversaciones de ese proyecto, de cualquier agente y cuenta del perfil. Un agente en Docker solo busca en su propia cuenta.',
            'Todas las palabras tienen que estar en el mensaje, sin importar mayúsculas ni tildes; con `--exacta`, la frase tal cual.',
            'Solo lee lo que se escribió: ni lo que hicieron las herramientas ni lo que se habló fuera de una conversación.'
          ]
        },
        'Tú también puedes usarlo en la terminal del proyecto: `tctx buscar migración tienda`. Más en [tctx](herramientas-de-los-agentes/tctx).'
      ]
    },
    {
      ancla: 'donde-se-guardan',
      titulo: 'Dónde se guardan',
      bloques: [
        'Las conversaciones las guardan Claude Code y Codex, no Tessera. Las de {tuEquipo} son las mismas que ves si usas el agente fuera de Tessera, y se ven desde cualquier perfil. Las de cada cuenta de Docker viven aparte, con esa cuenta.',
        'Los agentes manuales no tienen historial en Tessera. Para llevar las conversaciones a otro equipo, [exporta la configuración](copia-de-configuracion/historial) con el historial.'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Each agent keeps its conversations by project and by account. From its history, you can resume, rename, or delete them, and the agents can search what was said.',
  secciones: [
    {
      ancla: 'historial',
      titulo: 'Project history',
      bloques: [
        'The clock button in the agent header opens the **Conversation history of this project**: the agent’s conversations in this project with the account it uses now, most recent first. Conversations from other accounts appear when you switch to those accounts.',
        'The **Search conversations…** box filters by title. The terminal agent and the data agent each have their own history.'
      ]
    },
    {
      ancla: 'reanudar',
      titulo: 'Resume or start a conversation',
      bloques: [
        'Click a conversation to continue it in the agent. The conversation you had open stays saved in the history.',
        '**New conversation**, in the same header, closes the current conversation and starts an empty one; the previous conversation also stays in the history.',
        { nota: 'A [hibernated](hibernar/reanudar) agent returns to its conversation when you resume it, so you do not need to look for it here.' }
      ]
    },
    {
      ancla: 'renombrar-y-eliminar',
      titulo: 'Rename and delete',
      bloques: [
        {
          lista: [
            '**Rename conversation** replaces the automatic title with a name you choose. To restore the automatic title, leave the name empty. Tessera stores the name separately, so the conversation itself does not change.',
            '**Delete conversation** permanently deletes it from {tuEquipo}; you cannot recover it. Tessera asks you first.'
          ]
        }
      ]
    },
    {
      ancla: 'buscar',
      titulo: 'Let the agents search past conversations',
      bloques: [
        'Ask an agent to look up a past decision, for example, “find what we said about migrating the tienda database”. The agent uses `tctx buscar` and returns the most recent matches, with the agent, account, date, title, and an excerpt of the message.',
        {
          lista: [
            'It searches the conversations of that project, from any agent and any account in the profile. An agent in Docker searches only its own account.',
            'Every word must appear in the message, ignoring case and accents; with `--exacta`, the exact phrase must appear.',
            'It reads only the written messages: not tool activity, and not anything said outside a conversation.'
          ]
        },
        'You can also use it in the project terminal: `tctx buscar migration tienda`. For more, see [tctx](herramientas-de-los-agentes/tctx).'
      ]
    },
    {
      ancla: 'donde-se-guardan',
      titulo: 'Where conversations are stored',
      bloques: [
        'Claude Code and Codex store the conversations, not Tessera. The conversations on {tuEquipo} are the same ones you see when you use the agent outside Tessera, and they appear in every profile. The conversations of each Docker account are stored separately, with that account.',
        'Agents you add yourself have no history in Tessera. To move your conversations to another computer, [export your settings](copia-de-configuracion/historial) with the history included.'
      ]
    }
  ]
}

export const txConversaciones = crearTextos(es, en)
