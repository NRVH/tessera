// =============================================================================
// Reglas de cada motor SQL como TABLA de banderas (`REGLAS`): léxico, divisor, clasificador, parámetros
// y avisos son uno solo y consultan la fila del dialecto, nunca su nombre. Sumar un motor: su id en
// `DialectoSql`, su fila aquí y en `RESERVADAS` y `PALABRAS_CLAVE`. Lo que depende del motor y no del
// lenguaje vive en su descriptor (`shared/motores/`). Neutral, sin DOM ni `process`, ES2020.
// Decisiones: docs/decisiones/bd/sql-dialectos-como-tabla.md
// =============================================================================

import type { DbMotor } from '../db-ipc.ts'
import { descriptorSql } from '../motores/index.ts'
import { nunca } from '../nunca.ts'
import { deDialecto, type DialectoSql, type GramaticaLocal, type PragmasDialecto } from './dialectosSqlBase.ts'

export { deDialecto }
export type { DialectoSql, GramaticaLocal, PragmasDialecto }

/**
 * Cómo se escriben y se entienden los parámetros del usuario:
 * - 'dosPuntosNombre': `:x`, `:1`, `:"x"`, por nombre; sin comillas no distinguen caja (la clave va
 *   en mayúsculas), en el orden de su primera aparición. (Oracle)
 * - 'dolarNumero': `$1`, `$2`…, por número (sin ceros a la izquierda), ordenados. (PG)
 * - 'sqliteMixto': `?`, `?NNN`, `:x`, `@x` y `$x`, mezclables. La clave es el NOMBRE sin prefijo
 *   (`:x`, `@x` y `$x` son la clave `x`) o el NÚMERO en decimal; todos OBLIGATORIOS y con su valor
 *   como TEXTO (es lo que casa con la afinidad de la columna). (SQLite)
 * - 'ninguno': el dialecto NO tiene parámetros del usuario que pedir; en T-SQL `@x` es una VARIABLE
 *   del lote. `extraer` devuelve siempre la lista vacía. (SQL Server)
 */
export type EstiloParametros = 'dosPuntosNombre' | 'dolarNumero' | 'sqliteMixto' | 'ninguno'

export interface ReglasDialecto {
  /** Cadenas q-quote de Oracle: `q'[..]'`, `Q'{..}'`, `nq'<..>'`, `q'!..!'`. */
  cadenaQ: boolean
  /** Cadenas con escapes de barra `E'it\'s'` (PG). */
  cadenaE: boolean
  /** `U&'..'` y `U&".."` (PG). */
  cadenaUnicode: boolean
  /** `B'0101'` y `X'1F'` (PG). */
  cadenaBits: boolean
  /** Dólar-comillas `$$..$$` / `$tag$..$tag$` (PG). */
  cadenaDolar: boolean
  // Los comentarios de bloque anidan (PG). En Oracle el primer cierre de
  // comentario cierra, aunque dentro se hayan abierto otros.
  comentariosAnidados: boolean
  /** `/` sola en su línea termina la sentencia (Oracle / SQL*Plus). */
  barraTermina: boolean
  /** DECLARE/BEGIN/CREATE PROCEDURE… solo terminan en `/` o en el fin (Oracle). */
  bloquesPlsql: boolean
  /** `BEGIN` abre una transacción (PG) en vez de un bloque (Oracle). */
  beginEsTransaccion: boolean
  /**
   * Comandos del cliente de línea que no son SQL y no se envían: los de SQL*Plus, los
   * `\x` de psql, o los `.algo` del CLI `sqlite3` (`.tables`, `.schema`…: un punto al
   * principio de la línea, fuera de una sentencia, hasta el fin de línea).
   */
  comandosCliente: 'sqlplus' | 'psql' | 'sqlite3' | null
  /** Binds `:x` / `:1` (Oracle). En PG `:` es operador (`::`, `a[1:2]`). */
  bindDosPuntos: boolean
  /** Binds posicionales `$1` (PG). */
  bindDolar: boolean
  /** `#` vale dentro de un identificador sin comillas (Oracle: `A#B`). */
  almohadillaEnIdent: boolean
  /**
   * Cómo pliega el motor un identificador sin comillas: a mayúsculas (Oracle), a
   * minúsculas (PG), o NO lo pliega (el nombre se guarda y se enseña como se escribió) pero
   * lo COMPARA sin distinguir caja: 'insensible' solo en ASCII (SQLite: `Ñ` y `ñ` son
   * distintas) e 'insensibleUnicode' en toda letra (SQL Server con su intercalación por
   * defecto, _CI_AS, medido: `[Ñandú]` se encuentra como `[ñANDÚ]`; distingue acentos). En
   * los dos, `Clientes` y `CLIENTES` son la misma tabla, TAMBIÉN entre comillas o
   * corchetes, y la que se enseña es la del catálogo (`claveDeNombre`/`mismoNombre`).
   */
  cajaSinComillas: 'mayus' | 'minus' | 'insensible' | 'insensibleUnicode'
  /** Cuerpos `BEGIN ATOMIC … END` de funciones SQL estándar (PG 14+). */
  cuerpoAtomico: boolean
  /** Hay sentencias que no admiten transacción (VACUUM, …CONCURRENTLY). */
  sentenciasFueraDeTx: boolean
  /**
   * Parámetros de sesión que una conexión de SOLO LECTURA puede cambiar. Son los
   * que no tocan datos ni formatos: esquema actual, zona horaria y tiempos de
   * espera. En minúsculas.
   */
  sesionSoloLectura: readonly string[]
  /**
   * Parámetros de formato que Tessera fija al abrir la sesión y que por tanto se
   * rechazan en cualquier modo: cambian el TEXTO de las celdas (fechas, números,
   * binario) y rompen el orden local, la copia y el hex. En PG entra también
   * `standard_conforming_strings`, que no cambia las celdas sino cómo LEE el
   * servidor una cadena: con `off`, '\' es un escape dentro de '…' y el léxico de
   * Tessera (que lo lee como un carácter más) clasificaría una sentencia distinta
   * de la que corre. En minúsculas.
   */
  formatosFijados: readonly string[]

