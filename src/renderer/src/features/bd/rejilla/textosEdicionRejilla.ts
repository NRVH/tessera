// =============================================================================
// Textos de la edición de la rejilla y de las piezas que validan lo que llega: por qué una
// columna o una celda no se edita, el diálogo de un envío fallido, los errores de la clave
// con la que se encuentra cada fila, las páginas mal formadas y el visor del valor entero.
// Sin JSX; los leen `cambiosRejilla*.ts`, `celdasRejilla.ts` y `visorValor.ts`.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'

export const txEdicionRejilla = crearTextos(
  {
    // --- cuántos cambios ---
    unCambio: '1 cambio',
    nCambios: (n: number) => `${n} cambios`,
    unaActualizacion: '1 actualización',
    nActualizaciones: (n: number) => `${n} actualizaciones`,
    unaInsercion: '1 inserción',
    nInserciones: (n: number) => `${n} inserciones`,
    unBorrado: '1 borrado',
    nBorrados: (n: number) => `${n} borrados`,
    y: ' y ',
    // --- qué se puede editar ---
    binaria: 'Columna binaria: su valor no se escribe como texto desde la rejilla.',
    rowid: 'Columna interna de Tessera (ROWID).',
    recortada: 'El valor llegó recortado (más de 64 KiB): editarlo aquí guardaría solo el trozo que se ve.',
    borrada: 'La fila está marcada para borrar: revierte el borrado para editarla.',
    noSeEditaDesdeRejilla: 'No se puede editar desde la rejilla.',
    faltaRowid: 'No llegó el ROWID con el que encontrar cada fila: vuelve a abrir la tabla.',
    sinClave: 'La tabla no tiene clave con la que encontrar la fila.',
    faltaColumnaClave: (k: string) => `Falta la columna ${k} de la clave en el resultado: vuelve a abrir la tabla.`,
    // --- el envío ---
    filaYaNoCargada: 'La fila ya no está cargada: vuelve a abrir la tabla.',
    tablaNoSeEdita: 'Esta tabla no se puede editar.',
    columnaClaveNoEsta: (k: string) => `La columna ${k} de la clave no está en el resultado.`,
    claveRecortada: (k: string) => `El valor de ${k} (clave) llegó recortado: no sirve para encontrar la fila.`,
    filaCambio: 'La fila cambió o ya no existe: el cambio no encontró ninguna fila con la clave que se leyó.',
    tocabaVarias: (filas: number) => `El cambio tocaba ${filas} filas en vez de una: la clave no identifica una sola fila.`,
    // --- el diálogo tras un fallo ---
    tituloIncierto: 'No se sabe si se aplicó: refresca la tabla antes de reenviar',
    tituloDetenido: 'Envío detenido: se revirtió todo',
    tituloEnCommit: 'Falló al confirmar: no se aplicó ninguno',
    tituloFallo: (n: number, total: number) => `Falló el cambio ${n} de ${total}: no se aplicó ninguno`,
    inciertoTitulo: 'El último envío quedó sin saber si se aplicó',
    inciertoTexto:
      'Se cortó la conexión con el COMMIT en camino. Refresca la tabla para comprobarlo antes de reenviar: si se aplicó, reenviar duplicaría las inserciones.',
    // --- páginas que llegan ---
    paginaNoJson: 'La página de filas no es JSON válido.',
    paginaNoLista: 'La página de filas no es una lista.',
    filaNoLista: (f: number) => `La fila ${f} no es una lista.`,
    filaCeldas: (f: number, celdas: number, columnas: number) =>
      `La fila ${f} tiene ${celdas} celdas y el resultado ${columnas} columnas.`,
    celdaTipo: (f: number, c: number, tipo: string) =>
      `La celda (fila ${f}, columna ${c}) llegó como ${tipo}; se esperaba texto, booleano o NULL.`,
    paginaEmpieza: (desde: number, cargadas: number) => `La página empieza en la fila ${desde} y había ${cargadas} cargadas.`,
    // --- visor ---
    caracter: 'carácter',
    caracteres: 'caracteres',
    byte: 'byte',
    bytes: 'bytes',
    seMuestran: (mostrado: string, total: string, unidad: string) => `Se muestran ${mostrado} de ${total} ${unidad}`,
    sinClavePrimaria: 'La tabla no tiene clave primaria: no hay forma fiable de volver a encontrar la fila.',
    filaYaNoCargadaVisor: 'La fila ya no está cargada.',
    columnaPkNoEsta: (pk: string) => `La columna ${pk} de la clave primaria no está en el resultado.`,
    pkRecortada: (pk: string) => `El valor de ${pk} (clave primaria) llegó recortado.`
  },
  {
    unCambio: '1 change',
    nCambios: (n: number) => `${n} changes`,
    unaActualizacion: '1 update',
    nActualizaciones: (n: number) => `${n} updates`,
    unaInsercion: '1 insert',
    nInserciones: (n: number) => `${n} inserts`,
    unBorrado: '1 delete',
    nBorrados: (n: number) => `${n} deletes`,
    y: ' and ',
    binaria: 'Binary column: its value cannot be written as text from the grid.',
    rowid: 'Tessera internal column (ROWID).',
    recortada: 'The value arrived truncated (over 64 KiB): editing it here would save only the part you can see.',
    borrada: 'The row is marked for deletion: revert the deletion to edit it.',
    noSeEditaDesdeRejilla: 'It cannot be edited from the grid.',
    faltaRowid: 'The ROWID used to find each row did not arrive: reopen the table.',
    sinClave: 'The table has no key to find the row with.',
    faltaColumnaClave: (k: string) => `Key column ${k} is missing from the result: reopen the table.`,
    filaYaNoCargada: 'The row is no longer loaded: reopen the table.',
    tablaNoSeEdita: 'This table cannot be edited.',
    columnaClaveNoEsta: (k: string) => `Key column ${k} is not in the result.`,
    claveRecortada: (k: string) => `The value of ${k} (key) arrived truncated: it cannot be used to find the row.`,
    filaCambio: 'The row changed or no longer exists: the change found no row with the key that was read.',
    tocabaVarias: (filas: number) => `The change affected ${filas} rows instead of one: the key does not identify a single row.`,
    tituloIncierto: 'It is unknown whether it was applied: refresh the table before submitting again',
    tituloDetenido: 'Submit stopped: everything was rolled back',
    tituloEnCommit: 'Commit failed: nothing was applied',
    tituloFallo: (n: number, total: number) => `Change ${n} of ${total} failed: nothing was applied`,
    inciertoTitulo: 'It is unknown whether the last submit was applied',
    inciertoTexto:
      'The connection was lost while the COMMIT was on its way. Refresh the table to check before submitting again: if it was applied, submitting again would duplicate the inserts.',
    paginaNoJson: 'The page of rows is not valid JSON.',
    paginaNoLista: 'The page of rows is not a list.',
    filaNoLista: (f: number) => `Row ${f} is not a list.`,
    filaCeldas: (f: number, celdas: number, columnas: number) =>
      `Row ${f} has ${celdas} cells and the result has ${columnas} columns.`,
    celdaTipo: (f: number, c: number, tipo: string) =>
      `The cell (row ${f}, column ${c}) arrived as ${tipo}; text, boolean or NULL was expected.`,
    paginaEmpieza: (desde: number, cargadas: number) => `The page starts at row ${desde} and ${cargadas} were loaded.`,
    caracter: 'character',
    caracteres: 'characters',
    byte: 'byte',
    bytes: 'bytes',
    seMuestran: (mostrado: string, total: string, unidad: string) => `Showing ${mostrado} of ${total} ${unidad}`,
    sinClavePrimaria: 'The table has no primary key: there is no reliable way to find the row again.',
    filaYaNoCargadaVisor: 'The row is no longer loaded.',
    columnaPkNoEsta: (pk: string) => `Primary key column ${pk} is not in the result.`,
    pkRecortada: (pk: string) => `The value of ${pk} (primary key) arrived truncated.`
  }
)
