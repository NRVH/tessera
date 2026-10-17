// =============================================================================
// Textos que la rejilla de tabla y la consola SQL entregan al usuario desde el main: por qué una tabla no
// se edita, los fallos de «Enviar», los problemas de un filtro o de un fragmento WHERE/ORDER BY, los
// parámetros de la consola y las etiquetas del plan de MySQL. Se leen al producirse el mensaje.
// Depende de shared/i18n.ts.
// =============================================================================

import { crearTextos } from '../../../shared/i18n.ts'

/**
 * Las razones por las que no se edita, en español: quien las COMPARA con la respuesta del explorador
 * (`MOTIVO_*` en `edicionRejillaIdentidad.ts`) usa estas; la interfaz las lee con `txIdentidad()`.
 */
export const ES_IDENTIDAD = {
  soloLectura: 'La conexión es de solo lectura: la rejilla no puede escribir en ella.',
  tablaInterna: 'Es una tabla interna del motor (la mantiene él, no el usuario): la rejilla no la edita.',
  rowidTapado:
    'La tabla no tiene clave primaria y una columna suya se llama como su dirección de fila (rowid): no hay forma fiable de encontrar cada fila.',
  sinClavePg:
    'La tabla no tiene clave primaria ni una UNIQUE con todas sus columnas NOT NULL: no hay forma fiable de encontrar cada fila.',
  vista: 'Es una vista: la rejilla solo edita tablas.',
  vistaMaterializada: 'Es una vista materializada: la rejilla solo edita tablas.',
  tablaForanea: 'Es una tabla foránea (de otro servidor): la rejilla solo edita tablas locales.',
  tablaVirtual: 'Es una tabla virtual (la sirve un módulo, no guarda filas propias): la rejilla solo edita tablas ordinarias.',
  noEsTabla: 'Este objeto no es una tabla: la rejilla solo edita tablas.',
  remoto: 'Es un objeto remoto (@dblink): la rejilla no escribe a través de un enlace.',
  sistema: 'Es una tabla del sistema: la rejilla no la edita.',
  temporal: 'Es una tabla temporal: sus filas son de cada sesión, y «Enviar» escribe desde otra.',
  externa: 'Es una tabla externa (sus filas están en un archivo del servidor): no se edita.'
}

export const txIdentidad = crearTextos(ES_IDENTIDAD, {
  soloLectura: 'The connection is read-only: the grid cannot write to it.',
  tablaInterna: 'This is an internal engine table (the engine maintains it, not the user): the grid does not edit it.',
  rowidTapado:
    'The table has no primary key and one of its columns is named like its row address (rowid): there is no reliable way to find each row.',
  sinClavePg:
    'The table has no primary key or UNIQUE constraint with all its columns NOT NULL: there is no reliable way to find each row.',
  vista: 'This is a view: the grid only edits tables.',
  vistaMaterializada: 'This is a materialized view: the grid only edits tables.',
  tablaForanea: 'This is a foreign table (on another server): the grid only edits local tables.',
  tablaVirtual: 'This is a virtual table (served by a module, it keeps no rows of its own): the grid only edits ordinary tables.',
  noEsTabla: 'This object is not a table: the grid only edits tables.',
  remoto: 'This is a remote object (@dblink): the grid does not write through a link.',
  sistema: 'This is a system table: the grid does not edit it.',
  temporal: 'This is a temporary table: its rows belong to each session, and “Submit” writes from another one.',
  externa: 'This is an external table (its rows are in a file on the server): it cannot be edited.'
})

