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
    recortada: 'El valor llegó recortado (más de 64 KiB): al editarlo aquí se guardaría solo la parte visible.',
    borrada: 'La fila está marcada para borrar: revierta el borrado para poder editarla.',
    noSeEditaDesdeRejilla: 'No se puede editar desde la rejilla.',
    faltaRowid: 'No se recibió el ROWID necesario para localizar cada fila: vuelva a abrir la tabla.',
    sinClave: 'La tabla no tiene una clave con la que localizar la fila.',
    faltaColumnaClave: (k: string) => `Falta la columna ${k} de la clave en el resultado: vuelva a abrir la tabla.`,
    // --- el envío ---
    filaYaNoCargada: 'La fila ya no está cargada: vuelva a abrir la tabla.',
    tablaNoSeEdita: 'Esta tabla no se puede editar.',
    columnaClaveNoEsta: (k: string) => `La columna ${k} de la clave no está en el resultado.`,
    claveRecortada: (k: string) => `El valor de ${k} (clave) llegó recortado: no sirve para localizar la fila.`,
    filaCambio: 'La fila cambió o ya no existe: no se encontró ninguna fila con la clave leída.',
    tocabaVarias: (filas: number) => `El cambio afectaba a ${filas} filas en lugar de una: la clave no identifica una sola fila.`,
    // --- el diálogo tras un fallo ---
    tituloIncierto: 'No se puede saber si se aplicó: refresque la tabla antes de reenviar',
    tituloDetenido: 'Envío detenido: se revirtió todo',
    tituloEnCommit: 'Falló al confirmar: no se aplicó ninguno',
    tituloFallo: (n: number, total: number) => `Falló el cambio ${n} de ${total}: no se aplicó ninguno`,
    inciertoTitulo: 'No se sabe si el último envío se aplicó',
    inciertoTexto:
      'La conexión se interrumpió mientras se enviaba el COMMIT. Refresque la tabla para comprobarlo antes de reenviar: si los cambios se aplicaron, reenviarlos duplicaría las inserciones.',
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
    sinClavePrimaria: 'La tabla no tiene clave primaria: no hay forma fiable de volver a localizar la fila.',
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
    binaria: 'Binary column: its value cannot be edited as text in the grid.',
    rowid: 'Tessera internal column (ROWID).',
    recortada: 'The value was truncated (over 64 KiB). Editing it here would save only the visible part.',
    borrada: 'The row is marked for deletion. Undo the deletion to edit it.',
    noSeEditaDesdeRejilla: 'This cannot be edited in the grid.',
    faltaRowid: 'The ROWID needed to find each row is missing. Reopen the table.',
    sinClave: 'The table has no key to identify the row.',
    faltaColumnaClave: (k: string) => `Key column ${k} is missing from the result: reopen the table.`,
    filaYaNoCargada: 'The row is no longer loaded: reopen the table.',
    tablaNoSeEdita: 'This table cannot be edited.',
    columnaClaveNoEsta: (k: string) => `Key column ${k} is not in the result.`,
    claveRecortada: (k: string) => `The value of ${k} (key) was truncated, so it cannot be used to find the row.`,
    filaCambio: 'The row changed or no longer exists: no row matches the key that was read.',
    tocabaVarias: (filas: number) => `The change affected ${filas} rows instead of one: the key does not identify a single row.`,
    tituloIncierto: 'Unknown whether the changes were applied: refresh the table before submitting again',
    tituloDetenido: 'Submit stopped: all changes were rolled back',
    tituloEnCommit: 'Commit failed: nothing was applied',
    tituloFallo: (n: number, total: number) => `Change ${n} of ${total} failed: nothing was applied`,
    inciertoTitulo: 'Unknown whether the last submit was applied',
    inciertoTexto:
      'The connection was lost while the COMMIT was in progress. Refresh the table to check before submitting again: if it was applied, submitting again would duplicate the inserts.',
    paginaNoJson: 'The page of rows is not valid JSON.',
    paginaNoLista: 'The page of rows is not a list.',
    filaNoLista: (f: number) => `Row ${f} is not a list.`,
    filaCeldas: (f: number, celdas: number, columnas: number) =>
      `Row ${f} has ${celdas} cells and the result has ${columnas} columns.`,
    celdaTipo: (f: number, c: number, tipo: string) =>
      `The cell (row ${f}, column ${c}) is ${tipo}; expected text, boolean, or NULL.`,
    paginaEmpieza: (desde: number, cargadas: number) => `The page starts at row ${desde}, but ${cargadas} rows were loaded.`,
    caracter: 'character',
    caracteres: 'characters',
    byte: 'byte',
    bytes: 'bytes',
    seMuestran: (mostrado: string, total: string, unidad: string) => `Showing ${mostrado} of ${total} ${unidad}`,
    sinClavePrimaria: 'The table has no primary key: there is no reliable way to find the row again.',
    filaYaNoCargadaVisor: 'The row is no longer loaded.',
    columnaPkNoEsta: (pk: string) => `Primary key column ${pk} is not in the result.`,
    pkRecortada: (pk: string) => `The value of ${pk} (primary key) was truncated.`
  }
)
