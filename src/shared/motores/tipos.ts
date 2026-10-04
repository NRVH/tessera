// =============================================================================
// El DESCRIPTOR de un motor: lo que cambia de una base de datos a otra, como datos en un solo sitio
// y como unión discriminada por `familia` (`sql`, `documentos`, `claves`). Con `definir.ts` y el
// registro de `index.ts`, un motor nuevo no compila hasta declarar todas las capacidades.
// Neutral y ES2020: lo importan main, preload, renderer y pruebas; solo `import type`.
// Decisiones: docs/decisiones/bd/registro-motores-descriptor.md
// =============================================================================

import type { DbMotor, DbMotorClaves, DbMotorDocumentos, DbMotorSql, DbTls } from '../db-ipc.ts'
import type { DbTipoObjeto } from '../db-explorador-ipc.ts'
import type { DialectoSql } from '../sql/dialectosSql.ts'

// --- Conexión ------------------------------------------------------------------------

/**
 * Los campos que el main valida y que el formulario puede marcar, en su orden. 'archivo'
 * es el de un motor de ARCHIVO (SQLite): la ruta que guarda el main (`archivo` en disco;
 * el formulario la elige con el diálogo nativo, `DbOrigenArchivo`).
 */
export type CampoConexion =
  | 'alias'
  | 'host'
  | 'port'
  | 'database'
  | 'sid'
  | 'user'
  | 'archivo'
  | 'instancia'
  | 'autenticacion'
  | 'dominio'
  | 'tls'
  | 'srv'
  | 'opcionesUri'

/**
 * Los campos que un motor USA sin exigirlos: los que el
 * formulario enseña para ese motor además de los obligatorios y de los grupos excluyentes,
 * y los ÚNICOS de los opcionales que el main guarda para él (`ConnectionStore`
 * descarta `instancia`, `autenticacion`, `dominio` y `tls` de un motor que no los declara,
 * igual que `descartarAlGuardar` descarta un SID escrito con Oracle elegido).
 *   - 'database': la base, OPCIONAL en SQL Server (el árbol híbrido: sin base fija, un
 *     nivel «Bases»); en Oracle va en su grupo excluyente y en PG es obligatoria.
 *   - 'instancia': instancia con nombre; con ella el puerto no se usa (SQL Browser).
 *   - 'autenticacion': 'sql' | 'ntlm' (`DbAutenticacion`); con 'ntlm', `dominio` pasa a
 *     obligatorio (`pideDominio` de `motores/index.ts`).
 *   - 'dominio', 'tls': ver `DbConnection`.
 *   - 'user': el usuario, OPCIONAL en MongoDB y Redis: los dos se conectan
 *     sin autenticar si el servidor lo permite, y Redis admite la clave SIN usuario (el
 *     `AUTH <clave>` de antes de las ACL, `redis://:clave@…`). En los motores SQL es
 *     obligatorio y va en `obligatorios`.
 *   - 'srv', 'opcionesUri': solo MongoDB: `mongodb+srv://` y el resto de
 *     la URI (ver `DbConnection`). El formulario los rellena también al «pegar URI» (D7).
 * Oracle, PG y SQLite: ninguno (lo de siempre).
 */
export type CampoOpcional = Extract<
  CampoConexion,
  'user' | 'database' | 'instancia' | 'autenticacion' | 'dominio' | 'tls' | 'srv' | 'opcionesUri'
>

/**
 * Los campos que hacen la FORMA de una entrada del registro en disco: sin ellos, con su
 * tipo, esta versión no sabe usarla y la conserva como AJENA (`tieneFormaConocida` del
 * main, `formaConocida` de `tdb`). Son los obligatorios del motor que dicen A DÓNDE se
 * conecta (host y puerto, o el archivo); el usuario y la base no entran (una entrada
 * sin usuario se abre y el servidor dice lo que falta). DERIVADOS de `obligatorios` (`definirMotor`), así que la forma de cada motor no
 * se escribe a mano en ningún sitio: la leen el main, `tdb` (su copia en `motores.cjs`,
 * cruzada por `test-motores-tdb`) y `test-shim`.
 */
export type CampoForma = 'host' | 'port' | 'archivo'

/**
 * Con qué se autentica una conexión: 'usuarioClave' (usuario y contraseña guardada) o
 * 'ninguna' (SQLite: el permiso es el del sistema de archivos). Una unión y no un booleano:
 * SQL Server traerá la autenticación integrada.
 */
