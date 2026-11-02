// =============================================================================
// Tessera Academy · Proyectos: abrirlos, sus pestañas, cerrarlos y qué vuelve al reabrir la app.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Un proyecto es una carpeta abierta en un perfil, con su agente, su editor, git y sus terminales. Tessera nunca cambia la carpeta por abrirla o cerrarla.',
  secciones: [
    {
      ancla: 'abrir',
      titulo: 'Abrir un proyecto',
      bloques: [
        {
          pasos: [
            'Pulsa el **+** de la barra de proyectos (**Abrir una carpeta como proyecto**).',
            'Elige la carpeta, por ejemplo `tienda-web`.',
            'Se abre como una pestaña del perfil activo y su agente arranca en esa carpeta.'
          ]
        },
        'También puedes abrir carpetas desde {gestorArchivos}, si lo activas en **Configuración › Integración con el sistema**. Si abres así una carpeta que ya está abierta en algún perfil, Tessera te lleva a ella en vez de abrirla dos veces.'
      ]
    },
    {
      ancla: 'varios-repositorios',
      titulo: 'Un repositorio o varios',
      bloques: [
        'Un proyecto puede ser un solo repositorio o una carpeta que contiene varios, también agrupados en subcarpetas (por ejemplo `pedidos/api-pedidos` y `pedidos/web-pedidos`). La vista de [Git](git) los encuentra solos y te deja trabajar con cada uno.'
      ]
    },
    {
      ancla: 'pestanas',
      titulo: 'Las pestañas de proyecto',
      bloques: [
        {
          lista: [
            'Arrastra una pestaña para cambiar el orden. Ese orden es también el del [mosaico](mosaico).',
            'Una pestaña atenuada tiene su agente hibernado para ahorrar memoria: un clic la reanuda. Ver [Hibernar y reanudar](hibernar).',
            'Con clic derecho: **Cambiar «tienda-web» por otra carpeta…** y **Cerrar**.'
          ]
        }
      ]
    },
    {
      ancla: 'cerrar',
      titulo: 'Cerrar o cambiar de carpeta',
      bloques: [
        'Cerrar un proyecto cierra sus pestañas y su agente. Tessera siempre pregunta antes.',
        'Cambiarlo por otra carpeta es lo mismo: se cierra el proyecto y se abre la carpeta nueva en su lugar.',
        {
          nota: 'Ninguna carpeta se toca, y la conversación del agente queda en su [historial](conversaciones) para retomarla cuando vuelvas a abrir el proyecto.'
        }
      ]
    },
    {
      ancla: 'al-volver',
      titulo: 'Al volver a abrir Tessera',
      bloques: [
        'Cada perfil recupera sus proyectos tal como los dejaste. Para no gastar memoria, no arrancan todos los agentes a la vez: el de cada proyecto arranca cuando entras en él y retoma su última conversación.',
        'Si un proyecto se abrió desde {gestorArchivos} solo para ver un archivo, su agente no arranca hasta que lo pidas con su botón **Iniciar** (por ejemplo, **Iniciar Claude Code**).'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'A project is a folder open in a profile, with its own agent, editor, Git, and terminals. Opening or closing a project never changes the folder.',
  secciones: [
    {
      ancla: 'abrir',
      titulo: 'Open a project',
      bloques: [
        {
          pasos: [
            'Click the **+** in the project bar (**Open a folder as a project**).',
            'Choose the folder, for example `tienda-web`.',
            'The project opens as a tab in the active profile, and its agent starts in that folder.'
          ]
        },
        'You can also open folders from {gestorArchivos} if you turn this on in **Settings › System integration**. If you open a folder this way and it is already open in a profile, Tessera switches to it instead of opening it twice.'
      ]
    },
    {
      ancla: 'varios-repositorios',
      titulo: 'One repository or several',
      bloques: [
        'A project can be a single repository or a folder that contains several repositories, including repositories grouped in subfolders (for example, `pedidos/api-pedidos` and `pedidos/web-pedidos`). The [Git](git) view finds them automatically and lets you work with each one.'
      ]
    },
    {
      ancla: 'pestanas',
      titulo: 'Project tabs',
      bloques: [
        {
          lista: [
            'To change the order, drag a tab. The [mosaic](mosaico) uses the same order.',
            'A dimmed tab means its agent is hibernated to save memory. Click the tab to resume it. See [Hibernate and resume](hibernar).',
            'Right-click a tab for **Replace “tienda-web” with another folder…** and **Close**.'
          ]
        }
      ]
    },
    {
      ancla: 'cerrar',
      titulo: 'Close or replace the folder',
      bloques: [
        'Closing a project closes its tabs and its agent. Tessera always asks you first.',
        'Replacing the folder works the same way: the project closes, and the new folder opens in its place.',
        {
          nota: 'Tessera does not change any folder, and the agent’s conversation stays in its [history](conversaciones), so you can resume it when you open the project again.'
        }
      ]
    },
    {
      ancla: 'al-volver',
      titulo: 'When you open Tessera again',
      bloques: [
        'Each profile restores its projects as you left them. To save memory, the agents do not all start at once: the agent of each project starts when you open that project, and it resumes its last conversation.',
        'If you opened a project from {gestorArchivos} only to view a file, its agent does not start until you click its **Start** button (for example, **Start Claude Code**).'
      ]
    }
  ]
}

export const txProyectos = crearTextos(es, en)
