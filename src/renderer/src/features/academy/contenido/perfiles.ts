// =============================================================================
// Tessera Academy · Perfiles: qué guarda cada uno, crearlo, su menú y eliminarlo.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Un perfil es un espacio de trabajo con sus proyectos, sus cuentas y sus conexiones. Su color te dice en todo momento en cuál estás.',
  secciones: [
    {
      ancla: 'que-guarda',
      titulo: 'Qué guarda un perfil',
      bloques: [
        'Cada perfil tiene lo suyo y no lo comparte con los demás:',
        {
          lista: [
            'Sus proyectos abiertos, en el orden en que los dejaste.',
            'Sus [cuentas de Docker](cuentas) y los agentes que añadiste para correr en Docker.',
            'Sus conexiones [SSH](ssh) y de [bases de datos](bases-de-datos).',
            'Sus [reglas para los agentes](reglas-del-perfil), su color y la red de sus contenedores.',
            'Qué agentes se ven en sus proyectos y en qué orden.'
          ]
        },
        {
          nota: 'La cuenta de tu equipo y los agentes que corren en tu equipo son los mismos en todos los perfiles. Si quieres una cuenta distinta en cada perfil, usa una cuenta de Docker.'
        }
      ]
    },
    {
      ancla: 'crear',
      titulo: 'Crear un perfil y cambiar de uno a otro',
      bloques: [
        {
          pasos: [
            'Pulsa el **+** del final de la barra de perfiles.',
            'Escribe su nombre (por ejemplo, «Trabajo» o «Personal») y elige un color.',
            'Pulsa **Crear**. El perfil nuevo empieza sin proyectos.'
          ]
        },
        'Para cambiar de perfil, pulsa su pestaña. Cambiar nunca hiberna nada: el perfil que dejas sigue trabajando en segundo plano, y un punto en su pestaña te avisa si un agente trabaja, te espera o terminó sin que lo hayas revisado.',
        'Arrastra las pestañas para ordenar los perfiles.'
      ]
    },
    {
      ancla: 'menu',
      titulo: 'El menú del perfil',
      bloques: [
        'Con clic derecho sobre un perfil:',
        {
          lista: [
            '**Renombrar** (también con doble clic) y **Cambiar color**.',
            '**Red del contenedor Docker**: si los contenedores del perfil usan una red propia o la de {tuEquipo}. Lo explica [Contenedores de Docker](contenedores-docker).',
            '**Reglas para los agentes…**: instrucciones que leen todos sus agentes al arrancar. Ver [Reglas para los agentes](reglas-del-perfil).',
            '**Hibernar el perfil…**: cierra sus agentes y terminales para liberar memoria. Ver [Hibernar un perfil](hibernar/perfil).'
          ]
        },
        { captura: 'menu-del-perfil', alt: 'El menú del clic derecho de un perfil, con renombrar, color, red, reglas, hibernar y eliminar' }
      ]
    },
    {
      ancla: 'selector-compacto',
      titulo: 'Perfiles en un selector compacto',
      bloques: [
        'Si la barra de perfiles te quita sitio, activa **Configuración › Apariencia › Perfiles en un selector compacto**. La barra desaparece y en la barra de título queda una pastilla con el perfil activo; al pulsarla salen los demás.',
        'Desde esa lista haces lo mismo que desde la barra: crear, ordenar arrastrando, renombrar y el resto del menú.'
      ]
    },
    {
      ancla: 'eliminar',
      titulo: 'Eliminar un perfil',
      bloques: [
        '**Eliminar perfil…** está al final de su menú. Necesitas tener al menos otro perfil.',
        {
          lista: [
            'Se cierran sus agentes y terminales y se detiene su contenedor.',
            'Se borran sus conexiones SSH y de bases de datos y su historial de consultas.',
            'Las notas y consultas de sus agentes van a {papelera}: desde allí se recuperan.',
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
            'Its [Docker accounts](cuentas) and the agents you added to run in Docker.',
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
            'Click the **+** at the end of the profile bar.',
            'Enter a name (for example, “Work” or “Personal”) and choose a color.',
            'Click **Create**. The new profile starts with no projects.'
          ]
        },
        'To switch to a profile, click its tab. Switching never hibernates anything: the profile you leave keeps running in the background. A dot on its tab shows whether an agent is working, is waiting for you, or has finished and you have not reviewed the result yet.',
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
            '**Docker container network**: whether the profile’s containers use their own network or the network of {tuEquipo}. For details, see [Docker containers](contenedores-docker).',
            '**Rules for agents…**: instructions that every agent in the profile reads when it starts. See [Rules for agents](reglas-del-perfil).',
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
        'If the profile bar takes up too much space, turn on **Settings › Appearance › Profiles in a compact selector**. The bar disappears, and the title bar shows the active profile in a small button; click it to see the other profiles.',
        'This list offers the same actions as the bar: create, drag to reorder, rename, and the rest of the profile menu.'
      ]
    },
    {
      ancla: 'eliminar',
      titulo: 'Delete a profile',
      bloques: [
        '**Delete profile…** is at the end of the profile menu. You can delete a profile only if you have at least one other profile.',
        {
          lista: [
            'Tessera closes its agents and terminals and stops its container.',
            'Tessera deletes its SSH and database connections and its query history.',
            'The notes and queries of its agents move to {papelera}, where you can recover them.',
            'Its AI accounts and conversations stay on {tuEquipo}.'
          ]
        }
      ]
    }
  ]
}

export const txPerfiles = crearTextos(es, en)