export type CredencialesMotor = 'usuarioClave' | 'ninguna'

/** Los campos del DESTINO: lo que cambia de un motor a otro. */
export type CampoDestino = 'host' | 'port' | 'database' | 'sid'

/** Los de texto del destino: los únicos que se descartan (vaciándolos) al guardar. */
export type CampoTextoDestino = Exclude<CampoDestino, 'port'>

/** Lo que `validarDestino` mira: servicio/base y SID YA LIMPIOS (`limpiarDestinoBd`); '' = sin valor. */
export interface DestinoValidable {
  database: string
  sid: string
}

/** Los campos del destino que decide el MOTOR (host, puerto y usuario son reglas comunes). */
export type CampoValidable = keyof DestinoValidable

/** Campos de los que SOLO UNO puede llevar valor (Oracle: Service Name o SID). */
export interface GrupoExcluyenteDestino {
  campos: readonly CampoValidable[]
  /** Y al menos uno tiene que llevarlo: sin ninguno no hay a dónde conectar. */
  alMenosUno: boolean
}

/**
 * Un grupo excluyente tal como lo DECLARA un motor: con los mensajes EXACTOS con los que
 * el main lo rechaza (`validarDestino`, derivado). El renderer ve el grupo sin ellos.
 */
export interface GrupoExcluyenteDeclarado extends GrupoExcluyenteDestino {
  /** El rechazo si `alMenosUno` y ninguno lleva valor. */
  siNinguno: string
  /** El rechazo si lo lleva más de uno. */
  siVarios: string
}

/** Lo mínimo de una conexión para escribir su destino (`DbConnection` lo cumple). */
export interface DestinoConexion {
  /** El motor tal como está escrito (una ajena puede traer uno desconocido). */
  motor: string
  host: string
  port: number
  database?: string | null
  sid?: string | null
  user: string
  /** Motor de archivo: el NOMBRE del archivo (`DbConnection.archivoVisible`), nunca la ruta. */
  archivoVisible?: string | null
  /** Instancia con nombre de SQL Server: el destino es `host\instancia` y no lleva puerto. */
  instancia?: string | null
  /** La autenticación ('ntlm' escribe el usuario como `DOMINIO\usuario`). */
  autenticacion?: string | null
  /** El dominio de la cuenta con 'ntlm'. */
  dominio?: string | null
}

/**
 * Cómo se escribe el destino. Son las CINCO copias que había a mano, con su forma de hoy
 * al byte (las fija `test-motores.mts`):
 *   - 'completo'   `host:puerto/base` · `host:puerto (SID x)` · `host:puerto`
 *                  (bloque de memoria del agente y aviso de arranque);
 *   - 'conUsuario' `usuario@` + 'completo' (tooltip de la conexión en el árbol);
 *   - 'ls'         `host:puerto/base-o-SID` (la columna DESTINO de `tdb ls`, que es CJS
 *                  y lleva su copia en `src/tdb/motores.cjs`, con test de paridad);
 *   - 'breve'      solo el host (el popover de montaje del agente, tras el motor).
 */
export type FormaDestino = 'completo' | 'conUsuario' | 'ls' | 'breve'

