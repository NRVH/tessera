// =============================================================================
// Textos de la aplicación que el main pone delante del usuario: el menú de macOS y el progreso del
// cierre (overlay). Español e inglés juntos; se leen al usarse, nunca en el nivel superior.
// Depende solo de shared/i18n.
// =============================================================================
import { crearTextos } from '../../shared/i18n.ts'

export const txApp = crearTextos(
  {
    menu: {
      ocultar: 'Ocultar Tessera',
      ocultarOtros: 'Ocultar otros',
      mostrarTodo: 'Mostrar todo',
      salir: 'Salir de Tessera',
      edicion: 'Edición',
      deshacer: 'Deshacer',
      rehacer: 'Rehacer',
      cortar: 'Cortar',
      copiar: 'Copiar',
      pegar: 'Pegar',
      seleccionarTodo: 'Seleccionar todo',
      ventana: 'Ventana',
      minimizar: 'Minimizar',
      traerAlFrente: 'Traer todo al frente'
    },
    cierre: {
      dockerNoResponde: 'Docker no responde: sus contenedores se limpiarán al volver a abrir Tessera',
      cerrando: 'Cerrando Tessera…',
      volveraAbrirse: 'Tessera volverá a abrirse sola al terminar.',
      seCerrara: 'Tessera se cerrará; la nueva versión estará lista la próxima vez que la abras.',
      preparando: 'Preparando la actualización…',
      esperandoDocker: 'Esperando a que Docker termine…',
      cancelado: 'Cierre cancelado.'
    }
  },
  {
    menu: {
      ocultar: 'Hide Tessera',
      ocultarOtros: 'Hide others',
      mostrarTodo: 'Show all',
      salir: 'Quit Tessera',
      edicion: 'Edit',
      deshacer: 'Undo',
      rehacer: 'Redo',
      cortar: 'Cut',
      copiar: 'Copy',
      pegar: 'Paste',
      seleccionarTodo: 'Select all',
      ventana: 'Window',
      minimizar: 'Minimize',
      traerAlFrente: 'Bring all to front'
    },
    cierre: {
      dockerNoResponde: 'Docker is not responding: its containers will be cleaned up the next time you open Tessera',
      cerrando: 'Closing Tessera…',
      volveraAbrirse: 'Tessera will reopen by itself when it finishes.',
      seCerrara: 'Tessera will close; the new version will be ready the next time you open it.',
      preparando: 'Preparing the update…',
      esperandoDocker: 'Waiting for Docker to finish…',
      cancelado: 'Closing canceled.'
    }
  }
)
