// =============================================================================
// Tessera Academy · Bases de datos: crear una conexión, explorarla, las transacciones, producción
// y darla a los agentes. Su forma es la de `modelo.ts` y el inglés repite la del español
// (`test-academy.mts`).
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Tessera incluye un cliente de bases de datos: cada perfil guarda sus conexiones, y cada conexión tiene un árbol para explorarla, consolas para escribir consultas y una rejilla para ver y editar datos. También puede permitir que los agentes consulten una base sin que vean nunca la contraseña.',
  secciones: [
    {
      ancla: 'conexion',
      titulo: 'Crear o editar una conexión',
      bloques: [
        {
          pasos: [
            'En el [riel](glosario/riel), haga clic en el icono **Conexiones a bases de datos** y después en **Nueva conexión…**. Se abre el formulario de la conexión.',
            'Seleccione el **Motor**: Oracle, PostgreSQL, SQLite, SQL Server, MySQL / MariaDB, MongoDB o Redis. El formulario muestra los campos de ese motor. En PostgreSQL, MySQL / MariaDB, MongoDB y Redis, **Pegar URI…** rellena los campos desde una dirección como `postgres://usuario@host:5432/tienda`.',
            'Escriba un **Nombre** para la conexión. Es una etiqueta elegida por usted, no un dato del servidor, y los agentes identifican la conexión por ese nombre.',
            'Haga clic en **Guardar y probar**. Tessera guarda la conexión e intenta conectarse; el formulario informa del resultado. Si la prueba falla, la conexión queda guardada: corrija los datos y pruebe de nuevo.'
          ]
        },
        'Un agente solo puede usar una conexión que se haya verificado, es decir, que se haya probado con éxito o abierto en la vista de bases de datos. Si después cambia el servidor, el usuario, la contraseña o el cifrado, la conexión debe verificarse de nuevo.',
        'El formulario incluye además estos campos:',
        {
          lista: [
            '**Entorno**: **Desarrollo** añade una marca verde, **Pruebas** una marca ámbar y **Producción** una marca roja, además de [pedir confirmación](bases-de-datos/produccion) antes de cada escritura. **Sin entorno** no añade ninguna marca ni confirmación.',
            '**Solo lectura para los agentes (recomendado)**: impide que los agentes escriban en esta conexión mediante [tdb](glosario/tdb). No limita lo que usted hace en la vista de bases de datos. La única garantía completa es que los agentes usen además un usuario de base de datos con permisos de lectura únicamente.',
            '**Túnel SSH**: conecta con la base a través de una de las [conexiones SSH](ssh) del perfil, también con un bastión (un servidor intermedio). Indique el host y el puerto de la base tal como los ve el servidor SSH. Esa conexión SSH debe tener la [huella](glosario/huella) aceptada y la contraseña o la clave guardada. SQLite no usa túnel; tampoco lo admiten MongoDB con DNS SRV o con varios servidores, SQL Server con una instancia con nombre ni Redis con Sentinel o Cluster.'
          ]
        },
        'La contraseña se guarda cifrada con {almacenSecretos}, vinculada a su usuario y a {tuEquipo}. Si no se puede descifrar (por ejemplo, después de trasladar sus datos a otro equipo), el árbol la solicita de nuevo.',
        {
          nota: 'Sin GNOME Keyring ni KWallet, la conexión se puede crear, pero Tessera no guarda su contraseña, porque en ese caso quedaría en el disco sin un cifrado real. Para guardarla, instale y desbloquee uno de esos dos llaveros.',
          soloEn: ['linux']
        }
      ]
    },
    {
      ancla: 'explorador',
      titulo: 'El árbol, los datos y las consolas',
      bloques: [
        'A la izquierda de la vista aparece el árbol de cada conexión, con sus esquemas, tablas, vistas, rutinas y demás objetos. **Abrir datos**, en el menú contextual de una tabla, la abre en una rejilla con paginación, filtro y exportación.',
        '**Nueva consola** abre una [consola](glosario/consola) de esa conexión. Una consola SQL ofrece autocompletado, formato, plan de ejecución e historial de consultas; las de MongoDB y Redis usan la sintaxis de cada motor. Las consolas se guardan como archivos del perfil. Al eliminar una consola con contenido, su archivo pasa a {papelera}.',
        'Los cambios hechos en la rejilla no se escriben en la base hasta que se envían:',
        {
          pasos: [
            'Edite las celdas o las filas que necesite. Los cambios quedan pendientes en la rejilla.',
            'Haga clic en **Enviar cambios**. Se abre una vista previa con lo que se va a ejecutar.',
            'Haga clic en **Enviar**. En una conexión de producción, el botón se llama **Ejecutar en producción**. Los cambios quedan escritos en la base.'
          ]
        },
        'En los motores SQL, todos los cambios de un envío van en una sola transacción: si uno falla, no se aplica ninguno. En MongoDB ocurre lo mismo si el servidor admite transacciones; si no las admite, los cambios se aplican en orden, el envío se detiene en el primer fallo y Tessera indica cuántos se aplicaron.',
        {
          captura: 'bd-vista',
          alt: 'La vista de bases de datos: el árbol de una conexión a la izquierda, una consola SQL y la rejilla de resultados debajo'
        }
      ]
    },
    {
      ancla: 'transacciones',
      titulo: 'Transacciones: Auto y Manual',
      bloques: [
        'Cada consola SQL muestra su modo de transacción en la barra, y un clic en ese control lo cambia. **Tx: Auto** confirma cada sentencia al ejecutarla. **Tx: Manual** abre una transacción que queda pendiente hasta que se hace clic en **Confirmar (Commit)** o **Revertir (Rollback)**.',
        'Mientras hay una transacción pendiente, la pestaña de la consola lo indica. Para cerrar esa consola, desconectarla o pasarla a **Tx: Auto**, Tessera pide antes confirmar o revertir la transacción: nunca la descarta sin preguntar. Una transacción que falló solo se puede revertir.',
        'En una base SQLite, mientras la transacción sigue abierta el archivo queda bloqueado, y otras aplicaciones pueden no poder escribir en él.',
        'El modo inicial de las consolas nuevas se elige en **Configuración › Bases de datos › Transacción al abrir**. Esta preferencia no se aplica a las conexiones de producción, cuyas consolas se inician siempre en Manual.'
      ]
    },
    {
      ancla: 'produccion',
      titulo: 'Conexiones de producción',
      bloques: [
        'Una conexión de [producción](glosario/produccion) lleva una marca roja en el árbol, en sus pestañas y en la barra de sus consolas, y sus consolas nuevas se inician en **Tx: Manual**.',
        'Antes de cada escritura (DML, DDL, PL/SQL, un COMMIT o el envío de los cambios de la rejilla), Tessera pide confirmación y muestra el nombre de la conexión. Las consultas de lectura no piden confirmación, ni tampoco revertir o cerrar una consola.',
        'Tessera avisa, pero no bloquea la escritura. Puede pasar la consola a **Tx: Auto** si lo necesita: cada sentencia se confirmará al ejecutarla, y la confirmación previa a cada escritura se seguirá pidiendo.',
        {
          nota: 'Producción protege la base frente a un descuido de la persona que la utiliza; **Solo lectura para los agentes** la protege frente a las escrituras de los agentes. Son opciones independientes y se pueden combinar.'
        }
      ]
    },
    {
      ancla: 'agentes',
      titulo: 'Dar una base a los agentes',
      bloques: [
        'Un agente solo puede consultar las bases [montadas](glosario/montar) en su proyecto. Para montar una:',
        {
          pasos: [
            'En la cabecera del agente, haga clic en el botón **Dar al agente acceso a bases de datos**. La lista muestra las conexiones del perfil ya verificadas.',
            'Active las conexiones que el agente debe poder consultar. El cambio se aplica al momento, sin reiniciar el agente. Si el agente menciona una lista anterior, pídale que vuelva a comprobar qué bases tiene.'
          ]
        },
        'El agente consulta esas bases con `tdb`, por el nombre de la conexión y sin ver nunca la contraseña, tanto en modo nativo como en Docker. Lo explica [tdb, tssh y tctx](herramientas-de-los-agentes/tdb).',
        'Un archivo SQLite del proyecto se monta desde el explorador: haga clic derecho en el archivo y seleccione **Montar como base de datos**. El archivo se añade a la vista de bases de datos como una conexión de solo lectura para los agentes, si no existía ya una conexión a ese archivo, y el agente puede consultarlo. Para retirarlo, use **Desmontar la base de datos** en el mismo menú.'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Tessera includes a database client: each profile stores its connections, and each connection has a tree to explore it, consoles to write queries, and a grid to view and edit data. You can also let the agents query a database without ever seeing the password.',
  secciones: [
    {
      ancla: 'conexion',
      titulo: 'Create or edit a connection',
      bloques: [
        {
          pasos: [
            'In the [rail](glosario/riel), click the **Database connections** icon, and then click **New connection…**. The connection form opens.',
            'Select the **Engine**: Oracle, PostgreSQL, SQLite, SQL Server, MySQL / MariaDB, MongoDB, or Redis. The form shows the fields for that engine. For PostgreSQL, MySQL / MariaDB, MongoDB, and Redis, **Paste URI…** fills in the fields from an address such as `postgres://user@host:5432/shop`.',
            'Enter a **Name** for the connection. It is a label you choose, not a value from the server, and the agents identify the connection by that name.',
            'Click **Save and test**. Tessera saves the connection and tries to connect; the form reports the result. If the test fails, the connection stays saved: correct the details and test again.'
          ]
        },
        'An agent can use only a verified connection, that is, one that has been tested successfully or opened in the databases view. If you later change the server, user, password, or encryption, the connection must be verified again.',
        'The form also includes these fields:',
        {
          lista: [
            '**Environment**: **Development** adds a green label, **Testing** an amber label, and **Production** a red label; Production also [asks for confirmation](bases-de-datos/produccion) before every write. **No environment** adds no label or confirmation.',
            '**Read-only for agents (recommended)**: prevents the agents from writing to this connection through [tdb](glosario/tdb). It does not restrict what you do in the databases view. The only complete guarantee is to also give the agents a database user with read-only permissions.',
            '**SSH tunnel**: connects to the database through one of the profile’s [SSH connections](ssh), including through a bastion (an intermediate server). Enter the database host and port as the SSH server sees them. That SSH connection must have its [fingerprint](glosario/huella) accepted and its password or key saved. SQLite does not use a tunnel; tunnels are also not available for MongoDB with DNS SRV or several servers, SQL Server with a named instance, or Redis with Sentinel or Cluster.'
          ]
        },
        'The password is saved encrypted with {almacenSecretos}, tied to your user account and to {tuEquipo}. If it cannot be decrypted (for example, after you move your data to another computer), the tree asks for it again.',
        {
          nota: 'Without GNOME Keyring or KWallet, you can still create the connection, but Tessera does not save its password, because it would be stored on disk without real encryption. To save it, install and unlock one of those two keyrings.',
          soloEn: ['linux']
        }
      ]
    },
    {
      ancla: 'explorador',
      titulo: 'The tree, the data, and the consoles',
      bloques: [
        'The left side of the view shows the tree of each connection, with its schemas, tables, views, routines, and other objects. **Open data**, in a table’s context menu, opens the table in a grid with paging, filtering, and export.',
        '**New console** opens a [console](glosario/consola) for that connection. An SQL console offers autocompletion, formatting, execution plans, and query history; MongoDB and Redis consoles use each engine’s syntax. Consoles are saved as profile files. When you delete a console that has content, its file moves to {papelera}.',
        'Changes made in the grid are not written to the database until you submit them:',
        {
          pasos: [
            'Edit the cells or rows you need. The changes stay pending in the grid.',
            'Click **Submit changes**. A preview opens with what will be run.',
            'Click **Submit**. On a production connection, the button is called **Run in production**. The changes are written to the database.'
          ]
        },
        'On SQL engines, all the changes in a submission run in a single transaction: if one fails, none are applied. MongoDB does the same if the server supports transactions; if it does not, the changes are applied in order, the submission stops at the first failure, and Tessera reports how many were applied.',
        {
          captura: 'bd-vista',
          alt: 'The databases view: a connection’s tree on the left, an SQL console, and the results grid below it'
        }
      ]
    },
    {
      ancla: 'transacciones',
      titulo: 'Transactions: Auto and Manual',
      bloques: [
        'Each SQL console shows its transaction mode in its toolbar, and clicking that control changes it. **Tx: Auto** commits each statement when it runs. **Tx: Manual** opens a transaction that stays pending until you click **Commit** or **Roll back**.',
        'While a transaction is pending, the console tab shows it. Before you close that console, disconnect it, or switch it to **Tx: Auto**, Tessera asks you to commit or roll back the transaction: it never discards it without asking. A failed transaction can only be rolled back.',
        'On a SQLite database, the file stays locked while the transaction is open, and other applications may not be able to write to it.',
        'To choose the mode that new consoles start in, go to **Settings › Databases › Transaction mode for new consoles**. This preference does not apply to production connections, whose consoles always start in Manual.'
      ]
    },
    {
      ancla: 'produccion',
      titulo: 'Production connections',
      bloques: [
        'A [production](glosario/produccion) connection shows a red label in the tree, in its tabs, and in the toolbar of its consoles, and its new consoles start in **Tx: Manual**.',
        'Before every write (DML, DDL, PL/SQL, a COMMIT, or submitting grid changes), Tessera asks for confirmation and shows the connection name. Read queries do not ask for confirmation, and neither does rolling back or closing a console.',
        'Tessera warns you but does not block the write. You can switch the console to **Tx: Auto** if you need to: each statement is committed when it runs, and Tessera still asks for confirmation before each write.',
        {
          nota: 'Production protects the database from a mistake by the person using it; **Read-only for agents** protects it from writes by the agents. These are separate settings, and you can use both.'
        }
      ]
    },
    {
      ancla: 'agentes',
      titulo: 'Give the agents access to a database',
      bloques: [
        'An agent can query only the databases [mounted](glosario/montar) in its project. To mount one:',
        {
          pasos: [
            'In the agent header, click the **Give the agent access to databases** button. The list shows the profile’s verified connections.',
            'Turn on the connections the agent should be able to query. The change takes effect immediately, without restarting the agent. If the agent mentions an old list, ask it to check again which databases it has.'
          ]
        },
        'The agent queries those databases with `tdb`, by connection name and without ever seeing the password, both in native mode and in Docker. For details, see [tdb, tssh, and tctx](herramientas-de-los-agentes/tdb).',
        'To mount a SQLite file from the project, right-click it in the explorer and select **Mount as database**. The file is added to the databases view as a connection that is read-only for agents, unless a connection to that file already exists, and the agent can query it. To remove it, use **Unmount database** in the same menu.'
      ]
    }
  ]
}

export const txBasesDeDatos = crearTextos(es, en)