export interface CapacidadesConexion {
  /** Lo que el formulario precarga al elegir el motor; null = no tiene puerto (SQLite). */
  puertoPorDefecto: number | null
  /** Los que el main exige por sí solos (los de un grupo excluyente van en el grupo). */
  obligatorios: readonly CampoConexion[]
  /** Los que el motor usa sin exigirlos (ver `CampoOpcional`). Vacía en Oracle, PG y SQLite. */
  opcionales: readonly CampoOpcional[]
  /**
   * El cifrado de una conexión de este motor que no dice nada, si no es
   * `TLS_POR_DEFECTO` (cifrar y verificar, el de SQL Server). MongoDB: sin cifrar (un
   * servidor local no cifra; Atlas llega por `srv`, que lo activa). Solo tiene sentido con
   * 'tls' en `opcionales`. Lo lee `tlsDeConexion` (`motores/index.ts`).
   */
  tlsPorDefecto?: Readonly<DbTls>
  /**
   * DERIVADA (`definirMotor`): los campos de la FORMA en disco, en el orden de
   * `obligatorios` (ver `CampoForma`). Oracle y PG: host y puerto; SQLite: el archivo.
   */
  forma: readonly CampoForma[]
  /** DERIVADA (`definirMotor`): ¿es un motor de ARCHIVO? Es que 'archivo' esté en `obligatorios`. */
  deArchivo: boolean
  /**
   * Extensiones que ofrece el diálogo nativo al elegir o crear el archivo (sin punto, en
   * minúsculas; la primera es la de una base NUEVA). Vacía en los motores de red. Filtran
   * el diálogo y nada más: lo que decide si un archivo es de este motor es su CABECERA.
   */
  extensionesArchivo: readonly string[]
  /** Con qué se autentica (ver `CredencialesMotor`). 'ninguna' = sin usuario ni contraseña. */
  credenciales: CredencialesMotor
  /**
   * ¿Nace de SOLO LECTURA una conexión que se da de alta sin decirlo (la casilla del
   * formulario, «Montar como base de datos»)? Hoy, sí en todos: es el valor de siempre
   * del main (`readonly !== false`), escrito como dato del motor.
   */
  soloLecturaPorDefecto: boolean
  excluyentes: readonly GrupoExcluyenteDestino[]
  /** Lo que NO viaja al main con este motor aunque siga escrito en el borrador. */
  descartarAlGuardar: readonly CampoTextoDestino[]
  /** ¿Necesita clientes de base de datos (el Instant Client de Oracle)? */
  usaClientes: boolean
  /**
   * DERIVADA (`definirMotor`): la regla del destino propia del motor, con su mensaje EXACTO,
   * o null si vale. Sale de `obligatorios` (con `faltaDestino`) y de `excluyentes` (con
   * sus `siNinguno`/`siVarios`), que es con lo que marca el formulario: el main rechaza y
   * el formulario marca con los MISMOS datos. Se llama DESPUÉS de las comunes (host,
   * puerto, usuario), que no dependen del motor.
   */
  validarDestino(v: DestinoValidable): string | null
  /** El destino legible (sin secreto), en la forma pedida (ver `FormaDestino`). */
  destinoLegible(c: DestinoConexion, forma: FormaDestino): string
}

// --- SQL (integración del editor) ------------------------------------------------------

/**
 * `paramTypes` de sql-formatter, tal cual los recibe `formatDialect`. Arrays MUTABLES a
 * propósito: la librería los declara así, y uno `readonly` no se le podría pasar sin copia.
 */
export interface ParametrosFormateador {
  numbered?: Array<'?' | ':' | '$'>
  named?: Array<':' | '@' | '$'>
  quoted?: Array<':' | '@' | '$'>
}

export interface FormateadorMotor {
  /** Nombre del dialecto de sql-formatter (el objeto lo importa el renderer, perezoso). */
  dialecto: 'plsql' | 'postgresql' | 'sqlite' | 'transactsql'
  /** `paramTypes` que se pasan, o null para no pasar la clave (el de la librería). */
  parametros: ParametrosFormateador | null
}

export interface CapacidadesSql<M extends DbMotorSql = DbMotorSql> {
  /**
   * Su fila de `REGLAS` (léxico, divisor, clasificador, parámetros): la de SU MISMO id (la
   * invariante dialecto = motor). El tipo lo exige: con `M = 'postgres'` solo cabe
   * 'postgres', y un motor cuyo id no esté en `DialectoSql` no tiene valor que poner.
   */
  dialecto: Extract<M, DialectoSql>
  /** Id del lenguaje de Monaco del modelo de una CONSOLA. */
  lenguajeConsola: string
  /** Id del lenguaje de Monaco de la pestaña de FUENTE (`plsql` no existe en Monaco). */
  lenguajeFuente: 'sql' | 'pgsql'
  /** Con qué formatea «Formatear» de la consola. */
  formateador: FormateadorMotor
}

// --- Catálogo ------------------------------------------------------------------------

