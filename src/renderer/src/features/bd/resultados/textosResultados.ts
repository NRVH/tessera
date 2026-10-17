// =============================================================================
// Textos de los resultados de la consola (`TiraResultados`, `DbResultadosRejilla`, `planResultado`,
// `valorResultado`): menú de la pestaña, razones por las que no se puede pedir el valor entero de una
// celda y cabecera del plan copiado. Español e inglés con las mismas claves; se leen al usarse, nunca
// al cargar el módulo. Sin JSX ni DOM: lo cargan las pruebas con `node`.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'

export const txResultados = crearTextos(
  {
    // --- tira ---
    resultadoN: (k: number) => `Resultado ${k}`,
    desfijar: 'Desfijar',
    fijar: 'Fijar',
    cerrar: 'Cerrar',
    cerrarLasDemas: 'Cerrar las demás sin fijar',
    cerrarTodos: 'Cerrar todos los resultados',
    fijada: 'Fijada',
    cerrarEsteResultado: 'Cerrar este resultado',
    cerrarNombre: (titulo: string) => `Cerrar ${titulo}`,
    tiraAria: 'Salida y resultados',
    salidaTitulo: 'Salida: lo que pasó en cada ejecución',
    salida: 'Salida',
    // --- rejilla del resultado ---
    celdaYaNoCargada: 'La celda ya no está cargada',
    noSePudoLeerPk: (error: string) => `No se pudo leer la clave primaria de la tabla: ${error}`,
    resultadoAria: (titulo: string) => `Resultado ${titulo}`,
    // --- valor completo ---
    variasTablas: 'El resultado no sale de una sola tabla: no se puede volver a buscar la fila para leer el valor entero',
    dblink: 'La tabla está en otra base (@dblink): no se puede volver a buscar la fila',
    sinEsquema: 'No se sabe en qué esquema está la tabla',
    cargandoPk: 'Leyendo la clave primaria de la tabla…',
    sinPk: 'La tabla no tiene clave primaria: no se puede volver a buscar la fila',
    faltaColumna: (columna: string) => `El resultado no trae la columna ${columna} de la clave primaria`,
    faltanColumnas: (lista: string) => `El resultado no trae las columnas ${lista} de la clave primaria`,
    unirFaltan: (nombres: readonly string[]) => nombres.slice(0, -1).join(', ') + ' y ' + nombres[nombres.length - 1],
    // --- plan copiado ---
    columnasPlan: ['Operación', 'Objeto', 'Coste', 'Filas', 'Bytes', 'Detalle'] as readonly string[]
  },
  {
    resultadoN: (k) => `Result ${k}`,
    desfijar: 'Unpin',
    fijar: 'Pin',
    cerrar: 'Close',
    cerrarLasDemas: 'Close the others that are not pinned',
    cerrarTodos: 'Close all results',
    fijada: 'Pinned',
    cerrarEsteResultado: 'Close this result',
    cerrarNombre: (titulo: string) => `Close ${titulo}`,
    tiraAria: 'Output and results',
    salidaTitulo: 'Output: what happened in each execution',
    salida: 'Output',
    celdaYaNoCargada: 'The cell is no longer loaded',
    noSePudoLeerPk: (error: string) => `Could not read the table’s primary key: ${error}`,
    resultadoAria: (titulo: string) => `Result ${titulo}`,
    variasTablas: 'The result does not come from a single table: the row cannot be looked up again to read the whole value',
    dblink: 'The table is in another database (@dblink): the row cannot be looked up again',
    sinEsquema: 'It is not known which schema the table is in',
    cargandoPk: 'Reading the table’s primary key…',
    sinPk: 'The table has no primary key: the row cannot be looked up again',
    faltaColumna: (columna: string) => `The result does not include the primary key column ${columna}`,
    faltanColumnas: (lista: string) => `The result does not include the primary key columns ${lista}`,
    unirFaltan: (nombres: readonly string[]) => nombres.slice(0, -1).join(', ') + ' and ' + nombres[nombres.length - 1],
    columnasPlan: ['Operation', 'Object', 'Cost', 'Rows', 'Bytes', 'Details'] as readonly string[]
  }
)