export const txEnvio = crearTextos(
  {
    filaNuevaChoca:
      'La fila nueva choca con otra que una transacción sin confirmar tiene bloqueada (quizá una consola tuya).',
    filaBloqueada: 'La fila está bloqueada por otra transacción (quizá una consola tuya con cambios sin confirmar).',
    bloqueada: (que: string) => `${que} No se aplicó nada: confirma o revierte esa transacción y vuelve a enviar.`,
    sinCulpable: (desde: number, hasta: number, espera: boolean) =>
      `(No se pudo saber cuál de los cambios ${desde} a ${hasta}${espera ? ': al buscarla, la otra transacción ya la había soltado' : ''}.)`,
    noSeConstruyo: 'No se pudo construir la sentencia.',
    commitServidor: (detalle: string) => `Falló al confirmar (COMMIT): ${detalle}\nNo se aplicó nada.`,
    commitIncierto: (detalle: string) =>
      `No se sabe si el COMMIT llegó a aplicarse: ${detalle}\n` +
      'Vuelve a cargar la tabla y comprueba los datos antes de repetir el envío.',
    filaNoInsertada: 'La fila nueva no se insertó (0 filas). No se aplicó nada.',
    filaCambio:
      'La fila ya no está o cambió desde que se leyó (el cambio no tocó ninguna). No se aplicó nada: vuelve a cargar la tabla.',
    tocoVarias: (filas: number) =>
      `El cambio habría tocado ${filas} filas en vez de una (la clave no identifica una sola fila). No se aplicó nada.`
  },
  {
    filaNuevaChoca:
      'The new row conflicts with one locked by an uncommitted transaction (maybe one of your consoles).',
    filaBloqueada: 'The row is locked by another transaction (maybe one of your consoles with uncommitted changes).',
    bloqueada: (que: string) => `${que} Nothing was applied: commit or roll back that transaction and submit again.`,
    sinCulpable: (desde: number, hasta: number, espera: boolean) =>
      `(Could not tell which of changes ${desde} to ${hasta} it was${espera ? ': by the time it was looked for, the other transaction had already released it' : ''}.)`,
    noSeConstruyo: 'Could not build the statement.',
    commitServidor: (detalle: string) => `The commit (COMMIT) failed: ${detalle}\nNothing was applied.`,
    commitIncierto: (detalle: string) =>
      `It is not known whether the COMMIT was applied: ${detalle}\n` +
      'Reload the table and check the data before submitting again.',
    filaNoInsertada: 'The new row was not inserted (0 rows). Nothing was applied.',
    filaCambio:
      'The row is gone or changed since it was read (the change touched none). Nothing was applied: reload the table.',
    tocoVarias: (filas: number) =>
      `The change would have touched ${filas} rows instead of one (the key does not identify a single row). Nothing was applied.`
  }
)

export const txValorCelda = crearTextos(
  {
    sinPk: 'La tabla no tiene clave primaria: no hay forma fiable de volver a encontrar la fila.',
    claveNoCuadra: 'La clave de la fila no cuadra con la clave primaria de la tabla: vuelve a abrirla.',
    faltaObjeto: 'Falta el objeto o la columna.',
    claveNula: 'La clave de la fila tiene un valor nulo.',
    claveBinaria: 'La clave binaria no llegó como hexadecimal.'
  },
  {
    sinPk: 'The table has no primary key: there is no reliable way to find the row again.',
    claveNoCuadra: 'The row key does not match the table’s primary key: open it again.',
    faltaObjeto: 'The object or the column is missing.',
    claveNula: 'The row key has a null value.',
    claveBinaria: 'The binary key did not arrive as hexadecimal.'
  }
)

