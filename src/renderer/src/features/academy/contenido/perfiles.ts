// =============================================================================
// Tessera Academy · Perfiles: qué guarda cada uno, crearlo, su menú y eliminarlo.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Un perfil es un espacio de trabajo con sus propios proyectos, cuentas y conexiones. Su color indica en todo momento en qué perfil se encuentra.',
  secciones: [
    {
      ancla: 'que-guarda',
      titulo: 'Qué guarda un perfil',
      bloques: [
        'Cada perfil conserva lo siguiente y no lo comparte con los demás perfiles:',
        {
          lista: [
            'Sus proyectos abiertos, en el orden en que se dejaron.',
            'Sus [cuentas de Docker](cuentas/docker) y los agentes añadidos para ejecutarse en Docker.',
            'Sus conexiones [SSH](ssh) y de [bases de datos](bases-de-datos).',
            'Sus [reglas para los agentes](reglas-del-perfil), su color y la red de sus contenedores.',
            'Qué agentes se muestran en sus proyectos y en qué orden.'
          ]
        },
        {
          nota: 'La cuenta de su equipo y los agentes que se ejecutan en su equipo son los mismos en todos los perfiles. Para usar una cuenta distinta en cada perfil, utilice una cuenta de Docker.'
        }
      ]
    },
    {
      ancla: 'crear',
      titulo: 'Crear un perfil y cambiar de uno a otro',
      bloques: [
        {
          pasos: [
            'Haga clic en el **+** del final de la barra de perfiles. Se abre el formulario **Nuevo perfil**.',
            'Escriba el nombre (por ejemplo, «Trabajo» o «Personal») y seleccione un color.',
            'Haga clic en **Crear**. El perfil nuevo aparece en la barra, sin proyectos.'
          ]
        },
        'Para cambiar de perfil, haga clic en su pestaña. Cambiar de perfil nunca [hiberna](glosario/hibernar) nada: el perfil anterior sigue trabajando en segundo plano. Un punto en su pestaña indica si un agente está trabajando, espera su respuesta o terminó sin que se haya revisado el resultado.',
        'Para cambiar el orden de los perfiles, arrastre sus pestañas.'
      ]
    },
    {
      ancla: 'menu',
      titulo: 'El menú del perfil',
      bloques: [
        'Haga clic con el botón derecho en un perfil para abrir su menú:',
        {
          lista: [
            '**Renombrar** (también con doble clic en la pestaña) y **Cambiar color**.',
            '**Red del contenedor Docker**: indica si los contenedores del perfil usan una red propia o la de {tuEquipo}. Cambiarla reinicia los contenedores y deja el perfil hibernado. Consulte [Contenedores de Docker](contenedores-docker).',
            '**Reglas para los agentes…**: instrucciones que los agentes del perfil reciben al iniciarse. Consulte [Reglas para los agentes](reglas-del-perfil).',
            '**Hibernar el perfil…**: cierra sus agentes y terminales para liberar memoria. Consulte [Hibernar un perfil](hibernar/perfil).'
          ]
        },
        { captura: 'menu-del-perfil', alt: 'El menú contextual de un perfil, con renombrar, color, red, reglas, hibernar y eliminar' }
      ]
    },
    {
      ancla: 'selector-compacto',
      titulo: 'Perfiles en un selector compacto',
      bloques: [
        'Si la barra de perfiles ocupa demasiado espacio, active **Configuración › Apariencia › Perfiles en un selector compacto**. La barra desaparece y la barra de título muestra un botón con el perfil activo; al hacer clic en él se despliegan los demás perfiles.',
        'Esa lista ofrece las mismas acciones que la barra: crear, ordenar arrastrando, renombrar y el resto del menú del perfil.'
      ]
    },
    {
      ancla: 'eliminar',
      titulo: 'Eliminar un perfil',
      bloques: [
        '**Eliminar perfil…** está al final del menú del perfil y solo se puede usar si existe al menos otro perfil. Tessera pide confirmación y, al confirmar, ocurre lo siguiente:',
        {
          lista: [
            'Se cierran sus agentes y terminales y se detienen sus contenedores.',
            'Se borran sus conexiones SSH y de bases de datos, su historial de consultas y sus reglas para los agentes.',
            'Las notas y consultas de sus agentes van a {papelera}, desde donde se pueden recuperar.',
            'Sus cuentas de IA y sus conversaciones no se borran de {tuEquipo}.'
          ]
        }
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'A profile is a workspace with its own projects, accounts, and connections. Its color always shows you which profile you are in.',
  secciones: [
    {
      ancla: 'que-guarda',
      titulo: 'What a profile contains',
      bloques: [
        'Each profile keeps the following to itself and does not share it with other profiles:',
        {
          lista: [
            'Its open projects, in the order you left them.',
            'Its [Docker accounts](cuentas/docker) and the agents you added to run in Docker.',
            'Its [SSH](ssh) and [database](bases-de-datos) connections.',
            'Its [rules for agents](reglas-del-perfil), its color, and the network of its containers.',
            'Which agents appear in its projects, and in what order.'
          ]
        },
        {
          nota: 'The account on your computer and the agents that run on your computer are the same in every profile. To use a different account in each profile, use a Docker account.'
        }
      ]
    },
    {
      ancla: 'crear',
      titulo: 'Create and switch profiles',
      bloques: [
        {
          pasos: [
            'Click the **+** at the end of the profile bar. The **New profile** form opens.',
            'Enter a name (for example, “Work” or “Personal”) and choose a color.',
            'Click **Create**. The new profile appears in the bar, with no projects.'
          ]
        },
        'To switch to a profile, click its tab. Switching never [hibernates](glosario/hibernar) anything: the profile you leave keeps running in the background. A dot on its tab shows whether an agent is working, is waiting for your reply, or has finished and you have not reviewed the result yet.',
        'To reorder the profiles, drag their tabs.'
      ]
    },
    {
      ancla: 'menu',
      titulo: 'The profile menu',
      bloques: [
        'Right-click a profile to open its menu:',
        {
          lista: [
            '**Rename** (or double-click the tab) and **Change color**.',
            '**Docker container network**: whether the profile’s containers use their own network or the network of {tuEquipo}. Changing it restarts the containers and leaves the profile hibernated. See [Docker containers](contenedores-docker).',
            '**Rules for agents…**: instructions that the profile’s agents receive when they start. See [Rules for agents](reglas-del-perfil).',
            '**Hibernate profile…**: closes its agents and terminals to free memory. See [Hibernate a profile](hibernar/perfil).'
          ]
        },
        { captura: 'menu-del-perfil', alt: 'The shortcut menu of a profile, with rename, color, network, rules, hibernate, and delete' }
      ]
    },
    {
      ancla: 'selector-compacto',
      titulo: 'Profiles in a compact selector',
      bloques: [
        'If the profile bar takes up too much space, turn on **Settings › Appearance › Profiles in a compact selector**. The bar disappears, and the title bar shows a button with the active profile; click it to see the other profiles.',
        'This list offers the same actions as the bar: create, drag to reorder, rename, and the rest of the profile menu.'
      ]
    },
    {
      ancla: 'eliminar',
      titulo: 'Delete a profile',
      bloques: [
        '**Delete profile…** is at the end of the profile menu, and you can use it only if at least one other profile exists. Tessera asks you to confirm, and then the following happens:',
        {
          lista: [
            'Tessera closes its agents and terminals and stops its containers.',
            'Tessera deletes its SSH and database connections, its query history, and its rules for agents.',
            'The notes and queries of its agents move to {papelera}, where you can recover them.',
            'Its AI accounts and conversations stay on {tuEquipo}.'
          ]
        }
      ]
    }
  ]
}

export const txPerfiles = crearTextos(es, en)
