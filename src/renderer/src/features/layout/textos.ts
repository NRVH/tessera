// =============================================================================
// Textos del marco de la ventana en español e inglés: riel de actividad, barra de título, barra de
// estado, franja inferior, panel lateral, diálogo de cerrar sin guardar y overlay de cierre. Sin JSX:
// lo importa `layoutCentro.ts`, que prueba `node` a secas. Se leen al usarse. Depende de `shared/i18n`.
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txLayout = crearTextos(
  {
    riel: {
      archivos: 'Archivos',
      gitCambios: 'Git · Cambios',
      conexiones: 'Bases de datos',
      terminal: 'Terminal',
      terminalTitulo: 'Terminal (Ctrl+`)',
      gitLog: 'Git · Historial',
      gitLogTitulo: 'Historial de Git',
      cambiosSinConfirmar: (n: number) => `${n} ${n === 1 ? 'cambio' : 'cambios'} sin confirmar`,
      barra: 'Barra de actividad',
      grupoSuperior: 'Grupo superior del riel',
      grupoInferior: 'Grupo inferior del riel',
      grupoPantallaCompleta: 'Pantalla completa',
      grupoPaneles: 'Paneles a pantalla completa',
      restaurar: { terminal: 'Restaurar el panel de terminal', gitlog: 'Restaurar el panel de Git' },
      restaurarTitulo: {
        terminal: (acorde: string) => `Restaurar: la terminal vuelve a la parte inferior (${acorde})`,
        gitlog: (acorde: string) => `Restaurar: el panel de Git vuelve a la parte inferior (${acorde})`
      },
      ocultar: { terminal: 'Ocultar el panel de terminal', gitlog: 'Ocultar el panel de Git' },
      ocultarTitulo: {
        terminal: 'Ocultar el panel (las terminales siguen en ejecución; al volver a abrirlo sigue a pantalla completa)',
        gitlog: 'Ocultar el panel de Git (al volver a abrirlo sigue a pantalla completa)'
      },
      cambiarA: { terminal: 'Terminal a pantalla completa', gitlog: 'Historial de Git a pantalla completa' }
    },
    estado: {
      barra: 'Barra de estado',
      ocultarAgenteDatos: (acorde: string) => `Ocultar el agente de bases de datos (${acorde})`,
      mostrarAgenteDatos: (acorde: string) => `Mostrar el agente de bases de datos (${acorde})`,
      ocultarAgenteTerminal: (acorde: string) => `Ocultar el agente de la terminal, que sigue en ejecución (${acorde})`,
      mostrarAgenteTerminal: (acorde: string) => `Mostrar el agente de la terminal (${acorde})`,
      ocultarColumna: 'Ocultar el agente; sigue trabajando',
      mostrarColumna: 'Mostrar el agente',
      ramaActual: (rama: string) => `Rama actual: ${rama}`,
      tituloProblema: (titulo: string, detalle: string | undefined) =>
        `${titulo}${detalle ? `\n${detalle}` : ''}\n\nHaga clic para descartar`,
      ariaProblema: (titulo: string) => `Aviso: ${titulo}. Haga clic para descartar.`,
      finDeLinea: 'Fin de línea. Haga clic para cambiar',
      codificacion: 'Codificación del archivo (reabrir / convertir)',
      menuEol: 'Fin de línea',
      menuAccion: 'Codificación',
      menuReabrir: 'Reabrir con codificación',
      menuGuardar: 'Guardar con codificación (convierte)',
      itemReabrir: 'Reabrir con codificación…',
      itemGuardar: 'Guardar con codificación…'
    },
    razones: {
      sinArchivo: 'Sin un archivo abierto, el agente ocupa el centro; abra un archivo para poder ocultarlo',
      vistaDividida:
        'En vista dividida, la columna del agente se oculta para dejar espacio a los dos paneles. Cambie el modo de vista del archivo para volver a mostrarla.',
      mosaico: 'En el mosaico de agentes, las terminales ocupan toda la ventana. Salga del mosaico para ocultar la columna.',
      sinPerfilDb: 'Elija un perfil en la barra superior para usar el agente de bases de datos',
      gitLogPantallaCompleta:
        'A pantalla completa de Git no hay columna del agente. Haga clic en "Restaurar el panel de Git", en la barra de iconos de la izquierda, para volver a mostrarla.'
    },
    titulo: {
      salirMosaico: (mod: string) => `Salir del mosaico (${mod}+Mayús+M)`,
      mosaicoDisponible: (mod: string) =>
        `Mosaico de agentes: todas las terminales en ejecución visibles (${mod}+Mayús+M)`,
      mosaicoNoDisponible: 'Ver todos los agentes al mismo tiempo (cuando haya alguno en ejecución)',
      mosaico: 'Mosaico de agentes',
      configuracionTitulo: (mod: string) => `Configuración (${mod}+,)`,
      configuracion: 'Configuración'
    },
    franja: {
      desacoplar: 'Desacoplar',
      desacoplarTitulo: 'Desacoplar en una ventana',
      acoplar: 'Acoplar',
      acoplarTitulo: 'Acoplar la terminal y Git',
      mostrarSoloTerminal: 'Mostrar solo la terminal',
      mostrarVistaCompleta: 'Mostrar la vista completa',
      compactaPorAncho: 'Amplíe la ventana para mostrar la vista completa',
      acoplarEnPrincipal: 'Acoplar a la ventana principal',
      opcionesMaximizar: 'Más formas de ver el panel',
      opcionesVista: 'Opciones de la vista',
      grupoPaneles: 'Paneles de la ventana',
      perfilVentana: (nombre: string) => `Perfil: ${nombre}`,
      proyectoVentana: (nombre: string) => `Proyecto activo: ${nombre}`,
      tituloVentana: (perfil: string, panel: 'terminal' | 'gitlog') =>
        `Tessera · ${panel === 'terminal' ? 'Terminal' : 'Historial de Git'} · ${perfil}`,
      redimensionarInferior: 'Redimensionar el panel inferior',
      panelGit: 'el panel de Git',
      terminal: 'la terminal',
      redimensionarLateral: 'Redimensionar el explorador',
      panelLateral: 'el panel lateral'
    },
    cerrarSinGuardar: {
      titulo: 'Cerrar sin guardar',
      pregunta: (nombre: string) => `¿Cerrar "${nombre}" sin guardar?`,
      mensajeDiff: (nombre: string) =>
        `Si cierra la comparación, se pierden los cambios sin guardar de "${nombre}": no se han escrito en disco.`,
      mensajeArchivo: (nombre: string) => `Si cierra "${nombre}", se pierden sus cambios sin guardar.`,
      cancelar: 'Cancelar'
    },
    cierre: {
      aria: 'Cerrando Tessera',
      actualizando: 'Actualizando Tessera',
      cerrando: 'Cerrando Tessera',
      reabre: 'Tessera se abrirá de nuevo automáticamente al terminar.',
      deteniendo: 'Deteniendo contenedores Docker…'
    }
  },
  {
    riel: {
      archivos: 'Files',
      gitCambios: 'Git · Changes',
      conexiones: 'Databases',
      terminal: 'Terminal',
      terminalTitulo: 'Terminal (Ctrl+`)',
      gitLog: 'Git · History',
      gitLogTitulo: 'Git history',
      cambiosSinConfirmar: (n: number) => `${n} uncommitted change${n === 1 ? '' : 's'}`,
      barra: 'Activity bar',
      grupoSuperior: 'Sidebar top group',
      grupoInferior: 'Sidebar bottom group',
      grupoPantallaCompleta: 'Full screen',
      grupoPaneles: 'Full-screen panels',
      restaurar: { terminal: 'Restore terminal panel', gitlog: 'Restore Git panel' },
      restaurarTitulo: {
        terminal: (acorde: string) => `Restore: the terminal returns to the bottom panel (${acorde})`,
        gitlog: (acorde: string) => `Restore: Git returns to the bottom panel (${acorde})`
      },
      ocultar: { terminal: 'Hide terminal panel', gitlog: 'Hide Git panel' },
      ocultarTitulo: {
        terminal: 'Hide panel (terminals keep running; it reopens in full screen)',
        gitlog: 'Hide Git panel (it reopens in full screen)'
      },
      cambiarA: { terminal: 'Terminal in full screen', gitlog: 'Git history in full screen' }
    },
    estado: {
      barra: 'Status bar',
      ocultarAgenteDatos: (acorde: string) => `Hide the database agent (${acorde})`,
      mostrarAgenteDatos: (acorde: string) => `Show the database agent (${acorde})`,
      ocultarAgenteTerminal: (acorde: string) => `Hide the terminal agent, which keeps running (${acorde})`,
      mostrarAgenteTerminal: (acorde: string) => `Show the terminal agent (${acorde})`,
      ocultarColumna: 'Hide the agent; it keeps working',
      mostrarColumna: 'Show the agent',
      ramaActual: (rama: string) => `Current branch: ${rama}`,
      tituloProblema: (titulo: string, detalle: string | undefined) =>
        `${titulo}${detalle ? `\n${detalle}` : ''}\n\nClick to dismiss`,
      ariaProblema: (titulo: string) => `Warning: ${titulo}. Click to dismiss.`,
      finDeLinea: 'Line ending. Click to change',
      codificacion: 'File encoding (reopen / convert)',
      menuEol: 'Line ending',
      menuAccion: 'Encoding',
      menuReabrir: 'Reopen with encoding',
      menuGuardar: 'Save with encoding (converts)',
      itemReabrir: 'Reopen with encoding…',
      itemGuardar: 'Save with encoding…'
    },
    razones: {
      sinArchivo: 'With no file open, the agent fills the center; open a file to hide it',
      vistaDividida:
        'In split view the agent column is hidden to make room for the two panes. Change the file’s view mode to show it again.',
      mosaico: 'In the agent mosaic the terminals take up the whole window. Leave the mosaic to hide the column.',
      sinPerfilDb: 'Choose a profile in the bar at the top to use the database agent',
      gitLogPantallaCompleta:
        'In full-screen Git there is no agent column. Click Restore Git panel, in the icon bar on the left, to see it again.'
    },
    titulo: {
      salirMosaico: (mod: string) => `Leave the mosaic (${mod}+Shift+M)`,
      mosaicoDisponible: (mod: string) => `Agent mosaic: every running terminal in view (${mod}+Shift+M)`,
      mosaicoNoDisponible: 'See all agents at once (when one is running)',
      mosaico: 'Agent mosaic',
      configuracionTitulo: (mod: string) => `Settings (${mod}+,)`,
      configuracion: 'Settings'
    },
    franja: {
      desacoplar: 'Undock',
      desacoplarTitulo: 'Undock into a window',
      acoplar: 'Dock',
      acoplarTitulo: 'Dock the terminal and Git',
      mostrarSoloTerminal: 'Show terminal only',
      mostrarVistaCompleta: 'Show full view',
      compactaPorAncho: 'Widen the window to show the full view',
      acoplarEnPrincipal: 'Dock to the main window',
      opcionesMaximizar: 'More ways to view the panel',
      opcionesVista: 'View options',
      grupoPaneles: 'Window panels',
      perfilVentana: (nombre: string) => `Profile: ${nombre}`,
      proyectoVentana: (nombre: string) => `Active project: ${nombre}`,
      tituloVentana: (perfil: string, panel: 'terminal' | 'gitlog') =>
        `Tessera · ${panel === 'terminal' ? 'Terminal' : 'Git history'} · ${perfil}`,
      redimensionarInferior: 'Resize the bottom panel',
      panelGit: 'the Git panel',
      terminal: 'the terminal',
      redimensionarLateral: 'Resize the explorer',
      panelLateral: 'the side panel'
    },
    cerrarSinGuardar: {
      titulo: 'Close without saving',
      pregunta: (nombre: string) => `Close "${nombre}" without saving?`,
      mensajeDiff: (nombre: string) =>
        `If you close the diff, the unsaved changes in "${nombre}" are lost: they have not been written to disk.`,
      mensajeArchivo: (nombre: string) => `If you close "${nombre}", its unsaved changes are lost.`,
      cancelar: 'Cancel'
    },
    cierre: {
      aria: 'Closing Tessera',
      actualizando: 'Updating Tessera',
      cerrando: 'Closing Tessera',
      reabre: 'Tessera reopens automatically when it finishes.',
      deteniendo: 'Stopping Docker containers…'
    }
  }
)