export const txSqlRejilla = crearTextos(
  {
    ningunMotorRowid: 'Ningún motor lee las filas por su ROWID.',
    rowidSoloEn: (donde: string) => `ROWID solo existe en ${donde}.`,
    sinBases: (etiqueta: string) => `${etiqueta} no tiene bases dentro de una conexión: el objeto no puede llevar base.`,
    faltaEsquema: 'Falta el esquema del objeto.',
    faltaEsquemaONombre: 'Falta el esquema o el nombre del objeto.',
    noEsEsquema: (publico: string) => `${publico} no es un esquema: hay que resolver el sinónimo antes de consultarlo.`,
    bindsNoCasan: 'Los parámetros del filtro de este motor no casan con su forma de paginado.',
    remotoSinRowid: 'Un objeto remoto (@dblink) no se lee con su ROWID.',
    formaNoVale: (forma: string, d: string) => `La forma de paginado «${forma}» no vale para ${d}.`,
    sinClave: 'Sin clave ni ORDER BY, esta tabla no se puede paginar.',
    aliasRowid: 'Alias de rowid no válido.',
    claveSinColumnas: 'La clave del paginado no tiene columnas.',
    paginadoN: 'Paginado inválido: `n` debe ser un entero ≥ 1.',
    claveUltimaFila: 'La clave de la última fila no cuadra con la del paginado.',
    paginadoNDesde: 'Paginado inválido: `n` debe ser un entero ≥ 1 y `desde` un entero ≥ 0.',
    comentarioSinCerrar: (et: string) => `Comentario sin cerrar en ${et}.`,
    identSinCerrar: (et: string) => `Identificador entre comillas sin cerrar en ${et}.`,
    cadenaDolarSinCerrar: (delim: string, et: string) => `Cadena con ${delim} sin cerrar en ${et}.`,
    cadenaSinCerrar: (et: string) => `Cadena sin cerrar en ${et}.`,
    textoSinCerrar: (et: string) => `Texto sin cerrar en ${et}.`,
    sinPuntoYComa: (et: string) => `${et} no admite «;»: aquí va una sola expresión.`,
    sobraParen: (et: string) => `Sobra un «)» en ${et}: no tiene su «(».`,
    faltaCerrarParen: (et: string) => `Falta cerrar un «(» en ${et}.`,
    sinVariables: (et: string, valor: string) => `${et} no admite variables de enlace (${valor}): escribe el valor.`,
    sinPsql: (et: string) => `${et} no admite comandos de psql.`,
    sinForUpdate: 'ORDER BY no admite FOR UPDATE ni FOR SHARE: la rejilla solo lee.',
    whereConGuiado: 'El filtro guiado y el WHERE libre no van juntos: se aplica uno u otro.',
    orderConCabecera: 'El orden de la cabecera y el ORDER BY libre no van juntos: se aplica uno u otro.'
  },
  {
    ningunMotorRowid: 'No engine reads rows by their ROWID.',
    rowidSoloEn: (donde: string) => `ROWID only exists in ${donde}.`,
    sinBases: (etiqueta: string) => `${etiqueta} has no databases inside a connection: the object cannot carry a database.`,
    faltaEsquema: 'The object’s schema is missing.',
    faltaEsquemaONombre: 'The object’s schema or name is missing.',
    noEsEsquema: (publico: string) => `${publico} is not a schema: the synonym must be resolved before querying it.`,
    bindsNoCasan: 'The filter parameters of this engine do not match its pagination form.',
    remotoSinRowid: 'A remote object (@dblink) cannot be read by its ROWID.',
    formaNoVale: (forma: string, d: string) => `The pagination form “${forma}” does not apply to ${d}.`,
    sinClave: 'Without a key or an ORDER BY, this table cannot be paginated.',
    aliasRowid: 'Invalid rowid alias.',
    claveSinColumnas: 'The pagination key has no columns.',
    paginadoN: 'Invalid pagination: `n` must be an integer ≥ 1.',
    claveUltimaFila: 'The key of the last row does not match the pagination key.',
    paginadoNDesde: 'Invalid pagination: `n` must be an integer ≥ 1 and `desde` an integer ≥ 0.',
    comentarioSinCerrar: (et: string) => `Unclosed comment in ${et}.`,
    identSinCerrar: (et: string) => `Unclosed quoted identifier in ${et}.`,
    cadenaDolarSinCerrar: (delim: string, et: string) => `Unclosed string with ${delim} in ${et}.`,
    cadenaSinCerrar: (et: string) => `Unclosed string in ${et}.`,
    textoSinCerrar: (et: string) => `Unclosed text in ${et}.`,
    sinPuntoYComa: (et: string) => `${et} does not accept “;”: it takes a single expression.`,
    sobraParen: (et: string) => `Extra “)” in ${et}: it has no matching “(”.`,
    faltaCerrarParen: (et: string) => `Missing closing “)” for a “(” in ${et}.`,
    sinVariables: (et: string, valor: string) => `${et} does not accept bind variables (${valor}): type the value.`,
    sinPsql: (et: string) => `${et} does not accept psql commands.`,
    sinForUpdate: 'ORDER BY does not accept FOR UPDATE or FOR SHARE: the grid only reads.',
    whereConGuiado: 'The guided filter and the free WHERE cannot be combined: one or the other applies.',
    orderConCabecera: 'The header sort and the free ORDER BY cannot be combined: one or the other applies.'
  }
)

