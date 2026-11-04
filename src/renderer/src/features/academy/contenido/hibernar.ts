// =============================================================================
// Tessera Academy · Hibernar y reanudar: el perfil manualmente, el agente inactivo automáticamente.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Hibernar cierra lo que no se está usando para liberar memoria de su equipo. Al reanudar, cada agente retoma su conversación donde la dejó.',
  secciones: [
    {
      ancla: 'perfil',
      titulo: 'Hibernar un perfil',
      bloques: [
        'Haga clic con el botón derecho en un perfil y seleccione **Hibernar el perfil…**. Tessera cierra sus agentes y sus terminales y detiene sus [contenedores de Docker](contenedores-docker); sus sesiones SSH siguen abiertas. El perfil permanece en la barra, atenuado.',
        'Tessera solo pide confirmación si hibernar interrumpiría algo: un agente que está trabajando o una terminal que ejecuta un comando. Si no puede comprobarlo, pide confirmación igualmente.',
        { nota: 'Cambiar de perfil nunca hiberna nada: el perfil anterior sigue trabajando en segundo plano.' }
      ]
    },
    {
      ancla: 'reanudar',
      titulo: 'Reanudar',
      bloques: [
        'Para reanudar un perfil hibernado, basta con abrirlo. Sus proyectos vuelven con las mismas pestañas y cada agente retoma su conversación donde la dejó.',
        'Las terminales se abren de nuevo vacías: lo que ejecutaban se detuvo al hibernar.'
      ]
    },
    {
      ancla: 'agente-inactivo',
      titulo: 'El agente inactivo se hiberna automáticamente',
      bloques: [
        'El agente [nativo](glosario/nativo) de un proyecto que no está visible en pantalla se hiberna automáticamente tras unos minutos sin actividad. Un proyecto está visible si es la pestaña activa o si ocupa una casilla del [mosaico](mosaico). Las terminales de ese proyecto no se cierran.',
        {
          lista: [
            'Nunca ocurre mientras un agente del proyecto está trabajando, espera su respuesta, tiene texto sin enviar, terminó sin que se haya revisado el resultado o dejó una tarea en segundo plano.',
            'Los agentes de un proyecto se hibernan todos o ninguno, así que tampoco ocurre si alguno de ellos se ejecuta en Docker.',
            'Su pestaña aparece atenuada. Haga clic en ella para reanudar el agente en su conversación.',
            'El plazo se cambia en **Configuración › Proyectos › Hibernar el agente inactivo tras**: 5 minutos de forma predeterminada, o «Nunca».'
          ]
        },
        'Si su equipo tiene poca memoria disponible, el plazo baja a 2 minutos y Tessera ofrece **Hibernar inactivos ahora**. Si se eligió «Nunca», el plazo no cambia.'
      ]
    },
    {
      ancla: 'docker',
      titulo: 'Los agentes en Docker',
      bloques: [
        'Un agente en Docker no se hiberna por inactividad, porque lo que ocupa memoria es su contenedor. El contenedor se detiene al hibernar el perfil, al cerrar Tessera, a los 2 minutos sin agentes o cuando lo exigen el límite de contenedores o la saturación de memoria de Docker. Consulte [Contenedores de Docker](contenedores-docker).'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Hibernating closes what you are not using and frees memory on your computer. When you resume, each agent continues its conversation from where it stopped.',
  secciones: [
    {
      ancla: 'perfil',
      titulo: 'Hibernate a profile',
      bloques: [
        'Right-click a profile and select **Hibernate profile…**. Tessera closes its agents and terminals and stops its [Docker containers](contenedores-docker); its SSH sessions stay open. The profile stays in the bar, dimmed.',
        'Tessera asks you first only if hibernating would interrupt something: an agent that is working or a terminal that is running a command. If Tessera cannot check, it asks anyway.',
        { nota: 'Switching profiles never hibernates anything: the profile you leave keeps running in the background.' }
      ]
    },
    {
      ancla: 'reanudar',
      titulo: 'Resume',
      bloques: [
        'To resume a hibernated profile, open it. Its projects return with the same tabs, and each agent resumes its conversation from where it stopped.',
        'The terminals reopen empty: any command they were running stopped when the profile hibernated.'
      ]
    },
    {
      ancla: 'agente-inactivo',
      titulo: 'Idle agents hibernate automatically',
      bloques: [
        'When a project is not visible on screen, its [native](glosario/nativo) agent hibernates automatically after a few minutes of inactivity. A project is visible if it is the active tab or occupies a [mosaic](mosaico) tile. The terminals of that project stay open.',
        {
          lista: [
            'It never happens while an agent in the project is working, is waiting for your reply, has unsent text, has finished and you have not reviewed the result, or has left a task running in the background.',
            'The agents of a project hibernate all together or not at all, so it also does not happen if one of them runs in Docker.',
            'Its tab appears dimmed. Click the tab to resume the agent in its conversation.',
            'To change the delay, go to **Settings › Projects › Hibernate idle agents after**. The default is 5 minutes; you can also choose “Never”.'
          ]
        },
        'If your computer is low on memory, the delay drops to 2 minutes, and Tessera offers **Hibernate idle agents now**. If you chose “Never”, the delay does not change.'
      ]
    },
    {
      ancla: 'docker',
      titulo: 'Agents in Docker',
      bloques: [
        'An agent in Docker does not hibernate when it is idle, because what uses the memory is its container. The container stops when the profile hibernates, when Tessera closes, after 2 minutes with no agents, or when the container limit or Docker memory saturation requires it. For details, see [Docker containers](contenedores-docker).'
      ]
    }
  ]
}

export const txHibernar = crearTextos(es, en)
