// =============================================================================
// Tessera Academy · Nativo o en Docker: dónde corre cada agente, qué ve y cuándo conviene cada uno.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Cada agente corre en {tuEquipo} (nativo) o en un contenedor de Docker. Lo eliges por agente, con su botón de cuenta, y puedes cambiarlo cuando quieras.',
  secciones: [
    {
      ancla: 'nativo',
      titulo: 'Nativo: en tu equipo',
      bloques: [
        'Es el modo por defecto. El agente corre en {tuEquipo}, con tu cuenta, tus herramientas y tu red: puede arrancar tu aplicación con tus scripts o llegar a una base de datos que solo se alcanza por tu VPN. No necesita Docker.',
        {
          nota: 'Un agente nativo tiene el mismo acceso que tú: puede leer y cambiar cualquier archivo que tú puedas.'
        }
      ]
    },
    {
      ancla: 'docker',
      titulo: 'En Docker: aislado',
      bloques: [
        'El agente corre en un contenedor que Tessera crea y gestiona, uno por cada [cuenta de Docker](cuentas/docker). Es lo que te deja usar varias cuentas del mismo agente a la vez.',
        {
          lista: [
            'Los proyectos del perfil que lo usan se ven dentro en `/workspace/<carpeta>`, por ejemplo `/workspace/tienda-web`. Del resto de tu disco solo entran las credenciales del agente y, en solo lectura, tus llaves SSH, así que git por SSH sigue funcionando.',
            'El agente puede instalar herramientas con `sudo` dentro de su contenedor, pero lo que instale así se pierde cuando el contenedor se recrea.',
            'Para tener siempre a mano herramientas de documentos, un navegador de pruebas u otros paquetes, añádelos a la imagen en **Configuración › Proyectos › Sandbox de Docker**.'
          ]
        }
      ]
    },
    {
      ancla: 'cambiar',
      titulo: 'Cambiar un agente de modo',
      bloques: [
        'Se cambia desde el botón de cuenta de la cabecera del agente: la tarjeta de **En tu equipo** lo pasa a nativo y una cuenta de Docker lo pasa a Docker. Lo explica [Elegir la cuenta](cuentas/elegir).',
        'Cada agente va por su lado: en el mismo proyecto, Claude Code puede correr en {tuEquipo} y Codex en Docker. Al cambiar, el agente se abre con las conversaciones de la otra cuenta.',
        'Los agentes que añades a mano corren donde los definiste, y eso no se cambia después. Ver [Añadir cualquier otro agente](agentes/manuales).'
      ]
    },
    {
      ancla: 'cual-elegir',
      titulo: '¿Cuál elijo?',
      bloques: [
        {
          lista: [
            '**Nativo** si te basta con una cuenta por agente y quieres que el agente use todo lo que tienes instalado.',
            '**Docker** si quieres trabajar con varias cuentas del mismo agente a la vez, o una cuenta distinta en cada perfil.',
            '**Docker** también si prefieres que el agente no vea de tu disco más que sus proyectos.'
          ]
        },
        'Las bases de datos y los servidores SSH que des a los agentes les llegan en los dos modos, sin darles contraseñas: ver [tdb, tssh y tctx](herramientas-de-los-agentes).'
      ]
    },
    {
      ancla: 'que-no-cambia',
      titulo: 'Lo que no cambia con el modo',
      bloques: [
        'Las terminales de abajo son siempre nativas: tu propia shell en la carpeta del proyecto. Lo que un agente instala en su contenedor no lo ven ellas ni las demás cuentas; los archivos del proyecto sí, porque son tu disco.',
        'Los servidores que levanta un agente en Docker usan por defecto la red propia del perfil. Si quieres abrirlos desde tu navegador, cambia la red: lo explica [Contenedores de Docker](contenedores-docker).'
      ]
    },
    {
      ancla: 'requisitos',
      titulo: 'Qué necesita cada modo',
      bloques: [
        'Nativo: Claude Code o Codex instalados en {tuEquipo} y con la sesión iniciada. Docker: Docker en marcha; los dos agentes ya vienen en la imagen, que Tessera prepara la primera vez que hace falta.',
        { p: 'En Windows, Docker Desktop con el motor de WSL 2.', soloEn: ['windows'] },
        { p: 'En macOS, Docker Desktop.', soloEn: ['mac'] },
        { p: 'En Linux, el Docker del sistema. Docker sin root no está soportado: usa el agente nativo.', soloEn: ['linux'] }
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Each agent runs either on {tuEquipo} (native) or in a Docker container. You choose the mode for each agent with its account button, and you can change it at any time.',
  secciones: [
    {
      ancla: 'nativo',
      titulo: 'Native: on your computer',
      bloques: [
        'This is the default mode. The agent runs on {tuEquipo} with your account, your tools, and your network: it can start your app with your scripts or reach a database that is available only through your VPN. It does not need Docker.',
        {
          nota: 'A native agent has the same access you have: it can read and change any file that you can.'
        }
      ]
    },
    {
      ancla: 'docker',
      titulo: 'In Docker: isolated',
      bloques: [
        'The agent runs in a container that Tessera creates and manages, one for each [Docker account](cuentas/docker). This is what lets you use several accounts of the same agent at once.',
        {
          lista: [
            'The profile’s projects that use the container are visible inside it at `/workspace/<folder>`, for example `/workspace/tienda-web`. From the rest of your disk, only the agent’s credentials and, as read-only, your SSH keys are available, so Git over SSH keeps working.',
            'The agent can install tools with `sudo` inside its container, but anything it installs this way is lost when the container is re-created.',
            'To make document tools, a test browser, or other packages always available, add them to the image in **Settings › Projects › Docker sandbox**.'
          ]
        }
      ]
    },
    {
      ancla: 'cambiar',
      titulo: 'Change an agent’s mode',
      bloques: [
        'Use the account button in the agent header: the **On your computer** card makes the agent native, and a Docker account moves it to Docker. For details, see [Choose the account](cuentas/elegir).',
        'Each agent has its own mode: in the same project, Claude Code can run on {tuEquipo} and Codex in Docker. When you switch modes, the agent opens with the conversations of the other account.',
        'Agents you add yourself run where you defined them, and you cannot change this later. See [Add any other agent](agentes/manuales).'
      ]
    },
    {
      ancla: 'cual-elegir',
      titulo: 'Which mode should I choose?',
      bloques: [
        {
          lista: [
            '**Native** if one account per agent is enough and you want the agent to use everything you have installed.',
            '**Docker** if you want to work with several accounts of the same agent at once, or with a different account in each profile.',
            '**Docker** also if you prefer that the agent sees nothing on your disk except its projects.'
          ]
        },
        'In both modes, the agents can reach the databases and SSH servers you give them, without getting any passwords: see [tdb, tssh, and tctx](herramientas-de-los-agentes).'
      ]
    },
    {
      ancla: 'que-no-cambia',
      titulo: 'What the mode does not change',
      bloques: [
        'The bottom terminals are always native: your own shell in the project folder. They cannot see what an agent installs in its container, and neither can the other accounts. They can see the project files, because those files are on your disk.',
        'By default, servers that an agent starts in Docker use the profile’s own network. To open them from your browser, change the network. For details, see [Docker containers](contenedores-docker).'
      ]
    },
    {
      ancla: 'requisitos',
      titulo: 'Requirements for each mode',
      bloques: [
        'Native: Claude Code or Codex installed on {tuEquipo}, and signed in. Docker: Docker running. Both agents are already included in the image, which Tessera builds the first time it is needed.',
        { p: 'On Windows, Docker Desktop with the WSL 2 engine.', soloEn: ['windows'] },
        { p: 'On macOS, Docker Desktop.', soloEn: ['mac'] },
        { p: 'On Linux, the Docker engine installed on the system. Rootless Docker is not supported: use the native agent instead.', soloEn: ['linux'] }
      ]
    }
  ]
}

export const txNativoODocker = crearTextos(es, en)
