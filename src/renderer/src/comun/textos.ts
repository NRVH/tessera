// =============================================================================
// Textos de los componentes comunes en español e inglés: diálogos, buscador, avisos, notificaciones
// y el límite de errores. Los lleva cada componente con `tx...()` al usarlos, nunca en el nivel
// superior del módulo. Depende de `shared/i18n`.
// =============================================================================

import { crearTextos } from '../../../shared/i18n.ts'

export const txComun = crearTextos(
  {
    errorInterfaz: 'la interfaz',
    errorTotal: 'Algo se rompió en la interfaz',
    errorEn: (zona: string) => `Error en ${zona}`,
    recargarInterfaz: 'Recargar la interfaz',
    reintentar: 'Reintentar',
    trabajoASalvo: 'Tu trabajo en disco está a salvo. ',
    alRecargar: 'Al recargar se restaura la sesión.',
    aceptar: 'Aceptar',
    cancelar: 'Cancelar',
    crear: 'Crear',
    regexInvalido: 'Regex inválido',
    sinResultados: 'Sin resultados',
    coincidencias: (n: number) => `${n} coincidencias`,
    anterior: 'Anterior (Shift+Enter)',
    coincidenciaAnterior: 'Coincidencia anterior',
    siguiente: 'Siguiente (Enter)',
    coincidenciaSiguiente: 'Coincidencia siguiente',
    cerrarEsc: 'Cerrar (Esc)',
    cerrarBuscador: 'Cerrar buscador',
    buscarEnTerminal: 'Buscar en la terminal',
    buscar: 'Buscar',
    mayusculas: 'Distinguir mayúsculas y minúsculas',
    palabraCompleta: 'Palabra completa',
    expresionRegular: 'Expresión regular',
    notificaciones: 'Notificaciones',
    descartarNotificacion: 'Descartar notificación',
    descartar: 'Descartar',
    detalleTecnico: 'Detalle técnico',
    menuEditor: {
      irADefinicion: 'Ir a la definición',
      verReferencias: 'Ver referencias',
      renombrarSimbolo: 'Cambiar el nombre del símbolo',
      cambiarOcurrencias: 'Cambiar todas las apariciones',
      formatear: 'Dar formato al documento',
      cortar: 'Cortar',
      copiar: 'Copiar',
      pegar: 'Pegar',
      seleccionarTodo: 'Seleccionar todo'
    }
  },
  {
    errorInterfaz: 'the interface',
    errorTotal: 'Something broke in the interface',
    errorEn: (zona: string) => `Error in ${zona}`,
    recargarInterfaz: 'Reload the interface',
    reintentar: 'Retry',
    trabajoASalvo: 'Your work on disk is safe. ',
    alRecargar: 'Reloading restores the session.',
    aceptar: 'OK',
    cancelar: 'Cancel',
    crear: 'Create',
    regexInvalido: 'Invalid regex',
    sinResultados: 'No results',
    coincidencias: (n: number) => `${n} match${n === 1 ? '' : 'es'}`,
    anterior: 'Previous (Shift+Enter)',
    coincidenciaAnterior: 'Previous match',
    siguiente: 'Next (Enter)',
    coincidenciaSiguiente: 'Next match',
    cerrarEsc: 'Close (Esc)',
    cerrarBuscador: 'Close search',
    buscarEnTerminal: 'Search in the terminal',
    buscar: 'Search',
    mayusculas: 'Match case',
    palabraCompleta: 'Whole word',
    expresionRegular: 'Regular expression',
    notificaciones: 'Notifications',
    descartarNotificacion: 'Dismiss notification',
    descartar: 'Dismiss',
    detalleTecnico: 'Technical details',
    menuEditor: {
      irADefinicion: 'Go to definition',
      verReferencias: 'Go to references',
      renombrarSimbolo: 'Rename symbol',
      cambiarOcurrencias: 'Change all occurrences',
      formatear: 'Format document',
      cortar: 'Cut',
      copiar: 'Copy',
      pegar: 'Paste',
      seleccionarTodo: 'Select all'
    }
  }
)
