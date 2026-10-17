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
      conexiones: 'Conexiones a bases de datos',
      terminal: 'Terminal',
      terminalTitulo: 'Terminal (Ctrl+`)',
      gitLog: 'Git · Log',
      gitLogTitulo: 'Historial de git',
      cambiosSinConfirmar: (n: number) => `${n} cambios sin confirmar`,
      barra: 'Barra de actividad',
      grupoSuperior: 'Grupo superior del riel',
      grupoInferior: 'Grupo inferior del riel'
    },
    estado: {
      barra: 'Barra de estado',
      ocultarAgenteDatos: (acorde: string) => `Ocultar el agente de datos (${acorde})`,
      mostrarAgenteDatos: (acorde: string) => `Mostrar el agente de datos (${acorde})`,
      ocultarAgenteTerminal: (acorde: string) => `Ocultar el agente de la terminal, que sigue corriendo (${acorde})`,
      mostrarAgenteTerminal: (acorde: string) => `Mostrar el agente de la terminal (${acorde})`,
      ocultarColumna: 'Ocultar la columna del agente (CC/Codex)',
      mostrarColumna: 'Mostrar la columna del agente (CC/Codex)',
      ramaActual: (rama: string) => `Rama actual: ${rama}`,
      tituloProblema: (titulo: string, detalle: string | undefined) =>
        `${titulo}${detalle ? `\n${detalle}` : ''}\n\nClic para descartar`,
      ariaProblema: (titulo: string) => `Aviso: ${titulo}. Clic para descartar.`,
      finDeLinea: 'Fin de línea (clic para cambiar)',
      codificacion: 'Codificación del archivo (reabrir / convertir)',
      menuEol: 'Fin de línea',
      menuAccion: 'Codificación',
      menuReabrir: 'Reabrir con codificación',
      menuGuardar: 'Guardar con codificación (convierte)',
      itemReabrir: 'Reabrir con codificación…',
      itemGuardar: 'Guardar con codificación…'
    },
    razones: {
      sinArchivo: 'Abre un archivo para poder ocultar la columna del agente',
      vistaDividida:
        'En vista dividida la columna del agente se esconde para dejar sitio a los dos paneles. Cambia el modo del archivo para recuperarla.',
      mosaico: 'En el mosaico de agentes las terminales ocupan toda la ventana. Sal del mosaico para ocultar la columna.',
      sinPerfilDb: 'Abre un perfil para usar el agente de datos',
      gitLogPantallaCompleta:
        'A pantalla completa de Git no hay columna del agente. Pulsa Restaurar en el panel para volver a verla.'
    },
    titulo: {
      salirMosaico: (mod: string) => `Salir del mosaico (${mod}+Shift+M)`,
      mosaicoDisponible: (mod: string) =>
        `Mosaico de agentes: todas las terminales en marcha a la vista (${mod}+Shift+M)`,
      mosaicoNoDisponible: 'Mosaico de agentes: no hay ningún agente en marcha',
      mosaico: 'Mosaico de agentes',
      configuracionTitulo: (mod: string) => `Configuración (${mod}+,)`,
      configuracion: 'Configuración'
    },
    franja: {
      redimensionarInferior: 'Redimensionar el panel inferior',
      panelGit: 'el panel de Git',
      terminal: 'la terminal',
      redimensionarLateral: 'Redimensionar el explorador',
      panelLateral: 'el panel lateral'
    },
    cerrarSinGuardar: {
      titulo: 'Cerrar sin guardar',
      mensajeDiff: (nombre: string) =>
        `"${nombre}" tiene cambios sin guardar.\nSi cierras el diff, se pierden: no se han escrito a disco.`,
      mensajeArchivo: (nombre: string) => `"${nombre}" tiene cambios sin guardar.\nSi lo cierras, se pierden.`,
      cancelar: 'Cancelar'
    },
    cierre: {
      aria: 'Cerrando Tessera',
      actualizando: 'Actualizando Tessera',
      cerrando: 'Cerrando Tessera',
      reabre: 'Tessera volverá a abrirse sola al terminar.',
      deteniendo: 'Deteniendo contenedores Docker…'
    }
  },
  {
    riel: {
      archivos: 'Files',
      gitCambios: 'Git · Changes',
      conexiones: 'Database connections',
      terminal: 'Terminal',
      terminalTitulo: 'Terminal (Ctrl+`)',
      gitLog: 'Git · Log',
      gitLogTitulo: 'Git history',
      cambiosSinConfirmar: (n: number) => `${n} uncommitted change${n === 1 ? '' : 's'}`,
      barra: 'Activity bar',
      grupoSuperior: 'Sidebar top group',
      grupoInferior: 'Sidebar bottom group'
    },
    estado: {
      barra: 'Status bar',
      ocultarAgenteDatos: (acorde: string) => `Hide the data agent (${acorde})`,
      mostrarAgenteDatos: (acorde: string) => `Show the data agent (${acorde})`,
      ocultarAgenteTerminal: (acorde: string) => `Hide the terminal agent, which keeps running (${acorde})`,
      mostrarAgenteTerminal: (acorde: string) => `Show the terminal agent (${acorde})`,
      ocultarColumna: 'Hide the agent column (CC/Codex)',
      mostrarColumna: 'Show the agent column (CC/Codex)',
      ramaActual: (rama: string) => `Current branch: ${rama}`,
      tituloProblema: (titulo: string, detalle: string | undefined) =>
        `${titulo}${detalle ? `\n${detalle}` : ''}\n\nClick to dismiss`,
      ariaProblema: (titulo: string) => `Warning: ${titulo}. Click to dismiss.`,
      finDeLinea: 'Line ending (click to change)',
      codificacion: 'File encoding (reopen / convert)',
      menuEol: 'Line ending',
      menuAccion: 'Encoding',
      menuReabrir: 'Reopen with encoding',
      menuGuardar: 'Save with encoding (converts)',
      itemReabrir: 'Reopen with encoding…',
      itemGuardar: 'Save with encoding…'
    },
    razones: {
      sinArchivo: 'Open a file to be able to hide the agent column',
      vistaDividida:
        'In split view the agent column is hidden to make room for the two panes. Change the file’s mode to bring it back.',
      mosaico: 'In the agent mosaic the terminals take up the whole window. Leave the mosaic to hide the column.',
      sinPerfilDb: 'Open a profile to use the data agent',
      gitLogPantallaCompleta:
        'In full-screen Git there is no agent column. Click Restore in the panel to see it again.'
    },
    titulo: {
      salirMosaico: (mod: string) => `Leave the mosaic (${mod}+Shift+M)`,
      mosaicoDisponible: (mod: string) => `Agent mosaic: every running terminal in view (${mod}+Shift+M)`,
      mosaicoNoDisponible: 'Agent mosaic: no agent is running',
      mosaico: 'Agent mosaic',
      configuracionTitulo: (mod: string) => `Settings (${mod}+,)`,
      configuracion: 'Settings'
    },
    franja: {
      redimensionarInferior: 'Resize the bottom panel',
      panelGit: 'the Git panel',
      terminal: 'the terminal',
      redimensionarLateral: 'Resize the explorer',
      panelLateral: 'the side panel'
    },
    cerrarSinGuardar: {
      titulo: 'Close without saving',
      mensajeDiff: (nombre: string) =>
        `“${nombre}” has unsaved changes.\nIf you close the diff, they are lost: they have not been written to disk.`,
      mensajeArchivo: (nombre: string) => `“${nombre}” has unsaved changes.\nIf you close it, they are lost.`,
      cancelar: 'Cancel'
    },
    cierre: {
      aria: 'Closing Tessera',
      actualizando: 'Updating Tessera',
      cerrando: 'Closing Tessera',
      reabre: 'Tessera will reopen on its own when it finishes.',
      deteniendo: 'Stopping Docker containers…'
    }
  }
)