export interface CapacidadesCatalogo {
  /** Carpetas del árbol, en el orden en que se pintan. */
  carpetas: readonly DbTipoObjeto[]
  /**
   * Pseudo-esquema con los sinónimos públicos (Oracle: 'PUBLIC'), o null si el motor no
   * lo tiene. No es un esquema real: no se consulta, solo enseña su carpeta de sinónimos.
   */
  pseudoEsquemaPublico: string | null
  /**
   * Esquema que se ve SIN calificar además del actual (PG: 'public', que va en el
   * `search_path` por defecto), o null.
   */
  esquemaImplicito: string | null
  /** DERIVADA (`definirMotor`): ¿tiene sinónimos? Es que 'sinonimo' esté en `carpetas`. */
  tieneSinonimos: boolean
  /** ¿Tiene enlaces de base de datos (`objeto@enlace`)? */
  tieneDblinks: boolean
  /**
   * ¿Es un esquema del sistema, por su NOMBRE? Es la regla que no pregunta al servidor
   * (la de la rejilla y la de Oracle 11.2, que no tiene `oracle_maintained`).
   */
  esquemaDelSistema(nombre: string): boolean
  /**
   * ¿Hay un nivel «Bases» por encima de los esquemas? Ver `NivelBases`. Se
   * pregunta con `tieneNivelBases(d, conexion)` de `motores/index.ts`, no comparando.
   */
  nivelBases: NivelBases
}

/**
 * El nivel «Bases» del árbol (el árbol
 * HÍBRIDO):
 *   - 'ninguno': una conexión es una base y el árbol empieza en sus esquemas (Oracle, PG,
 *     SQLite: lo de siempre).
 *   - 'sinBaseFija': si la conexión FIJA una base (`database`), el árbol es como el de PG
 *     (esquemas → carpetas) y la sesión trabaja en ella; si la deja VACÍA, el árbol empieza
 *     en un nivel «Bases» con su «N de M» (`DbConnection.bases`, la misma forma que los
 *     esquemas visibles), y el selector de la consola elige la BASE (`USE`), no el esquema:
 *     en SQL Server no se cambia el esquema de una sesión, se cambia de base (SQL Server).
 * Una unión y no un booleano: Azure SQL Database (sin `USE` ni nombres de tres partes) o
 * MySQL (base = esquema) traerán su valor.
 */
export type NivelBases = 'ninguno' | 'sinBaseFija'

// --- Sesión --------------------------------------------------------------------------

/**
 * Cómo se pagina la lectura de una tabla:
 * - `cursor`: SELECT sin paginar; el trabajador lee del cursor vivo (Oracle, `resultSet`).
 * - `rownum`: ROWNUM anidado con `:hasta`/`:desde` (Oracle, la relectura sin cursor).
 * - `limitOffset`: `LIMIT $1 OFFSET $2` (PostgreSQL; en SQLite con sus marcadores).
 * - `keyset`: la página siguiente EMPIEZA DETRÁS de la última clave leída (`WHERE (clave) >
 *   (…) ORDER BY clave LIMIT n`), por el rowid o la PK; sin OFFSET. SQLite: 1 ms frente a
 *   9 s para la página del millón y medio en el archivo real (medido). Solo vale para una
 *   pestaña de TABLA sin ORDER BY del usuario; con uno, `limitOffset`.
 * - `offsetFetch`: `ORDER BY … OFFSET @o ROWS FETCH NEXT @n ROWS ONLY` (SQL Server 2012+).
 *   OFFSET sin ORDER BY es un error en T-SQL: sin orden del usuario ni PK, el orden es
 *   `ORDER BY (SELECT NULL)` (medido: vale) y las páginas pueden repetir o saltarse filas
 *   (`paginasInestablesSinOrden`). Medido: saltar 900 000 filas cuesta 97 ms con OFFSET
 *   frente a 1185 ms re-ejecutando y saltando en el cliente.
 * Vive aquí y no en `sqlRejilla.ts` (que lo re-exporta) porque el descriptor lo necesita.
 */
export type FormaPaginado = 'cursor' | 'rownum' | 'limitOffset' | 'keyset' | 'offsetFetch'

export interface PaginadoMotor {
  /** La primera página de una pestaña de datos, una exportación y la previa del WHERE. */
  rejilla: FormaPaginado
  /** Una página que se RELEE sin lector vivo (volver a pedir filas de una ya leída). */
  relectura: FormaPaginado
  /** Las que `construirConsultaTabla` acepta para este motor. */
  admitidas: readonly FormaPaginado[]
}

