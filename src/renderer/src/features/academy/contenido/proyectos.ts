// =============================================================================
// Tessera Academy · Proyectos: abrirlos, sus pestañas, cerrarlos y qué vuelve al reabrir la app.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Un proyecto es una carpeta abierta en un perfil, con su agente, su editor, git y sus terminales. Abrir o cerrar un proyecto no modifica la carpeta.',
  secciones: [
    {
      ancla: 'abrir',
      titulo: 'Abrir un proyecto',
      bloques: [
        {
          pasos: [
            'Haga clic en el **+** de la barra de proyectos (**Abrir una carpeta como proyecto**).',
            'Seleccione la carpeta, por ejemplo `tienda-web`.',
            'La carpeta se abre como una pestaña del perfil activo y su [agente](glosario/agente) se inicia en ella.'
          ]
        },
        'También se pueden abrir carpetas desde {gestorArchivos}, si esta opción se activa en **Configuración › Integración con el sistema**. Si la carpeta ya está abierta en algún perfil, Tessera cambia a ese proyecto en lugar de abrirlo otra vez.'
      ]
    },
    {
      ancla: 'varios-repositorios',
      titulo: 'Un repositorio o varios',
      bloques: [
        'Un proyecto puede ser un solo repositorio o una carpeta que contiene varios, también agrupados en subcarpetas (por ejemplo, `pedidos/api-pedidos` y `pedidos/web-pedidos`). La vista de [Git](git) los detecta automáticamente y permite trabajar con cada uno por separado.'
      ]
    },
    {
      ancla: 'pestanas',
      titulo: 'Las pestañas de proyecto',
      bloques: [
        {
          lista: [
            'Arrastre una pestaña para cambiar el orden. El [mosaico](mosaico) sigue ese mismo orden.',
            'Una pestaña atenuada indica que su agente está hibernado para ahorrar memoria. Haga clic en ella para reanudarlo. Consulte [Hibernar y reanudar](hibernar).',
            'Haga clic con el botón derecho en una pestaña para ver **Cambiar "tienda-web" por otra carpeta…** y **Cerrar**.'
          ]
        }
      ]
    },
    {
      ancla: 'cerrar',
      titulo: 'Cerrar o cambiar de carpeta',
      bloques: [
        'Cerrar un proyecto cierra sus pestañas y su agente. Tessera siempre pide confirmación antes.',
        'Cambiar el proyecto por otra carpeta funciona igual: se cierra el proyecto y la carpeta nueva se abre en su lugar. Si se selecciona la misma carpeta, no se cierra nada.',
        {
          nota: 'Ninguna carpeta se modifica, y la conversación del agente queda en su [historial](conversaciones) para retomarla al volver a abrir el proyecto.'
        }
      ]
    },
    {
      ancla: 'al-volver',
      titulo: 'Al volver a abrir Tessera',
      bloques: [
        'Cada perfil recupera sus proyectos tal como se dejaron. Para ahorrar memoria, los agentes no se inician todos al mismo tiempo: el agente de cada proyecto se inicia al entrar en ese proyecto y retoma su última conversación.',
        'Cada proyecto recupera también sus archivos abiertos, en su orden, con su modo de vista y la línea del cursor, las carpetas desplegadas del explorador y sus terminales, con sus nombres y una shell nueva. La ventana vuelve a su monitor, con su tamaño y su posición; si ese monitor ya no está conectado, se abre en el principal.',
        'Si un proyecto se abrió desde {gestorArchivos} solo para ver un archivo, su agente no se inicia hasta que se solicite con el botón **Iniciar** (por ejemplo, **Iniciar Claude Code**).'
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
            'The folder opens as a tab in the active profile, and its [agent](glosario/agente) starts there.'
          ]
        },
        'You can also open folders from {gestorArchivos} if you turn this on in **Settings › System integration**. If the folder is already open in a profile, Tessera switches to that project instead of opening it again.'
      ]
    },
    {
      ancla: 'varios-repositorios',
      titulo: 'One repository or several',
      bloques: [
        'A project can be a single repository or a folder that contains several repositories, including repositories grouped in subfolders (for example, `pedidos/api-pedidos` and `pedidos/web-pedidos`). The [Git](git) view finds them automatically and lets you work with each one separately.'
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
            'Right-click a tab for **Replace "tienda-web" with another folder…** and **Close**.'
          ]
        }
      ]
    },
    {
      ancla: 'cerrar',
      titulo: 'Close or replace the folder',
      bloques: [
        'Closing a project closes its tabs and its agent. Tessera always asks you first.',
        'Replacing the folder works the same way: the project closes, and the new folder opens in its place. If you choose the same folder, nothing closes.',
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
        'Each project also restores its open files, in order, with their view mode and cursor line, the expanded folders of the explorer, and its terminals, with their names and a new shell. The window returns to its monitor, with its size and position; if that monitor is no longer connected, it opens on the main one.',
        'If you opened a project from {gestorArchivos} only to view a file, its agent does not start until you click its **Start** button (for example, **Start Claude Code**).'
      ]
    }
  ]
}

export const txProyectos = crearTextos(es, en)