  // --- Banderas del léxico, el divisor y el clasificador ------------------------------

  /** Números con base `0x1F`, `0o17`, `0b101` (con `_` de separador) (PG 16). */
  numerosConBase: boolean
  /** Sufijo `f`/`d` de un número: `1.5f`, `2d` (BINARY_FLOAT / BINARY_DOUBLE de Oracle). */
  sufijoFlotante: boolean

  // --- …en el clasificador ------------------------------------------------------------

  /** `SELECT … INTO nueva_tabla FROM …` CREA una tabla (PG); en Oracle es PL/SQL. */
  selectIntoCreaTabla: boolean
  /** Un DML con `RETURNING` devuelve filas (PG); en Oracle exige INTO (solo PL/SQL). */
  returningDevuelveFilas: boolean
  /**
   * La forma de EXPLAIN: 'planFor' es `EXPLAIN PLAN [SET …] FOR …`, que no ejecuta ni
   * devuelve el plan (Oracle); 'conOpciones' es `EXPLAIN [(ANALYZE, …)] …`, que lo
   * devuelve y con ANALYZE ejecuta (PG); 'queryPlan' es `EXPLAIN QUERY PLAN …`, que
   * devuelve el plan (id, parent, detail) sin ejecutar, y `EXPLAIN …` a secas, que
   * devuelve el programa de la máquina virtual, tampoco ejecuta y también devuelve filas
   * (SQLite; medido); 'showplan' es que NO hay sentencia EXPLAIN: el plan se pide con
   * `SET SHOWPLAN_XML ON`, que tiene que ir SOLO en su lote (1067 si no) y hace que lo que
   * sigue NO se ejecute (medido: un DELETE bajo SHOWPLAN no borra); son tres viajes que
   * hace la sesión del main, no el texto del usuario (SQL Server).
   */
  explain: 'planFor' | 'conOpciones' | 'queryPlan' | 'showplan'
  /** `ALTER SESSION SET …` es la sentencia de sesión (Oracle). */
  alterSession: boolean
  /** `SET x = …` cambia un parámetro de sesión (PG); en Oracle un SET suelto no es SQL. */
  setDeSesion: boolean
  /**
   * Verbos que tienen clasificación PROPIA en este dialecto; fuera de la lista caen en
   * la genérica (`base(verbo)`). PG: TABLE, SHOW, BEGIN/START/END/ABORT como tx,
   * PREPARE TRANSACTION, RESET, DISCARD y DO. En MAYÚSCULAS.
   */
  verbosDelDialecto: readonly string[]
  /** `ANALYZE` es DDL (Oracle: recoge estadísticas en el diccionario); en PG, mantenimiento. */
  analyzeEsDdl: boolean
  /** `CALL` devuelve filas (PG: los parámetros OUT/INOUT de un procedimiento). */
  callDevuelveFilas: boolean
  /**
   * Qué es `EXEC`/`EXECUTE`: 'rutinaPlsql' es la llamada a un procedimiento de SQL*Plus
   * (Oracle); 'sentenciaPreparada' ejecuta una sentencia preparada, y `EXECUTE` devuelve
   * filas (PG); 'noExiste': no es una sentencia del dialecto y cae en la clasificación
   * genérica, como cualquier palabra que no conoce (SQLite); 'procedimientoTsql':
   * `EXEC[UTE] proc …` llama a un procedimiento y `EXEC[UTE] ('texto')` ejecuta SQL
   * dinámico; los dos pueden devolver VARIOS conjuntos de resultados y escribir, y un
   * procedimiento puede confirmar por dentro: clase de rutina SIEMPRE, y NUNCA en solo
   * lectura (SQL Server).
   */
  ejecutar: 'rutinaPlsql' | 'sentenciaPreparada' | 'noExiste' | 'procedimientoTsql'
  /** `FETCH` de un cursor declarado devuelve filas (PG). */
  fetchDevuelveFilas: boolean
  /** Cómo se escribe, en el motivo de un rechazo en solo lectura, la sentencia de sesión permitida. */
  formaSetSesion: string