/**
 * Cómo se impone el «solo lectura» en la sesión:
 * - 'transaccionSoloLectura': `SET TRANSACTION READ ONLY` antes de cada sentencia; tras un
 *   error hay que revertir para soltarla (Oracle).
 * - 'envoltorioRollback': cada sentencia dentro de `BEGIN READ ONLY … ROLLBACK`; lo que
 *   tenga que sobrevivir (la lista blanca de SET) va FUERA del envoltorio (PG).
 * - 'autorizador': lo impone el propio proceso con el autorizador de SQLite
 *   (`sqlite3_set_authorizer`, perfil de lectura de `src/tdb/sqliteComun.cjs`) sobre una
 *   conexión abierta con `readOnly`; no hay transacción que abrir ni que revertir (SQLite).
 * - 'clasificadorYEnvoltorio': el SERVIDOR NO TIENE candado de solo lectura (medido:
 *   `ApplicationIntent=ReadOnly` en un servidor suelto ACEPTA un INSERT), así que lo impone
 *   TESSERA en dos capas: (1) el CLASIFICADOR compartido mira la sentencia ENTERA (no el
 *   prefijo: `SELECT 1\nDELETE …` sin `;` se ejecuta entero, medido) con lista blanca —solo
 *   una consulta pura o un SET/USE permitido suelto— y NINGÚN EXEC (un COMMIT dentro de un
 *   procedimiento rompería el envoltorio); (2) cada sentencia va dentro de
 *   `BEGIN TRAN; <sentencia>` (en la MISMA línea, para que el número de línea del error no
 *   cambie) `\nIF @@TRANCOUNT>0 ROLLBACK`, más un ROLLBACK de repuesto si la transacción
 *   sigue abierta (un 208 o un Stop la dejan viva, medido). Límite escrito y dicho en el
 *   diálogo: NO deshace secuencias ni IDENTITY, ni lo que salga por servidores vinculados,
 *   xp_ o CLR; la garantía de verdad es un usuario con solo `db_datareader` (SQL Server).
 *   `tdb` aplica lo mismo a los agentes: su guardia por prefijo NO basta aquí.
 * - 'listaBlanca': (MongoDB y Redis) no hay SQL ni transacción que envuelva:
 *   Tessera INTERPRETA la operación (nunca evalúa JavaScript) y deja pasar solo las de
 *   lectura de su lista blanca. MongoDB: `find`, `aggregate` sin `$out`/`$merge` en ninguna
 *   posición, `countDocuments`, `distinct`, `explain` y los de catálogo. Redis: un comando
 *   con la marca `readonly` de `COMMAND INFO` (resuelta por SUBCOMANDO: `CONFIG GET` es
 *   `config|get`) que NO esté en la lista de peligrosos (D5: `KEYS` es `readonly`). Como en
 *   SQL Server, la garantía de verdad es un usuario de solo lectura (rol `read`, ACL
 *   `+@read`), y así lo dicen el diálogo y las instrucciones del agente.
 */
export type CandadoSoloLectura =
  | 'transaccionSoloLectura'
  | 'envoltorioRollback'
  | 'autorizador'
  | 'clasificadorYEnvoltorio'
  | 'listaBlanca'

/**
 * Con qué se identifica una fila de una tabla SIN clave primaria para editarla:
 * - 'rowid': la pseudo-columna ROWID (Oracle), que va oculta en el SELECT de la página.
 * - 'unicaNoNula': una restricción UNIQUE con todas sus columnas NOT NULL (PG); sin ella,
 *   la tabla no se edita.
 *
 * El SQL de cada identidad es de la SESIÓN de cada motor en el main, y el compilador lo
 * exige a todos: la expresión que lee el ROWID (`sqlColumnaRowid`, `ROWIDTOCHAR(ROWID)` en
 * Oracle) y la consulta de la UNIQUE NOT NULL (`sqlUnicaNoNula`, `pg_constraint` en PG).
 *
 * La regla de QUÉ COLUMNAS se comparan con lo leído (concurrencia optimista con 'rowid') es
 * también de cada motor: `comparacionOriginal(d, tipo)` en `shared/sql/originalesSql.ts`
 * (lista blanca de Oracle, afinidad de SQLite; un switch con `nunca`), que aplican la sesión
 * del main a su catálogo y la rejilla (`ContextoEnvio.dialecto`) al tipo del resultado.
 *
 * SQLite declara 'rowid' solo si el alias `rowid` está libre (una columna
 * de usuario que se llame así lo tapa, y la tabla queda 'ninguna' con MOTIVO_ROWID_TAPADO,
 * porque el DML de «Enviar» escribe `ROWID`), en la misma columna oculta `__TESSERA_ROWID`;
 * una tabla WITHOUT ROWID va por su PK, y vistas, virtuales, sombra y temp no se editan.
 *
 * SQL Server: 'unicaNoNula', como PG, con su `sqlUnicaNoNula` sobre `sys.indexes`
 * (restricciones UNIQUE e índices únicos, sin filtro, con todas sus columnas NOT NULL). NO
 * hay pseudo-columna estable: `%%physloc%%` es la dirección física, cambia con un
 * rebuild y no está documentada; se descartó. Sin PK ni única no nula, la tabla no se edita.
 */
