// =============================================================================
// Tessera Academy · Actualizaciones: la de Tessera, en cada sistema, y la de los agentes.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Tessera se actualiza automáticamente: descarga la versión nueva en segundo plano y la aplica al cerrarse. Claude Code y Codex se actualizan por separado, con un botón.',
  secciones: [
    {
      ancla: 'tessera',
      titulo: 'Cómo se actualiza Tessera',
      bloques: [
        'Tessera comprueba si hay una versión nueva a los pocos segundos de iniciarse y, después, cada 5 minutos si su ventana tiene el foco y cada 30 minutos si está en segundo plano. Si hay una versión nueva, la descarga en segundo plano sin preguntar, y se puede seguir trabajando.',
        'Cuando la versión nueva está preparada, el botón de actualización de la barra de título lo indica. Hay dos opciones:',
        {
          lista: [
            '**Actualizar ahora**: cierra Tessera, instala la versión nueva y vuelve a abrir Tessera.',
            'No hacer nada: con **Aplicar al cerrar Tessera** activado, que es lo predeterminado, la versión nueva se instala la próxima vez que se cierre Tessera. En este caso, Tessera no se vuelve a abrir sola.'
          ]
        },
        {
          nota: 'Una actualización no modifica sus datos: los perfiles, los proyectos, las conexiones, las conversaciones y la configuración se conservan.'
        }
      ]
    },
    {
      ancla: 'configuracion',
      titulo: 'En Configuración',
      bloques: [
        '**Configuración › Actualizaciones** muestra la versión actual y el estado de la siguiente. **Buscar actualizaciones** comprueba en ese momento si hay una versión nueva y **Reiniciar e instalar** aplica una versión ya preparada.',
        '**Aplicar al cerrar Tessera** decide si la versión preparada se instala automáticamente al cerrar. Si se desactiva, la versión espera hasta que se pulse el botón.',
        'Si una versión no llega a instalarse, Tessera lo indica y sigue en la versión anterior, con sus datos intactos. Tessera vuelve a intentarlo la próxima vez que se cierre. Después de dos intentos deja de reintentar, y el problema se resuelve cuando se publica una versión superior.'
      ]
    },
    {
      ancla: 'plataformas',
      titulo: 'En cada sistema',
      bloques: [
        {
          p: 'El instalador es por usuario. Por ello, actualizar no pide permisos de administrador ni vuelve a mostrar el aviso de SmartScreen de la primera ejecución.',
          soloEn: ['windows']
        },
        {
          p: 'Durante la instalación, también cuando se aplica al cerrar, una ventana muestra cada paso. Al terminar, **Abrir Tessera** abre la aplicación. Si algo falla, esa misma ventana ofrece tres opciones: **Reintentar**, **Volver a la versión anterior** (restaura la versión que había y la abre) o **Abrir el instalador**, para realizar la instalación paso a paso.',
          soloEn: ['windows']
        },
        {
          p: 'Tessera sustituye la aplicación en su carpeta. Cuando lo hace con la aplicación cerrada, una notificación avisa al empezar y otra al terminar, con el resultado. Si la aplicación está en una carpeta sin permiso de escritura, no puede instalarse automáticamente y ofrece descargar la versión nueva para sustituirla manualmente. Después de cada actualización, el Llavero pregunta una vez si Tessera puede usar sus contraseñas: pulse **Permitir siempre**.',
          soloEn: ['mac']
        },
        {
          p: 'Tessera se actualiza automáticamente cuando se ejecuta como AppImage: sustituye ese archivo por el nuevo antes de cerrarse y, si no puede, lo indica en su ventana. Una copia que no se ejecuta como AppImage no puede instalarse automáticamente y ofrece descargar la versión nueva.',
          soloEn: ['linux']
        }
      ]
    },
    {
      ancla: 'agentes-nativos',
      titulo: 'Claude Code y Codex en su equipo',
      bloques: [
        'Los agentes [nativos](glosario/nativo) usan el Claude Code y el Codex instalados en {tuEquipo}. El botón **Actualizar los agentes de {tuEquipo}**, en la barra de título, comprueba sus versiones y se marca cuando hay una nueva. Para actualizar:',
        {
          pasos: [
            'Haga clic en el botón. Se abre un panel con las versiones y con las sesiones que se reiniciarán.',
            'Si el panel muestra un motivo de espera, como «Espera: 1 agente trabajando», espere a que el agente termine o responda a su pregunta. Mientras una sesión que debe reiniciarse esté trabajando o espere su respuesta, la acción no está disponible.',
            'Pulse el botón de acción, cuyo texto dice lo que hará, por ejemplo «Actualizar Claude Code y reiniciar 2 sesiones». Tessera instala la versión nueva y reinicia solo las sesiones que usan una versión anterior, cada una en su conversación.'
          ]
        },
        'Antes de actuar, el panel advierte de las sesiones que pueden tener texto sin enviar o un trabajo terminado sin revisar. Si una sesión empieza a trabajar, pide su respuesta o recibe texto nuevo durante el proceso, Tessera no la reinicia e indica cuáles quedaron sin reiniciar y por qué.',
        'La misma información está en **Configuración › Actualizaciones**, en el grupo **Agentes**. Si un agente se instaló de una forma que Tessera no puede actualizar, el panel lo indica y, cuando la conoce, muestra la orden para actualizarlo manualmente.'
      ]
    },
    {
      ancla: 'agentes-docker',
      titulo: 'Los agentes en Docker',
      bloques: [
        'Los agentes en Docker usan el Claude Code y el Codex incluidos en la imagen de su contenedor. Para actualizarlos:',
        {
          pasos: [
            'En la cabecera de un agente en Docker, fuera del [mosaico](glosario/mosaico), pulse **Actualizar agentes**. Se abre un diálogo con el mismo título.',
            'Pulse **Actualizar**. Tessera reconstruye la imagen con las últimas versiones (tarda unos minutos) y reinicia los contenedores. Al terminar, el diálogo muestra las versiones instaladas.'
          ]
        },
        'Los agentes abiertos se reinician automáticamente con la versión nueva. Lo que un agente actualice manualmente dentro de su contenedor se pierde al detenerse el contenedor; una actualización de la imagen, en cambio, se conserva. Lo explica [Contenedores de Docker](contenedores-docker/imagen).',
        {
          nota: 'No cierre Tessera mientras se reconstruye la imagen.'
        }
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Tessera updates automatically: it downloads the new version in the background and installs it when it closes. Claude Code and Codex are updated separately, with a button.',
  secciones: [
    {
      ancla: 'tessera',
      titulo: 'How Tessera updates',
      bloques: [
        'Tessera checks for a new version a few seconds after it starts, and then every 5 minutes while its window has focus and every 30 minutes while it is in the background. If a new version is available, Tessera downloads it in the background without asking, so you can keep working.',
        'When the new version is ready, the update button in the title bar shows it. You have two options:',
        {
          lista: [
            '**Update now**: closes Tessera, installs the new version, and opens Tessera again.',
            'Do nothing: with **Apply when Tessera closes** turned on, which is the default, the new version installs the next time Tessera closes. In this case, Tessera does not reopen on its own.'
          ]
        },
        {
          nota: 'An update does not change your data: profiles, projects, connections, conversations, and settings are kept.'
        }
      ]
    },
    {
      ancla: 'configuracion',
      titulo: 'In Settings',
      bloques: [
        '**Settings › Updates** shows the current version and the status of the next one. **Check for updates** checks for a new version immediately, and **Restart and install** applies a version that is already prepared.',
        '**Apply when Tessera closes** controls whether a prepared version installs automatically on close. If you turn it off, the version waits until you click the button.',
        'If a version fails to install, Tessera tells you and stays on the previous version, with your data intact. Tessera tries again the next time it closes. After two attempts it stops retrying, and the problem is resolved when a higher version is published.'
      ]
    },
    {
      ancla: 'plataformas',
      titulo: 'On each operating system',
      bloques: [
        {
          p: 'The installer is per user, so updating does not ask for administrator permissions or show the SmartScreen warning from the first launch again.',
          soloEn: ['windows']
        },
        {
          p: 'During installation, also when the update is applied on close, a window shows each step. When it finishes, **Open Tessera** opens the app. If something fails, the same window offers three options: **Try again**, **Go back to the previous version** (restores the version you had and opens it), or **Open the installer**, to do the installation step by step.',
          soloEn: ['windows']
        },
        {
          p: 'Tessera replaces the app in its folder. When it does this with the app closed, one notification tells you when it starts and another when it finishes, with the result. If the app is in a folder without write permission, it cannot install the update automatically and offers the new version as a download, so that you can replace it manually. After each update, Keychain asks once whether Tessera can use its passwords: click **Always Allow**.',
          soloEn: ['mac']
        },
        {
          p: 'Tessera updates automatically when it runs as an AppImage: it replaces that file with the new one before closing and, if it cannot, tells you in its window. A copy that does not run as an AppImage cannot install updates automatically and offers the new version as a download.',
          soloEn: ['linux']
        }
      ]
    },
    {
      ancla: 'agentes-nativos',
      titulo: 'Claude Code and Codex on your computer',
      bloques: [
        '[Native](glosario/nativo) agents use the Claude Code and Codex installed on {tuEquipo}. The **Update agents on {tuEquipo}** button, in the title bar, checks their versions and shows a badge when a new version is available. To update:',
        {
          pasos: [
            'Click the button. A panel opens with the versions and the sessions that will restart.',
            'If the panel shows a reason to wait, such as “Wait: 1 agent working”, wait until the agent finishes or answer its question. While a session that must restart is working or waiting for your reply, the action is not available.',
            'Click the action button, whose text says what it will do, for example “Update Claude Code and restart 2 sessions”. Tessera installs the new version and restarts only the sessions running an older version, each in its own conversation.'
          ]
        },
        'Before acting, the panel warns you about sessions that may have unsent text or finished work you have not reviewed. If a session starts working, asks for your reply, or receives new text during the process, Tessera does not restart it and tells you which sessions were not restarted and why.',
        'The same information is in **Settings › Updates**, in the **Agents** group. If an agent was installed in a way that Tessera cannot update, the panel says so and, when Tessera knows the command, shows it so that you can update the agent manually.'
      ]
    },
    {
      ancla: 'agentes-docker',
      titulo: 'Agents in Docker',
      bloques: [
        'Agents in Docker use the Claude Code and Codex included in their container image. To update them:',
        {
          pasos: [
            'In the header of an agent in Docker, outside the [mosaic](glosario/mosaico), click **Update agents**. A dialog with the same title opens.',
            'Click **Update**. Tessera rebuilds the image with the latest versions (this takes a few minutes) and restarts the containers. When it finishes, the dialog shows the installed versions.'
          ]
        },
        'Open agents restart automatically on the new version. Anything an agent updates manually inside its container is lost when the container stops; an update of the image, by contrast, is kept. For details, see [Docker containers](contenedores-docker/imagen).',
        {
          nota: 'Do not close Tessera while the image is being rebuilt.'
        }
      ]
    }
  ]
}

export const txActualizaciones = crearTextos(es, en)
