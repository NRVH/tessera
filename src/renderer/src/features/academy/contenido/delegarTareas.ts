// =============================================================================
// Tessera Academy · Delegar tareas en las cuentas de Docker: requisitos, `tctx cuentas`, `delegar` y `tarea`, qué
// puede hacer la cuenta delegada y cómo seguir sus tareas. Su forma es la de `modelo.ts` y el inglés repite la del
// español (`test-academy.mts`).
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen: 'Un agente nativo o una terminal de Tessera puede encargar una tarea a una cuenta de Claude Code o Codex en Docker. La cuenta trabaja sobre el mismo proyecto sin abrir su ventana y devuelve el resultado.',
  secciones: [
    {
      ancla: 'que-es',
      titulo: 'Qué significa delegar',
      bloques: [
        'Delegar permite repartir trabajo: por ejemplo, pedir una revisión a otra cuenta mientras el [agente](glosario/agente) principal sigue trabajando. La tarea usa una [cuenta de Docker](cuentas/docker) del mismo perfil; no cambia la cuenta del agente principal.',
        'El agente delegado recibe la instrucción de la tarea y el contexto del perfil, pero no la conversación de quien delega. Incluya los archivos, el objetivo y el resultado esperado. Para trasladar la conversación a otro agente, consulte [Continuar en otro agente o cuenta](continuar-en-otro-agente).'
      ]
    },
    {
      ancla: 'requisitos',
      titulo: 'Requisitos y origen de la tarea',
      bloques: [
        'Antes debe tener [Docker instalado](nativo-o-docker/requisitos); si está detenido, Tessera intenta iniciarlo y, si no lo logra, la tarea termina indicando el motivo. También necesita una [cuenta de Docker con la sesión iniciada](cuentas/docker), de Claude Code o Codex, en el perfil del proyecto. Una cuenta de un agente propio no puede recibir tareas delegadas.',
        'La orden debe salir de un [agente nativo](nativo-o-docker) o de una [terminal de Tessera](terminales) con proyecto. Desde Docker se rechazan `tctx cuentas`, `tctx delegar` y `tctx tarea`: una tarea delegada tampoco puede delegar en otra cuenta. Una consola abierta fuera de Tessera no tiene el contexto necesario.'
      ]
    },
    {
      ancla: 'pedir',
      titulo: 'Pedir la tarea y elegir la cuenta',
      bloques: [
        'Puede pedírselo al agente nativo así: «Consulte las cuentas de Docker disponibles y delegue en Claude Code una revisión de los cambios de este proyecto, sin modificar archivos. Incluya en la instrucción los archivos que debe revisar y devuelva los problemas encontrados». Antes debe cumplir los [requisitos de delegación](delegar-tareas/requisitos).',
        {
          pasos: [
            'Ejecute `tctx cuentas` desde la sesión nativa del proyecto. Lista las cuentas de Claude Code y Codex del perfil, su estado, el uso por ventana, sus reinicios en hora local y las tareas en marcha. Si no hay cuentas, antes debe [crear una e iniciar sesión](cuentas/docker).',
            'Prepare un archivo de texto dentro del proyecto, por ejemplo `tarea.md`, con la instrucción completa. Ejecute `tctx delegar --agente claude-code --cuenta auto --solo-lectura --archivo tarea.md`. Se anuncia el identificador y se espera el resultado; sustituya `claude-code` por `codex` para elegir Codex. Consulte el [efecto de solo lectura](delegar-tareas/permisos).'
          ]
        },
        {
          lista: [
            '`tctx delegar --agente claude-code|codex [--cuenta nombre|auto] [--modelo <modelo>] [--esfuerzo <nivel>] [--solo-lectura] [--sin-esperar] [--archivo <ruta> | -]`: `--agente` es obligatorio; `--cuenta` elige una cuenta por nombre o automáticamente. `--solo-lectura` solicita una revisión sin cambios y `--sin-esperar` devuelve el identificador sin esperar el resultado.',
            '`tctx modelos --agente claude-code|codex [--cuenta nombre|auto] [--actualizar]` consulta en el contenedor de la cuenta los modelos y niveles de esfuerzo que ofrece. `--modelo` y `--esfuerzo` se comprueban contra esa lista; sin ellos se usa la configuración de la cuenta. La consulta se conserva una hora; `--actualizar` la repite.',
            'La instrucción llega exclusivamente con `--archivo <ruta>` o por una tubería, con o sin `-`; por ejemplo, `cat tarea.md | tctx delegar --agente codex -`. No se admite `--texto` ni una instrucción como argumento. `--archivo` evita que las comillas de la instrucción pasen por la shell.',
            '`--cuenta auto` es el valor predeterminado. Elige la cuenta del agente solicitado con menor porcentaje consumido en su ventana más ajustada y menos tareas en marcha. Excluye las cuentas sin sesión y las que alcanzan el 95 % en alguna ventana; si ninguna sirve, indica el primer reinicio conocido.',
            'El nombre de cuenta no distingue mayúsculas ni tildes; se admite una parte si identifica una sola cuenta. Al nombrar una cuenta se permite intentar la tarea aunque figure agotada, porque el dato de uso puede haber quedado desactualizado.'
          ]
        }
      ]
    },
    {
      ancla: 'permisos',
      titulo: 'Qué puede hacer la cuenta delegada',
      bloques: [
        'Tiene los recursos de esa cuenta en su pestaña de Docker sobre el proyecto: los archivos del proyecto montado, las [bases montadas](herramientas-de-los-agentes/tdb), las [conexiones SSH disponibles para los agentes](herramientas-de-los-agentes/tssh), las [reglas y los documentos](reglas-del-perfil) y la configuración de Docker. `tctx buscar` solo consulta el historial de su cuenta. No obtiene acceso general a las carpetas de {tuEquipo} fuera del proyecto; los documentos configurados se consultan por `tctx docs`.',
        'Puede instalar herramientas y servidores MCP dentro de su contenedor. Nadie responde preguntas durante la tarea: su respuesta final es el resultado que recibe quien delegó. Los cambios en los archivos del proyecto son visibles para el agente principal, porque es la misma carpeta.',
        {
          lista: [
            'Sin `--solo-lectura`, Claude Code y Codex pueden leer y escribir sin solicitar aprobaciones durante la tarea.',
            'Con `--solo-lectura`, Claude Code usa `--permission-mode plan`, que impide modificar archivos. Codex se ejecuta sin su sandbox y recibe la restricción como indicación: es una petición, no un bloqueo técnico. Su aislamiento de solo lectura no funciona dentro del contenedor.'
          ]
        }
      ]
    },
    {
      ancla: 'seguir',
      titulo: 'Seguir, cancelar y continuar',
      bloques: [
        'Mientras hay tareas en marcha, aparece un indicador con un círculo giratorio en la cabecera del agente que delegó, o en la cabecera de la franja de terminales si la orden salió de una terminal. Con una tarea muestra la cuenta y el tiempo; con varias, muestra su número. Al pasar el puntero, el texto emergente de una tarea indica el agente, la cuenta, si puede editar y el resumen; con varias dice **Tareas delegadas**.',
        {
          pasos: [
            'Haga clic en el indicador para abrir la lista con el resumen, el tiempo, y el agente y la cuenta de cada tarea con los límites de 5 horas y semanal de esa cuenta. Antes debe [iniciar una tarea](delegar-tareas/pedir). Si una tarea falla, el indicador muestra una advertencia y queda en rojo; la lista muestra el motivo, el detalle disponible y la última actividad. **Descartar** retira el fallo del indicador; no reintenta la tarea.',
            'Para cancelar desde la interfaz, haga clic en el botón de la equis (**Cancelar la tarea delegada**), junto al indicador de una tarea en marcha o en su fila de la lista. Confirme con **Cancelar la tarea delegada**; **Mantener la tarea** cierra el diálogo sin cancelarla. Antes debe haber una [tarea en marcha](delegar-tareas/pedir).'
          ]
        },
        'Al completarse correctamente, el indicador muestra una marca de verificación y se retira automáticamente. El resultado se entrega por `tctx`; el indicador no abre una terminal de la cuenta.',
        {
          lista: [
            '`tctx delegar --agente codex --sin-esperar --archivo tarea.md` devuelve el identificador inmediatamente. Sin `--sin-esperar`, espera sin límite total y comunica el progreso cada 30 segundos por la salida de errores.',
            '`tctx tarea <id>` consulta el estado, el tiempo transcurrido, el tiempo desde la última actividad y las últimas líneas de actividad; si terminó correctamente, entrega el resultado. Antes debe tener el identificador de una [tarea iniciada](delegar-tareas/pedir) del mismo perfil y proyecto.',
            '`tctx tareas` lista las tareas del proyecto con su identificador y su estado. `tctx tarea <id> --esperar [--max-segundos N]` aguarda a que termine; con `N` devuelve el control antes si sigue en marcha, sin cancelarla.',
            '`tctx tarea <id> --cancelar` cancela la ejecución. `tctx tarea <id> --continuar [--modelo <modelo>] [--esfuerzo <nivel>] [--sin-esperar] [--archivo <ruta> | -]` envía una nueva instrucción y reanuda la misma conversación en la misma cuenta, con el mismo modelo y esfuerzo salvo que indique otros; admite una tubería con o sin `-`. Si aún estaba en marcha, primero la detiene. Antes debe existir una conversación para continuar; si no existe, [delegue una tarea nueva](delegar-tareas/pedir).',
            'Interrumpir el comando `tctx` no cancela la tarea: puede volver a consultarla por su identificador. Cerrar la sesión que la originó sí cancela sus tareas en marcha.'
          ]
        }
      ]
    },
    {
      ancla: 'limites',
      titulo: 'Límites y casos conocidos',
      bloques: [
        {
          lista: [
            'Una instrucción por la entrada estándar admite hasta 24 KiB en UTF-8 y debe caber, escapada, en la petición del puente. Un archivo admite hasta 512 KiB y debe estar dentro del proyecto, también después de resolver enlaces simbólicos.',
            'Se conservan hasta 12 líneas de actividad y hasta 256 × 1024 caracteres del resultado. La conversación queda en el historial de la cuenta; el resultado de una tarea terminada se guarda en memoria y no sustituye ese historial.',
            'Detener el contenedor o cerrar Tessera termina la ejecución. Si Tessera o el equipo se apagan con una tarea en marcha, al volver figura como **interrumpida** durante siete días: `tctx tareas` la muestra y `tctx tarea <id> --continuar` la reanuda en su misma conversación. Conviene pedirle que revise lo que quedó hecho, porque el último turno puede haberse perdido. Nunca se reanuda sola.',
            'Las tareas que modifican archivos comparten la carpeta del proyecto: `tctx delegar` avisa si ya hay otra en marcha, pero no las aísla. Evite que dos trabajen sobre los mismos archivos.',
            'No hay cambio automático de cuenta al fallar: consulte `tctx cuentas` y [delegue una tarea nueva](delegar-tareas/pedir) si necesita otra cuenta.',
            '`tctx help` muestra la sintaxis y los códigos de salida para distinguir una tarea hecha, en marcha, fallida o cancelada de un rechazo o un error de comunicación.'
          ]
        },
        { p: 'En la terminal interactiva de {sistema} no se ven los avisos que `tctx` escribe por la salida de errores. Un agente que captura ambas salidas sí los recibe; `--sin-esperar` escribe el identificador en la salida estándar.', soloEn: ['windows'] }
      ]
    }
  ]
}

