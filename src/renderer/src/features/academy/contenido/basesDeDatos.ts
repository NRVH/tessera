// =============================================================================
// Tessera Academy · Bases de datos: crear una conexión, explorarla, las transacciones, producción
// y darla a los agentes. Su forma es la de `modelo.ts` y el inglés repite la del español
// (`test-academy.mts`).
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Tessera trae su propio cliente de bases de datos: conexiones por perfil, un árbol para explorarlas, consolas y una rejilla para editar. Y puedes dárselas a los agentes sin enseñarles la contraseña.',
  secciones: [
    {
      ancla: 'conexion',
      titulo: 'Crear o editar una conexión',
      bloques: [
        {
          pasos: [
            'Abre la vista de bases de datos con el icono **Conexiones a bases de datos** del riel y pulsa **Nueva conexión…**.',
            'Elige el **Motor**: Oracle, PostgreSQL, SQLite, SQL Server, MySQL / MariaDB, MongoDB o Redis. El formulario cambia con él, y **Pegar URI…** lo rellena desde una dirección como `postgres://usuario@host:5432/tienda`.',
            'Dale un **Nombre**: es solo tuyo, y es el que usarán los agentes para referirse a ella.',
            'Pulsa **Guardar y probar**. Una conexión que nunca se ha probado no se puede dar a los agentes.'
          ]
        },
        {
          lista: [
            '**Entorno**: Desarrollo (marca verde), Pruebas (ámbar) o Producción (roja, y [pide confirmación](bases-de-datos/produccion) antes de cada escritura). **Sin entorno** no marca nada.',
            '**Solo lectura para los agentes (recomendado)**: limita lo que hacen los agentes con `tdb`; a ti nunca te limita. Para una garantía de verdad, dales además un usuario de base de datos que solo pueda leer.',
            '**Túnel SSH**: llega a la base a través de una de las [conexiones SSH](ssh) del perfil, también con bastión. El host y el puerto son los de la base vistos desde el servidor SSH, y esa conexión necesita su [huella](glosario/huella) ya aceptada y su contraseña o clave guardada.'
          ]
        },
        'La contraseña se guarda cifrada con {almacenSecretos}, atada a tu usuario y a {tuEquipo}. Si un día no se puede descifrar (por ejemplo, tras llevar tus datos a otro equipo), el árbol te pide que la vuelvas a escribir.',
        {
          nota: 'Sin GNOME Keyring ni KWallet, la conexión se crea igual, pero Tessera no guarda su contraseña: nunca la deja en el disco casi en claro.',
          soloEn: ['linux']
        }
      ]
    },
    {
      ancla: 'explorador',
      titulo: 'El árbol, los datos y las consolas',
      bloques: [
        'A la izquierda, el árbol de cada conexión: esquemas, tablas, vistas, rutinas y el resto de objetos. **Abrir datos**, en el menú de una tabla, la abre en una rejilla con paginado, filtro y exportación.',
        '**Nueva consola** abre una consola de esa conexión: SQL con autocompletado, formato, plan de ejecución e historial de consultas, o la sintaxis propia de MongoDB y Redis. Las consolas se guardan como archivos del perfil; al eliminar una, va a {papelera}.',
        'Lo que cambias en la rejilla no se escribe hasta que pulsas **Enviar**: todos los cambios van en una sola transacción, y si uno falla no se aplica ninguno.',
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
        'Cada consola tiene su modo en su barra. **Tx: Auto** confirma cada sentencia al ejecutarla. **Tx: Manual** abre una transacción que queda pendiente hasta que pulsas **Confirmar (Commit)** o **Revertir (Rollback)**.',
        'Mientras hay una transacción pendiente, su pestaña lo marca. Para desconectar o eliminar esa consola, Tessera te pide antes confirmarla o revertirla: nunca la descarta sin preguntar. Una transacción que falló solo se puede revertir.',
        'El modo con el que nacen las consolas nuevas se elige en **Configuración › Bases de datos › Transacción al abrir**.'
      ]
    },
    {
      ancla: 'produccion',
      titulo: 'Conexiones de producción',
      bloques: [
        'Una conexión de [producción](glosario/produccion) lleva una marca roja en el árbol, en sus pestañas y en la barra de sus consolas, y sus consolas nuevas arrancan en **Tx: Manual**.',
        'Antes de cada escritura (DML, DDL, PL/SQL, un COMMIT o el envío de los cambios de la rejilla), Tessera te pide confirmarla con el nombre de la conexión delante. Avisa, pero nunca te bloquea: si quieres, pasas la consola a Auto.',
        {
          nota: 'Producción te protege a ti de un descuido; **Solo lectura para los agentes** protege la base de los agentes. Son cosas distintas y se pueden combinar.'
        }
      ]
    },
    {
      ancla: 'agentes',
      titulo: 'Dar una base a los agentes',
      bloques: [
        'Un agente solo ve las bases que [montas](glosario/montar) en su proyecto. En la cabecera del agente, el botón **Dar al agente acceso a bases de datos** enseña las conexiones del perfil ya probadas: activa las que quieras y el cambio vale al momento.',
        'El agente las consulta con `tdb`, por el nombre de la conexión, sin ver nunca la contraseña, igual en nativo que en Docker. Lo cuenta [tdb, tssh y tctx](herramientas-de-los-agentes/tdb).',
        'Un archivo SQLite del proyecto se monta desde el explorador, con clic derecho y **Montar como base de datos**: se añade a la vista de bases de datos y el agente puede consultarlo.'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Tessera includes its own database client: connections per profile, a tree to explore them, consoles, and an editable data grid. You can also give the agents access to your databases without showing them the password.',
  secciones: [
    {
      ancla: 'conexion',
      titulo: 'Create or edit a connection',
      bloques: [
        {
          pasos: [
            'To open the databases view, click the **Database connections** icon in the rail, and then click **New connection…**.',
            'Choose the **Engine**: Oracle, PostgreSQL, SQLite, SQL Server, MySQL / MariaDB, MongoDB, or Redis. The form adapts to the engine, and **Paste URI…** fills it in from an address such as `postgres://user@host:5432/shop`.',
            'Enter a **Name**: it is for your use only, and the agents use it to refer to the connection.',
            'Click **Save and test**. You cannot give the agents a connection that has never been tested.'
          ]
        },
        {
          lista: [
            '**Environment**: Development (green label), Testing (amber), or Production (red; Tessera [asks for confirmation](bases-de-datos/produccion) before every write). **No environment** adds no label.',
            '**Read-only for agents (recommended)**: restricts what the agents can do with `tdb`; it never restricts you. For a real guarantee, also give the agents a database user with read-only permissions.',
            '**SSH tunnel**: reaches the database through one of the profile’s [SSH connections](ssh), including through a bastion. Enter the database host and port as the SSH server sees them. That SSH connection must already have its [fingerprint](glosario/huella) accepted and its password or key saved.'
          ]
        },
        'Tessera encrypts and saves the password with {almacenSecretos}, tied to your user account and to {tuEquipo}. If the password ever cannot be decrypted (for example, after you move your data to another computer), the tree asks you to enter it again.',
        {
          nota: 'Without GNOME Keyring or KWallet, Tessera still creates the connection, but it does not save the password, so the password is never stored on disk in a nearly plain-text form.',
          soloEn: ['linux']
        }
      ]
    },
    {
      ancla: 'explorador',
      titulo: 'The tree, the data, and the consoles',
      bloques: [
        'On the left, each connection has a tree with its schemas, tables, views, routines, and other objects. **Open data**, in a table’s menu, opens the table in a grid with paging, filtering, and export.',
        '**New console** opens a console for that connection: SQL with autocompletion, formatting, execution plans, and query history, or the MongoDB and Redis syntax. Consoles are saved as profile files; when you delete one, it moves to {papelera}.',
        'Your changes in the grid are not written until you click **Submit**. All the changes run in a single transaction, and if one fails, none are applied.',
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
        'Each console shows its transaction mode in its toolbar. **Tx: Auto** commits each statement when it runs. **Tx: Manual** opens a transaction that stays pending until you click **Commit** or **Roll back**.',
        'While a transaction is pending, the console tab shows it. Before you disconnect or delete that console, Tessera asks you to commit or roll back the transaction: it never discards it without asking. A failed transaction can only be rolled back.',
        'To choose the mode that new consoles start in, go to **Settings › Databases › Transaction mode for new consoles**.'
      ]
    },
    {
      ancla: 'produccion',
      titulo: 'Production connections',
      bloques: [
        'A [production](glosario/produccion) connection shows a red label in the tree, in its tabs, and in the toolbar of its consoles, and its new consoles start in **Tx: Manual**.',
        'Before every write (DML, DDL, PL/SQL, a COMMIT, or submitting grid changes), Tessera asks you to confirm it and shows the connection name. It warns you but never blocks you: if you prefer, you can switch the console to Auto.',
        {
          nota: 'Production protects you from mistakes; **Read-only for agents** protects the database from the agents. These are separate settings, and you can use both.'
        }
      ]
    },
    {
      ancla: 'agentes',
      titulo: 'Give the agents access to a database',
      bloques: [
        'An agent can see only the databases you [mount](glosario/montar) in its project. In the agent header, the **Give the agent access to databases** button lists the profile’s tested connections: turn on the ones you want, and the change takes effect immediately.',
        'The agent queries them with `tdb`, by connection name, without ever seeing the password, both in native mode and in Docker. For details, see [tdb, tssh, and tctx](herramientas-de-los-agentes/tdb).',
        'To mount a SQLite file from the project, right-click it in the explorer and choose **Mount as database**. Tessera adds it to the databases view, and the agent can query it.'
      ]
    }
  ]
}

export const txBasesDeDatos = crearTextos(es, en)
