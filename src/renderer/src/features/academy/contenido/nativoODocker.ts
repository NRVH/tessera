// =============================================================================
// Tessera Academy · Nativo o en Docker: dónde corre cada agente, qué ve y cuándo conviene cada uno.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Cada agente se ejecuta en {tuEquipo} (modo nativo) o en un contenedor de Docker (modo Docker). El modo se elige por agente, con su botón de cuenta, y se puede cambiar en cualquier momento.',
  secciones: [
    {
      ancla: 'nativo',
      titulo: 'Nativo: en su equipo',
      bloques: [
        '[Nativo](glosario/nativo) es el modo predeterminado. El [agente](glosario/agente) se ejecuta en {tuEquipo}, con la misma cuenta de usuario, las mismas herramientas, la misma red y la misma VPN que usted utiliza. Por ello puede iniciar la aplicación del proyecto con sus scripts o conectarse a una base de datos a la que solo se llega por esa VPN. Este modo no necesita Docker.',
        {
          nota: 'Un agente nativo tiene el mismo acceso que usted: puede leer y modificar cualquier archivo que usted pueda leer y modificar.'
        }
      ]
    },
    {
      ancla: 'docker',
      titulo: 'En Docker: aislado',
      bloques: [
        'El agente se ejecuta en un [contenedor](glosario/contenedor), un entorno aislado que Tessera crea y administra. Hay un contenedor por cada [cuenta de Docker](cuentas/docker), y por eso este modo permite usar varias cuentas del mismo agente al mismo tiempo. Dentro del contenedor ocurre lo siguiente:',
        {
          lista: [
            'Los proyectos del [perfil](glosario/perfil) en los que trabaja esa cuenta aparecen en `/workspace/<carpeta>`, por ejemplo `/workspace/tienda-web`. Son los archivos de su disco: lo que el agente cambia allí, cambia en su disco.',
            'Del resto de su disco solo se incluyen las credenciales de esa cuenta y las claves públicas SSH que usted active para el perfil. Las claves privadas permanecen en su equipo y Tessera firma por el agente, para que git por SSH siga funcionando.',
            'El agente puede instalar herramientas con `sudo`, pero lo instalado se pierde cuando el contenedor se detiene.',
            'Para disponer siempre de herramientas de documentos, de las bibliotecas de un navegador de pruebas o de otros paquetes, inclúyalos en la imagen, que es la plantilla de la que nacen los contenedores. Se hace en **Configuración › Proyectos › Sandbox de Docker** y lo explica [La imagen y los paquetes adicionales](contenedores-docker/imagen).'
          ]
        }
      ]
    },
    {
      ancla: 'codex',
      titulo: 'Codex en Docker necesita acceso completo',
      bloques: [
        'Dentro de un contenedor, Codex no puede iniciar su propio sandbox, el entorno restringido en el que ejecuta sus órdenes. Con sus permisos habituales, esas órdenes fallan con un error de `bwrap` o piden salir del sandbox. Lo mismo ocurre con `tdb`, `tssh` y `tctx`. Para usar Codex en Docker, siga estos pasos:',
        {
          pasos: [
            'En la sesión de Codex, escriba `/permissions`.',
            'Seleccione **Full Access**. A partir de ese momento, las órdenes de Codex dejan de fallar por el sandbox.'
          ]
        },
        'Si en otra sesión vuelve a aparecer el error, repita los dos pasos.',
        {
          nota: 'Tessera no activa este modo automáticamente. Con **Full Access**, Codex no solicita aprobación: puede modificar todo lo que ve el contenedor, incluidos los proyectos, y usar la red.'
        }
      ]
    },
    {
      ancla: 'cambiar',
      titulo: 'Cambiar el modo de un agente',
      bloques: [
        {
          pasos: [
            'En la cabecera del agente, a la derecha, haga clic en el botón de la pantalla o del cubo. El agente de la terminal y los agentes propios nativos no tienen este botón; los propios en Docker no permiten cambiar a nativo.',
            'Seleccione la tarjeta de **En su equipo** para pasar a nativo, o una cuenta de **Cuentas de Docker** para pasar a Docker. El agente se vuelve a abrir en el modo elegido.'
          ]
        },
        'El selector se explica en [Elegir la cuenta](cuentas/elegir).',
        'Cada agente tiene su propio modo: en un mismo proyecto, Claude Code puede ejecutarse en {tuEquipo} y Codex en Docker. Las conversaciones pertenecen a la cuenta, así que el agente se abre con las de la cuenta elegida. Para llevar una conversación a la otra cuenta, consulte [Continuar en otro agente o cuenta](continuar-en-otro-agente).',
        'Un agente añadido manualmente se ejecuta donde se definió, y ese lugar no se puede cambiar después. Consulte [Añadir cualquier otro agente](agentes/manuales).'
      ]
    },
    {
      ancla: 'cual-elegir',
      titulo: '¿Qué modo conviene?',
      bloques: [
        {
          lista: [
            'Nativo, si basta con una cuenta por agente y desea que el agente use todo lo que hay instalado en su equipo.',
            'Docker, si desea trabajar con varias cuentas del mismo agente al mismo tiempo, o con una cuenta distinta en cada perfil.',
            'Docker, también, si prefiere que el agente vea de su disco únicamente sus proyectos.'
          ]
        },
        'Las bases de datos y los servidores SSH que usted ponga a disposición de los agentes funcionan en los dos modos, sin entregarles contraseñas. Consulte [tdb, tssh y tctx](herramientas-de-los-agentes).'
      ]
    },
    {
      ancla: 'que-no-cambia',
      titulo: 'Lo que no cambia con el modo',
      bloques: [
        'Las terminales del panel inferior son siempre nativas: su propia shell en la carpeta del proyecto. No ven lo que un agente instala en su contenedor, y las demás cuentas tampoco. Los archivos del proyecto sí son visibles para todos, porque están en su disco.',
        'De forma predeterminada, un contenedor tiene su propia red, de modo que un servidor iniciado por un agente en Docker no se puede abrir desde su navegador. Para abrirlo, cambie la red como se explica en [La red del contenedor](contenedores-docker/red).'
      ]
    },
    {
      ancla: 'requisitos',
      titulo: 'Qué necesita cada modo',
      bloques: [
        'Modo nativo: Claude Code o Codex instalados en {tuEquipo}, con la sesión iniciada. Modo Docker: Docker en ejecución. Los dos agentes ya vienen en la imagen, que Tessera construye la primera vez que hace falta.',
        { p: 'En Windows, el modo Docker requiere Docker Desktop con el motor de WSL 2.', soloEn: ['windows'] },
        { p: 'En macOS, el modo Docker requiere Docker Desktop.', soloEn: ['mac'] },
        { p: 'En Linux, el modo Docker usa el Docker del sistema. Docker sin root no es compatible: en ese caso, use el modo nativo.', soloEn: ['linux'] }
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Each agent runs either on {tuEquipo} (native mode) or in a Docker container (Docker mode). You choose the mode for each agent with its account button, and you can change it at any time.',
  secciones: [
    {
      ancla: 'nativo',
      titulo: 'Native: on your computer',
      bloques: [
        '[Native](glosario/nativo) is the default mode. The [agent](glosario/agente) runs on {tuEquipo} with your user account, your tools, and your network. It can therefore start your app with your scripts or connect to a database that is reachable only through your VPN. This mode does not need Docker.',
        {
          nota: 'A native agent has the same access you have: it can read and change any file that you can read and change.'
        }
      ]
    },
    {
      ancla: 'docker',
      titulo: 'In Docker: isolated',
      bloques: [
        'The agent runs in a [container](glosario/contenedor), an isolated environment that Tessera creates and manages. There is one container for each [Docker account](cuentas/docker), which is why this mode lets you use several accounts of the same agent at once. Inside the container:',
        {
          lista: [
            'The [profile](glosario/perfil)’s projects that this account works on appear at `/workspace/<folder>`, for example `/workspace/tienda-web`. These are the files on your disk: what the agent changes there changes on your disk.',
            'From the rest of your disk, only that account’s credentials and the public SSH keys you enable for the profile are available. Private keys stay on your computer, and Tessera signs for the agent so Git over SSH keeps working.',
            'The agent can install tools with `sudo`, but anything installed this way is lost when the container stops.',
            'To make document tools, the libraries for a test browser, or other packages always available, add them to the image, which is the template that containers are created from. You do this in **Settings › Projects › Docker sandbox**, as explained in [The image and extra packages](contenedores-docker/imagen).'
          ]
        }
      ]
    },
    {
      ancla: 'codex',
      titulo: 'Codex in Docker needs full access',
      bloques: [
        'Inside a container, Codex cannot start its own sandbox, the restricted environment where it runs its commands. With its usual permissions, those commands fail with a `bwrap` error or ask to leave the sandbox. The same happens with `tdb`, `tssh`, and `tctx`. To use Codex in Docker, follow these steps:',
        {
          pasos: [
            'In the Codex session, type `/permissions`.',
            'Select **Full Access**. From then on, Codex commands no longer fail because of the sandbox.'
          ]
        },
        'If the error appears again in another session, repeat both steps.',
        {
          nota: 'Tessera does not turn on this mode for you. With **Full Access**, Codex does not ask for approval: it can change everything the container can see, including the projects, and use the network.'
        }
      ]
    },
    {
      ancla: 'cambiar',
      titulo: 'Change an agent’s mode',
      bloques: [
        {
          pasos: [
            'On the right of the agent header, click the screen or cube button. The terminal agent and native custom agents do not have this button; custom agents in Docker cannot switch to native mode.',
            'Select the **On your computer** card to switch to native, or an account under **Docker accounts** to switch to Docker. The agent reopens in the chosen mode.'
          ]
        },
        'The selector is explained in [Choose the account](cuentas/elegir).',
        'Each agent has its own mode: in the same project, Claude Code can run on {tuEquipo} and Codex in Docker. Conversations belong to the account, so the agent opens with the conversations of the chosen account. To take a conversation to the other account, see [Continue in another agent or account](continuar-en-otro-agente).',
        'An agent you added manually runs where you defined it, and you cannot change this later. See [Add any other agent](agentes/manuales).'
      ]
    },
    {
      ancla: 'cual-elegir',
      titulo: 'Which mode should I choose?',
      bloques: [
        {
          lista: [
            'Native, if one account per agent is enough and you want the agent to use everything installed on your computer.',
            'Docker, if you want to work with several accounts of the same agent at once, or with a different account in each profile.',
            'Docker, also, if you prefer that the agent sees only its projects on your disk.'
          ]
        },
        'The databases and SSH servers that you make available to the agents work in both modes, without giving them any passwords. See [tdb, tssh, and tctx](herramientas-de-los-agentes).'
      ]
    },
    {
      ancla: 'que-no-cambia',
      titulo: 'What the mode does not change',
      bloques: [
        'The terminals in the bottom panel are always native: your own shell in the project folder. They cannot see what an agent installs in its container, and neither can the other accounts. Everyone can see the project files, because those files are on your disk.',
        'By default, a container has its own network, so you cannot open a server started by an agent in Docker from your browser. To open it, change the network as explained in [The container network](contenedores-docker/red).'
      ]
    },
    {
      ancla: 'requisitos',
      titulo: 'Requirements for each mode',
      bloques: [
        'Native mode: Claude Code or Codex installed on {tuEquipo}, and signed in. Docker mode: Docker running. Both agents are already included in the image, which Tessera builds the first time it is needed.',
        { p: 'On Windows, Docker mode requires Docker Desktop with the WSL 2 engine.', soloEn: ['windows'] },
        { p: 'On macOS, Docker mode requires Docker Desktop.', soloEn: ['mac'] },
        { p: 'On Linux, Docker mode uses the Docker engine installed on the system. Rootless Docker is not supported: in that case, use native mode.', soloEn: ['linux'] }
      ]
    }
  ]
}

export const txNativoODocker = crearTextos(es, en)