export type IdentidadSinPk = 'rowid' | 'unicaNoNula'

export interface CapacidadesSesion {
  /** Versión MAYOR más vieja soportada: la que se supone si el servidor no la dice. */
  versionMinima: number
  paginado: PaginadoMotor
  /**
   * ¿Pueden las páginas repetir o saltarse filas si no hay ORDER BY ni PK por la que
   * ordenar? (PG: LIMIT/OFFSET no guarda estado entre páginas; el cursor de Oracle sí.)
   */
  paginasInestablesSinOrden: boolean
  /** ¿El trabajador mantiene un LECTOR por id para las filas que siguen (Oracle)? */
  lectorPorId: boolean
  /** ¿Hay que pedir `mantenerCursor` para seguir leyendo (PG)? En Oracle el cursor vivo es el `resultSet`. */
  mantenerCursor: boolean
  candadoSoloLectura: CandadoSoloLectura
  /** ¿Un ROLLBACK deshace el cambio de esquema hecho dentro de la transacción (PG: `SET search_path`)? */
  esquemaTransaccional: boolean
  /**
   * ¿Fijar un esquema que no existe FALLA (Oracle: ORA-01435)? En PG `set_config` acepta
   * cualquier nombre y `current_schema()` lo salta: hay que releer para saberlo.
   */
  fijarEsquemaValida: boolean
  /** ¿La salida del servidor llega sin viaje extra (PG: NOTICE) en toda sentencia? Si no, solo en ciertas clases. */
  salidaServidorSiempre: boolean
  /** ¿Explicar plan necesita los VALORES de los parámetros (PG)? Oracle no hace «bind peeking». */
  explainPideValores: boolean
  // Cómo espera «Enviar» un bloqueo de fila NO está aquí: es de la sesión de cada motor en
  // el main, con su SQL (`esperaBloqueo`, `motores/sesion.ts`).
  /** ¿Un DDL confirma de forma implícita la transacción pendiente (Oracle)? */
  ddlConfirmaImplicito: boolean
  /** ¿Un bloque o una rutina pueden confirmar POR DENTRO sin que se vea (Oracle)? */
  rutinasConfirmanPorDentro: boolean
  identidadSinPk: IdentidadSinPk
  /**
   * ¿Un PROCESO de sesión por CONSOLA en vez de uno por conexión (SQLite)? node:sqlite no se
   * puede interrumpir (ni interrupt ni progress handler; medido: un `terminate()` de un
   * worker no corta la consulta), así que Detener = MATAR el proceso de esa consola. Con uno
   * por conexión, Detener mataría todas las consolas de la base, y mientras corre una
   * consulta larga el árbol y las demás consolas se quedan esperando (medido: 3 s sin
   * respuesta). Meta, datos y «Enviar» de la rejilla siguen en el proceso de la conexión,
   * que no tiene transacción y se puede matar. Lo lee `GestorSesiones` (la clave del mapa
   * de procesos pasa a ser (conexión, sesión)).
   */
  procesoPorSesion: boolean
}

// --- Documentos y claves -------------------------------------------------------

/**
 * Lo que cambia entre motores de DOCUMENTOS. Hoy uno (MongoDB), y solo lo
 * que el código de la familia lee.
 */
export interface CapacidadesDocumentos {
  /**
   * El nivel «Bases» del árbol, con el MISMO sentido que en SQL (`NivelBases`): MongoDB es
   * 'sinBaseFija' (con base en la conexión, el árbol empieza en sus colecciones; sin ella, en
   * las bases autorizadas, `listDatabases({ authorizedDatabases: true })`).
   */
  nivelBases: NivelBases
  /** Quién impone el solo lectura (ver `CandadoSoloLectura`). MongoDB: 'listaBlanca'. */
  candadoSoloLectura: CandadoSoloLectura
}