const en: Articulo = {
  resumen: 'A native agent or a Tessera terminal can assign a task to a Claude Code or Codex account in Docker. The account works on the same project without opening its window and returns the result.',
  secciones: [
    {
      ancla: 'que-es',
      titulo: 'What delegation means',
      bloques: [
        'Delegation lets you distribute work: for example, ask another account for a review while the main [agent](glosario/agente) continues working. The task uses a [Docker account](cuentas/docker) in the same profile; it does not change the main agent’s account.',
        'The delegated agent receives the task instruction and the profile context, but not the conversation of the caller. Include the files, the objective, and the expected result. To transfer the conversation to another agent, see [Continue in another agent or account](continuar-en-otro-agente).'
      ]
    },
    {
      ancla: 'requisitos',
      titulo: 'Requirements and task origin',
      bloques: [
        'First, you must have [Docker installed](nativo-o-docker/requisitos); if it is stopped, Tessera tries to start it and, if it cannot, the task ends stating the reason. You also need a [signed-in Docker account](cuentas/docker), for Claude Code or Codex, in the project’s profile. A custom agent account cannot receive delegated tasks.',
        'The command must come from a [native agent](nativo-o-docker) or a [Tessera terminal](terminales) with a project. Docker sessions reject `tctx cuentas`, `tctx delegar`, and `tctx tarea`: a delegated task cannot delegate to another account either. A console opened outside Tessera lacks the required context.'
      ]
    },
    {
      ancla: 'pedir',
      titulo: 'Request the task and choose the account',
      bloques: [
        'You can ask the native agent: “Check the available Docker accounts and delegate a review of this project’s changes to Claude Code, without modifying files. Include the files to review in the instruction and return the issues found”. First, you must meet the [delegation requirements](delegar-tareas/requisitos).',
        {
          pasos: [
            'Run `tctx cuentas` from the project’s native session. It lists the profile’s Claude Code and Codex accounts, their state, usage per window, resets in local time, and running tasks. If there are no accounts, first [create one and sign in](cuentas/docker).',
            'Prepare a text file inside the project, for example `tarea.md`, with the complete instruction. Run `tctx delegar --agente claude-code --cuenta auto --solo-lectura --archivo tarea.md`. It announces the identifier and waits for the result; replace `claude-code` with `codex` to choose Codex. See the [read-only behavior](delegar-tareas/permisos).'
          ]
        },
        {
          lista: [
            '`tctx delegar --agente claude-code|codex [--cuenta name|auto] [--modelo <model>] [--esfuerzo <level>] [--solo-lectura] [--sin-esperar] [--archivo <path> | -]`: `--agente` is required; `--cuenta` chooses an account by name or automatically. `--solo-lectura` requests a review without changes, and `--sin-esperar` returns the identifier without waiting for the result.',
            '`tctx modelos --agente claude-code|codex [--cuenta name|auto] [--actualizar]` checks, inside the account’s container, the models and effort levels it offers. `--modelo` and `--esfuerzo` are checked against that list; without them, the account’s configuration applies. The result is kept for one hour; `--actualizar` checks again.',
            'The instruction comes exclusively from `--archivo <path>` or a pipe, with or without `-`; for example, `cat tarea.md | tctx delegar --agente codex -`. Neither `--texto` nor an instruction as an argument is accepted. `--archivo` keeps the instruction’s quotation marks out of shell parsing.',
            '`--cuenta auto` is the default. It chooses the requested agent’s account with the lowest consumed percentage in its tightest usage window and the fewest running tasks. It excludes accounts without a sign-in and those reaching 95% in any window; if none qualify, it reports the first known reset.',
            'Account names ignore case and accents; a partial name is accepted if it identifies only one account. Naming an account allows an attempt even when it is shown as exhausted, because usage data may be outdated.'
          ]
        }
      ]
    },
    {
      ancla: 'permisos',
      titulo: 'What the delegated account can do',
      bloques: [
        'It has the resources of that account in its Docker tab on the project: the mounted project files, [mounted databases](herramientas-de-los-agentes/tdb), [SSH connections available to agents](herramientas-de-los-agentes/tssh), [rules and documents](reglas-del-perfil), and Docker configuration. `tctx buscar` only searches its account’s history. It does not gain general access to folders on {tuEquipo} outside the project; configured documents are read through `tctx docs`.',
        'It can install tools and MCP servers inside its container. Nobody answers questions during the task: its final response is the result returned to the caller. Project file changes are visible to the main agent, because it is the same folder.',
        {
          lista: [
            'Without `--solo-lectura`, Claude Code and Codex can read and write without requesting approvals during the task.',
            'With `--solo-lectura`, Claude Code uses `--permission-mode plan`, which prevents file modifications. Codex runs without its sandbox and receives the restriction as an instruction: it is a request, not a technical block. Its read-only isolation does not work inside the container.'
          ]
        }
      ]
    },
    {
      ancla: 'seguir',
      titulo: 'Monitor, cancel, and continue',
      bloques: [
        'While tasks are running, an indicator with a spinning circle appears in the header of the agent that delegated, or in the terminal strip header if the command came from a terminal. With one task it shows the account and elapsed time; with several, it shows their count. On hover, a single task’s tooltip shows the agent, account, whether it can edit, and summary; with several it says **Delegated tasks**.',
        {
          pasos: [
            'Click the indicator to open the list with the summary, the time, and the agent and account of each task with that account’s 5-hour and weekly limits. First, you must [start a task](delegar-tareas/pedir). If a task fails, the indicator shows a warning and remains red; the list shows the reason, available detail, and latest activity. **Dismiss** removes the failure from the indicator; it does not retry the task.',
            'To cancel through the interface, click the cross button (**Cancel the delegated task**), beside the indicator for a single running task or in its list row. Confirm with **Cancel the delegated task**; **Keep the task** closes the dialog without canceling. First, you must have a [running task](delegar-tareas/pedir).'
          ]
        },
        'On successful completion, the indicator shows a check mark and disappears automatically. The result is delivered through `tctx`; the indicator does not open an account terminal.',
        {
          lista: [
            '`tctx delegar --agente codex --sin-esperar --archivo tarea.md` returns the identifier immediately. Without `--sin-esperar`, it waits with no total time limit and reports progress every 30 seconds through standard error.',
            '`tctx tarea <id>` queries the state, elapsed time, time since the last activity, and latest activity lines; on successful completion, it returns the result. First, you must have the identifier of a [started task](delegar-tareas/pedir) in the same profile and project.',
            '`tctx tareas` lists the project’s tasks with their identifier and state. `tctx tarea <id> --esperar [--max-segundos N]` waits for it to finish; with `N` it returns control earlier if it is still running, without canceling it.',
            '`tctx tarea <id> --cancelar` cancels execution. `tctx tarea <id> --continuar [--modelo <model>] [--esfuerzo <level>] [--sin-esperar] [--archivo <path> | -]` sends a new instruction and resumes the same conversation in the same account, with the same model and effort unless you specify others; it accepts a pipe with or without `-`. If it was still running, it stops it first. First, a conversation must exist to resume; if none exists, [delegate a new task](delegar-tareas/pedir).',
            'Interrupting the `tctx` command does not cancel the task: you can query it again by its identifier. Closing the session that started it does cancel its running tasks.'
          ]
        }
      ]
    },
    {
      ancla: 'limites',
      titulo: 'Limits and known cases',
      bloques: [
        {
          lista: [
            'An instruction through standard input allows up to 24 KiB in UTF-8 and must fit, escaped, in the bridge request. A file allows up to 512 KiB and must be inside the project, including after resolving symbolic links.',
            'Up to 12 activity lines and 256 × 1024 characters of the result are retained. The conversation remains in the account’s history; a finished task’s result is held in memory and does not replace that history.',
            'Stopping the container or closing Tessera ends execution. If Tessera or the computer shuts down with a task running, on return it appears as **interrupted** for seven days: `tctx tareas` shows it and `tctx tarea <id> --continuar` resumes it in the same conversation. Ask it to review what was done, because the last turn may have been lost. It never resumes on its own.',
            'Tasks that modify files share the project folder: `tctx delegar` warns if another one is running, but does not isolate them. Avoid having two work on the same files.',
            'There is no automatic account change on failure: check `tctx cuentas` and [delegate a new task](delegar-tareas/pedir) if you need another account.',
            '`tctx help` shows the syntax and exit codes to distinguish a completed, running, failed, or canceled task from a rejection or communication error.'
          ]
        },
        { p: 'In the interactive {sistema} terminal, notices that `tctx` writes through standard error are not visible. An agent capturing both outputs does receive them; `--sin-esperar` writes the identifier to standard output.', soloEn: ['windows'] }
      ]
    }
  ]
}

export const txDelegarTareas = crearTextos(es, en)