export const txFiltro = crearTextos(
  {
    operadorNoVale: 'Ese operador no vale para esta columna.',
    noEsFecha: 'No es una fecha (AAAA-MM-DD, con hora opcional HH:MM[:SS]).',
    escribeBool: 'Escribe true o false.',
    noEsNumero: 'No es un número (usa punto decimal: 12.5).',
    cifrasMax: (n: number) => `Este motor compara números de hasta ${n} cifras.`,
    cifrasEscalaMax: (n: number, escala: number) =>
      `Este motor compara números de hasta ${n} cifras, ${escala} de ellas decimales.`
  },
  {
    operadorNoVale: 'That operator does not apply to this column.',
    noEsFecha: 'Not a date (YYYY-MM-DD, with optional time HH:MM[:SS]).',
    escribeBool: 'Type true or false.',
    noEsNumero: 'Not a number (use a decimal point: 12.5).',
    cifrasMax: (n: number) => `This engine compares numbers of up to ${n} digits.`,
    cifrasEscalaMax: (n: number, escala: number) =>
      `This engine compares numbers of up to ${n} digits, ${escala} of them decimals.`
  }
)

export const txBinds = crearTextos(
  {
    formaInesperada: 'Los parámetros no tienen la forma esperada.',
    demasiados: (max: number) => `Demasiados parámetros (más de ${max}).`,
    nombreNoValido: 'Un parámetro tiene un nombre no válido.',
    valorTexto: (k: string) => `El valor de «${k}» tiene que ser texto o NULL.`,
    muyGrandes: 'Los valores de los parámetros son demasiado grandes.',
    falta: (p: string) => `Falta el valor del parámetro ${p}.`,
    faltan: (ps: string) => `Faltan los valores de los parámetros ${ps}.`,
    posicionMax: (motor: string, max: number, texto: string | null) =>
      `${motor} admite como mucho $${max}: ${texto ?? 'el parámetro'} no puede enviarse.`,
    faltaTexto: 'Falta el texto de la sentencia para enlazar sus parámetros.',
    indiceMax: (max: number) => `Como mucho ?${max}: la sentencia usa un número de parámetro más alto.`,
    choque: (motor: string, numero: string, nombre: string) =>
      `En ${motor}, ${numero} y ${nombre} son el MISMO parámetro: se usó el valor de ${nombre} y el de ${numero} no.`,
    pareja: (numero: string, nombre: string) => `${numero} y ${nombre}`,
    choques: (motor: string, parejas: string) =>
      `En ${motor}, cada pareja es el MISMO parámetro (${parejas}): se usaron los valores de los nombres y los de los números no.`,
    esquemaPerdido: (esquema: string, actual: string | null) =>
      `El esquema ${esquema} de esta consola ya no existe: vuelve al de la conexión${actual ? ` (${actual})` : ''}.`
  },
  {
    formaInesperada: 'The parameters do not have the expected shape.',
    demasiados: (max: number) => `Too many parameters (more than ${max}).`,
    nombreNoValido: 'A parameter has an invalid name.',
    valorTexto: (k: string) => `The value of “${k}” must be text or NULL.`,
    muyGrandes: 'The parameter values are too large.',
    falta: (p: string) => `The value of parameter ${p} is missing.`,
    faltan: (ps: string) => `The values of parameters ${ps} are missing.`,
    posicionMax: (motor: string, max: number, texto: string | null) =>
      `${motor} accepts at most $${max}: ${texto ?? 'the parameter'} cannot be sent.`,
    faltaTexto: 'The statement text is missing, so its parameters cannot be bound.',
    indiceMax: (max: number) => `At most ?${max}: the statement uses a higher parameter number.`,
    choque: (motor: string, numero: string, nombre: string) =>
      `In ${motor}, ${numero} and ${nombre} are the SAME parameter: the value of ${nombre} was used and the one of ${numero} was not.`,
    pareja: (numero: string, nombre: string) => `${numero} and ${nombre}`,
    choques: (motor: string, parejas: string) =>
      `In ${motor}, each pair is the SAME parameter (${parejas}): the values of the names were used and those of the numbers were not.`,
    esquemaPerdido: (esquema: string, actual: string | null) =>
      `The schema ${esquema} of this console no longer exists: falling back to the connection’s${actual ? ` (${actual})` : ''}.`
  }
)

