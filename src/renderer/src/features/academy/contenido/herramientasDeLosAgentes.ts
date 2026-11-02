// =============================================================================
// Tessera Academy · tdb, tssh y tctx: lo que los agentes usan sin ver ninguna contraseña.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Tres comandos que Tessera pone a mano de los agentes: `tdb` para tus bases de datos, `tssh` para tus servidores SSH y `tctx` para las reglas, los traspasos y el historial. Los agentes usan tus conexiones por su nombre y nunca ven una contraseña.',
  secciones: [
    {
      ancla: 'que-son',
      titulo: 'Qué son',
      bloques: [
        'Los tres están en las terminales de Tessera y en todos sus agentes, nativos o en Docker. Cuando un agente los usa, Tessera pone la contraseña o la clave por él: no pasa por la conversación, ni por su entorno, ni por ningún registro.',
        'Tú decides qué puede usar: las bases que montas en cada proyecto y las conexiones SSH que dejas disponibles. También puedes usarlos tú en la terminal; `tdb help`, `tssh help` y `tctx help` explican cada uno.'
      ]
    },
    {
      ancla: 'tdb',
      titulo: 'tdb: bases de datos',
      bloques: [
        'Para que el agente de un proyecto consulte una base, pulsa **Dar al agente acceso a bases de datos** en su cabecera y marca la conexión en **Bases que el agente puede consultar**. Vale al momento, sin perder la conversación, y sirve también en las terminales de ese proyecto.',
        {
          lista: [
            '`tdb ls` lista las bases montadas. Las demás del perfil no se pueden consultar.',
            '`tdb query tienda "SELECT * FROM pedidos"` consulta, con un tope de filas.',
            '`tdb schema tienda` y `tdb describe tienda pedidos` enseñan las tablas y sus columnas.'
          ]
        },
        'Con **Solo lectura para los agentes (recomendado)**, marcada en la conexión, `tdb` no escribe en ella. A ti no te limita.',
        { nota: 'Las escrituras de `tdb` no pasan por la confirmación de [producción](glosario/produccion) que ves tú: el agente sabe qué bases son de producción y tiene la orden de no escribir en ellas salvo que se lo pidas. Si no quieres que escriba, déjala en solo lectura. Ver [Bases de datos](bases-de-datos).' }
      ]
    },
    {
      ancla: 'tssh',
      titulo: 'tssh: servidores SSH',
      bloques: [
        'Los agentes usan las conexiones SSH del perfil que tienen marcada **Disponible para los agentes**; las demás ni las ven por su nombre.',
        {
          lista: [
            '`tssh ls` lista las disponibles y si están listas.',
            '`tssh run web-pruebas -- df -h` ejecuta una orden en el servidor.',
            '`tssh cp informe.txt web-pruebas:/tmp/` copia archivos en los dos sentidos.'
          ]
        },
        'Solo entra en servidores cuya [huella](glosario/huella) ya aceptó una persona, desde la terminal de Tessera o con **Probar**. Si la huella cambia, se para. Tessera apunta cada uso con la conexión y cómo acabó, nunca la orden. Ver [Conexiones SSH](ssh).'
      ]
    },
    {
      ancla: 'tctx',
      titulo: 'tctx: reglas, traspasos e historial',
      bloques: [
        {
          lista: [
            '`tctx reglas` da las [reglas del perfil](reglas-del-perfil) vigentes.',
            '`tctx proponer` te deja una [propuesta de cambio](reglas-del-perfil/propuestas) a esas reglas, que no vale hasta que la aceptes.',
            '`tctx traspaso` da el trabajo que le pasó otro agente al [continuar con él](continuar-en-otro-agente).',
            '`tctx buscar` [busca en lo que se habló](conversaciones/buscar) en el proyecto.'
          ]
        },
        'El perfil y el proyecto los pone Tessera: un agente no puede leer las reglas ni el historial de otro perfil.'
      ]
    },
    {
      ancla: 'docker',
      titulo: 'Nativo o en Docker',
      bloques: [
        'En Docker los tres hacen lo mismo, pero el trabajo de verdad lo hace Tessera en {tuEquipo}: el contenedor no tiene tus contraseñas, ni tus claves, ni tu red privada.',
        {
          lista: [
            'La salida de `tssh run` llega al acabar, no en vivo, y la orden se corta a los 10 minutos si no se pide otro tope.',
            '`tctx buscar` solo busca en las conversaciones de su propia cuenta.'
          ]
        },
        { nota: 'Un agente nativo corre con tus permisos. No ve las contraseñas, pero eso no es una barrera: si quieres aislarlo de verdad, usa [Docker](nativo-o-docker).' }
      ]
    },
    {
      ancla: 'si-falla',
      titulo: 'Si algo no funciona',
      bloques: [
        {
          lista: [
            '`tdb doctor` y `tssh doctor` dicen qué falla en el comando o en su conexión con Tessera. `tdb test tienda` y `tssh doctor web-pruebas` prueban además esa conexión.',
            'Si dicen que Tessera no reconoce la sesión, recarga la terminal o reinicia el agente.',
            'Solo funcionan en terminales y agentes de Tessera: en una consola abierta por tu cuenta no tienen a quién preguntar.'
          ]
        }
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Tessera gives the agents three commands: `tdb` for your databases, `tssh` for your SSH servers, and `tctx` for rules, handoffs, and history. The agents use your connections by name and never see a password.',
  secciones: [
    {
      ancla: 'que-son',
      titulo: 'What these commands are',
      bloques: [
        'All three commands are available in Tessera terminals and in every Tessera agent, native or in Docker. When an agent uses them, Tessera supplies the password or key on the agent’s behalf, so the secret never passes through the conversation, the agent’s environment, or any log.',
        'You decide what the agents can use: the databases you mount in each project and the SSH connections you make available. You can also use the commands yourself in the terminal; `tdb help`, `tssh help`, and `tctx help` explain each one.'
      ]
    },
    {
      ancla: 'tdb',
      titulo: 'tdb: databases',
      bloques: [
        'To let a project’s agent query a database, click **Give the agent access to databases** in the agent header, and select the connection in **Databases the agent can query**. The change takes effect immediately, without losing the conversation, and also applies to the terminals of that project.',
        {
          lista: [
            '`tdb ls` lists the mounted databases. The other databases in the profile cannot be queried.',
            '`tdb query tienda "SELECT * FROM pedidos"` runs a query, with a row limit.',
            '`tdb schema tienda` and `tdb describe tienda pedidos` show the tables and their columns.'
          ]
        },
        'When **Read-only for agents (recommended)** is selected on the connection, `tdb` does not write to it. This setting does not restrict you.',
        { nota: 'Writes through `tdb` skip the [production](glosario/produccion) confirmation that you see. The agent knows which databases are production databases and is instructed not to write to them unless you ask. If you do not want the agent to write, keep the connection read-only. See [Databases](bases-de-datos).' }
      ]
    },
    {
      ancla: 'tssh',
      titulo: 'tssh: SSH servers',
      bloques: [
        'Agents can use the profile’s SSH connections that have **Available to agents** selected; they cannot even see the names of the other connections.',
        {
          lista: [
            '`tssh ls` lists the available connections and whether they are ready.',
            '`tssh run web-pruebas -- df -h` runs a command on the server.',
            '`tssh cp report.txt web-pruebas:/tmp/` copies files in either direction.'
          ]
        },
        '`tssh` connects only to servers whose [fingerprint](glosario/huella) a person has already accepted, from the Tessera terminal or with **Test**. If the fingerprint changes, it stops. Tessera logs each use with the connection name and the result, but never the command. See [SSH connections](ssh).'
      ]
    },
    {
      ancla: 'tctx',
      titulo: 'tctx: rules, handoffs, and history',
      bloques: [
        {
          lista: [
            '`tctx reglas` returns the current [profile rules](reglas-del-perfil).',
            '`tctx proponer` sends you a [proposed change](reglas-del-perfil/propuestas) to those rules, which has no effect until you accept it.',
            '`tctx traspaso` returns the work that another agent passed on when you [continued with this agent](continuar-en-otro-agente).',
            '`tctx buscar` [searches past conversations](conversaciones/buscar) in the project.'
          ]
        },
        'Tessera sets the profile and the project: an agent cannot read the rules or the history of another profile.'
      ]
    },
    {
      ancla: 'docker',
      titulo: 'Native or in Docker',
      bloques: [
        'In Docker, all three commands work the same way, but Tessera does the actual work on {tuEquipo}: the container never has your passwords, your keys, or access to your private network.',
        {
          lista: [
            'The output of `tssh run` arrives when the command finishes, not live, and the command stops after 10 minutes unless a different limit is requested.',
            '`tctx buscar` searches only the conversations of the agent’s own account.'
          ]
        },
        { nota: 'A native agent runs with your permissions. It does not see the passwords, but that is not a security boundary: to truly isolate the agent, use [Docker](nativo-o-docker).' }
      ]
    },
    {
      ancla: 'si-falla',
      titulo: 'Troubleshooting',
      bloques: [
        {
          lista: [
            '`tdb doctor` and `tssh doctor` report what is failing in the command or in its connection to Tessera. `tdb test tienda` and `tssh doctor web-pruebas` also test that specific connection.',
            'If they report that Tessera does not recognize the session, reload the terminal or restart the agent.',
            'These commands work only in Tessera terminals and agents: a console that you opened outside Tessera has no connection to Tessera.'
          ]
        }
      ]
    }
  ]
}

export const txHerramientasDeLosAgentes = crearTextos(es, en)
