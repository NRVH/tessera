// =============================================================================
// Textos del código por motor del explorador (avisos y errores que llegan a la interfaz) en
// español e inglés. Se leen al producirse, nunca al cargar el módulo. Los títulos de las partes de
// un DDL (`DbFuente`) no están aquí: son un tipo literal compartido con la interfaz.
// Depende solo de `shared/i18n.ts`.
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

const es = {
  parteCatalogo: 'Catálogo',
  parteSesion: 'Sesión',
  pendiente: (parte: string, motor: string, que: string) => `${parte} de ${motor}: «${que}» todavía no está implementado.`,
  noDisponible: (que: string, motor: string) => `Catálogo: «${que}» no existe en ${motor}`,
  queNivelBases: 'nivel «Bases»',
  queSinonimos: 'sinónimos',
  queTipoPorNombre: 'tipo de objeto por nombre',
  queFuenteDe: (tipo: string) => `fuente de ${tipo}`,
  queDdlDe: (tipo: string) => `DDL de ${tipo}`,
  queUniqueNotNull: 'UNIQUE NOT NULL como identidad de la fila',
  unirNombres: (nombres: readonly string[]) =>
    nombres.length <= 1 ? nombres.join('') : nombres.slice(0, -1).join(', ') + ' y ' + nombres[nombres.length - 1],
  ningunMotor: (que: string) => `Ningún motor tiene ${que}.`,
  soloMotores: (motores: string, cuantos: number, que: string) =>
    `Solo ${motores} ${cuantos === 1 ? 'tiene' : 'tienen'} ${que}.`,
  sinFuente: 'No hay fuente visible: el objeto no existe o faltan privilegios para verlo.',
  sinDdlObjeto: 'No hay DDL visible: el objeto no existe o faltan privilegios para verlo.',
  sinDdlRutina: 'No hay DDL visible: la rutina no existe o faltan privilegios para verla.',
  sinDdlEnBase: 'No hay DDL visible: el objeto no existe en la base.',
  sinDdlOracle: (motivo: string) =>
    `No hay DDL visible: el objeto no existe o faltan privilegios para verlo (DBMS_METADATA: ${motivo}).`,
  ddlRecortado: (tope: number) => `El DDL pasa de ${tope} caracteres: se enseña recortado.`,
  ddlVacio: 'devolvió un DDL vacío',
  sinCuerpo:
    'No se ve el cuerpo: o el paquete no tiene, o ALL_SOURCE solo lo enseña a su dueño y a quien tenga privilegios de depuración.',
  codigoOfuscado: 'Código ofuscado (wrapped): Oracle no guarda el fuente legible.',
  sinDefinicionSqlServer:
    'SQL Server no enseña la definición: el objeto está cifrado (WITH ENCRYPTION) o te falta el permiso VIEW DEFINITION.',
  motivoOra31603: 'ORA-31603: sin SELECT_CATALOG_ROLE no enseña objetos de otro esquema, y nunca los que mantiene Oracle',
  motivoSinXdk: 'DBMS_METADATA no funciona en este servidor (su instalación no tiene el XDK)',
  motivoOra01031: 'ORA-01031: privilegios insuficientes',
  motivoSinAcceso: 'DBMS_METADATA no es accesible para este usuario',
  motivoNoEnAllObjects: 'el objeto no aparece en ALL_OBJECTS',
  repliegueTabla: 'DDL reconstruido desde el catálogo, sin restricciones CHECK, sin ON DELETE ni almacenamiento',
  repliegueFuente: 'DDL reconstruido desde su fuente',
  repliegueCatalogo: 'DDL reconstruido desde el catálogo',
  repliegue: (motivo: string, que: string) => `DBMS_METADATA no devolvió el DDL (${motivo}): ${que}.`,
  sinTiposDeclarados: (motor: string) => `Los tipos declarados solo se leen de Oracle: los de ${motor} ya llegan exactos.`,
  columnaGeneradaServidor: 'Columna generada: la calcula el servidor.',
  binaria: 'Binaria: no se edita como texto.',
  bitConsola: "BIT: se edita desde la consola (b'0101').",
  espacial: 'Espacial: se edita desde la consola (ST_GeomFromText).',
  columnaGenerada: (motor: string) => `Columna generada: la calcula ${motor}.`,
  columnaVirtualOracle: 'Columna virtual: la calcula Oracle.',
  identidadOracle: 'Identidad GENERATED ALWAYS: la numera Oracle.',
  longNoEscribible: 'LONG: no se puede escribir desde la rejilla.',
  bfile: 'BFILE: apunta a un archivo del servidor.',
  tipoNoEscribible: (tipo: string) => `${tipo || 'Este tipo'}: no se escribe como texto desde la rejilla.`,
  identidadAlways: (motor: string) => `Identidad GENERATED ALWAYS: la numera ${motor}.`,
  columnaOcultaVirtual: 'Columna oculta de una tabla virtual: no se escribe.',
  rowversion: 'rowversion: la escribe SQL Server.',
  tipoClr: 'Tipo CLR: no se edita como texto.',
  sqlVariant: 'sql_variant: un texto cambiaría su tipo guardado.',
  identidadSqlServer: 'Identidad (IDENTITY): la numera SQL Server.',
  columnaCalculadaSqlServer: 'Columna calculada: la calcula SQL Server.',
  periodoTemporal: 'Periodo de una tabla temporal: lo escribe SQL Server.',
  planSinFilas: 'El servidor no devolvió el plan.',
  planSqliteSinFilas: 'SQLite no devolvió el plan.',
  planGrande: 'El plan es demasiado grande para enseñarlo.',
  planNoEntendido: 'El servidor devolvió un plan que Tessera no entiende.',
  sinPermisoShowplan: 'No tienes permiso para ver planes en esta base (SHOWPLAN): pídeselo a quien administre el servidor.',
  baseNoAplicadaMysql: (esquema: string) =>
    `No se puede usar la base ${esquema} en esta conexión: no existe o no tienes permiso sobre ella.`,
  esquemaNoExiste: (esquema: string) => `El esquema ${esquema} no existe en esta conexión.`,
  esquemaNoAplicadoPostgres: (esquema: string) =>
    `No se puede usar el esquema ${esquema} en esta conexión: no existe o no tienes permiso de uso (USAGE) sobre él.`,
  esquemaSqlite: (esquema: string) =>
    `SQLite no tiene el esquema ${esquema}: cada archivo es una base con un único esquema, main.`,
  baseNoAplicadaSqlServer: (esquema: string) =>
    `No se puede usar la base ${esquema} en esta conexión: no existe o no tienes acceso a ella.`,
  uniqueNotNullSqlite: 'Catálogo: «UNIQUE NOT NULL» no se usa en SQLite: una fila sin PK se identifica por su rowid.'
}

