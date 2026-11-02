// =============================================================================
// Tessera Academy · Reglas para los agentes: el texto del perfil y las propuestas de los agentes.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Escribe una vez lo que todos los agentes de un perfil tienen que saber, y lo leen al arrancar en cualquier proyecto y con cualquier cuenta. Ellos pueden proponerte cambios; nunca las cambian solos.',
  secciones: [
    {
      ancla: 'que-son',
      titulo: 'Qué son',
      bloques: [
        'Un texto por perfil con tus instrucciones para sus agentes: a qué rama se sube, qué no se toca, cómo se nombran los commits. Lo reciben al arrancar todos los agentes del perfil, nativos o en Docker y de cualquier cuenta, como instrucciones tuyas.',
        'Así no tienes que repetirlas en cada proyecto ni en el formato de cada agente. Viven en el perfil, nunca dentro de un repositorio ni de una carpeta que vea un contenedor.'
      ]
    },
    {
      ancla: 'escribir',
      titulo: 'Escribirlas',
      bloques: [
        {
          pasos: [
            'Haz clic derecho sobre el perfil y elige **Reglas para los agentes…**.',
            'Escribe las reglas. Caben unos 6000 caracteres; el contador te dice cuánto llevas.',
            'Pulsa **Guardar**.'
          ]
        },
        { nota: 'Las reglas nuevas llegan a los agentes que arrancan desde ese momento. Un agente que ya estaba abierto lee las vigentes con `tctx reglas`: pídeselo, o empieza una conversación nueva.' }
      ]
    },
    {
      ancla: 'propuestas',
      titulo: 'Las propuestas de los agentes',
      bloques: [
        'Cuando le dices a un agente que algo es una regla del perfil, o le corriges lo mismo dos veces, te propone un cambio con `tctx proponer`: la versión entera nueva de las reglas y un motivo. También puedes pedírselo tú. Hasta que la aceptes no cambia nada.',
        'Al llegar, Tessera avisa con **Revisar**. La revisión enseña las reglas vigentes a la izquierda y las propuestas a la derecha, con el motivo del agente y el proyecto desde el que la hizo. Puedes:',
        {
          lista: [
            '**Aceptar**: las reglas pasan a ser las propuestas.',
            '**Editar antes de aceptar**: retocas el texto y lo guardas tú.',
            '**Descartar**: todo sigue como estaba.'
          ]
        },
        { nota: 'Hay como mucho una propuesta pendiente por perfil: una nueva sustituye a la anterior. Si se te pasó el aviso, abre **Reglas para los agentes…** y pulsa **Revisar propuesta**.' }
      ]
    },
    {
      ancla: 'quien-las-recibe',
      titulo: 'Quién las recibe',
      bloques: [
        {
          lista: [
            'Todos los agentes de serie del perfil: los de cada proyecto, el agente de la terminal y el de datos.',
            'Los agentes manuales no: arrancan con el comando que escribiste tú. Si lo necesitan, pueden leerlas con `tctx reglas`.',
            'Si las reglas son muy largas para la línea de arranque, el agente recibe el aviso de leerlas con `tctx reglas` antes de empezar.'
          ]
        },
        'Viajan con el perfil cuando [exportas la configuración](copia-de-configuracion/exportar), y se borran con él.'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Write once what every agent in a profile needs to know. The agents read it when they start, in any project and with any account. They can propose changes, but they never change the rules themselves.',
  secciones: [
    {
      ancla: 'que-son',
      titulo: 'What rules are',
      bloques: [
        'Rules are a single text per profile with your instructions for its agents: which branch to push to, what not to change, how to name commits. Every agent in the profile receives the rules when it starts, as instructions from you, whether it is native or in Docker and whatever account it uses.',
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
            'Write the rules. The limit is about 6,000 characters; the counter shows how many you have used.',
            'Click **Save**.'
          ]
        },
        { nota: 'New rules apply to agents that start after you save them. An agent that was already open can read the current rules with `tctx reglas`: ask it to, or start a new conversation.' }
      ]
    },
    {
      ancla: 'propuestas',
      titulo: 'Proposals from the agents',
      bloques: [
        'When you tell an agent that something is a profile rule, or correct it twice on the same point, the agent proposes a change with `tctx proponer`: the complete new version of the rules and a reason. You can also ask it to propose one. Nothing changes until you accept the proposal.',
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
            'Every built-in agent in the profile: the agent in each project, the terminal agent, and the data agent.',
            'Agents you add yourself do not receive them, because they start with the command you entered. If they need the rules, they can read them with `tctx reglas`.',
            'If the rules are too long for the startup command, the agent is instructed to read them with `tctx reglas` before it begins.'
          ]
        },
        'The rules are included with the profile when you [export your settings](copia-de-configuracion/exportar), and they are deleted along with the profile.'
      ]
    }
  ]
}

export const txReglasDelPerfil = crearTextos(es, en)
