// =============================================================================
// Textos del filtro guiado (`BarraFiltroGuiado`): conectores, etiquetas de los campos, pistas de valor
// por categoría y avisos. Español e inglés con las mismas claves; se leen al usarse, nunca al cargar el
// módulo. Sin JSX ni DOM.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'

export const txFiltro = crearTextos(
  {
    pista: {
      texto: 'texto',
      textoLargo: 'texto',
      numero: 'número (12.5)',
      fecha: 'AAAA-MM-DD [HH:MM]',
      booleano: '',
      id: 'ObjectId o texto',
      otro: ''
    },
    conector: { donde: 'donde', y: 'y', o: 'o' },
    union: { todas: 'todas', cualquiera: 'cualquiera' },
    columna: 'Columna',
    operador: 'Operador',
    noEsta: (columna: string) => `${columna} (no está)`,
    condicionN: (n: number) => `Condición ${n}`,
    desde: 'Desde',
    valor: 'Valor',
    hasta: 'Hasta',
    y: 'y',
    quitarN: (n: number) => `Quitar la condición ${n}`,
    quitar: 'Quitar la condición',
    sinColumnas: 'Todavía no hay columnas que elegir',
    anadir: 'Añadir una condición',
    masCondicion: '+ Condición',
    sinFiltro: 'Sin filtro',
    comoSeUnen: 'Cómo se unen las condiciones',
    tituloUnion: 'Filas que cumplan todas las condiciones (Y) o cualquiera de ellas (O)',
    aplicarTitulo: 'Aplicar el filtro (Intro)',
    aplicar: 'Aplicar',
    filtro: 'Filtro',
    elige: 'elegir…',
    verdadero: 'verdadero',
    falso: 'falso'
  },
  {
    pista: {
      texto: 'text',
      textoLargo: 'text',
      numero: 'number (12.5)',
      fecha: 'YYYY-MM-DD [HH:MM]',
      booleano: '',
      id: 'ObjectId or text',
      otro: ''
    },
    conector: { donde: 'where', y: 'and', o: 'or' },
    union: { todas: 'all', cualquiera: 'any' },
    columna: 'Column',
    operador: 'Operator',
    noEsta: (columna: string) => `${columna} (missing)`,
    condicionN: (n: number) => `Condition ${n}`,
    desde: 'From',
    valor: 'Value',
    hasta: 'To',
    y: 'and',
    quitarN: (n: number) => `Remove condition ${n}`,
    quitar: 'Remove condition',
    sinColumnas: 'No columns to choose from yet',
    anadir: 'Add a condition',
    masCondicion: '+ Condition',
    sinFiltro: 'No filter',
    comoSeUnen: 'How the conditions are combined',
    tituloUnion: 'Rows that match all conditions (AND) or any of them (OR)',
    aplicarTitulo: 'Apply filter (Enter)',
    aplicar: 'Apply',
    filtro: 'Filter',
    elige: 'choose…',
    verdadero: 'true',
    falso: 'false'
  }
)