const en = {
  parteCatalogo: 'Catalog',
  parteSesion: 'Session',
  pendiente: (parte: string, motor: string, que: string) => `${parte} of ${motor}: “${que}” is not implemented yet.`,
  noDisponible: (que: string, motor: string) => `Catalog: “${que}” does not exist in ${motor}`,
  queNivelBases: 'the “Databases” level',
  queSinonimos: 'synonyms',
  queTipoPorNombre: 'object type by name',
  queFuenteDe: (tipo: string) => `source of ${tipo}`,
  queDdlDe: (tipo: string) => `DDL of ${tipo}`,
  queUniqueNotNull: 'UNIQUE NOT NULL as the row identity',
  unirNombres: (nombres: readonly string[]) =>
    nombres.length <= 1 ? nombres.join('') : nombres.slice(0, -1).join(', ') + ' and ' + nombres[nombres.length - 1],
  ningunMotor: (que: string) => `No engine has ${que}.`,
  soloMotores: (motores: string, cuantos: number, que: string) => `Only ${motores} ${cuantos === 1 ? 'has' : 'have'} ${que}.`,
  sinFuente: 'No source is visible: the object does not exist or you lack the privileges to see it.',
  sinDdlObjeto: 'No DDL is visible: the object does not exist or you lack the privileges to see it.',
  sinDdlRutina: 'No DDL is visible: the routine does not exist or you lack the privileges to see it.',
  sinDdlEnBase: 'No DDL is visible: the object does not exist in the database.',
  sinDdlOracle: (motivo: string) =>
    `No DDL is visible: the object does not exist or you lack the privileges to see it (DBMS_METADATA: ${motivo}).`,
  ddlRecortado: (tope: number) => `The DDL exceeds ${tope} characters: it is shown truncated.`,
  ddlVacio: 'returned an empty DDL',
  sinCuerpo:
    'The body is not visible: either the package has none, or ALL_SOURCE only shows it to its owner and to anyone with debug privileges.',
  codigoOfuscado: 'Obfuscated code (wrapped): Oracle does not keep readable source.',
  sinDefinicionSqlServer:
    'SQL Server does not show the definition: the object is encrypted (WITH ENCRYPTION) or you lack the VIEW DEFINITION permission.',
  motivoOra31603: 'ORA-31603: without SELECT_CATALOG_ROLE it does not show objects of another schema, nor ever those maintained by Oracle',
  motivoSinXdk: 'DBMS_METADATA does not work on this server (its installation lacks the XDK)',
  motivoOra01031: 'ORA-01031: insufficient privileges',
  motivoSinAcceso: 'DBMS_METADATA is not accessible to this user',
  motivoNoEnAllObjects: 'the object does not appear in ALL_OBJECTS',
  repliegueTabla: 'DDL rebuilt from the catalog, without CHECK constraints, ON DELETE or storage',
  repliegueFuente: 'DDL rebuilt from its source',
  repliegueCatalogo: 'DDL rebuilt from the catalog',
  repliegue: (motivo: string, que: string) => `DBMS_METADATA did not return the DDL (${motivo}): ${que}.`,
  sinTiposDeclarados: (motor: string) => `Declared types are only read from Oracle: those of ${motor} already arrive exact.`,
  columnaGeneradaServidor: 'Generated column: the server computes it.',
  binaria: 'Binary: not edited as text.',
  bitConsola: "BIT: edit it from the console (b'0101').",
  espacial: 'Spatial: edit it from the console (ST_GeomFromText).',
  columnaGenerada: (motor: string) => `Generated column: ${motor} computes it.`,
  columnaVirtualOracle: 'Virtual column: Oracle computes it.',
  identidadOracle: 'GENERATED ALWAYS identity: Oracle numbers it.',
  longNoEscribible: 'LONG: cannot be written from the grid.',
  bfile: 'BFILE: points to a file on the server.',
  tipoNoEscribible: (tipo: string) => `${tipo || 'This type'}: cannot be written as text from the grid.`,
  identidadAlways: (motor: string) => `GENERATED ALWAYS identity: ${motor} numbers it.`,
  columnaOcultaVirtual: 'Hidden column of a virtual table: it is not written.',
  rowversion: 'rowversion: SQL Server writes it.',
  tipoClr: 'CLR type: not edited as text.',
  sqlVariant: 'sql_variant: a text value would change its stored type.',
  identidadSqlServer: 'Identity (IDENTITY): SQL Server numbers it.',
  columnaCalculadaSqlServer: 'Computed column: SQL Server computes it.',
  periodoTemporal: 'Period of a temporal table: SQL Server writes it.',
  planSinFilas: 'The server did not return the plan.',
  planSqliteSinFilas: 'SQLite did not return the plan.',
  planGrande: 'The plan is too large to show.',
  planNoEntendido: 'The server returned a plan that Tessera does not understand.',
  sinPermisoShowplan: 'You do not have permission to view plans on this database (SHOWPLAN): ask whoever administers the server.',
  baseNoAplicadaMysql: (esquema: string) =>
    `Cannot use database ${esquema} on this connection: it does not exist or you do not have permission on it.`,
  esquemaNoExiste: (esquema: string) => `Schema ${esquema} does not exist on this connection.`,
  esquemaNoAplicadoPostgres: (esquema: string) =>
    `Cannot use schema ${esquema} on this connection: it does not exist or you do not have usage permission (USAGE) on it.`,
  esquemaSqlite: (esquema: string) =>
    `SQLite does not have schema ${esquema}: each file is a database with a single schema, main.`,
  baseNoAplicadaSqlServer: (esquema: string) =>
    `Cannot use database ${esquema} on this connection: it does not exist or you do not have access to it.`,
  uniqueNotNullSqlite: 'Catalog: “UNIQUE NOT NULL” is not used in SQLite: a row without a PK is identified by its rowid.'
}

export const txMotores = crearTextos(es, en)