  // --- …en los parámetros y en el SQL que se genera ------------------------------------

  estiloParametros: EstiloParametros
  /**
   * Marcador del parámetro posicional n-ésimo en el SQL que GENERA Tessera: `:n` (Oracle),
   * `$n` (PG) o `?n` (SQLite: `?NNN`, que enlaza por número y no por orden de aparición,
   * así que un mismo n puede repetirse; o `@pn` (SQL Server: los parámetros de
   * `sp_executesql`, que el trabajador declara como `@p1 nvarchar(max), …`).
   */
  marcadorPosicional: 'dosPuntos' | 'dolar' | 'interrogacion' | 'arrobaP'
  /** La cadena vacía ES NULL (Oracle). En PG, '' y NULL son distintos. */
  cadenaVaciaEsNull: boolean
  /** Hay `INSERT INTO t DEFAULT VALUES` para una fila nueva sin ningún valor (PG); Oracle no lo tiene. */
  insertDefaultValues: boolean
  /**
   * Tabla de una fila que no es del usuario y que no se sugiere ni se trata como tabla
   * de la sentencia (Oracle: `DUAL`, sin calificar o como `SYS.DUAL`), o null.
   */
  tablaFicticia: { esquema: string; nombre: string } | null

  // --- Banderas de SQLite ---------------------------------------------------------------
  // Oracle y PG las declaran en false/null: su léxico no cambia.

  /** Identificadores entre corchetes `[mi tabla]`, sin escape dentro (SQLite; SQL Server, con `]]`). */
  identCorchetes: boolean
  /** Identificadores entre acentos graves `` `mi tabla` ``, con `` `` `` como escape (SQLite; MySQL). */
  identAcentoGrave: boolean
  /** Parámetros `?` y `?NNN` (SQLite). */
  bindInterrogacion: boolean
  /** Parámetros por nombre `@x` (SQLite; en SQL Server, `@x` es una variable). */
  bindArroba: boolean
  /**
   * Parámetros por nombre `$x`, con `::` y un sufijo `(…)` (`$a::b(c)`) (SQLite). En PG
   * `$1` es `bindDolar` y `$$`/`$tag$` son `cadenaDolar`: no se mezclan.
   */
  bindDolarNombre: boolean
  /**
   * `CREATE [TEMP] TRIGGER … BEGIN … END`: el cuerpo lleva sentencias con `;` que NO
   * terminan la sentencia; termina el `END` que cierra ese BEGIN (el divisor ya cuenta
   * CASE…END dentro, como en `cuerpoAtomico`). Fuera de un CREATE TRIGGER, un BEGIN sigue
   * siendo la transacción (`beginEsTransaccion`). (SQLite)
   */
  triggerBeginEnd: boolean
  /**
   * Números hexadecimales `0x1F` (SQLite; SQL Server, `0x` es un binario), SIN el resto de
   * `numerosConBase` (ni `0o`, ni `0b`, ni `_` de separador). Sin esto, `0x1F` se partiría
   * en el número 0 y el identificador `x1F`.
   */
  hex0x: boolean
  /** Los PRAGMA que solo leen (ver `PragmasDialecto`), o null si el dialecto no tiene PRAGMA. */
  pragmas: PragmasDialecto | null

  // --- Banderas de SQL Server ------------------------------------------------------------
  // Oracle, PG y SQLite las declaran en false/null/[]: su léxico no cambia. Lo medido que las
  // justifica está en `REGLAS.sqlserver`.

