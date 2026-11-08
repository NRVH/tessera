// =============================================================================
// Tessera Academy · Conversaciones e historial: el historial por proyecto y `tctx buscar`.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Cada agente guarda sus conversaciones por proyecto y por cuenta. Desde el historial se pueden reanudar, renombrar o eliminar, y los agentes pueden buscar en lo que se habló.',
  secciones: [
    {
      ancla: 'historial',
      titulo: 'El historial de un proyecto',
      bloques: [
        'El botón con el icono de reloj de la cabecera del agente abre el diálogo **Conversaciones de Claude Code** (o del agente que use): las conversaciones de ese agente en ese proyecto con la cuenta que usa en ese momento, de la más reciente a la más antigua. Las de otras [cuentas](cuentas) aparecen al cambiar a ellas.',
        'El cuadro **Buscar conversación…** filtra por título. El [agente de la terminal](terminales/pantalla-completa) y el agente de la vista de [bases de datos](bases-de-datos) tienen su propio historial.'
      ]
    },
    {
      ancla: 'reanudar',
      titulo: 'Reanudar y empezar otra',
      bloques: [
        'Haga clic en una conversación para continuarla en el agente. La conversación que estaba abierta queda guardada en el historial.',
        '**Nueva conversación**, en la misma cabecera, cierra la conversación actual y empieza una vacía; la anterior también queda en el historial.',
        { nota: 'Un agente [hibernado](hibernar/reanudar) vuelve a su conversación al reanudarlo, sin necesidad de buscarla aquí.' }
      ]
    },
    {
      ancla: 'renombrar-y-eliminar',
      titulo: 'Renombrar y eliminar',
      bloques: [
        'Al pasar el puntero por una conversación del historial aparecen dos botones: el lápiz (**Renombrar conversación**) y la papelera (**Eliminar conversación**). Sus acciones son las siguientes:',
        {
          lista: [
            '**Renombrar conversación** le asigna un nombre propio en lugar del título automático. Para volver al título automático, deje el nombre vacío. Tessera guarda el nombre por separado: la conversación no cambia.',
            '**Eliminar conversación** la borra de {tuEquipo} de forma definitiva. Tessera pide confirmación antes.'
          ]
        }
      ]
    },
    {
      ancla: 'buscar',
      titulo: 'Búsqueda de los agentes en las conversaciones',
      bloques: [
        'Se puede pedir a un agente que busque lo que se decidió, por ejemplo: «busca qué se dijo de la migración de la base tienda». El agente usa `tctx buscar` y devuelve las coincidencias más recientes, con el agente, la cuenta, la fecha, el título y un fragmento del mensaje.',
        {
          lista: [
            'Busca en las conversaciones de ese proyecto, de cualquier agente y cuenta del perfil. Un agente en Docker solo busca en su propia cuenta.',
            'Todas las palabras deben estar en el mensaje, sin distinguir mayúsculas ni tildes; con `--exacta`, la frase literal.',
            'Solo lee los mensajes escritos: ni la actividad de las herramientas ni lo que se habló fuera de una conversación.'
          ]
        },
        'También se puede usar en la terminal del proyecto: `tctx buscar migración tienda`. Consulte [tctx](herramientas-de-los-agentes/tctx).'
      ]
    },
    {
      ancla: 'donde-se-guardan',
      titulo: 'Dónde se guardan',
      bloques: [
        'Las conversaciones las guardan Claude Code y Codex, no Tessera. Las de {tuEquipo} son las mismas que se ven al usar el agente fuera de Tessera, y aparecen en todos los perfiles. Las de cada cuenta de Docker se guardan por separado, con esa cuenta.',
        'Los [agentes propios](agentes/manuales) no tienen historial en Tessera. Para llevar las conversaciones a otro equipo, [exporte la configuración](copia-de-configuracion/historial) con el historial incluido.'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Each agent keeps its conversations by project and by account. From the history, you can resume, rename, or delete them, and the agents can search what was said.',
  secciones: [
    {
      ancla: 'historial',
      titulo: 'Project history',
      bloques: [
        'The clock button in the agent header opens the **Claude Code conversations** dialog (or the dialog for the agent you use): the agent’s conversations in this project with the account it uses now, most recent first. Conversations from other [accounts](cuentas) appear when you switch to those accounts.',
        'The **Search conversations…** box filters by title. The [terminal agent](terminales/pantalla-completa) and the agent of the [database](bases-de-datos) view each have their own history.'
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
        'Hover over a conversation in the history to reveal two buttons: the pencil (**Rename conversation**) and the trash can (**Delete conversation**). Their actions are as follows:',
        {
          lista: [
            '**Rename conversation** replaces the automatic title with a name you choose. To restore the automatic title, leave the name empty. Tessera stores the name separately, so the conversation itself does not change.',
            '**Delete conversation** permanently deletes it from {tuEquipo}. Tessera asks you first.'
          ]
        }
      ]
    },
    {
      ancla: 'buscar',
      titulo: 'Let the agents search past conversations',
      bloques: [
        'You can ask an agent to look up a past decision, for example: “find what was said about migrating the tienda database”. The agent uses `tctx buscar` and returns the most recent matches, with the agent, account, date, title, and an excerpt of the message.',
        {
          lista: [
            'It searches the conversations of that project, from any agent and any account in the profile. An agent in Docker searches only its own account.',
            'Every word must appear in the message, ignoring case and accents; with `--exacta`, the exact phrase must appear.',
            'It reads only the written messages: not tool activity, and not anything said outside a conversation.'
          ]
        },
        'You can also use it in the project terminal: `tctx buscar migration tienda`. See [tctx](herramientas-de-los-agentes/tctx).'
      ]
    },
    {
      ancla: 'donde-se-guardan',
      titulo: 'Where conversations are stored',
      bloques: [
        'Claude Code and Codex store the conversations, not Tessera. The conversations on {tuEquipo} are the same ones you see when you use the agent outside Tessera, and they appear in every profile. The conversations of each Docker account are stored separately, with that account.',
        '[Custom agents](agentes/manuales) have no history in Tessera. To move your conversations to another computer, [export your settings](copia-de-configuracion/historial) with the history included.'
      ]
    }
  ]
}

export const txConversaciones = crearTextos(es, en)
