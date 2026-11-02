// =============================================================================
// Tessera Academy · Hibernar y reanudar: el perfil a mano, el agente inactivo solo.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Hibernar cierra lo que no estás usando para devolver memoria a tu equipo. Lo que se cierra vuelve donde lo dejaste al reanudarlo.',
  secciones: [
    {
      ancla: 'perfil',
      titulo: 'Hibernar un perfil',
      bloques: [
        'Con clic derecho sobre un perfil, **Hibernar el perfil…** cierra sus agentes y sus terminales y para sus [contenedores de Docker](contenedores-docker); sus sesiones SSH siguen abiertas. El perfil se queda en la barra, atenuado.',
        'Solo pregunta antes si cortaría algo: un agente que está trabajando o una terminal que ejecuta un comando. Si no se puede comprobar, pregunta igual.',
        { nota: 'Cambiar de perfil nunca hiberna nada: el perfil que dejas sigue trabajando en segundo plano.' }
      ]
    },
    {
      ancla: 'reanudar',
      titulo: 'Reanudar',
      bloques: [
        'Para reanudar un perfil hibernado basta con abrirlo. Sus proyectos vuelven con las mismas pestañas y cada agente retoma su conversación donde la dejó.',
        'Las terminales se abren de nuevo vacías: lo que ejecutaban se detuvo al hibernar.'
      ]
    },
    {
      ancla: 'agente-inactivo',
      titulo: 'El agente inactivo se hiberna solo',
      bloques: [
        'El agente [nativo](glosario/nativo) de un proyecto que no está en pantalla se hiberna solo tras unos minutos sin actividad. Las terminales de ese proyecto no se tocan.',
        {
          lista: [
            'Nunca pasa mientras el agente trabaja, te espera o tiene texto sin enviar, ni si dejó una tarea en segundo plano.',
            'Su pestaña se ve atenuada; con un clic se reanuda en su conversación.',
            'El plazo se cambia en **Configuración › Proyectos › Hibernar el agente inactivo tras**: 5 minutos por defecto, o nunca.'
          ]
        },
        'Si a tu equipo le queda poca memoria, el plazo baja a 2 minutos y Tessera ofrece **Hibernar inactivos ahora**. Si elegiste nunca, se respeta.'
      ]
    },
    {
      ancla: 'docker',
      titulo: 'Los agentes en Docker',
      bloques: [
        'Un agente en Docker no se hiberna por inactividad: lo caro es su contenedor, que se para al hibernar el perfil, al cerrar Tessera, a los 2 minutos sin agentes o cuando lo piden el límite o la saturación. Lo explica [Contenedores de Docker](contenedores-docker).'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Hibernating closes what you are not using and frees memory on your computer. When you resume, everything returns to where you left it.',
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
        'When a project is not on screen, its [native](glosario/nativo) agent hibernates automatically after a few minutes of inactivity. The terminals of that project stay open.',
        {
          lista: [
            'An agent never hibernates while it is working, while it is waiting for you, while it has unsent text, or while a task it started is still running in the background.',
            'Its tab appears dimmed. Click the tab to resume the agent in its conversation.',
            'To change the delay, go to **Settings › Projects › Hibernate idle agents after**. The default is 5 minutes; you can also choose never.'
          ]
        },
        'If your computer is low on memory, the delay drops to 2 minutes, and Tessera offers **Hibernate idle agents now**. If you chose never, Tessera respects that setting.'
      ]
    },
    {
      ancla: 'docker',
      titulo: 'Agents in Docker',
      bloques: [
        'An agent in Docker does not hibernate when it is idle, because the costly part is its container. The container stops when the profile hibernates, when Tessera closes, after 2 minutes with no agents, or when the container limit or Docker memory saturation requires it. For details, see [Docker containers](contenedores-docker).'
      ]
    }
  ]
}

export const txHibernar = crearTextos(es, en)