export const txPlanMysql = crearTextos(
  {
    operaciones: {
      query_block: 'Consulta',
      table: 'Tabla',
      ordering_operation: 'Ordenación',
      grouping_operation: 'Agrupación',
      duplicates_removal: 'Quitar duplicados',
      union_result: 'Unión',
      windowing: 'Ventanas',
      read_sorted_file: 'Leer ordenado',
      filesort: 'Ordenación en archivo',
      temporary_table: 'Tabla temporal',
      materialized_from_subquery: 'Subconsulta materializada'
    } as Record<string, string>,
    acceso: {
      ALL: 'recorrido completo',
      index: 'recorrido del índice',
      range: 'rango del índice',
      ref: 'por índice',
      eq_ref: 'por índice único',
      const: 'una fila (constante)',
      system: 'una fila (sistema)',
      ref_or_null: 'por índice o NULL',
      index_merge: 'mezcla de índices',
      fulltext: 'texto completo',
      unique_subquery: 'subconsulta única',
      index_subquery: 'subconsulta por índice'
    } as Record<string, string>,
    clave: (v: string) => `clave: ${v}`,
    posibles: (v: string) => `posibles: ${v}`,
    ref: (v: string) => `ref: ${v}`,
    condicion: (v: string) => `condición: ${v}`,
    soloIndice: 'solo el índice',
    tablaTemporal: 'tabla temporal',
    ordenacionArchivo: 'ordenación en archivo',
    sinPlanSqlServer: 'El servidor no devolvió un plan de SHOWPLAN_XML.',
    sinPlan: 'El servidor no devolvió un plan.'
  },
  {
    operaciones: {
      query_block: 'Query',
      table: 'Table',
      ordering_operation: 'Sorting',
      grouping_operation: 'Grouping',
      duplicates_removal: 'Remove duplicates',
      union_result: 'Union',
      windowing: 'Windows',
      read_sorted_file: 'Read sorted',
      filesort: 'File sort',
      temporary_table: 'Temporary table',
      materialized_from_subquery: 'Materialized subquery'
    } as Record<string, string>,
    acceso: {
      ALL: 'full scan',
      index: 'index scan',
      range: 'index range',
      ref: 'by index',
      eq_ref: 'by unique index',
      const: 'one row (constant)',
      system: 'one row (system)',
      ref_or_null: 'by index or NULL',
      index_merge: 'index merge',
      fulltext: 'full text',
      unique_subquery: 'unique subquery',
      index_subquery: 'index subquery'
    } as Record<string, string>,
    clave: (v: string) => `key: ${v}`,
    posibles: (v: string) => `possible: ${v}`,
    ref: (v: string) => `ref: ${v}`,
    condicion: (v: string) => `condition: ${v}`,
    soloIndice: 'index only',
    tablaTemporal: 'temporary table',
    ordenacionArchivo: 'file sort',
    sinPlanSqlServer: 'The server did not return a SHOWPLAN_XML plan.',
    sinPlan: 'The server did not return a plan.'
  }
)