  /** Dentro de `[…]` (`identCorchetes`), `]]` es un `]`: `[a]]b;c]` es UN nombre, `a]b;c` (SQL Server). */
  corcheteEscapeDoble: boolean
  /**
   * `N'…'` es UNA cadena (nacional, Unicode), con `''` dentro como en `'…'` (SQL Server). Sin
   * la bandera, `N'x'` se lee como el identificador N seguido de una cadena, que no cambia
   * cómo se divide ni cómo se clasifica, pero sí el color y el autocompletado.
   */
  cadenaNacional: boolean
  /**
   * `#` y `##` al PRINCIPIO de un identificador: tablas temporales locales (`#tmp`) y
   * globales (`##glob`) (SQL Server). La de dentro (`a#b`) es `almohadillaEnIdent`.
   */
  almohadillaInicial: boolean
  /**
   * `@x` es una VARIABLE del lote y `@@x` una función del sistema (`@@TRANCOUNT`): son UN
   * token de tipo identificador (`@a$b#c`, medido), nunca un parámetro (`bindArroba` sigue en
   * false) (SQL Server).
   */
  variablesArroba: boolean
  /** `$12.50` y `-$3` son literales de MONEY (un número), no un identificador (SQL Server). */
  literalDinero: boolean
  /**
   * Los NÚMEROS se cortan como los corta T-SQL, y lo que venga pegado detrás es otro token
   * (SQL Server; medido): `0x` admite CERO dígitos
   * hexadecimales (`0xINSERT t …` es el binario vacío y un INSERT que se ejecuta); el
   * exponente se lleva la `e` y su signo aunque no traigan dígitos (`1EDELETE` es `1E` y un
   * DELETE que borra); el dinero no tiene exponente (`$1EDELETE` es `$1` y un alias) y el `_`
   * no separa dígitos (`1_a` es `1` y el alias `_a`). Sin la bandera, `1EDELETE` salía como
   * `1` y la palabra `EDELETE`, y la guardia de solo lectura no veía el DELETE.
   */
  numerosTsql: boolean
  /**
   * El SEPARADOR DE LOTES del cliente, o null. 'go': una línea con solo `GO` (sin distinguir
   * caja; delante, blancos; detrás, blancos o un comentario `--`) CIERRA el lote y NO se
   * envía: lo reconocen sqlcmd y los editores de SQL Server, no el servidor (medido: `SELECT 1\nGO` enviado
   * al servidor toma GO como ALIAS de columna; por ODBC, error de sintaxis). `GO n` (repetir
   * n veces) NO se admite: el léxico lo marca y el aviso lo dice. Dentro de un comentario de
   * bloque o de una cadena, no es separador (SQL Server).
   */
  separadorLote: 'go' | null
  /**
   * Las construcciones de ALCANCE DE LOTE: una sentencia que EMPIEZA por una de estas
   * secuencias de palabras (en MAYÚSCULAS, separadas por un espacio) llega hasta el siguiente
   * separador de lote o el fin del texto y CONSERVA sus `;` dentro, igual que un bloque PL/SQL
   * llega hasta `/` (SQL Server). Por qué:
   *   - CREATE PROCEDURE/FUNCTION/TRIGGER/VIEW/SCHEMA/RULE/DEFAULT tienen que EMPEZAR su lote
   *     (111 si no) y el cuerpo se come lo que sigue (medido);
   *   - DECLARE, IF, WHILE, BEGIN (bloque o TRY) y GOTO: las variables viven lo que dura el
   *     lote, así que partir por `;` rompería `DECLARE @x int = 1; SELECT @x` (137, medido).
   * BEGIN TRAN / BEGIN TRANSACTION / BEGIN DISTRIBUTED son una TRANSACCIÓN, no un bloque: no
   * entran (lo distingue la segunda palabra). Una etiqueta `x:` también abre alcance de lote
   * (la trata el divisor, no esta lista). Vacía en los demás dialectos.
   */
  hastaSeparadorLote: readonly string[]
  /**
   * Dos sentencias SIN `;` entre ellas son, para el SERVIDOR, dos sentencias que se EJECUTAN
   * JUNTAS (SQL Server; medido: `SELECT 1\nDELETE FROM dbo.t WHERE id=777` borró la fila).
   * En Oracle y PG el servidor las rechaza como UNA sentencia mal escrita, y la regla del
   * divisor («pegadas sin separador son UNA: el servidor da el error») es segura; aquí NO:
   * con la bandera, el CLASIFICADOR mira TODA la unidad (todas sus palabras reservadas de
   * escritura y control, que en T-SQL no pueden ser identificadores sin citar), no solo la
   * primera, y la clase es la MÁS peligrosa encontrada; el aviso «¿falta ;?» dice que se
   * ejecutan juntas. Es la barrera del solo lectura (`clasificadorYEnvoltorio`) y de la
   * confirmación de producción: se equivoca hacia «escritura».
   */
  sinSeparadorSeEjecutanJuntas: boolean
  /**
   * El `;` final de una sentencia se CONSERVA al enviarla (SQL Server: MERGE lo exige,
   * 10713; y un `WITH` o un `THROW` necesitan el `;` de la anterior, 319 y 102). En los demás
   * se quita, como hoy.
   */
  conservaPuntoYComaFinal: boolean
  /**
   * Un DML con cláusula `OUTPUT` (`UPDATE … OUTPUT inserted.*`, `DELETE … OUTPUT deleted.id`)
   * DEVUELVE FILAS, como un RETURNING (`returningDevuelveFilas`), y además escribe (SQL
   * Server). `OUTPUT … INTO @t` no devuelve filas al cliente.
   */
  clausulaOutput: boolean
  /**
   * La GRAMÁTICA del motor que Tessera tiene en local para subrayar los errores de
   * sintaxis mientras se escribe, sin ejecutar nada (`sintaxisSql.ts`), o null si no hay
   * ninguna y la gramática solo la valida el servidor. Solo PostgreSQL: su parser real
   * (libpg_query) existe compilado a WASM; Oracle, SQLite y SQL Server siguen con el léxico.
   */
  gramaticaLocal: GramaticaLocal | null
}