/** Lo que cambia entre motores de CLAVES. Hoy uno (Redis). */
export interface CapacidadesClaves {
  /**
   * Cuántas bases numeradas se ofrecen (0…n-1) si el servidor no deja preguntarlo: `CONFIG
   * GET databases` es de administración y un usuario de solo lectura recibe NOPERM (medido).
   * Redis: 16, el de fábrica.
   */
  basesPorDefecto: number
  /** Quién impone el solo lectura (ver `CandadoSoloLectura`). Redis: 'listaBlanca'. */
  candadoSoloLectura: CandadoSoloLectura
}

// --- El descriptor ---------------------------------------------------------------------

/**
 * La familia de un motor (`sql`, `documentos` o `claves`). La decide la unión de su id en
 * `db-ipc.ts` (`DbMotorSql`, `DbMotorDocumentos`, `DbMotorClaves`), no se declara aparte.
 */
export type FamiliaMotor = 'sql' | 'documentos' | 'claves'

/** Lo que tienen TODOS los motores, de cualquier familia. */
interface DescriptorComun<M extends DbMotor> {
  /** La clave de `MOTORES` (lo fija el tipo del registro). */
  id: M
  /** Nombre del producto tal como se enseña (el selector, los mensajes). */
  etiqueta: string
  conexion: CapacidadesConexion
}

/** El descriptor de un motor SQL (lo de las fases 1-4). */
export interface DescriptorSql<M extends DbMotorSql = DbMotorSql> extends DescriptorComun<M> {
  familia: 'sql'
  sql: CapacidadesSql<M>
  catalogo: CapacidadesCatalogo
  sesion: CapacidadesSesion
}

/** El descriptor de un motor de documentos. */
export interface DescriptorDocumentos<M extends DbMotorDocumentos = DbMotorDocumentos> extends DescriptorComun<M> {
  familia: 'documentos'
  documentos: CapacidadesDocumentos
}

/** El descriptor de un motor de claves. */
export interface DescriptorClaves<M extends DbMotorClaves = DbMotorClaves> extends DescriptorComun<M> {
  familia: 'claves'
  claves: CapacidadesClaves
}

/**
 * El descriptor del motor `M`, el de SU familia. Sin parámetro, la UNIÓN de todos: quien
 * lo recibe mira `familia` (con un `switch` que cierra con `nunca`) o pide el de una
 * familia con `descriptorSql(m)`.
 */
export type DescriptorMotor<M extends DbMotor = DbMotor> = M extends DbMotorSql
  ? DescriptorSql<M>
  : M extends DbMotorDocumentos
    ? DescriptorDocumentos<M>
    : M extends DbMotorClaves
      ? DescriptorClaves<M>
      : never

/** La `conexion` tal como la DECLARA un motor (sin lo derivado, con los mensajes). */
export type ConexionDeclarada = Omit<CapacidadesConexion, 'validarDestino' | 'excluyentes' | 'forma' | 'deArchivo'> & {
  excluyentes: readonly GrupoExcluyenteDeclarado[]
  /**
   * El rechazo EXACTO de cada campo validable que esté en `obligatorios` y venga vacío.
   * `definirMotor` exige uno por cada uno (y ninguno de más).
   */
  faltaDestino: Readonly<Partial<Record<CampoValidable, string>>>
}

/**
 * Lo que un motor ESCRIBE de su descriptor: todo menos lo derivado (`validarDestino` y
 * `tieneSinonimos`, que calcula `definirMotor`), y con los mensajes de sus reglas del
 * destino, que solo usa la derivación.
 */
export type DeclaracionMotor<M extends DbMotor = DbMotor> = M extends DbMotorSql
  ? Omit<DescriptorSql<M>, 'conexion' | 'catalogo'> & {
      conexion: ConexionDeclarada
      catalogo: Omit<CapacidadesCatalogo, 'tieneSinonimos'>
    }
  : M extends DbMotorDocumentos
    ? Omit<DescriptorDocumentos<M>, 'conexion'> & { conexion: ConexionDeclarada }
    : M extends DbMotorClaves
      ? Omit<DescriptorClaves<M>, 'conexion'> & { conexion: ConexionDeclarada }
      : never
