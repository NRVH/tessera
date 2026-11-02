// =============================================================================
// Tessera Academy · Contenedores de Docker: qué entra, cuándo se paran, la red, el límite, la
// saturación y la imagen. Su forma es la de `modelo.ts` y el inglés repite la del español
// (`test-academy.mts`).
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Un agente en Docker trabaja dentro de un contenedor que Tessera crea y para por ti. Aquí está qué entra en él, cuándo se para, qué red usa y cómo evitar que Docker se quede sin memoria.',
  secciones: [
    {
      ancla: 'por-cuenta',
      titulo: 'Un contenedor por cuenta',
      bloques: [
        'Cuando un agente usa una cuenta de **Cuentas aisladas (Docker)**, en el botón de cuenta de su cabecera, Tessera arranca un [contenedor](glosario/contenedor) para esa cuenta del perfil. Cada cuenta tiene el suyo, así que ninguna puede leer la sesión iniciada de otra. Cuándo conviene lo explica [Nativo o en Docker](nativo-o-docker).',
        {
          lista: [
            'Las carpetas de los proyectos donde trabaja, en `/workspace/<carpeta>`. Son tus archivos: lo que el agente cambia ahí, cambia en tu disco.',
            'La carpeta de la cuenta, con su sesión iniciada y su configuración. Se conserva cuando el contenedor se para.',
            'Tus claves SSH, en solo lectura, para que git por SSH funcione con tus propios alias de host.'
          ]
        },
        'Nada más de tu disco entra. El agente tiene `sudo` dentro del contenedor para instalar lo que necesite, pero eso se pierde cuando el contenedor se para: lo que quieras conservar, hornéalo en la [imagen](contenedores-docker/imagen).'
      ]
    },
    {
      ancla: 'cuando-se-paran',
      titulo: 'Cuándo se para un contenedor',
      bloques: [
        {
          lista: [
            'A los 2 minutos de cerrarse su último agente. Si vuelves a abrir uno antes, se aprovecha el mismo.',
            'Al [hibernar el perfil](hibernar/perfil): se paran todos los suyos.',
            'Al cerrar Tessera: no queda ningún contenedor corriendo.',
            'Cuando lo pide el [límite](contenedores-docker/limite) o la [saturación](contenedores-docker/saturacion) de Docker.'
          ]
        },
        'Parar un contenedor es como hibernar: sus agentes retoman la conversación al volver, pero lo que estaban haciendo en ese momento se interrumpe, y se pierde lo que vivía solo dentro (procesos en segundo plano, paquetes instalados a mano). Los archivos de los proyectos no se tocan.',
        {
          nota: 'Un agente en Docker no se hiberna por inactividad: lo que ocupa memoria es su contenedor. Ver [Hibernar y reanudar](hibernar/docker).'
        }
      ]
    },
    {
      ancla: 'red',
      titulo: 'La red del contenedor',
      bloques: [
        'Con clic derecho sobre el perfil, **Red del contenedor Docker** decide por dónde entran y salen las conexiones de sus contenedores:',
        {
          lista: [
            '**Propia** (recomendada): el contenedor tiene su red y sus puertos. Un servidor que levante el agente no se ve desde tu navegador.',
            '**La de tu equipo**: el contenedor usa la red de {tuEquipo} y ve sus VPN y sus puertos; lo que el agente levante en el puerto 3000 se abre en tu navegador en ese mismo puerto. A cambio, comparte los puertos con los demás perfiles que usen este modo y no puede escuchar por debajo del 1024.'
          ]
        },
        'Cambiar la red reinicia los contenedores del perfil y lo deja hibernado: se cierran sus agentes y terminales, y las conexiones SSH siguen abiertas. Si algo está trabajando, Tessera pregunta antes. Al reanudar el perfil, sus contenedores nacen con la red nueva.',
        {
          nota: 'En Docker Desktop, la red de tu equipo necesita activar «Enable host networking» en sus ajustes. El diálogo comprueba si funciona y te dice qué falta; aun así, puedes aplicarla.',
          soloEn: ['windows', 'mac']
        }
      ]
    },
    {
      ancla: 'limite',
      titulo: 'Límite de contenedores',
      bloques: [
        'Cada agente trabajando ocupa de 0,3 a 1,5 GB. En **Configuración › Contenedores Docker › Límite de contenedores** eliges cuántos pueden correr a la vez, y el semáforo dice, según la memoria que tiene Docker en {tuEquipo}, si es **Holgado**, **Justo** o **Excesivo**. De serie vale el recomendado.',
        'Al llegar al límite y abrir otro agente en Docker, Tessera para primero un contenedor sin agentes. Si no hay, para el que diga **Qué parar primero**: los últimos que abriste (recomendado), los primeros o los que llevan más tiempo sin uso. Nunca para el que estás mirando ni el de un agente propio.',
        'Con **No parar los que están trabajando mientras haya otro**, un agente que trabaja no se interrumpe si hay otro que parar. Si todos están protegidos, el agente nuevo no se abre y Tessera te explica por qué.',
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
        'Aunque no abras nada, muchos agentes trabajando pueden agotar la memoria de Docker, y entonces cae un proceso cualquiera. Para evitarlo, Tessera mide la memoria de todos los contenedores y, si pasa del umbral durante un rato (90 % durante 30 segundos, de serie), hiberna un agente con la misma regla del límite.',
        'Antes de parar, avisa durante 30 segundos y te deja elegir otro con **Parar otro**; si la memoria baja, el aviso se retira. Nunca para el que estás mirando. Si todos los que quedan están trabajando, para uno igual: sin memoria caería uno de todos modos, y sin elegir.',
        'Cada parada, por el límite o por la saturación, se anuncia y queda apuntada en **Configuración › Contenedores Docker › Últimas paradas**.'
      ]
    },
    {
      ancla: 'imagen',
      titulo: 'La imagen y los paquetes extra',
      bloques: [
        'Todos los contenedores nacen de una imagen que Tessera construye la primera vez que hace falta (tarda unos minutos), con Claude Code y Codex ya instalados.',
        'En **Configuración › Proyectos › Sandbox de Docker** puedes hornear en ella **Herramientas de documentos** (para convertir y capturar PDF y documentos de oficina; suma cerca de 1 GB), las librerías de sistema del **Navegador de pruebas** y **Otros paquetes** de Debian. Se aplica al reconstruirla: la próxima vez que se abra un agente, o con **Actualizar agentes**.',
        {
          nota: 'Si un paquete extra no existe o falla al instalarse, la imagen se construye sin los extras para no dejarte sin agente.'
        },
        {
          nota: 'Tessera usa el Docker del sistema. Docker sin root no está soportado: para ese caso, usa el agente nativo.',
          soloEn: ['linux']
        }
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'An agent in Docker works inside a container that Tessera creates and stops for you. This article explains what the container includes, when it stops, which network it uses, and how to keep Docker from running out of memory.',
  secciones: [
    {
      ancla: 'por-cuenta',
      titulo: 'One container per account',
      bloques: [
        'When an agent uses an account from **Isolated accounts (Docker)**, in the account button of its header, Tessera starts a [container](glosario/contenedor) for that account in the profile. Each account has its own container, so no account can read another account’s sign-in session. To decide when Docker is worth it, see [Native or in Docker](nativo-o-docker). The container includes only the following:',
        {
          lista: [
            'The folders of the projects the agent works on, at `/workspace/<folder>`. These are your files: what the agent changes there changes on your disk.',
            'The account folder, with its sign-in session and settings. This folder is kept when the container stops.',
            'Your SSH keys, as read-only, so that Git over SSH works with your own host aliases.'
          ]
        },
        'Nothing else from your disk is available. The agent has `sudo` inside the container to install what it needs, but those changes are lost when the container stops: to keep a tool, add it to the [image](contenedores-docker/imagen).'
      ]
    },
    {
      ancla: 'cuando-se-paran',
      titulo: 'When a container stops',
      bloques: [
        {
          lista: [
            '2 minutes after its last agent closes. If you open an agent again before then, Tessera reuses the same container.',
            'When you [hibernate the profile](hibernar/perfil): all its containers stop.',
            'When you quit Tessera: no container is left running.',
            'When the Docker [container limit](contenedores-docker/limite) or [memory saturation](contenedores-docker/saturacion) requires it.'
          ]
        },
        'Stopping a container is like hibernating: its agents resume their conversations when you return, but any work in progress at that moment is interrupted, and anything that existed only inside the container is lost (background processes, packages installed manually). The project files are not affected.',
        {
          nota: 'An agent in Docker does not hibernate when it is idle, because the memory is used by its container. See [Hibernate and resume](hibernar/docker).'
        }
      ]
    },
    {
      ancla: 'red',
      titulo: 'The container network',
      bloques: [
        'Right-click the profile and use **Docker container network** to choose how network traffic reaches and leaves its containers:',
        {
          lista: [
            '**Own network** (recommended): the container has its own network and ports. You cannot reach a server that the agent starts from your browser.',
            '**Your computer’s network**: the container uses the network of {tuEquipo} and can reach its VPNs and ports. A server that the agent starts on port 3000 opens in your browser on that same port. The trade-off: it shares ports with the other profiles that use this mode, and it cannot listen on ports below 1024.'
          ]
        },
        'Changing the network restarts the profile’s containers and leaves the profile hibernated: its agents and terminals close, and SSH connections stay open. If something is working, Tessera asks you first. When you resume the profile, its containers start with the new network.',
        {
          nota: 'In Docker Desktop, using your computer’s network requires the “Enable host networking” setting. The dialog checks whether it works and tells you what is missing; you can still apply the change.',
          soloEn: ['windows', 'mac']
        }
      ]
    },
    {
      ancla: 'limite',
      titulo: 'Container limit',
      bloques: [
        'Each working agent uses 0.3 to 1.5 GB. In **Settings › Docker containers › Container limit**, you choose how many containers can run at once. Based on the memory available to Docker on {tuEquipo}, a traffic light shows whether the limit is **Comfortable**, **Tight**, or **Excessive**. By default, the recommended limit applies.',
        'When the limit is reached and you open another agent in Docker, Tessera first stops a container with no agents. If there is none, it stops the container selected by **What to stop first**: the most recently opened (recommended), the earliest opened, or the least recently used. It never stops the container you are viewing or the container of an agent you added yourself.',
        'With **Do not stop working agents while another can be stopped**, a working agent is not interrupted if there is another container to stop. If all containers are protected, the new agent does not open, and Tessera tells you why.',
        {
          captura: 'docker-limite',
          alt: 'Settings › Docker containers, with the limit slider, its traffic light, and the memory available to Docker'
        }
      ]
    },
    {
      ancla: 'saturacion',
      titulo: 'If Docker runs out of memory',
      bloques: [
        'Even if you do not open anything new, many working agents can use up Docker’s memory, and then any process can crash. To prevent this, Tessera monitors the memory of all containers. If usage stays above the threshold for a while (90% for 30 seconds, by default), Tessera hibernates an agent, using the same rule as the limit.',
        'Before stopping a container, Tessera warns you for 30 seconds and lets you choose a different one with **Stop another one**; if memory usage drops, the warning disappears. It never stops the container you are viewing. If all the remaining agents are working, Tessera stops one anyway: without memory, one of them would crash regardless, and you would not get to choose which.',
        'Every stop, whether caused by the limit or by saturation, is announced and recorded in **Settings › Docker containers › Latest stops**.'
      ]
    },
    {
      ancla: 'imagen',
      titulo: 'The image and extra packages',
      bloques: [
        'All containers are created from an image that Tessera builds the first time it is needed (this takes a few minutes), with Claude Code and Codex already installed.',
        'In **Settings › Projects › Docker sandbox**, you can add to the image **Document tools** (to convert and capture PDF and office documents; adds about 1 GB), the system libraries for the **Test browser**, and **Other packages** from Debian. Changes take effect when the image is rebuilt: the next time an agent opens, or when you click **Update agents**.',
        {
          nota: 'If an extra package does not exist or fails to install, Tessera builds the image without the extras, so you still have a working agent.'
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
