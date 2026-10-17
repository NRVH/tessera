// =============================================================================
// Textos del explorador de documentos y de claves que llegan al usuario desde el main: el error interno,
// los avisos de un filtro de documentos, el aviso de la exportación CSV y el fallo de guardar un archivo.
// Se leen al producirse el mensaje. Depende de shared/i18n.ts.
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txDocumentos = crearTextos(
  {
    errorInterno: 'Error interno del explorador de bases de datos.',
    campoNulo: 'El nombre del campo lleva un carácter nulo.',
    rutaNoValida: (nombre: string) =>
      `«${nombre}» no es una ruta de campo válida (un punto al principio, al final o dos seguidos).`,
    campoDolar: (nombre: string) => `El campo «${nombre}» empieza por $: el servidor lo leería como un operador.`,
    operadorNoVale: 'Ese operador no vale para esta columna.',
    numeroLargo: (max: number) =>
      `El número pasa de ${max} cifras significativas: el servidor no lo guarda exacto.`,
    ordenNumerico: (campos: string) =>
      `Un campo de nombre numérico (${campos}) solo puede ordenar el primero (y, si hay varios, de menor a mayor): ` +
      'Tessera todavía no sabe ponerlo detrás de otro.',
    camposOmitidos: (n: number) =>
      `${n} ${n === 1 ? 'documento tenía' : 'documentos tenían'} campos que no están en las columnas del CSV (las de los primeros documentos): esos campos no se escribieron.`
  },
  {
    errorInterno: 'Internal error in the database explorer.',
    campoNulo: 'The field name contains a null character.',
    rutaNoValida: (nombre: string) =>
      `“${nombre}” is not a valid field path (a dot at the start, at the end, or two in a row).`,
    campoDolar: (nombre: string) => `The field “${nombre}” starts with $: the server would read it as an operator.`,
    operadorNoVale: 'That operator does not apply to this column.',
    numeroLargo: (max: number) =>
      `The number has more than ${max} significant digits: the server would not store it exactly.`,
    ordenNumerico: (campos: string) =>
      `A field with a numeric name (${campos}) can only be sorted first (and, if there are several, in ascending order): ` +
      'Tessera cannot yet put it after another one.',
    camposOmitidos: (n: number) =>
      `${n} ${n === 1 ? 'document had' : 'documents had'} fields that are not in the CSV columns (those of the first documents): those fields were not written.`
  }
)
