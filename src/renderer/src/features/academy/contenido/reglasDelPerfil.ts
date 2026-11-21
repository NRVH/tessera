// =============================================================================
// Tessera Academy · Contexto de los agentes: lo que reciben en cada sesión (reglas, documentos y configuración de
// Docker), en dos niveles, el global y el de cada perfil, y las propuestas de los agentes.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Reúne en un solo lugar lo que reciben los agentes: las reglas, los documentos de referencia y la configuración de Docker, para todos los perfiles y para cada uno. Se escribe una vez para Claude Code y Codex, en su equipo y en Docker. Los agentes pueden proponer cambios, pero nunca los aplican por su cuenta.',
  secciones: [
    {
      ancla: 'que-son',
      titulo: 'Qué es',
      bloques: [
        'El contexto se organiza en dos niveles. El **Global** vale para los agentes de todos los perfiles; el de cada perfil, para los suyos, y se suma después del global. Cada nivel tiene tres partes:',
        {
          lista: [
            '**Reglas**: lo que los agentes deben tener presente siempre, como a qué rama subir los cambios o cómo nombrar los commits. Llegan al iniciarse cada sesión, en un solo texto para Claude Code y Codex, tanto si son [nativos](glosario/nativo) como si se ejecutan en Docker.',
            '**Documentos**: carpetas con textos de consulta, como un contrato o una guía. No se cargan en cada sesión: el agente los lee cuando los necesita.',
            '**Configuración de Docker**: la configuración técnica de cada agente en sus cuentas de Docker, como el modelo, los permisos o los servidores MCP.'
          ]
        },
        'Cada perfil decide con **Usar el contexto global en este perfil** si recibe el global. **Resumen**, en la cabecera del perfil dentro del diálogo **Contexto de los agentes**, muestra lo que reciben sus agentes: el resultado del perfil tal como llega a sus agentes, con el origen de cada parte y su tamaño.',
        'Se abre desde **Configuración › Agentes › Contexto de los agentes** o con **Reglas para los agentes…** en el menú de un perfil (clic derecho, o **⋯** en el selector compacto).'
      ]
    },
    {
      ancla: 'escribir',
      titulo: 'Escribir las reglas',
      bloques: [
        {
          pasos: [
            'Elija el nivel a la izquierda: **Global** o un perfil.',
            'En **Reglas**, escriba el texto. El límite es de 6000 caracteres por nivel; el contador indica cuántos se han usado.',
            'Haga clic en **Guardar**.'
          ]
        },
        'Si una regla del perfil contradice una global, prevalece la del perfil. Lo que solo se consulta a veces conviene ponerlo en **Documentos**: cada carácter de las reglas ocupa parte de la ventana de contexto de cada sesión.',
        { nota: 'Las reglas nuevas llegan a los agentes que se inicien a partir de ese momento. Un agente que ya estaba abierto puede leer las vigentes con `tctx reglas`: solicítelo al agente o empiece una conversación nueva.' }
      ]
    },
    {
      ancla: 'documentos',
      titulo: 'Los documentos de referencia',
      bloques: [
        'En **Documentos**, añada la carpeta con **Añadir carpeta…**. Los agentes leen sus documentos con `tctx docs`, con la misma orden en su equipo y en Docker; los del global y los del perfil aparecen juntos.',
        {
          lista: [
            '`tctx docs` lista los documentos; `tctx docs <nombre>` muestra uno. Basta el nombre del archivo si no se repite en otra carpeta.',
            'Tessera lee el documento cuando el agente lo pide: se edita donde siempre y el agente recibe la versión de ese momento.',
            'Solo se entregan textos (Markdown, texto, JSON, YAML y similares) de hasta 256 KiB. Los agentes no pueden modificarlos con `tctx`.',
            'En las reglas, cite el documento por su nombre: "lea `tctx docs contrato.md` antes de empezar". Si una regla cita una ruta de su equipo, el agente busca el documento por el nombre del archivo.'
          ]
        }
      ]
    },
    {
      ancla: 'docker',
      titulo: 'La configuración de Docker',
      bloques: [
        'En **Configuración de Docker**, elija el agente y edite su archivo: `settings.json` para Claude Code y `config.toml` para Codex. Al abrir una sesión en Docker, el agente aplica sus valores encima de la configuración de la cuenta, sin modificarla; prevalece el perfil sobre el global. Consulte [la configuración de las cuentas](cuentas/configuracion).',
        'En un perfil, **Se aplica a** decide qué se edita: **Todas las cuentas** del perfil o una sola cuenta, con sus propios archivos, por si hace falta algo solo para ella.',
        'Los archivos del agente en {tuEquipo} están en **En su equipo**, al pie de la lista. Ese agente se ejecuta fuera de Docker y no recibe esta configuración.'
      ]
    },
    {
      ancla: 'propuestas',
      titulo: 'Las propuestas de los agentes',
      bloques: [
        'Cuando usted indica a un agente que algo es una regla, o lo corrige dos veces en lo mismo, el agente propone un cambio con `tctx proponer`, y con `tctx proponer --global` si vale para todos los perfiles (consulte [tctx](herramientas-de-los-agentes/tctx)): la nueva versión completa de las reglas y un motivo. También se le puede pedir directamente. Nada cambia hasta que se acepta la propuesta.',
        'Cuando llega una propuesta, Tessera muestra un aviso con **Revisar**. La revisión muestra las reglas vigentes a la izquierda y las propuestas a la derecha, con el motivo del agente y el proyecto desde el que se hizo. Las opciones son:',
        {
          lista: [
            '**Aceptar**: las reglas propuestas sustituyen a las vigentes.',
            '**Editar antes de aceptar**: permite ajustar el texto y guardarlo.',
            '**Descartar**: todo queda como estaba.'
          ]
        },
        { nota: 'Cada nivel tiene como máximo una propuesta pendiente: una nueva sustituye a la anterior. Si no se atendió el aviso, abra las reglas de ese nivel y haga clic en **Revisar la propuesta**.' }
      ]
    },
    {
      ancla: 'quien-las-recibe',
      titulo: 'Quién lo recibe',
      bloques: [
        {
          lista: [
            'Claude Code y Codex en todo el perfil: el agente de cada proyecto, el agente de la terminal y el de la vista de bases de datos.',
            'Los [agentes propios](agentes/manuales) no reciben las reglas, porque se inician con el comando que usted escribió. Si las necesitan, pueden leerlas con `tctx reglas`.',
            'Una [ventana de agente](mosaico/ventana-de-agente) no tiene perfil y no recibe el contexto.',
            'Si las reglas son demasiado largas para la línea de inicio del agente, este recibe la indicación de leerlas con `tctx reglas` antes de empezar.'
          ]
        },
        'Las reglas de cada perfil lo acompañan al [exportar la configuración](copia-de-configuracion/exportar), y el contexto global viaja en su propio apartado. Las carpetas de documentos no viajan: son rutas de este equipo.'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Brings together in one place what the agents receive: rules, reference documents, and Docker configuration, for all profiles and for each one. You write it once for Claude Code and Codex, on your computer and in Docker. Agents can propose changes, but they never apply them themselves.',
  secciones: [
    {
      ancla: 'que-son',
      titulo: 'What it is',
      bloques: [
        'The context has two levels. **Global** applies to the agents of every profile; each profile’s applies to its own agents, after the global one. Each level has three parts:',
        {
          lista: [
            '**Rules**: what the agents must always keep in mind, such as which branch to push to or how to name commits. They arrive when each session starts, in a single text for Claude Code and Codex, whether they are [native](glosario/nativo) or run in Docker.',
            '**Documents**: folders with reference texts, such as a contract or a guide. They are not loaded into every session: the agent reads them when it needs them.',
            '**Docker configuration**: each agent’s technical configuration in its Docker accounts, such as the model, permissions, or MCP servers.'
          ]
        },
        'Each profile decides with **Use the global context in this profile** whether it receives the global one. **Summary**, in the profile header within the **Agent context** dialog, shows what its agents receive: the profile’s result as its agents receive it, with the origin of each part and its size.',
        'Open it from **Settings › Agents › Agent context** or with **Rules for agents…** in a profile’s menu (right-click, or **⋯** in the compact selector).'
      ]
    },
    {
      ancla: 'escribir',
      titulo: 'Write the rules',
      bloques: [
        {
          pasos: [
            'Choose the level on the left: **Global** or a profile.',
            'In **Rules**, write the text. The limit is 6000 characters per level; the counter shows how many you have used.',
            'Click **Save**.'
          ]
        },
        'If a profile rule contradicts a global one, the profile rule prevails. Whatever is only consulted occasionally belongs in **Documents**: every character of the rules uses part of each session’s context window.',
        { nota: 'New rules apply to agents that start after you save them. An agent that was already open can read the current rules with `tctx reglas`: ask it to, or start a new conversation.' }
      ]
    },
    {
      ancla: 'documentos',
      titulo: 'Reference documents',
      bloques: [
        'In **Documents**, add the folder with **Add folder…**. The agents read its documents with `tctx docs`, with the same command on your computer and in Docker; the global and the profile documents appear together.',
        {
          lista: [
            '`tctx docs` lists the documents; `tctx docs <name>` shows one. The file name is enough if no other folder repeats it.',
            'Tessera reads the document when the agent requests it: you edit it where you always do, and the agent receives the current version.',
            'Only text files (Markdown, plain text, JSON, YAML and similar) of up to 256 KiB are delivered. Agents cannot modify them with `tctx`.',
            'In the rules, cite the document by its name: "read `tctx docs contract.md` before you start". If a rule cites a path on your computer, the agent looks up the document by its file name.'
          ]
        }
      ]
    },
    {
      ancla: 'docker',
      titulo: 'Docker configuration',
      bloques: [
        'In **Docker configuration**, choose the agent and edit its file: `settings.json` for Claude Code and `config.toml` for Codex. When a session opens in Docker, the agent applies its values on top of the account configuration, without changing it; the profile prevails over global. See [account configuration](cuentas/configuracion).',
        'In a profile, **Applies to** decides what you edit: **All accounts** of the profile, or a single account with its own files, in case something is needed for that one alone.',
        'The files of the agent on {tuEquipo} are under **On your computer**, at the bottom of the list. That agent runs outside Docker and does not receive this configuration.'
      ]
    },
    {
      ancla: 'propuestas',
      titulo: 'Proposals from the agents',
      bloques: [
        'When you tell an agent that something is a rule, or correct it twice on the same point, the agent proposes a change with `tctx proponer`, and with `tctx proponer --global` if it applies to every profile (see [tctx](herramientas-de-los-agentes/tctx)): the complete new version of the rules and a reason. You can also ask it to propose one. Nothing changes until you accept the proposal.',
        'When a proposal arrives, Tessera shows a notification with **Review**. The review shows the current rules on the left and the proposed rules on the right, with the agent’s reason and the project it came from. You can choose:',
        {
          lista: [
            '**Accept**: the proposed rules replace the current rules.',
            '**Edit before accepting**: you adjust the text and save it yourself.',
            '**Discard**: nothing changes.'
          ]
        },
        { nota: 'Each level has at most one pending proposal: a new proposal replaces the previous one. If you missed the notification, open that level’s rules and click **Review the proposal**.' }
      ]
    },
    {
      ancla: 'quien-las-recibe',
      titulo: 'Which agents receive it',
      bloques: [
        {
          lista: [
            'Claude Code and Codex across the profile: the agent in each project, the terminal agent, and the agent of the database view.',
            '[Custom agents](agentes/manuales) do not receive the rules, because they start with the command you entered. If they need the rules, they can read them with `tctx reglas`.',
            'An [agent window](mosaico/ventana-de-agente) has no profile and receives no context.',
            'If the rules are too long for the agent’s startup command, the agent is instructed to read them with `tctx reglas` before it begins.'
          ]
        },
        'Each profile’s rules are included with it when you [export your settings](copia-de-configuracion/exportar), and the global context travels in its own section. Document folders do not travel: they are paths on this computer.'
      ]
    }
  ]
}

export const txReglasDelPerfil = crearTextos(es, en)
