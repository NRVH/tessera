// =============================================================================
// Tessera Academy · Conexiones SSH: crear una, las sesiones en la terminal, bastiones y túneles,
// SFTP y su uso por los agentes. Su forma es la de `modelo.ts` y el inglés repite la del
// español (`test-academy.mts`).
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Permite guardar en el perfil los servidores a los que se conecta por SSH. Se abren en pestañas de la terminal, con su explorador de archivos, y los agentes pueden usarlos sin ver la contraseña.',
  secciones: [
    {
      ancla: 'conexion',
      titulo: 'Crear una conexión',
      bloques: [
        {
          pasos: [
            'Abra el panel con el icono de la terminal del riel. Al pasar el puntero por el panel o al recibir el foco, aparece el botón dividido + │ ▾ junto a sus pestañas; haga clic en la flecha ▾ (**Conexiones SSH: conectar, buscar o crear**) y, al pie de la lista, en **Nueva conexión SSH…**. Con la terminal a pantalla completa, la lista ya está a la izquierda. Sin proyecto abierto, use **Conectar por SSH…**. Se abre el formulario.',
            'Rellene **Nombre**, **Host**, **Puerto** y **Usuario**, y elija la **Autenticación**. Si sus servidores ya están en el archivo `config` de OpenSSH, **Importar desde OpenSSH…** rellena el formulario con ellos.',
            'Pulse **Guardar y probar**. Tessera guarda la conexión y comprueba que el servidor responde y que acepta las credenciales.'
          ]
        },
        'Los métodos de **Autenticación** son los siguientes:',
        {
          lista: [
            '**Contraseña**: Tessera la guarda cifrada con {almacenSecretos} y la proporciona al conectar. Si se deja vacía, la terminal la solicita.',
            '**Archivo de clave**: un archivo `.pem` o una clave de OpenSSH. Tessera guarda una copia protegida y no modifica el original. Si la clave tiene frase, se guarda igual que una contraseña.',
            '**Claves del sistema**: usa {agenteClavesSsh} y las claves de su carpeta `.ssh`, igual que `ssh` en su propia terminal.'
          ]
        },
        'La primera vez que se conecta a un servidor (al probar la conexión, al abrir una terminal o el explorador SFTP), Tessera enseña su [huella](glosario/huella), su identificador, antes de enviarle la contraseña o de identificarse con la clave. Compruébela por otra vía, por ejemplo con su administrador, y pulse **Confiar y conectar**: Tessera la guarda y conecta. Si cancela, no se guarda nada ni se conecta. Con un bastión sin huella, se confirma primero la suya. Si en otra conexión no coincide, Tessera no se conecta: el servidor pudo reinstalarse o alguien podría estar suplantándolo. Si conoce el motivo del cambio, use **Olvidar la huella guardada…** en el menú de la conexión (clic derecho en ella, o su botón **⋯**, que aparece al pasar el puntero).',
        {
          nota: 'Si el servidor rechaza la contraseña guardada o solicita un segundo factor, Tessera lo pregunta en un diálogo. Esa respuesta no se guarda. **Probar** no puede responder a estas preguntas; se responden al abrir la sesión.'
        }
      ]
    },
    {
      ancla: 'terminales',
      titulo: 'Las sesiones en la terminal',
      bloques: [
        'Las conexiones pertenecen al perfil. Se abren desde la lista **Conexiones SSH**, en pestañas de la terminal que se ven en todos los proyectos del perfil. Sin ningún proyecto abierto, se llega a la lista con **Conectar por SSH…**. Con la terminal a pantalla completa, la lista queda fija a la izquierda.',
        'Si la sesión se corta, se reconecta desde la propia pestaña con **Reconectar**. Al abrir Tessera se restauran las pestañas SSH, pero cada una no se conecta hasta que se selecciona.',
        '[Hibernar el perfil](hibernar/perfil) no cierra las sesiones SSH; cerrar Tessera, sí.',
        {
          captura: 'ssh-riel',
          alt: 'La terminal a pantalla completa con la lista de conexiones SSH agrupadas a la izquierda y una sesión abierta'
        }
      ]
    },
    {
      ancla: 'tuneles',
      titulo: 'Bastiones y túneles',
      bloques: [
        'Un bastión es un servidor intermedio por el que se pasa para llegar a un equipo que no es accesible directamente. Para usar uno, selecciónelo en **Conectar a través de**: primero se conecta al bastión, con sus propias credenciales, y desde él al destino. Se pueden encadenar hasta cuatro saltos.',
        'Un túnel lleva el tráfico de un puerto a través de la conexión SSH. Hay tres tipos:',
        {
          lista: [
            '**Local (-L)**: un puerto de {tuEquipo} se redirige a un destino tal como se ve desde el servidor, por ejemplo una base de datos a la que solo llega el servidor.',
            '**Remoto (-R)**: un puerto del servidor se redirige a un destino tal como se ve desde {tuEquipo}.',
            '**SOCKS (-D)**: un proxy en {tuEquipo} cuyo tráfico sale desde el servidor.'
          ]
        },
        'Los túneles se abren con la terminal de la conexión y se cierran con ella, y los agentes no los usan. Para llegar a una base de datos, es preferible el **Túnel SSH** de su [conexión](bases-de-datos/conexion), que no depende de tener una terminal abierta.'
      ]
    },
    {
      ancla: 'sftp',
      titulo: 'Explorador SFTP',
      bloques: [
        '**Abrir explorador SFTP**, en el menú de una conexión (clic derecho en ella, o su botón **⋯**, que aparece al pasar el puntero), abre sus archivos remotos en una pestaña. Allí se puede navegar, crear carpetas, renombrar, eliminar, y subir y descargar archivos y carpetas, también arrastrándolos. Antes de reemplazar algo, Tessera pide confirmación.',
        'El explorador atraviesa el bastión igual que la terminal. Como no tiene una terminal donde escribir la contraseña, si falta la solicita en un diálogo.'
      ]
    },
    {
      ancla: 'agentes',
      titulo: 'Los agentes y tssh',
      bloques: [
        'Los agentes del perfil, nativos o en Docker, usan las conexiones con `tssh`: pueden listarlas, ejecutar una orden y copiar archivos, indicando el nombre de la conexión. Nunca ven la contraseña ni la clave. Lo explica [tdb, tssh y tctx](herramientas-de-los-agentes/tssh).',
        {
          lista: [
            'Solo ven las conexiones con el interruptor **Disponible para los agentes** activado, que lo está de forma predeterminada. Desactívelo en las que no deban usar.',
            'Solo se conectan a servidores cuya huella ya aceptó usted: si nunca se ha conectado a uno, pulse **Probar** una vez.',
            'Pasan por el bastión de la conexión, pero nunca abren sus túneles.',
            'Para `git push` y otras conexiones SSH directas, los agentes en Docker usan solo las claves que usted active. Consulte [Las claves SSH de los agentes](contenedores-docker/claves-ssh).'
          ]
        }
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Lets you save in the profile the servers you connect to over SSH. They open in terminal tabs, with their own file explorer, and the agents can use them without seeing the password.',
  secciones: [
    {
      ancla: 'conexion',
      titulo: 'Create a connection',
      bloques: [
        {
          pasos: [
            'Open the panel with the terminal icon in the rail. On hover over the panel or keyboard focus, the split + │ ▾ button appears next to its tabs; click the ▾ arrow (**SSH connections: connect, search or create**) and then **New SSH connection…** at the bottom of the list. In full screen, the list is already on the left. With no project open, use **Connect over SSH…**. The form opens.',
            'Fill in **Name**, **Host**, **Port**, and **User**, and choose the **Authentication** method. If your servers are already in your OpenSSH `config` file, **Import from OpenSSH…** fills in the form with them.',
            'Click **Save and test**. Tessera saves the connection and checks that the server responds and accepts the credentials.'
          ]
        },
        'The **Authentication** methods are the following:',
        {
          lista: [
            '**Password**: Tessera saves it encrypted with {almacenSecretos} and enters it when you connect. If you leave it empty, the terminal asks for it.',
            '**Key file**: a `.pem` file or an OpenSSH key. Tessera keeps a protected copy and does not change the original. If the key has a passphrase, it is saved like a password.',
            '**System keys**: uses {agenteClavesSsh} and the keys in your `.ssh` folder, just like `ssh` in your own terminal.'
          ]
        },
        'The first time you connect to a server (when testing the connection, opening a terminal or the SFTP explorer), Tessera shows its [fingerprint](glosario/huella), its identifier, before sending the password or signing in with the key. Verify it another way, for example with its administrator, and click **Trust and connect**: Tessera saves it and connects. If you cancel, nothing is saved and it does not connect. With a jump host that has no fingerprint, its fingerprint is confirmed first. If it does not match on a later connection, Tessera does not connect: the server may have been reinstalled, or someone may be impersonating it. If you know why it changed, use **Forget saved fingerprint…** in the connection’s menu (right-click it, or use its **⋯** button, which appears on hover).',
        {
          nota: 'If the server rejects the saved password or asks for a second factor, Tessera asks you in a dialog. That answer is not saved. **Test** cannot answer these questions; you answer them when you open the session.'
        }
      ]
    },
    {
      ancla: 'terminales',
      titulo: 'Terminal sessions',
      bloques: [
        'Connections belong to the profile. You open them from the **SSH connections** list, in terminal tabs that appear in all the profile’s projects. With no project open, you reach the list with **Connect over SSH…**. When the terminal is in full screen, the list stays fixed on the left.',
        'If the session drops, reconnect from the tab with **Reconnect**. When Tessera opens, SSH tabs are restored, but each one does not connect until you select it.',
        '[Hibernating the profile](hibernar/perfil) does not close SSH sessions; closing Tessera does.',
        {
          captura: 'ssh-riel',
          alt: 'The terminal in full screen, with the grouped list of SSH connections on the left and an open session'
        }
      ]
    },
    {
      ancla: 'tuneles',
      titulo: 'Bastions and tunnels',
      bloques: [
        'A bastion is an intermediate server you pass through to reach a machine that is not directly accessible. To use one, select it in **Jump host**: you connect to the bastion first, with its own credentials, and from there to the destination. You can chain up to four jumps.',
        'A tunnel carries a port’s traffic through the SSH connection. There are three types:',
        {
          lista: [
            '**Local (-L)**: a port on {tuEquipo} forwards to a destination as seen from the server, for example a database that only the server can reach.',
            '**Remote (-R)**: a port on the server forwards to a destination as seen from {tuEquipo}.',
            '**SOCKS (-D)**: a proxy on {tuEquipo} whose traffic exits from the server.'
          ]
        },
        'Tunnels open and close with the connection’s terminal, and agents do not use them. To reach a database, the **SSH tunnel** of its [connection](bases-de-datos/conexion) is preferable, because it does not depend on an open terminal.'
      ]
    },
    {
      ancla: 'sftp',
      titulo: 'SFTP explorer',
      bloques: [
        '**Open SFTP explorer**, in a connection’s menu (right-click it, or use its **⋯** button, which appears on hover), opens its remote files in a tab. There you can browse, create folders, rename, delete, and upload and download files and folders, including by dragging them. Tessera asks for confirmation before it replaces anything.',
        'The explorer goes through the bastion, just like the terminal. Because it has no terminal to type the password in, it asks for a missing password in a dialog.'
      ]
    },
    {
      ancla: 'agentes',
      titulo: 'Agents and tssh',
      bloques: [
        'The profile’s agents, native or in Docker, use the connections through `tssh`: they can list them, run a command, and copy files, by giving the connection name. They never see the password or the key. For details, see [tdb, tssh, and tctx](herramientas-de-los-agentes/tssh).',
        {
          lista: [
            'Agents see only connections with the **Available to agents** switch turned on, which is the default. Turn it off on any connection they should not use.',
            'Agents connect only to servers whose fingerprint you have already accepted: if you have never connected to a server, click **Test** once.',
            'Agents go through the connection’s bastion, but they never open its tunnels.',
            'For `git push` and other direct SSH connections, agents in Docker use only the keys you enable. See [Agent SSH keys](contenedores-docker/claves-ssh).'
          ]
        }
      ]
    }
  ]
}

export const txSsh = crearTextos(es, en)
