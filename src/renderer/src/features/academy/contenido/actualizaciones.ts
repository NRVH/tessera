// =============================================================================
// Tessera Academy · Actualizaciones: la de Tessera, en cada sistema, y la de los agentes.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Tessera se actualiza sola: baja la versión nueva en segundo plano y la aplica al cerrarla. Claude Code y Codex se ponen al día aparte, con un botón.',
  secciones: [
    {
      ancla: 'tessera',
      titulo: 'Cómo se actualiza Tessera',
      bloques: [
        'Tessera comprueba si hay una versión nueva poco después de arrancar y luego cada pocos minutos. Si la hay, la descarga en segundo plano sin preguntar: puedes seguir trabajando.',
        'Cuando está preparada, el botón de actualización de la barra de título lo indica. Tienes dos caminos:',
        {
          lista: [
            '**Actualizar ahora**: cierra Tessera e instala la versión nueva enseguida.',
            'No hacer nada: con **Aplicar al cerrar Tessera** activado, que lo está de serie, se instala la próxima vez que cierres la app, sin volver a abrirla.'
          ]
        },
        {
          nota: 'Una actualización nunca toca tus datos: perfiles, proyectos, conexiones, conversaciones y configuración siguen igual.'
        }
      ]
    },
    {
      ancla: 'configuracion',
      titulo: 'En Configuración',
      bloques: [
        '**Configuración › Actualizaciones** enseña tu versión y en qué punto está la siguiente: **Buscar actualizaciones** comprueba al momento y **Reiniciar e instalar** aplica una versión ya preparada.',
        '**Aplicar al cerrar Tessera** decide si la versión preparada se instala sola al cerrar. Si lo apagas, espera a que pulses el botón.',
        'Si una versión no llega a instalarse, Tessera te lo dice y sigues en la anterior, con tus datos intactos. Lo intenta otra vez la próxima vez que la cierres.'
      ]
    },
    {
      ancla: 'plataformas',
      titulo: 'En cada sistema',
      bloques: [
        {
          p: 'El instalador es por usuario, así que actualizar no pide permisos de administrador ni vuelve a enseñar el aviso de SmartScreen del primer arranque.',
          soloEn: ['windows']
        },
        {
          p: 'Mientras se instala, también cuando se aplica al cerrar, una ventana enseña cada paso. Al terminar, **Abrir Tessera** la abre. Si algo falla, esa misma ventana te deja elegir: **Reintentar**, **Volver a la versión anterior** (repone la que tenías y la abre) o **Abrir el instalador** para hacerlo paso a paso.',
          soloEn: ['windows']
        },
        {
          p: 'Tessera sustituye la app en su carpeta. Mientras lo hace con la app cerrada, una notificación te avisa al empezar y otra al terminar, con el resultado. Si está en una carpeta donde no puede escribir, no puede instalarse sola y te ofrece descargar la versión nueva para que la sustituyas tú. Tras cada actualización, el Llavero pregunta una vez si Tessera puede usar sus contraseñas: pulsa **Permitir siempre**.',
          soloEn: ['mac']
        },
        {
          p: 'Se actualiza sola cuando la abres como AppImage: Tessera sustituye ese archivo por el nuevo antes de cerrarse, y si no puede, te lo dice en su ventana. Una copia que no corre como AppImage no puede instalarse sola y te ofrece descargar la versión nueva.',
          soloEn: ['linux']
        }
      ]
    },
    {
      ancla: 'agentes-nativos',
      titulo: 'Claude Code y Codex en tu equipo',
      bloques: [
        'Los agentes [nativos](glosario/nativo) usan el Claude Code y el Codex instalados en {tuEquipo}. El botón **Actualizar los agentes de {tuEquipo}**, en la barra de título, comprueba sus versiones y se marca cuando hay una nueva.',
        'Con **Actualizar y reiniciar**, Tessera instala la versión nueva y reinicia solo las sesiones que corren una anterior, cada una en su conversación. Se salta las que están trabajando, esperan tu respuesta o tienen texto sin enviar, y te dice cuáles quedaron sin reiniciar.',
        'También lo tienes en **Configuración › Actualizaciones**, en el grupo Agentes. Si uno se instaló de una forma que Tessera no sabe actualizar, te da la orden para hacerlo a mano.'
      ]
    },
    {
      ancla: 'agentes-docker',
      titulo: 'Los agentes en Docker',
      bloques: [
        'Los agentes en Docker usan el Claude Code y el Codex de la imagen de su contenedor. Para ponerlos al día, pulsa **Actualizar agentes** en el panel de un agente en Docker: reconstruye la imagen con las últimas versiones (unos minutos) y reinicia los contenedores.',
        'Los agentes que tengas abiertos se reinician solos sobre la versión nueva. Lo que un agente actualice a mano dentro de su contenedor se pierde al pararlo; esto, en cambio, dura. Lo explica [Contenedores de Docker](contenedores-docker/imagen).',
        {
          nota: 'No cierres Tessera mientras se reconstruye la imagen.'
        }
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Tessera updates itself: it downloads the new version in the background and installs it when you quit. Claude Code and Codex are updated separately, with a button.',
  secciones: [
    {
      ancla: 'tessera',
      titulo: 'How Tessera updates',
      bloques: [
        'Tessera checks for a new version shortly after it starts, and then every few minutes. If a new version is available, Tessera downloads it in the background without asking, so you can keep working.',
        'When the update is ready, the update button in the title bar shows it. You have two options:',
        {
          lista: [
            '**Update now**: quits Tessera and installs the new version right away.',
            'Do nothing: if **Apply when Tessera closes** is turned on (the default), the update installs the next time you quit, without reopening the app.'
          ]
        },
        {
          nota: 'An update never changes your data: profiles, projects, connections, conversations, and settings stay the same.'
        }
      ]
    },
    {
      ancla: 'configuracion',
      titulo: 'In Settings',
      bloques: [
        '**Settings › Updates** shows your version and the status of the next one: **Check for updates** checks immediately, and **Restart and install** installs a version that is already downloaded.',
        '**Apply when Tessera closes** controls whether a downloaded version installs automatically when you quit. If you turn it off, Tessera waits for you to click the button.',
        'If a version fails to install, Tessera tells you, and you stay on the previous version with your data intact. Tessera tries again the next time you quit.'
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
          p: 'While it installs, also when the update is applied on quit, a window shows each step. When it finishes, **Open Tessera** opens the app. If something fails, the same window lets you choose: **Try again**, **Go back to the previous version** (restores the version you had and opens it), or **Open the installer** to do it step by step.',
          soloEn: ['windows']
        },
        {
          p: 'Tessera replaces the app in its folder. While it does this with the app closed, one notification tells you when it starts and another when it finishes, with the result. If the app is in a folder that Tessera cannot write to, the update cannot install itself, and Tessera offers the new version as a download so you can replace the app yourself. After each update, Keychain asks once whether Tessera can use its passwords: click **Always Allow**.',
          soloEn: ['mac']
        },
        {
          p: 'Tessera updates itself when you run it as an AppImage: it replaces that file with the new one before quitting, and if it cannot, it tells you in its window. A copy that does not run as an AppImage cannot install updates itself, so Tessera offers the new version as a download.',
          soloEn: ['linux']
        }
      ]
    },
    {
      ancla: 'agentes-nativos',
      titulo: 'Claude Code and Codex on your computer',
      bloques: [
        '[Native](glosario/nativo) agents use the Claude Code and Codex installed on {tuEquipo}. The **Update agents on {tuEquipo}** button, in the title bar, checks their versions and shows a badge when a new version is available.',
        'With **Update and restart**, Tessera installs the new version and restarts only the sessions that run an older version, each in its own conversation. It skips agents that are working, are waiting for your answer, or have unsent text, and tells you which ones were not restarted.',
        'The same option is in **Settings › Updates**, in the Agents group. If an agent was installed in a way that Tessera cannot update, Tessera shows you the command to update it manually.'
      ]
    },
    {
      ancla: 'agentes-docker',
      titulo: 'Agents in Docker',
      bloques: [
        'Agents in Docker use the Claude Code and Codex included in their container image. To update them, click **Update agents** in the panel of an agent in Docker: Tessera rebuilds the image with the latest versions (this takes a few minutes) and restarts the containers.',
        'Open agents restart automatically on the new version. Anything an agent updates manually inside its container is lost when the container stops; an update through the image, by contrast, persists. For details, see [Docker containers](contenedores-docker/imagen).',
        {
          nota: 'Do not quit Tessera while the image is being rebuilt.'
        }
      ]
    }
  ]
}

export const txActualizaciones = crearTextos(es, en)
