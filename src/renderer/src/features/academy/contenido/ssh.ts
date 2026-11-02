// =============================================================================
// Tessera Academy · Conexiones SSH: crear una, las sesiones en la terminal, bastiones y túneles,
// SFTP y su uso por los agentes. Su forma es la de `modelo.ts` y el inglés repite la del
// español (`test-academy.mts`).
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Guarda en el perfil los servidores a los que entras por SSH: se abren en pestañas de la terminal, con su explorador de archivos, y los agentes pueden usarlos sin ver la contraseña.',
  secciones: [
    {
      ancla: 'conexion',
      titulo: 'Crear una conexión',
      bloques: [
        {
          pasos: [
            'En el panel de terminal, abre **Conexiones SSH** y pulsa **Nueva conexión SSH…**. Si ya tienes tus servidores en el `config` de OpenSSH, **Importar desde OpenSSH…** los trae.',
            'Rellena **Nombre**, **Host**, **Puerto** y **Usuario**, y elige la **Autenticación**.',
            'Pulsa **Guardar y probar**: comprueba que el servidor responde y que las credenciales entran.'
          ]
        },
        {
          lista: [
            '**Contraseña**: Tessera la guarda cifrada con {almacenSecretos} y la da sola al conectar. Si la dejas vacía, la pide la terminal.',
            '**Archivo de clave**: un `.pem` o una clave de OpenSSH. Tessera guarda una copia protegida y no toca el original; su frase, si la tiene, se guarda como una contraseña.',
            '**Claves del sistema**: usa {agenteClavesSsh} y las claves de tu carpeta `.ssh`, como haría `ssh` en tu propia terminal.'
          ]
        },
        'La primera vez que conectas, Tessera guarda la [huella](glosario/huella) del servidor. Si otro día no coincide, no entra: puede que lo hayan reinstalado o que alguien se haga pasar por él. Si sabes por qué cambió, usa **Olvidar la huella guardada…** en el menú de la conexión.',
        {
          nota: 'Si el servidor rechaza la contraseña guardada o pide un segundo factor, Tessera te lo pregunta en un diálogo. Esa respuesta no se guarda.'
        }
      ]
    },
    {
      ancla: 'terminales',
      titulo: 'Las sesiones en la terminal',
      bloques: [
        'Las conexiones son del perfil: se abren en pestañas de la terminal que se ven en todos sus proyectos, y también sin ningún proyecto abierto, con **Conectar por SSH…**. Con la terminal a pantalla completa, la lista queda fija a la izquierda.',
        'Si la sesión se corta, se reconecta desde la propia pestaña con **Reconectar**. Las pestañas SSH vuelven al abrir Tessera, pero no se conectan hasta que las miras.',
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
        'Para un equipo al que solo se llega pasando por otro, elige ese otro en **Saltar por**: se entra primero en el bastión, con sus propias credenciales, y desde él en el destino. Se pueden encadenar hasta cuatro saltos.',
        {
          lista: [
            '**Local (-L)**: un puerto de {tuEquipo} lleva a un destino visto desde el servidor, por ejemplo una base que solo ve él.',
            '**Remoto (-R)**: un puerto del servidor lleva a un destino visto desde {tuEquipo}.',
            '**SOCKS (-D)**: un proxy en {tuEquipo} cuyo tráfico sale desde el servidor.'
          ]
        },
        'Los túneles se abren con la terminal de la conexión y se cierran con ella, y los agentes no los usan. Para llegar a una base de datos, mejor el **Túnel SSH** de su [conexión](bases-de-datos/conexion): no depende de tener una terminal abierta.'
      ]
    },
    {
      ancla: 'sftp',
      titulo: 'Explorador SFTP',
      bloques: [
        '**Abrir explorador SFTP**, en el menú de una conexión, abre sus archivos remotos en una pestaña: navegar, crear carpetas, renombrar, borrar, y subir y bajar archivos y carpetas, también soltándolos encima. Antes de reemplazar algo, pregunta.',
        'Atraviesa el bastión igual que la terminal. Como no tiene terminal donde escribirla, si falta la contraseña te la pide en un diálogo.'
      ]
    },
    {
      ancla: 'agentes',
      titulo: 'Los agentes y tssh',
      bloques: [
        'Los agentes del perfil, nativos o en Docker, usan las conexiones con `tssh`: listarlas, ejecutar un comando y copiar archivos, por el nombre de la conexión. Nunca ven la contraseña ni la clave. Lo cuenta [tdb, tssh y tctx](herramientas-de-los-agentes/tssh).',
        {
          lista: [
            'Solo ven las conexiones con **Disponible para los agentes** marcada, que lo está de serie. Desmárcala en las que no quieras que toquen.',
            'Solo entran en servidores cuya huella ya aceptaste tú: si nunca te has conectado a uno, pulsa **Probar** una vez.',
            'Saltan por el bastión de la conexión, pero nunca abren sus túneles.'
          ]
        }
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Save the servers you reach over SSH in the profile. They open in terminal tabs, with their own file explorer, and the agents can use them without seeing the password.',
  secciones: [
    {
      ancla: 'conexion',
      titulo: 'Create a connection',
      bloques: [
        {
          pasos: [
            'In the terminal panel, open **SSH connections** and click **New SSH connection…**. If your servers are already in your OpenSSH `config` file, **Import from OpenSSH…** imports them.',
            'Fill in **Name**, **Host**, **Port**, and **User**, and choose the **Authentication** method.',
            'Click **Save and test**. Tessera checks that the server responds and that the credentials are accepted.'
          ]
        },
        {
          lista: [
            '**Password**: Tessera encrypts and saves it with {almacenSecretos}, and enters it for you when you connect. If you leave it empty, the terminal asks for it.',
            '**Key file**: a `.pem` file or an OpenSSH key. Tessera keeps a protected copy and does not change the original; if the key has a passphrase, Tessera saves it like a password.',
            '**System keys**: uses {agenteClavesSsh} and the keys in your `.ssh` folder, just as `ssh` does in your own terminal.'
          ]
        },
        'The first time you connect, Tessera saves the server’s [fingerprint](glosario/huella). If it does not match on a later connection, Tessera does not connect: the server may have been reinstalled, or someone may be impersonating it. If you know why the fingerprint changed, use **Forget saved fingerprint…** in the connection’s menu.',
        {
          nota: 'If the server rejects the saved password or asks for a second factor, Tessera asks you in a dialog. Your answer is not saved.'
        }
      ]
    },
    {
      ancla: 'terminales',
      titulo: 'Terminal sessions',
      bloques: [
        'Connections belong to the profile. Open them with **Connect over SSH…**: they open in terminal tabs that appear in all the profile’s projects, and even when no project is open. When the terminal is in full screen, the list stays pinned on the left.',
        'If the session drops, reconnect from the tab with **Reconnect**. SSH tabs are restored when you open Tessera, but they do not connect until you switch to them.',
        '[Hibernating the profile](hibernar/perfil) does not close SSH sessions; quitting Tessera does.',
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
        'If you can reach a machine only through another one, choose that other machine in **Jump host**: you sign in to the bastion first, with its own credentials, and then to the destination. You can chain up to four jumps.',
        {
          lista: [
            '**Local (-L)**: a port on {tuEquipo} forwards to a destination as seen from the server, for example a database that only the server can reach.',
            '**Remote (-R)**: a port on the server forwards to a destination as seen from {tuEquipo}.',
            '**SOCKS (-D)**: a proxy on {tuEquipo} whose traffic exits from the server.'
          ]
        },
        'Tunnels open and close with the connection’s terminal, and agents do not use them. To reach a database, use the **SSH tunnel** setting of its [connection](bases-de-datos/conexion) instead, which does not require an open terminal.'
      ]
    },
    {
      ancla: 'sftp',
      titulo: 'SFTP explorer',
      bloques: [
        '**Open SFTP explorer**, in a connection’s menu, opens its remote files in a tab. You can browse, create folders, rename, delete, and upload and download files and folders, including by dragging them onto the tab. Tessera asks before it replaces anything.',
        'The SFTP explorer goes through the bastion, just like the terminal. Because it has no terminal to type the password in, it asks for a missing password in a dialog.'
      ]
    },
    {
      ancla: 'agentes',
      titulo: 'Agents and tssh',
      bloques: [
        'The profile’s agents, native or in Docker, use the connections through `tssh`: they list them, run commands, and copy files, by connection name. They never see the password or the key. For details, see [tdb, tssh, and tctx](herramientas-de-los-agentes/tssh).',
        {
          lista: [
            'Agents see only connections with **Available to agents** selected, which is the default. Clear it on any connection you do not want them to use.',
            'Agents connect only to servers whose fingerprint you have already accepted: if you have never connected to a server, click **Test** once.',
            'Agents go through the connection’s bastion, but they never open its tunnels.'
          ]
        }
      ]
    }
  ]
}

export const txSsh = crearTextos(es, en)
