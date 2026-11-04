// =============================================================================
// Tessera Academy · Reglas para los agentes: el texto del perfil y las propuestas de los agentes.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Permiten escribir una sola vez lo que los agentes de un perfil deben saber. Los agentes reciben las reglas al iniciarse, en cualquier proyecto y con cualquier cuenta. Pueden proponer cambios, pero nunca las modifican por su cuenta.',
  secciones: [
    {
      ancla: 'que-son',
      titulo: 'Qué son',
      bloques: [
        'Las reglas son un texto por perfil con sus instrucciones para los agentes: a qué rama subir los cambios, qué no modificar, cómo nombrar los commits. Claude Code y Codex las reciben al iniciarse, como instrucciones del usuario, tanto si son [nativos](glosario/nativo) como si se ejecutan en Docker y con cualquier cuenta.',
        'De este modo no es necesario repetirlas en cada proyecto ni en el formato de cada agente. Se guardan en el perfil, nunca dentro de un repositorio ni en una carpeta visible para un contenedor.'
      ]
    },
    {
      ancla: 'escribir',
      titulo: 'Escribirlas',
      bloques: [
        {
          pasos: [
            'Haga clic con el botón derecho en el perfil y seleccione **Reglas para los agentes…**.',
            'Escriba las reglas. El límite es de 6000 caracteres; el contador indica cuántos se han usado.',
            'Haga clic en **Guardar**. Las reglas quedan guardadas en el perfil.'
          ]
        },
        { nota: 'Las reglas nuevas llegan a los agentes que se inicien a partir de ese momento. Un agente que ya estaba abierto puede leer las vigentes con `tctx reglas`: solicítelo al agente o empiece una conversación nueva.' }
      ]
    },
    {
      ancla: 'propuestas',
      titulo: 'Las propuestas de los agentes',
      bloques: [
        'Cuando usted indica a un agente que algo es una regla del perfil, o lo corrige dos veces en lo mismo, el agente propone un cambio con el comando `tctx proponer` (consulte [tctx](herramientas-de-los-agentes/tctx)): la nueva versión completa de las reglas y un motivo. También se le puede pedir directamente. Nada cambia hasta que se acepta la propuesta.',
        'Cuando llega una propuesta, Tessera muestra un aviso con **Revisar**. La revisión muestra las reglas vigentes a la izquierda y las propuestas a la derecha, con el motivo del agente y el proyecto desde el que se hizo. Las opciones son:',
        {
          lista: [
            '**Aceptar**: las reglas propuestas sustituyen a las vigentes.',
            '**Editar antes de aceptar**: permite ajustar el texto y guardarlo.',
            '**Descartar**: todo queda como estaba.'
          ]
        },
        { nota: 'Cada perfil tiene como máximo una propuesta pendiente: una nueva sustituye a la anterior. Si no se atendió el aviso, abra **Reglas para los agentes…** y haga clic en **Revisar propuesta**.' }
      ]
    },
    {
      ancla: 'quien-las-recibe',
      titulo: 'Quién las recibe',
      bloques: [
        {
          lista: [
            'Claude Code y Codex en todo el perfil: el agente de cada proyecto, el agente de la terminal y el de la vista de bases de datos.',
            'Los [agentes propios](agentes/manuales) no las reciben, porque se inician con el comando que usted escribió. Si las necesitan, pueden leerlas con `tctx reglas`.',
            'Una [ventana de agente](mosaico/ventana-de-agente) no tiene perfil y no recibe reglas.',
            'Si las reglas son demasiado largas para la línea de inicio del agente, este recibe la indicación de leerlas con `tctx reglas` antes de empezar.'
          ]
        },
        'Las reglas acompañan al perfil al [exportar la configuración](copia-de-configuracion/exportar) y se eliminan con él.'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Write once what the agents in a profile need to know. The agents receive the rules when they start, in any project and with any account. They can propose changes, but they never change the rules themselves.',
  secciones: [
    {
      ancla: 'que-son',
      titulo: 'What rules are',
      bloques: [
        'Rules are a single text per profile with your instructions for its agents: which branch to push to, what not to change, how to name commits. Claude Code and Codex receive the rules when they start, as instructions from the user, whether they are [native](glosario/nativo) or in Docker and whatever account they use.',
        'This way, you do not have to repeat the rules in every project or in each agent’s own format. The rules are stored in the profile, never inside a repository or in a folder that a container can see.'
      ]
    },
    {
      ancla: 'escribir',
      titulo: 'Write the rules',
      bloques: [
        {
          pasos: [
            'Right-click the profile and choose **Rules for agents…**.',
            'Write the rules. The limit is 6,000 characters; the counter shows how many you have used.',
            'Click **Save**. The rules are saved in the profile.'
          ]
        },
        { nota: 'New rules apply to agents that start after you save them. An agent that was already open can read the current rules with `tctx reglas`: ask it to, or start a new conversation.' }
      ]
    },
    {
      ancla: 'propuestas',
      titulo: 'Proposals from the agents',
      bloques: [
        'When you tell an agent that something is a profile rule, or correct it twice on the same point, the agent proposes a change with the `tctx proponer` command (see [tctx](herramientas-de-los-agentes/tctx)): the complete new version of the rules and a reason. You can also ask it to propose one. Nothing changes until you accept the proposal.',
        'When a proposal arrives, Tessera shows a notification with **Review**. The review shows the current rules on the left and the proposed rules on the right, with the agent’s reason and the project it came from. You can choose:',
        {
          lista: [
            '**Accept**: the proposed rules replace the current rules.',
            '**Edit before accepting**: you adjust the text and save it yourself.',
            '**Discard**: nothing changes.'
          ]
        },
        { nota: 'Each profile has at most one pending proposal: a new proposal replaces the previous one. If you missed the notification, open **Rules for agents…** and click **Review proposal**.' }
      ]
    },
    {
      ancla: 'quien-las-recibe',
      titulo: 'Which agents receive the rules',
      bloques: [
        {
          lista: [
            'Claude Code and Codex across the profile: the agent in each project, the terminal agent, and the agent of the database view.',
            '[Custom agents](agentes/manuales) do not receive them, because they start with the command you entered. If they need the rules, they can read them with `tctx reglas`.',
            'An [agent window](mosaico/ventana-de-agente) has no profile and receives no rules.',
            'If the rules are too long for the agent’s startup command, the agent is instructed to read them with `tctx reglas` before it begins.'
          ]
        },
        'The rules are included with the profile when you [export your settings](copia-de-configuracion/exportar), and they are deleted along with the profile.'
      ]
    }
  ]
}

export const txReglasDelPerfil = crearTextos(es, en)