export const REGLAS: Readonly<Record<DialectoSql, ReglasDialecto>> = {
  oracle: {
    cadenaQ: true,
    cadenaE: false,
    cadenaUnicode: false,
    cadenaBits: false,
    cadenaDolar: false,
    comentariosAnidados: false,
    barraTermina: true,
    bloquesPlsql: true,
    beginEsTransaccion: false,
    comandosCliente: 'sqlplus',
    bindDosPuntos: true,
    bindDolar: false,
    almohadillaEnIdent: true,
    cajaSinComillas: 'mayus',
    cuerpoAtomico: false,
    sentenciasFueraDeTx: false,
    sesionSoloLectura: ['current_schema', 'time_zone'],
    // NLS_TERRITORY no está en la lista del plan, pero REDEFINE a la vez
    // NLS_DATE_FORMAT, NLS_TIMESTAMP_FORMAT y NLS_NUMERIC_CHARACTERS: dejarlo pasar
    // sería dejar pasar los cuatro por la puerta de atrás.
    formatosFijados: [
      'nls_date_format',
      'nls_timestamp_format',
      'nls_timestamp_tz_format',
      'nls_numeric_characters',
      'nls_territory'
    ],
    numerosConBase: false,
    sufijoFlotante: true,
    selectIntoCreaTabla: false,
    returningDevuelveFilas: false,
    explain: 'planFor',
    alterSession: true,
    setDeSesion: false,
    verbosDelDialecto: [],
    analyzeEsDdl: true,
    callDevuelveFilas: false,
    ejecutar: 'rutinaPlsql',
    fetchDevuelveFilas: false,
    formaSetSesion: 'ALTER SESSION SET ',
    estiloParametros: 'dosPuntosNombre',
    marcadorPosicional: 'dosPuntos',
    cadenaVaciaEsNull: true,
    insertDefaultValues: false,
    tablaFicticia: { esquema: 'SYS', nombre: 'DUAL' },
    identCorchetes: false,
    identAcentoGrave: false,
    bindInterrogacion: false,
    bindArroba: false,
    bindDolarNombre: false,
    triggerBeginEnd: false,
    hex0x: false,
    pragmas: null,
    corcheteEscapeDoble: false,
    cadenaNacional: false,
    almohadillaInicial: false,
    variablesArroba: false,
    literalDinero: false,
    numerosTsql: false,
    separadorLote: null,
    hastaSeparadorLote: [],
    sinSeparadorSeEjecutanJuntas: false,
    conservaPuntoYComaFinal: false,
    clausulaOutput: false,
    gramaticaLocal: null
  },
  postgres: {
    cadenaQ: false,
    cadenaE: true,
    cadenaUnicode: true,
    cadenaBits: true,
    cadenaDolar: true,
    comentariosAnidados: true,
    barraTermina: false,
    bloquesPlsql: false,
    beginEsTransaccion: true,
    comandosCliente: 'psql',
    bindDosPuntos: false,
    bindDolar: true,
    almohadillaEnIdent: false,
    cajaSinComillas: 'minus',
    cuerpoAtomico: true,
    sentenciasFueraDeTx: true,
    sesionSoloLectura: ['search_path', 'timezone', 'statement_timeout', 'lock_timeout'],
    formatosFijados: ['datestyle', 'intervalstyle', 'bytea_output', 'extra_float_digits', 'standard_conforming_strings'],
    numerosConBase: true,
    sufijoFlotante: false,
    selectIntoCreaTabla: true,
    returningDevuelveFilas: true,
    explain: 'conOpciones',
    alterSession: false,
    setDeSesion: true,
    verbosDelDialecto: ['TABLE', 'SHOW', 'BEGIN', 'START', 'END', 'ABORT', 'PREPARE', 'RESET', 'DISCARD', 'DO'],
    analyzeEsDdl: false,
    callDevuelveFilas: true,
    ejecutar: 'sentenciaPreparada',
    fetchDevuelveFilas: true,
    formaSetSesion: 'SET ',
    estiloParametros: 'dolarNumero',
    marcadorPosicional: 'dolar',
    cadenaVaciaEsNull: false,
    insertDefaultValues: true,
    tablaFicticia: null,
    identCorchetes: false,
    identAcentoGrave: false,
    bindInterrogacion: false,
    bindArroba: false,
    bindDolarNombre: false,
    triggerBeginEnd: false,
    hex0x: false,
    pragmas: null,
    corcheteEscapeDoble: false,
    cadenaNacional: false,
    almohadillaInicial: false,
    variablesArroba: false,
    literalDinero: false,
    numerosTsql: false,
    separadorLote: null,
    hastaSeparadorLote: [],
    sinSeparadorSeEjecutanJuntas: false,
    conservaPuntoYComaFinal: false,
    clausulaOutput: false,
    gramaticaLocal: 'postgres'
  },
  // SQLite 3.53 (el de node:sqlite del Electron de Tessera): cada valor es lo que hace SQLite,
  // no lo que hace otro motor.
  sqlite: {
    cadenaQ: false,
    cadenaE: false,
    cadenaUnicode: false,
    // `X'1F'` es un BLOB en SQLite, pero `B'0101'` no existe: la bandera junta los dos
    // (PG) y dejarla en false solo hace que `X'1F'` se lea como el identificador X y una
    // cadena, que no cambia cómo se divide ni cómo se clasifica.
    cadenaBits: false,
    cadenaDolar: false,
    comentariosAnidados: false,
    barraTermina: false,
    bloquesPlsql: false,
    // `BEGIN [DEFERRED|IMMEDIATE|EXCLUSIVE] [TRANSACTION]` abre una transacción; el BEGIN
    // del cuerpo de un CREATE TRIGGER lo trata `triggerBeginEnd`.
    beginEsTransaccion: true,
    comandosCliente: 'sqlite3',
    // `:x` es un parámetro por nombre (y `:1` también: es el nombre «1»).
    bindDosPuntos: true,
    bindDolar: false,
    almohadillaEnIdent: false,
    cajaSinComillas: 'insensible',
    cuerpoAtomico: false,
    // VACUUM no se puede ejecutar dentro de una transacción.
    sentenciasFueraDeTx: true,
    // No hay sentencia de sesión que se pueda cambiar en solo lectura: la sesión de
    // SQLite son PRAGMA, y en solo lectura solo pasan los de LEER (`pragmas`).
    sesionSoloLectura: [],
    // Tessera no fija ningún formato al abrir: SQLite no tiene NLS ni datestyle, y las
    // celdas las formatea el trabajador (`src/tdb/sqliteComun.cjs`).
    formatosFijados: [],
    numerosConBase: false,
    sufijoFlotante: false,
    selectIntoCreaTabla: false,
    // RETURNING existe desde la 3.35 y devuelve filas.
    returningDevuelveFilas: true,
    explain: 'queryPlan',
    alterSession: false,
    setDeSesion: false,
    // BEGIN/END como transacción (como PG), y PRAGMA, que tiene clasificación propia (lee o
    // escribe según `pragmas`).
    verbosDelDialecto: ['BEGIN', 'END', 'PRAGMA'],
    // ANALYZE escribe `sqlite_stat1`: mantenimiento, como en PG.
    analyzeEsDdl: false,
    callDevuelveFilas: false,
    ejecutar: 'noExiste',
    fetchDevuelveFilas: false,
    formaSetSesion: 'PRAGMA ',
    estiloParametros: 'sqliteMixto',
    marcadorPosicional: 'interrogacion',
    cadenaVaciaEsNull: false,
    insertDefaultValues: true,
    tablaFicticia: null,
    identCorchetes: true,
    identAcentoGrave: true,
    bindInterrogacion: true,
    bindArroba: true,
    bindDolarNombre: true,
    triggerBeginEnd: true,
    hex0x: true,
    // La lista medida (sonda 03): 23 lecturas pasan y 30 escrituras/fugas no. `table_list`,
    // `integrity_check`, `quick_check` y `foreign_key_check` están en las dos: leen con y
    // sin argumento.
    pragmas: {
      soloSinValor: [
        'application_id',
        'auto_vacuum',
        'busy_timeout',
        'cache_size',
        'collation_list',
        'compile_options',
        'data_version',
        'database_list',
        'encoding',
        'foreign_key_check',
        'foreign_keys',
        'freelist_count',
        'function_list',
        'integrity_check',
        'journal_mode',
        'max_page_count',
        'mmap_size',
        'module_list',
        'page_count',
        'page_size',
        'pragma_list',
        'query_only',
        'quick_check',
        'recursive_triggers',
        'schema_version',
        'synchronous',
        'table_list',
        'temp_store',
        'user_version',
        'wal_autocheckpoint'
      ],
      conArgumento: [
        'foreign_key_check',
        'foreign_key_list',
        'index_info',
        'index_list',
        'index_xinfo',
        'integrity_check',
        'quick_check',
        'table_info',
        'table_list',
        'table_xinfo'
      ]
    },
    corcheteEscapeDoble: false,
    cadenaNacional: false,
    almohadillaInicial: false,
    variablesArroba: false,
    literalDinero: false,
    numerosTsql: false,
    separadorLote: null,
    hastaSeparadorLote: [],
    sinSeparadorSeEjecutanJuntas: false,
    conservaPuntoYComaFinal: false,
    clausulaOutput: false,
    gramaticaLocal: null
  },
  // SQL Server 2012+ (T-SQL). Cada valor es lo que hace SQL Server (medido en 2022 con tedious),
  // no lo que hace otro motor.
  sqlserver: {
    cadenaQ: false,
    cadenaE: false,
    cadenaUnicode: false,
    // `0x1F` es un binario (`hex0x`); `B'…'`/`X'…'` no existen.
    cadenaBits: false,
    cadenaDolar: false,
    // Medido: los comentarios de bloque ANIDAN.
    comentariosAnidados: true,
    barraTermina: false,
    bloquesPlsql: false,
    // BEGIN a secas abre un BLOQUE (BEGIN…END, BEGIN TRY): va en `hastaSeparadorLote`. La
    // transacción es BEGIN TRAN[SACTION] / BEGIN DISTRIBUTED TRAN[SACTION] (clase tx), que
    // el clasificador distingue por la segunda palabra.
    beginEsTransaccion: false,
    // GO no es un «comando del cliente» de una línea que se tire: es el separador de lotes
    // (`separadorLote`). Los `:setvar`/`:r` de sqlcmd no se admiten.
    comandosCliente: null,
    bindDosPuntos: false,
    bindDolar: false,
    // `a#b` vale; `#tmp`/`##glob` al principio, `almohadillaInicial`.
    almohadillaEnIdent: true,
    cajaSinComillas: 'insensibleUnicode',
    cuerpoAtomico: false,
    // CREATE/ALTER/DROP DATABASE, BACKUP, RESTORE… no admiten transacción (226, 3021: medido
    // dentro del envoltorio de solo lectura).
    sentenciasFueraDeTx: true,
    // Lo que una conexión de solo lectura puede cambiar de su sesión (primera palabra tras
    // SET, en minúsculas): el tope de espera de bloqueos, el recuento de filas, las
    // estadísticas de E/S y tiempo, la prioridad de interbloqueo y el nivel de aislamiento
    // (SET TRANSACTION ISOLATION LEVEL; leer sin esperar es READ UNCOMMITTED). `USE`, que
    // cambia de base, lo trata el clasificador aparte (también permitido en solo lectura).
    sesionSoloLectura: ['lock_timeout', 'nocount', 'statistics', 'deadlock_priority', 'transaction'],
    // Lo que Tessera fija al abrir y que cambia las celdas o cómo se LEE el texto: TEXTSIZE
    // (el recorte de las celdas lo hace el servidor), IMPLICIT_TRANSACTIONS (es el modo Tx
    // Manual), DATEFORMAT y LANGUAGE (cómo se leen los literales de fecha del DML que genera
    // Tessera, y el idioma de los mensajes), y QUOTED_IDENTIFIER (con OFF, "x" es una CADENA
    // y el léxico de Tessera, que la lee como nombre, clasificaría otra sentencia: el mismo
    // caso que `standard_conforming_strings` en PG).
    formatosFijados: ['textsize', 'implicit_transactions', 'dateformat', 'language', 'quoted_identifier'],
    numerosConBase: false,
    sufijoFlotante: false,
    // `SELECT … INTO nueva FROM …` CREA la tabla (como en PG).
    selectIntoCreaTabla: true,
    // No hay RETURNING; su equivalente es OUTPUT (`clausulaOutput`).
    returningDevuelveFilas: false,
    explain: 'showplan',
    alterSession: false,
    // `SET NOCOUNT ON`, `SET LOCK_TIMEOUT 5000`…: parámetros de sesión.
    setDeSesion: true,
    verbosDelDialecto: ['BEGIN', 'SAVE', 'USE', 'PRINT', 'RAISERROR', 'THROW', 'WAITFOR', 'DBCC', 'KILL', 'BACKUP', 'RESTORE', 'BULK'],
    analyzeEsDdl: false,
    callDevuelveFilas: false,
    ejecutar: 'procedimientoTsql',
    // `FETCH NEXT FROM cursor` devuelve la fila.
    fetchDevuelveFilas: true,
    formaSetSesion: 'SET ',
    estiloParametros: 'ninguno',
    marcadorPosicional: 'arrobaP',
    cadenaVaciaEsNull: false,
    insertDefaultValues: true,
    tablaFicticia: null,
    identCorchetes: true,
    identAcentoGrave: false,
    bindInterrogacion: false,
    bindArroba: false,
    bindDolarNombre: false,
    triggerBeginEnd: false,
    hex0x: true,
    pragmas: null,
    corcheteEscapeDoble: true,
    cadenaNacional: true,
    almohadillaInicial: true,
    variablesArroba: true,
    literalDinero: true,
    numerosTsql: true,
    separadorLote: 'go',
    hastaSeparadorLote: [
      'CREATE PROCEDURE',
      'CREATE PROC',
      'CREATE FUNCTION',
      'CREATE TRIGGER',
      'CREATE VIEW',
      'CREATE SCHEMA',
      'CREATE RULE',
      'CREATE DEFAULT',
      'CREATE OR ALTER PROCEDURE',
      'CREATE OR ALTER PROC',
      'CREATE OR ALTER FUNCTION',
      'CREATE OR ALTER TRIGGER',
      'CREATE OR ALTER VIEW',
      'ALTER PROCEDURE',
      'ALTER PROC',
      'ALTER FUNCTION',
      'ALTER TRIGGER',
      'ALTER VIEW',
      'DECLARE',
      'IF',
      'WHILE',
      'BEGIN',
      'GOTO'
    ],
    sinSeparadorSeEjecutanJuntas: true,
    conservaPuntoYComaFinal: true,
    clausulaOutput: true,
    gramaticaLocal: null
  }
}

