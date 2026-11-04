// =============================================================================
// Tessera Academy · tdb, tssh y tctx: lo que los agentes usan sin ver ninguna contraseña.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Tres comandos de Tessera, disponibles para los agentes y para usted: `tdb` para sus bases de datos, `tssh` para sus servidores SSH y `tctx` para las reglas, los traspasos y el historial. Con ellos, un agente usa sus conexiones por su nombre y nunca ve una contraseña.',
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
            'En la cabecera del agente, pulse **Dar al agente acceso a bases de datos**. Se abre la lista **Bases que el agente puede consultar**. Si ya hay bases montadas, el mismo botón indica cuántas puede consultar el agente.',
            'Marque la conexión. El cambio se aplica de inmediato, sin perder la conversación, y también vale en las terminales de ese proyecto.'
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
        'Con **Solo lectura para los agentes (recomendado)** marcada en la conexión, `tdb` no escribe en ella. Esta opción no limita lo que usted hace en la vista de bases de datos.',
        { nota: 'Las escrituras de `tdb` no pasan por la confirmación de [producción](glosario/produccion) que usted ve en la vista de bases de datos. El agente sabe qué bases son de producción y tiene la instrucción de no escribir en ellas salvo que usted se lo pida. Para que no pueda escribir, deje la conexión en solo lectura. Consulte [Bases de datos](bases-de-datos).' }
      ]
    },
    {
      ancla: 'tssh',
      titulo: 'tssh: servidores SSH',
      bloques: [
        'Los agentes pueden usar las conexiones SSH del perfil que tienen marcada **Disponible para los agentes**; de las demás no conocen ni el nombre. En los ejemplos, `web-pruebas` es el nombre de la conexión:',
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
      titulo: 'tctx: reglas, traspasos e historial',
      bloques: [
        {
          lista: [
            '`tctx reglas` muestra las [reglas del perfil](reglas-del-perfil) vigentes.',
            '`tctx proponer` envía una [propuesta de cambio](reglas-del-perfil/propuestas) de esas reglas. La propuesta no tiene efecto hasta que usted la acepta.',
            '`tctx traspaso` entrega al agente el trabajo que otro agente le pasó cuando usted [continuó la conversación con él](continuar-en-otro-agente).',
            '`tctx buscar` [busca en lo que se habló](conversaciones/buscar) en el proyecto.'
          ]
        },
        'Tessera determina el perfil y el proyecto, de modo que un agente no puede leer las reglas ni el historial de otro perfil.'
      ]
    },
    {
      ancla: 'docker',
      titulo: 'Nativo o en Docker',
      bloques: [
        'En Docker, los tres comandos se usan igual, pero la operación real la realiza Tessera en {tuEquipo}: el contenedor no recibe las contraseñas ni las claves guardadas en Tessera, ni tiene acceso a la red privada del equipo. Hay estas diferencias:',
        {
          lista: [
            'La salida de `tssh run` llega al terminar la orden, no en vivo, y la orden se detiene a los 10 minutos salvo que se indique otro tope con `--timeout`.',
            '`tssh cp` mueve como máximo 32 MiB y 10 000 archivos por vez.',
            '`tctx buscar` solo busca en las conversaciones de la cuenta del propio agente.',
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
            'Si indican que Tessera no reconoce la sesión o que la terminal no lleva el contexto de Tessera, reinicie la terminal con **Reiniciar terminal** o reinicie el agente.',
            'Los comandos solo funcionan en terminales y agentes de Tessera. En una consola abierta fuera de Tessera no pueden comunicarse con ella.'
          ]
        }
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Three Tessera commands, available to the agents and to you: `tdb` for your databases, `tssh` for your SSH servers, and `tctx` for rules, handoffs, and history. With them, an agent uses your connections by name and never sees a password.',
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
            'In the agent header, click **Give the agent access to databases**. The **Databases the agent can query** list opens. If databases are already mounted, the same button shows how many the agent can query.',
            'Select the connection. The change takes effect immediately, without losing the conversation, and also applies to the terminals of that project.'
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
        'When **Read-only for agents (recommended)** is selected on the connection, `tdb` does not write to it. This option does not restrict what you do in the database view.',
        { nota: 'Writes through `tdb` skip the [production](glosario/produccion) confirmation that you see in the database view. The agent knows which databases are production databases and is instructed not to write to them unless you ask. To keep it from writing, leave the connection read-only. See [Databases](bases-de-datos).' }
      ]
    },
    {
      ancla: 'tssh',
      titulo: 'tssh: SSH servers',
      bloques: [
        'Agents can use the profile’s SSH connections that have **Available to agents** selected; they do not even know the names of the others. In the examples, `web-pruebas` is the connection name:',
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
      titulo: 'tctx: rules, handoffs, and history',
      bloques: [
        {
          lista: [
            '`tctx reglas` shows the current [profile rules](reglas-del-perfil).',
            '`tctx proponer` sends a [proposed change](reglas-del-perfil/propuestas) to those rules. The proposal has no effect until you accept it.',
            '`tctx traspaso` gives the agent the work that another agent passed on when you [continued the conversation with it](continuar-en-otro-agente).',
            '`tctx buscar` [searches what was said](conversaciones/buscar) in the project.'
          ]
        },
        'Tessera determines the profile and the project, so an agent cannot read the rules or the history of another profile.'
      ]
    },
    {
      ancla: 'docker',
      titulo: 'Native or in Docker',
      bloques: [
        'In Docker, all three commands are used the same way, but Tessera performs the actual operation on {tuEquipo}: the container does not have your passwords, your keys, or access to your private network. These are the differences:',
        {
          lista: [
            'The output of `tssh run` arrives when the command finishes, not live, and the command stops after 10 minutes unless you set a different limit with `--timeout`.',
            '`tssh cp` moves at most 32 MiB and 10,000 files at a time.',
            '`tctx buscar` searches only the conversations of the agent’s own account.',
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
            'If they report that Tessera does not recognize the session or that the terminal lacks the Tessera context, restart the terminal with **Restart terminal** or restart the agent.',
            'These commands work only in Tessera terminals and agents. In a console opened outside Tessera, they cannot communicate with it.'
          ]
        }
      ]
    }
  ]
}

export const txHerramientasDeLosAgentes = crearTextos(es, en)
