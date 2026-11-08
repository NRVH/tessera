// =============================================================================
// Textos de los componentes comunes en español e inglés: diálogos, buscador, avisos, notificaciones
// y el límite de errores. Los lleva cada componente con `tx...()` al usarlos, nunca en el nivel
// superior del módulo. Depende de `shared/i18n`.
// =============================================================================

import { crearTextos } from '../../../shared/i18n.ts'

export const txComun = crearTextos(
  {
    errorInterfaz: 'la interfaz',
    errorTotal: 'Se produjo un error en la interfaz',
    errorEn: (zona: string) => `Error en ${zona}`,
    recargarInterfaz: 'Refrescar la interfaz',
    reintentar: 'Reintentar',
    trabajoASalvo: 'Su trabajo guardado en disco no se ha perdido. ',
    alRecargar: 'Al refrescar se restaura la sesión.',
    aceptar: 'Aceptar',
    cancelar: 'Cancelar',
    crear: 'Crear',
    regexInvalido: 'Expresión regular no válida',
    sinResultados: 'Sin resultados',
    coincidencias: (n: number) => `${n} ${n === 1 ? 'coincidencia' : 'coincidencias'}`,
    anterior: 'Anterior (Mayús+Intro)',
    coincidenciaAnterior: 'Coincidencia anterior',
    siguiente: 'Siguiente (Intro)',
    coincidenciaSiguiente: 'Coincidencia siguiente',
    cerrarEsc: 'Cerrar (Esc)',
    cerrar: 'Cerrar',
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
    severidad: { peligro: 'Peligro', advertencia: 'Advertencia', info: 'Información' },
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
    recargarInterfaz: 'Refresh interface',
    reintentar: 'Retry',
    trabajoASalvo: 'Your work on disk is safe. ',
    alRecargar: 'Refreshing restores the session.',
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
    cerrar: 'Close',
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
    severidad: { peligro: 'Danger', advertencia: 'Warning', info: 'Information' },
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