/**
 * El dialecto de un motor de conexión: el que dice su descriptor (`sql.dialecto`), que
 * por la invariante de la cabecera es el MISMO id. Sigue existiendo para que el tipo pase
 * de `DbMotor` a `DialectoSql` en un solo sitio (y lance con un motor sin dialecto), no
 * porque dos motores puedan compartir uno: no pueden.
 *
 * Va por `descriptor()` y no por `MOTORES[motor]`: con un motor que no está en el
 * registro (imposible para el tipo, pero no para un valor mal validado), el fallo es el
 * «Motor desconocido: "x".» de siempre y no un TypeError anónimo al leer `.sql`.
 */
export function dialectoDeMotor(motor: DbMotor): DialectoSql {
  // `descriptorSql`: MongoDB y Redis no tienen dialecto, y pedírselo lanza.
  return descriptorSql(motor).sql.dialecto
}

/** Las reglas del dialecto de un motor (`REGLAS[dialectoDeMotor(motor)]`). */
export function reglasDeMotor(motor: DbMotor): ReglasDialecto {
  return REGLAS[dialectoDeMotor(motor)]
}

/** Las reglas de un dialecto, validándolo (ver `deDialecto`). */
export function reglasDe(d: DialectoSql): ReglasDialecto {
  return deDialecto(REGLAS, d)
}

/**
 * El marcador del parámetro posicional `n` (desde 1) en el SQL que genera Tessera:
 * `:1` en Oracle, `$1` en PG. Es el de `dmlRejilla` y `valorCelda`.
 */
export function marcadorPosicional(d: DialectoSql, n: number): string {
  const m = reglasDe(d).marcadorPosicional
  switch (m) {
    case 'dosPuntos':
      return `:${n}`
    case 'dolar':
      return `$${n}`
    case 'interrogacion':
      return `?${n}`
    case 'arrobaP':
      return `@p${n}`
    default:
      return nunca(m, 'marcadorPosicional')
  }
}
