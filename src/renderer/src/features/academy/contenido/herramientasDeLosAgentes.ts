// =============================================================================
// Tessera Academy · tdb, tssh y tctx: lo que los agentes usan sin ver ninguna contraseña.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Tres comandos de Tessera, disponibles para los agentes y para usted: `tdb` para sus bases de datos, `tssh` para sus servidores SSH y `tctx` para el contexto, los traspasos, el historial y las tareas delegadas. Con ellos, un agente usa sus conexiones por su nombre y nunca ve una contraseña.',
  secciones: [
    {
      ancla: 'que-son',
      titulo: 'Qué son',
      bloques: [
        'Los tres comandos están disponibles en las terminales de Tessera y en todos sus [agentes](glosario/agente), nativos o en Docker. Cuando un agente los usa, Tessera proporciona la contraseña o la clave en su lugar: el secreto no pasa por la conversación, ni por el entorno del agente, ni por ningún registro.',
        'Usted decide qué puede usar cada agente: las bases de datos que monta en cada proyecto y las conexiones SSH que deja disponibles. Montar una base significa [permitir que los agentes la usen](glosario/montar). Usted también puede ejecutar los comandos en la terminal; `tdb help`, `tssh help` y `tctx help` explican cada uno.'
      ]
    },
    {
      ancla: 'tdb',
      titulo: 'tdb: bases de datos',
      bloques: [
        'Para que el agente de un proyecto pueda consultar una base de datos, siga estos pasos:',
        {
          pasos: [
            'En la cabecera del agente, a la derecha, haga clic en el botón del cilindro (**Dar al agente acceso a bases de datos**). Si ya hay bases montadas, muestra su número y el texto emergente indica cuántas puede consultar el agente. Se abre **Bases que el agente puede consultar**. Si la lista está vacía, primero [cree una conexión](bases-de-datos/conexion) y pruébela con **Guardar y probar**; las conexiones sin probar no aparecen hasta que se abren una vez o se prueban con **Probar conexión** en su menú contextual.',
            'Active el interruptor de la conexión. El cambio se aplica de inmediato, sin perder la conversación, y también vale en las terminales de ese proyecto.'
          ]
        },
        'Una vez montada la base, el agente, o usted en la terminal, dispone de estos comandos. En los ejemplos, `tienda` es el nombre de la conexión:',
        {
          lista: [
            '`tdb ls` lista las bases montadas. Las demás bases del perfil no se pueden consultar.',
            '`tdb query tienda "SELECT * FROM pedidos"` ejecuta una consulta, con un tope de 50 filas que se cambia con `--limit`.',
            '`tdb schema tienda` y `tdb describe tienda pedidos` muestran las tablas y sus columnas.'
          ]
        },
        'Con el interruptor **Solo lectura para los agentes (recomendado)** activado en la conexión, `tdb` no escribe en ella. Esta opción no limita lo que usted hace en la vista de bases de datos.',
        { nota: 'Las escrituras de `tdb` no pasan por la confirmación de [producción](glosario/produccion) que usted ve en la vista de bases de datos. El agente sabe qué bases son de producción y tiene la instrucción de no escribir en ellas salvo que usted se lo pida. Para que no pueda escribir, deje la conexión en solo lectura. Consulte [Bases de datos](bases-de-datos).' }
      ]
    },
    {
      ancla: 'tssh',
      titulo: 'tssh: servidores SSH',
      bloques: [
        'Los agentes pueden usar las conexiones SSH del perfil que tienen activado el interruptor **Disponible para los agentes** del formulario de la [conexión SSH](ssh/conexion); de las demás no conocen ni el nombre. En los ejemplos, `web-pruebas` es el nombre de la conexión:',
        {
          lista: [
            '`tssh ls` lista las conexiones disponibles e indica si están listas.',
            '`tssh run web-pruebas -- df -h` ejecuta una orden en el servidor.',
            '`tssh cp informe.txt web-pruebas:/tmp/` copia archivos, en los dos sentidos.'
          ]
        },
        '`tssh` solo se conecta a servidores cuya [huella](glosario/huella) ya aceptó una persona, desde la terminal de Tessera o con **Probar**. Si la huella cambia, no se conecta. Tessera registra cada uso con la conexión y el resultado, nunca con la orden. Consulte [Conexiones SSH](ssh).'
      ]
    },
    {
      ancla: 'tctx',
      titulo: 'tctx: contexto, traspasos, historial y tareas',
      bloques: [
        {
          lista: [
            '`tctx reglas [--perfil | --global]` muestra las [reglas](reglas-del-perfil) vigentes: las globales, si el perfil las usa, y las del perfil; con una opción entrega solo ese nivel, sin encabezados, para editarlo.',
            '`tctx proponer (--archivo <ruta> | --texto "<texto>" | -) [--motivo "<motivo>"] [--global]` envía una [propuesta de cambio](reglas-del-perfil/propuestas) con la versión completa de las reglas del perfil o, con `--global`, de las globales; `-` lee la entrada estándar. No tiene efecto hasta que usted la acepta.',
            '`tctx traspaso` entrega al agente el trabajo que otro agente le pasó cuando usted [continuó la conversación con él](continuar-en-otro-agente).',
            '`tctx buscar <palabras> [--exacta] [--max N]` [busca en lo que se habló](conversaciones/buscar) en el proyecto: todas las palabras en un mensaje o, con `--exacta`, la frase; `--max` admite de 1 a 20 resultados. Tras `--`, todo se interpreta como texto de búsqueda.',
            '`tctx docs [<nombre>]` lista los [documentos de referencia](reglas-del-perfil/documentos), los del perfil y los globales si el perfil los usa; con un nombre entrega ese documento.',
            '`tctx config [--agente codex|claude-code]` muestra la [configuración técnica de Docker por niveles](reglas-del-perfil/docker): global si se usa, perfil y, desde Docker, cuenta. Desde una terminal debe indicar el agente con `--agente`.',
            '`tctx config proponer --nivel global|perfil (--archivo <ruta> | --texto "<texto>" | -) [--motivo "<motivo>"] [--agente codex|claude-code]` envía una [propuesta de configuración](reglas-del-perfil/propuestas) con el archivo completo del nivel indicado; desde una terminal debe indicar `--agente`. No se aplica hasta que usted la acepta.',
            '`tctx cuentas` lista las [cuentas de Docker para delegar](delegar-tareas/pedir), su estado, su uso y sus reinicios.',
            '`tctx modelos --agente claude-code|codex [--cuenta nombre|auto] [--actualizar]` indica los [modelos y esfuerzos](delegar-tareas/pedir) que ofrece una cuenta.',
            '`tctx tareas` lista las [tareas delegadas](delegar-tareas/seguir) del proyecto con su identificador y su estado.',
            '`tctx delegar --agente claude-code|codex [--cuenta nombre|auto] [--modelo <modelo>] [--esfuerzo <nivel>] [--solo-lectura] [--sin-esperar] [--archivo <ruta> | -]` [encarga una tarea](delegar-tareas/pedir) a una cuenta del perfil; recibe la instrucción desde un archivo del proyecto o una tubería, con o sin `-`.',
            '`tctx tarea <id> [--cancelar | --continuar [--archivo <ruta> | -] [--sin-esperar]]` [consulta, cancela o continúa una tarea](delegar-tareas/seguir); solo al continuar recibe una nueva instrucción, igual que `delegar`, y admite `--sin-esperar`.',
            '`tctx help` muestra la ayuda completa de [tctx](herramientas-de-los-agentes/tctx), incluidos los códigos de salida; también se abre con `tctx`, `tctx --help` o `tctx -h`.'
          ]
        },
        'Tessera determina el perfil y el proyecto, de modo que un agente no puede leer las reglas ni el historial de otro perfil.'
      ]
    },
    {
      ancla: 'docker',
      titulo: 'Nativo o en Docker',
      bloques: [
        'En Docker, las operaciones disponibles de estos comandos las realiza Tessera en {tuEquipo}: el contenedor no recibe las contraseñas ni las claves guardadas en Tessera, ni tiene acceso a la red privada del equipo. Hay estas diferencias:',
        {
          lista: [
            'La salida de `tssh run` llega al terminar la orden, no en vivo, y la orden se detiene a los 10 minutos salvo que se indique otro tope con `--timeout`.',
            '`tssh cp` mueve como máximo 32 MiB y 10 000 archivos por vez.',
            '`tctx buscar` solo busca en las conversaciones de la cuenta del propio agente.',
            '`tctx cuentas`, `tctx delegar` y `tctx tarea` se rechazan desde Docker. Para [delegar tareas](delegar-tareas/requisitos), use un agente nativo o una terminal de Tessera con proyecto.',
            'Codex necesita [acceso completo](nativo-o-docker/codex) para usarlos.'
          ]
        },
        { nota: 'Un agente nativo se ejecuta con los mismos permisos que usted. No ve las contraseñas en su contexto, pero eso no es una barrera de seguridad. Para aislarlo realmente, use [Docker](nativo-o-docker).' }
      ]
    },
    {
      ancla: 'si-falla',
      titulo: 'Si algo no funciona',
      bloques: [
        {
          lista: [
            '`tdb doctor` y `tssh doctor` indican qué falla en el comando o en su comunicación con Tessera. `tdb test tienda` y `tssh doctor web-pruebas` también prueban esa conexión.',
            'Si indican que Tessera no reconoce la sesión o que la terminal no lleva el contexto de Tessera, reinicie la terminal con el botón de la flecha circular (**Reiniciar terminal**) de la cabecera del panel de terminal, que aparece al pasar el puntero por el panel, o reinicie el agente.',
            'Los comandos solo funcionan en terminales y agentes de Tessera. En una consola abierta fuera de Tessera no pueden comunicarse con ella.'
          ]
        }
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Three Tessera commands, available to the agents and to you: `tdb` for your databases, `tssh` for your SSH servers, and `tctx` for context, handoffs, history, and delegated tasks. With them, an agent uses your connections by name and never sees a password.',
  secciones: [
    {
      ancla: 'que-son',
      titulo: 'What these commands are',
      bloques: [
        'All three commands are available in Tessera terminals and in all its [agents](glosario/agente), native or in Docker. When an agent uses them, Tessera supplies the password or key on the agent’s behalf: the secret does not pass through the conversation, the agent’s environment, or any log.',
        'You decide what each agent can use: the databases you mount in each project and the SSH connections you make available. Mounting a database means [letting the agents use it](glosario/montar). You can also run the commands yourself in the terminal; `tdb help`, `tssh help`, and `tctx help` explain each one.'
      ]
    },
    {
      ancla: 'tdb',
      titulo: 'tdb: databases',
      bloques: [
        'To let a project’s agent query a database, follow these steps:',
        {
          pasos: [
            'On the right of the agent header, click the cylinder button (**Give the agent access to databases**). If databases are already mounted, it shows their number and its tooltip says how many the agent can query. **Databases the agent can query** opens. If the list is empty, first [create a connection](bases-de-datos/conexion) and test it with **Save and test**; untested connections do not appear until you open them once or use **Test connection** in their context menu.',
            'Turn on the connection’s switch. The change takes effect immediately, without losing the conversation, and also applies to the terminals of that project.'
          ]
        },
        'Once the database is mounted, the agent, or you in the terminal, can use these commands. In the examples, `tienda` is the connection name:',
        {
          lista: [
            '`tdb ls` lists the mounted databases. The other databases in the profile cannot be queried.',
            '`tdb query tienda "SELECT * FROM pedidos"` runs a query, with a limit of 50 rows that you can change with `--limit`.',
            '`tdb schema tienda` and `tdb describe tienda pedidos` show the tables and their columns.'
          ]
        },
        'When the **Read-only for agents (recommended)** switch is turned on for the connection, `tdb` does not write to it. This option does not restrict what you do in the database view.',
        { nota: 'Writes through `tdb` skip the [production](glosario/produccion) confirmation that you see in the database view. The agent knows which databases are production databases and is instructed not to write to them unless you ask. To keep it from writing, leave the connection read-only. See [Databases](bases-de-datos).' }
      ]
    },
    {
      ancla: 'tssh',
      titulo: 'tssh: SSH servers',
      bloques: [
        'Agents can use the profile’s SSH connections that have the **Available to agents** switch turned on in the [SSH connection](ssh/conexion) form; they do not even know the names of the others. In the examples, `web-pruebas` is the connection name:',
        {
          lista: [
            '`tssh ls` lists the available connections and shows whether they are ready.',
            '`tssh run web-pruebas -- df -h` runs a command on the server.',
            '`tssh cp report.txt web-pruebas:/tmp/` copies files, in either direction.'
          ]
        },
        '`tssh` connects only to servers whose [fingerprint](glosario/huella) a person has already accepted, from the Tessera terminal or with **Test**. If the fingerprint changes, it does not connect. Tessera logs each use with the connection and the result, never with the command. See [SSH connections](ssh).'
      ]
    },
    {
      ancla: 'tctx',
      titulo: 'tctx: context, handoffs, history, and tasks',
      bloques: [
        {
          lista: [
            '`tctx reglas [--perfil | --global]` shows the current [rules](reglas-del-perfil): the global ones, if the profile uses them, and the profile’s; either option returns only that level, without headings, for editing.',
            '`tctx proponer (--archivo <path> | --texto "<text>" | -) [--motivo "<reason>"] [--global]` sends a [proposed change](reglas-del-perfil/propuestas) with the complete profile rules or, with `--global`, the global rules; `-` reads standard input. It has no effect until you accept it.',
            '`tctx traspaso` gives the agent the work that another agent passed on when you [continued the conversation with it](continuar-en-otro-agente).',
            '`tctx buscar <words> [--exacta] [--max N]` [searches what was said](conversaciones/buscar) in the project: all words in one message or, with `--exacta`, the phrase; `--max` accepts 1 to 20 results. After `--`, everything is interpreted as search text.',
            '`tctx docs [<name>]` lists the [reference documents](reglas-del-perfil/documentos), from the profile and from the global context if the profile uses it; with a name it returns that document.',
            '`tctx config [--agente codex|claude-code]` shows the [technical Docker configuration by level](reglas-del-perfil/docker): global if used, profile, and, from Docker, account. From a terminal, you must specify the agent with `--agente`.',
            '`tctx config proponer --nivel global|perfil (--archivo <path> | --texto "<text>" | -) [--motivo "<reason>"] [--agente codex|claude-code]` sends a [configuration proposal](reglas-del-perfil/propuestas) with the complete file for the specified level; from a terminal, you must specify `--agente`. It does not apply until you accept it.',
            '`tctx cuentas` lists the [Docker accounts for delegation](delegar-tareas/pedir), their state, usage, and resets.',
            '`tctx modelos --agente claude-code|codex [--cuenta name|auto] [--actualizar]` shows the [models and efforts](delegar-tareas/pedir) an account offers.',
            '`tctx tareas` lists the project’s [delegated tasks](delegar-tareas/seguir) with their identifier and state.',
            '`tctx delegar --agente claude-code|codex [--cuenta name|auto] [--modelo <model>] [--esfuerzo <level>] [--solo-lectura] [--sin-esperar] [--archivo <path> | -]` [assigns a task](delegar-tareas/pedir) to a profile account; it receives the instruction from a project file or a pipe, with or without `-`.',
            '`tctx tarea <id> [--cancelar | --continuar [--archivo <path> | -] [--sin-esperar]]` [queries, cancels, or continues a task](delegar-tareas/seguir); only continuation receives a new instruction, as with `delegar`, and accepts `--sin-esperar`.',
            '`tctx help` shows the complete [tctx](herramientas-de-los-agentes/tctx) help, including exit codes; it also opens with `tctx`, `tctx --help`, or `tctx -h`.'
          ]
        },
        'Tessera determines the profile and the project, so an agent cannot read the rules or the history of another profile.'
      ]
    },
    {
      ancla: 'docker',
      titulo: 'Native or in Docker',
      bloques: [
        'In Docker, Tessera performs the available operations of these commands on {tuEquipo}: the container does not receive passwords or keys stored in Tessera, or access to your private network. These are the differences:',
        {
          lista: [
            'The output of `tssh run` arrives when the command finishes, not live, and the command stops after 10 minutes unless you set a different limit with `--timeout`.',
            '`tssh cp` moves at most 32 MiB and 10,000 files at a time.',
            '`tctx buscar` searches only the conversations of the agent’s own account.',
            '`tctx cuentas`, `tctx delegar`, and `tctx tarea` are rejected from Docker. To [delegate tasks](delegar-tareas/requisitos), use a native agent or a Tessera terminal with a project.',
            'Codex needs [full access](nativo-o-docker/codex) to use them.'
          ]
        },
        { nota: 'A native agent runs with your permissions. It does not see the passwords in its context, but that is not a security boundary. To truly isolate it, use [Docker](nativo-o-docker).' }
      ]
    },
    {
      ancla: 'si-falla',
      titulo: 'Troubleshooting',
      bloques: [
        {
          lista: [
            '`tdb doctor` and `tssh doctor` report what is failing in the command or in its communication with Tessera. `tdb test tienda` and `tssh doctor web-pruebas` also test that connection.',
            'If they report that Tessera does not recognize the session or that the terminal lacks the Tessera context, restart the terminal with the circular arrow button (**Restart terminal**) in the terminal panel header, which appears when you hover over the panel, or restart the agent.',
            'These commands work only in Tessera terminals and agents. In a console opened outside Tessera, they cannot communicate with it.'
          ]
        }
      ]
    }
  ]
}

export const txHerramientasDeLosAgentes = crearTextos(es, en)
