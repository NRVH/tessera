// =============================================================================
// Tessera Academy · Contenedores de Docker: qué entra, cuándo se paran, la red, el límite, la
// saturación y la imagen. Su forma es la de `modelo.ts` y el inglés repite la del español
// (`test-academy.mts`).
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Un agente en Docker trabaja dentro de un contenedor que Tessera crea y detiene automáticamente. Este artículo explica qué incluye el contenedor, cuándo se detiene, qué red usa y cómo evitar que Docker se quede sin memoria.',
  secciones: [
    {
      ancla: 'por-cuenta',
      titulo: 'Un contenedor por cuenta',
      bloques: [
        'Cuando un agente usa una cuenta de Docker ([Elegir la cuenta](cuentas/elegir)), Tessera inicia un [contenedor](glosario/contenedor) para esa cuenta dentro del perfil. Cada cuenta tiene el suyo, de modo que ninguna puede leer la sesión iniciada de otra. Cuándo conviene este modo se explica en [Nativo o en Docker](nativo-o-docker). El contenedor incluye únicamente lo siguiente:',
        {
          lista: [
            'Las carpetas de los proyectos en los que trabaja el agente, en `/workspace/<carpeta>`. Son sus archivos: lo que el agente cambia allí, cambia en su disco.',
            'La carpeta de la cuenta, con su sesión iniciada y su configuración. Esta carpeta se conserva cuando el contenedor se detiene.',
            'Las claves públicas SSH que usted active para el perfil, para que git por SSH funcione con sus propios alias de host. Las claves privadas no entran en el contenedor.'
          ]
        },
        'No se incluye nada más de su disco. El agente dispone de `sudo` dentro del contenedor para instalar lo que necesite, pero lo instalado se pierde cuando el contenedor se detiene. Para conservar una herramienta, inclúyala en la [imagen](contenedores-docker/imagen).'
      ]
    },
    {
      ancla: 'cuando-se-paran',
      titulo: 'Cuándo se detiene un contenedor',
      bloques: [
        {
          lista: [
            'A los 2 minutos de cerrarse su último agente. Si se vuelve a abrir uno antes de ese plazo, se aprovecha el mismo contenedor.',
            'Al [hibernar el perfil](hibernar/perfil): se detienen todos sus contenedores.',
            'Al cerrar Tessera: no queda ningún contenedor en ejecución.',
            'Cuando lo exige el [límite de contenedores](contenedores-docker/limite) o la [saturación de la memoria](contenedores-docker/saturacion) de Docker.'
          ]
        },
        'Detener un contenedor tiene el mismo efecto que hibernar: sus agentes retoman la conversación al volver a abrirse, pero se interrumpe lo que estuvieran haciendo en ese momento y se pierde lo que existía solo dentro del contenedor (procesos en segundo plano y paquetes instalados manualmente). Los archivos de los proyectos no se modifican.',
        {
          nota: 'Un agente en Docker no se hiberna por inactividad, porque lo que ocupa memoria es su contenedor. Consulte [Hibernar y reanudar](hibernar/docker).'
        }
      ]
    },
    {
      ancla: 'red',
      titulo: 'La red del contenedor',
      bloques: [
        'En el menú que se abre con clic derecho sobre el perfil (en el selector compacto, con el botón **⋯** del perfil), **Red del contenedor**, en el submenú **Agentes en Docker**, muestra la red actual y permite definir por dónde entran y salen las conexiones de sus contenedores:',
        {
          lista: [
            '**Propia** (recomendada): el contenedor tiene su propia red y sus propios puertos. Un servidor iniciado por el agente no se puede abrir desde su navegador.',
            '**La de su equipo**: el contenedor usa la red de {tuEquipo} y tiene acceso a las VPN y a los puertos del equipo. Un servidor que el agente inicie en el puerto 3000 se abre en el navegador de usted en ese mismo puerto. A cambio, comparte los puertos con los demás perfiles que usen esta opción y no puede escuchar en puertos inferiores al 1024.'
          ]
        },
        'Cambiar la red reinicia los contenedores del perfil y lo deja hibernado: se cierran sus agentes y terminales, y las conexiones SSH siguen abiertas. Si hay algo en ejecución, Tessera pide confirmación antes. Al reanudar el perfil, sus contenedores se crean con la red nueva.',
        {
          nota: 'En Docker Desktop, **La de su equipo** requiere activar «Enable host networking» en sus ajustes. El diálogo comprueba si funciona e indica qué falta; aun así, se puede aplicar.',
          soloEn: ['windows', 'mac']
        }
      ]
    },
    {
      ancla: 'claves-ssh',
      titulo: 'Las claves SSH de los agentes',
      bloques: [
        'Un agente en Docker no recibe sus claves SSH privadas. Cuando necesita conectarse, por ejemplo con `git push`, pide cada firma a Tessera, que la realiza en su equipo y solo con las claves que usted haya activado para ese perfil.',
        'Para elegirlas, abra el menú del perfil y, en el submenú **Agentes en Docker**, seleccione **Claves SSH…**:',
        {
          lista: [
            'La lista reúne las claves de su configuración SSH y de la carpeta SSH del perfil.',
            'Un servidor con entrada y clave propias en su configuración SSH usa solo esa clave. A cualquier otro servidor se le ofrecen todas las claves activadas, primero las de nombre estándar.',
            'Un perfil nuevo empieza sin ninguna clave activada. Un perfil que ya existía conserva todas sus claves hasta que usted guarde una selección.',
            'Si una clave tiene frase de contraseña, Tessera se la solicita en su equipo. El agente nunca la recibe.'
          ]
        },
        'Esta selección no limita a los agentes nativos: se ejecutan con su usuario del sistema y pueden leer las claves de su equipo. Para mantener separadas las claves de cada perfil, trabaje esos proyectos en Docker. Consulte [Nativo o Docker](nativo-o-docker).'
      ]
    },
    {
      ancla: 'limite',
      titulo: 'Límite de contenedores',
      bloques: [
        'Cada agente trabajando ocupa entre 0,3 y 1,5 GB. En **Configuración › Contenedores Docker › Límite de contenedores** se elige cuántos contenedores pueden ejecutarse al mismo tiempo. Según la memoria que tiene Docker en {tuEquipo}, un semáforo indica si el valor es **Holgado**, **Justo** o **Excesivo**. Si no se elige ningún valor, se aplica el recomendado.',
        'Al llegar al límite y abrir otro agente en Docker, Tessera detiene primero un contenedor sin agentes. Si no hay ninguno, detiene el que indique la opción **Qué contenedor detener primero**, del grupo **Al llegar al límite**:',
        {
          lista: [
            '**El último contenedor abierto** (recomendado, porque suele tener menos trabajo en curso).',
            '**El primer contenedor abierto**.',
            '**El contenedor con más tiempo sin actividad**.'
          ]
        },
        'Tessera nunca detiene el contenedor del agente visible en pantalla ni el de un agente añadido manualmente.',
        'Con **No detener contenedores con agentes trabajando**, activado de forma predeterminada, un agente que está trabajando no se interrumpe mientras haya otro contenedor que detener. Si no queda ninguno, el agente nuevo no se abre y Tessera explica el motivo.',
        {
          captura: 'docker-limite',
          alt: 'Configuración › Contenedores Docker, con el deslizador del límite, su semáforo y la memoria que tiene Docker'
        }
      ]
    },
    {
      ancla: 'saturacion',
      titulo: 'Si Docker se satura',
      bloques: [
        'Aunque no se abra nada nuevo, muchos agentes trabajando pueden agotar la memoria de Docker, y entonces puede fallar cualquier proceso. Para evitarlo, Tessera mide la memoria de todos los contenedores de Docker. Si supera el umbral durante un tiempo (de forma predeterminada, 90 % durante 30 segundos, valores que se cambian en **Configuración › Contenedores Docker › Si Docker se satura**), Tessera detiene un contenedor con la misma regla que el límite, y sus agentes quedan hibernados.',
        'Antes de detenerlo, avisa durante 30 segundos y permite elegir otro con **Detener otro**. Si la memoria baja, el aviso se retira. Tessera nunca detiene el agente visible en pantalla. Si todos los restantes están trabajando, detiene uno de ellos de todos modos: sin memoria, alguno fallaría igualmente y sin posibilidad de elegir cuál.',
        'Cada contenedor detenido, por el límite o por la saturación, se anuncia y queda registrado en **Configuración › Contenedores Docker › Últimos contenedores detenidos**.'
      ]
    },
    {
      ancla: 'imagen',
      titulo: 'La imagen y los paquetes adicionales',
      bloques: [
        'La imagen es la plantilla de la que nacen todos los contenedores. Tessera la construye la primera vez que hace falta (tarda unos minutos), con Claude Code y Codex ya instalados.',
        'En **Configuración › Proyectos › Sandbox de Docker** se pueden incluir en ella **Herramientas de documentos** (LibreOffice y poppler, para convertir y capturar PDF y documentos de oficina; aumentan la imagen en aproximadamente 1 GB), las bibliotecas del sistema del **Navegador de pruebas** (el navegador se instala dentro del proyecto) y **Otros paquetes** de Debian. Estos cambios se aplican al reconstruir la imagen, es decir, la próxima vez que se abra un agente o al usar **Actualizar todos sus agentes**.',
        {
          nota: 'Si un paquete adicional no existe o falla al instalarse, Tessera construye la imagen sin los paquetes adicionales, para que el agente pueda seguir abriéndose, y lo avisa.'
        },
        {
          nota: 'Tessera usa el Docker del sistema. Docker sin root no es compatible: en ese caso, use el agente nativo.',
          soloEn: ['linux']
        }
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'An agent in Docker works inside a container that Tessera creates and stops automatically. This article explains what the container includes, when it stops, which network it uses, and how to keep Docker from running out of memory.',
  secciones: [
    {
      ancla: 'por-cuenta',
      titulo: 'One container per account',
      bloques: [
        'When an agent uses an account in Docker ([Choose the account](cuentas/elegir)), Tessera starts a [container](glosario/contenedor) for that account in the profile. Each account has its own container, so no account can read another account’s sign-in session. To decide when this mode is worth using, see [Native or in Docker](nativo-o-docker). The container includes only the following:',
        {
          lista: [
            'The folders of the projects the agent works on, at `/workspace/<folder>`. These are your files: what the agent changes there changes on your disk.',
            'The account folder, with its sign-in session and settings. This folder is kept when the container stops.',
            'The public SSH keys you enable for the profile, so that Git over SSH works with your own host aliases. Private keys do not enter the container.'
          ]
        },
        'Nothing else from your disk is available. The agent has `sudo` inside the container to install what it needs, but anything installed this way is lost when the container stops. To keep a tool, add it to the [image](contenedores-docker/imagen).'
      ]
    },
    {
      ancla: 'cuando-se-paran',
      titulo: 'When a container stops',
      bloques: [
        {
          lista: [
            '2 minutes after its last agent closes. If an agent opens again before then, Tessera reuses the same container.',
            'When you [hibernate the profile](hibernar/perfil): all its containers stop.',
            'When you quit Tessera: no container is left running.',
            'When the [container limit](contenedores-docker/limite) or Docker [memory saturation](contenedores-docker/saturacion) requires it.'
          ]
        },
        'Stopping a container has the same effect as hibernating: its agents resume their conversations when they reopen, but any work in progress at that moment is interrupted, and anything that existed only inside the container is lost (background processes and packages installed manually). The project files are not changed.',
        {
          nota: 'An agent in Docker does not hibernate when it is idle, because the memory is used by its container. See [Hibernate and resume](hibernar/docker).'
        }
      ]
    },
    {
      ancla: 'red',
      titulo: 'The container network',
      bloques: [
        'In the menu that opens when you right-click the profile (in the compact selector, use the profile’s **⋯** button), **Container network**, in the **Agents in Docker** submenu, shows the current network and lets you define how connections reach and leave its containers:',
        {
          lista: [
            '**Own network** (recommended): the container has its own network and its own ports. You cannot open a server started by the agent from your browser.',
            '**Your computer’s network**: the container uses the network of {tuEquipo} and can reach its VPNs and ports. A server that the agent starts on port 3000 opens in your browser on that same port. The trade-off: it shares ports with the other profiles that use this option, and it cannot listen on ports below 1024.'
          ]
        },
        'Changing the network restarts the profile’s containers and leaves the profile hibernated: its agents and terminals close, and SSH connections stay open. If something is running, Tessera asks for confirmation first. When you resume the profile, its containers are created with the new network.',
        {
          nota: 'In Docker Desktop, **Your computer’s network** requires the “Enable host networking” setting. The dialog checks whether it works and tells you what is missing; you can still apply the change.',
          soloEn: ['windows', 'mac']
        }
      ]
    },
    {
      ancla: 'claves-ssh',
      titulo: 'Agent SSH keys',
      bloques: [
        'An agent in Docker does not receive your private SSH keys. When it needs to connect, for example with `git push`, it asks Tessera for each signature, and Tessera signs on your computer, only with the keys you have enabled for that profile.',
        'To choose them, open the profile menu and, in the **Agents in Docker** submenu, select **SSH keys…**:',
        {
          lista: [
            'The list brings together the keys from your SSH configuration and from the profile’s SSH folder.',
            'A server with its own entry and key in your SSH configuration uses only that key. Any other server is offered all the enabled keys, standard names first.',
            'A new profile starts with no keys enabled. A profile that already existed keeps all its keys until you save a selection.',
            'If a key has a passphrase, Tessera asks you for it on your computer. The agent never receives it.'
          ]
        },
        'This selection does not limit native agents: they run with your system user and can read the keys on your computer. To keep each profile’s keys separate, work on those projects in Docker. See [Native or Docker](nativo-o-docker).'
      ]
    },
    {
      ancla: 'limite',
      titulo: 'Container limit',
      bloques: [
        'Each working agent uses 0.3 to 1.5 GB. In **Settings › Docker containers › Container limit**, you choose how many containers can run at once. Based on the memory available to Docker on {tuEquipo}, a traffic light shows whether the value is **Comfortable**, **Tight**, or **Excessive**. If you do not choose a value, the recommended one applies.',
        'When the limit is reached and you open another agent in Docker, Tessera first stops a container with no agents. If there is none, it stops the one indicated by the **Which container to stop first** option in the **When the limit is reached** group:',
        {
          lista: [
            '**The last container you opened** (recommended, because it usually has less work in progress).',
            '**The first container you opened**.',
            '**The container idle the longest**.'
          ]
        },
        'Tessera never stops the container of the agent visible on screen or the container of an agent you added manually.',
        'With **Do not stop containers with working agents**, which is on by default, a working agent is not interrupted while there is another container to stop. If there is none left, the new agent does not open, and Tessera tells you why.',
        {
          captura: 'docker-limite',
          alt: 'Settings › Docker containers, with the limit slider, its traffic light, and the memory available to Docker'
        }
      ]
    },
    {
      ancla: 'saturacion',
      titulo: 'If Docker gets saturated',
      bloques: [
        'Even if nothing new opens, many working agents can use up Docker’s memory, and then any process can fail. To prevent this, Tessera measures the memory of all Docker containers. If usage stays above the threshold for a while (by default, 90% for 30 seconds; you can change these values in **Settings › Docker containers › If Docker gets saturated**), Tessera stops a container using the same rule as the limit, and its agents are hibernated.',
        'Before stopping it, Tessera warns you for 30 seconds and lets you choose a different one with **Stop another one**. If memory usage drops, the warning disappears. Tessera never stops the agent visible on screen. If all the remaining agents are working, Tessera stops one of them anyway: without memory, one would fail regardless, with no choice of which.',
        'Every stopped container, whether caused by the limit or by saturation, is announced and recorded in **Settings › Docker containers › Recently stopped containers**.'
      ]
    },
    {
      ancla: 'imagen',
      titulo: 'The image and extra packages',
      bloques: [
        'The image is the template that all containers are created from. Tessera builds it the first time it is needed (this takes a few minutes), with Claude Code and Codex already installed.',
        'In **Settings › Projects › Docker sandbox**, you can add to the image **Document tools** (LibreOffice and poppler, to convert and capture PDF and office documents; they add about 1 GB), the system libraries for the **Test browser** (the browser itself is installed inside the project), and **Other packages** from Debian. These changes apply when the image is rebuilt, that is, the next time an agent opens or when you use **Update all your agents**.',
        {
          nota: 'If an extra package does not exist or fails to install, Tessera builds the image without the extra packages, so that the agent can still open, and tells you.'
        },
        {
          nota: 'Tessera uses the Docker engine installed on the system. Rootless Docker is not supported: in that case, use the native agent.',
          soloEn: ['linux']
        }
      ]
    }
  ]
}

export const txContenedoresDocker = crearTextos(es, en)
