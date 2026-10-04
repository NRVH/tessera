// =============================================================================
// Aviso de arranque del agente sobre sus bases montadas: el texto que se añade al system prompt para que
// sepa que las tiene. Función pura sobre datos planos; `DbController` filtra qué conexiones son válidas y
// aquí solo se redacta. Dos redacciones de la primera línea (proyecto y espacio de datos) y frases por
// familia de motor que dicen quién impone el solo lectura. El texto lo lee el agente: lo fijan
// `test-entorno-bd-agente` y `test-agent-memory` al carácter.
// Decisiones: docs/decisiones/bd/puente-textos-del-agente.md
// =============================================================================
import type { DbConnection } from '../../shared/db-ipc.ts'
import {
  candadoSoloLecturaDe,
  destinoLegible,
  esAutenticacion,
  esMotor,
  listaLegible,
  MOTORES,
  pideDominio,
  pideUsuarioYClave,
  usaOpcional,
  type DescriptorMotor
} from '../../shared/motores/index.ts'
import { nunca } from '../../shared/nunca.ts'

/** Lo mínimo de una conexión que el aviso enseña. */
export type ConexionAviso = Pick<
  DbConnection,
  | 'alias'
  | 'motor'
  | 'host'
  | 'port'
  | 'database'
  | 'sid'
  | 'user'
  | 'readonly'
  | 'entorno'
  | 'archivoVisible'
  | 'instancia'
  | 'autenticacion'
  | 'dominio'
>

/**
 * ¿Quién impone el solo lectura de un motor? El SERVIDOR (Oracle, PG: una transacción de
 * solo lectura o un envoltorio con ROLLBACK) o TESSERA (el autorizador de una base de
 * archivo). Un `switch` que cierra con `nunca`: un candado nuevo tiene que decidirse aquí.
 * El candado sale de `candadoSoloLecturaDe`, que vale para las tres
 * familias: MongoDB y Redis no tienen `sesion`.
 */
export function quienImponeSoloLectura(d: DescriptorMotor): 'servidor' | 'tessera' | 'clasificador' | 'listaBlanca' {
  const c = candadoSoloLecturaDe(d)
  switch (c) {
    case 'transaccionSoloLectura':
    case 'envoltorioRollback':
      return 'servidor'
    case 'autorizador':
      return 'tessera'
    // SQL Server: HAY servidor, pero no tiene candado de solo lectura; lo imponen el
    // clasificador y el envoltorio de Tessera (y `tdb`, a los agentes). Un valor PROPIO y no
    // 'tessera': las frases de 'tessera' hablan de ARCHIVOS (ATTACH, VACUUM INTO), y decirlas
    // de un SQL Server sería mentir. Los textos de SQL Server para el agente los afina el
    // grupo TDB; aquí va la frase mínima que no miente.
    case 'clasificadorYEnvoltorio':
      return 'clasificador'
    // MongoDB y Redis: no hay SQL ni transacción que envuelva; lo impone
    // Tessera interpretando cada operación contra su lista blanca. Un valor PROPIO y no
    // 'clasificador': la frase de aquel habla de EXEC, transacciones y db_datareader, que en
    // estos motores no existen.
    case 'listaBlanca':
      return 'listaBlanca'
    default:
      return nunca(c, 'quienImponeSoloLectura')
  }
}

/**
 * Las etiquetas (en el orden del registro) de los motores de `motores` cuyo solo lectura lo
 * impone Tessera sobre un ARCHIVO (sin servidor): «SQLite»; '' si ninguno. Para las frases
 * de archivos de este aviso y del bloque de memoria.
 */
export function etiquetasConCandadoDeTessera(motores: readonly string[]): string {
  return etiquetasDondeImpone(motores, 'tessera')
}

/**
 * Las etiquetas de los motores de `motores` con servidor pero SIN candado de solo
 * lectura, que impone Tessera con su clasificador: «SQL Server»; '' si ninguno.
 */
export function etiquetasConClasificador(motores: readonly string[]): string {
  return etiquetasDondeImpone(motores, 'clasificador')
}

/**
 * Las etiquetas de los motores de `motores` cuyo solo lectura lo impone
 * Tessera con su LISTA BLANCA de operaciones (MongoDB, Redis); '' si ninguno.
 */
export function etiquetasConListaBlanca(motores: readonly string[]): string {
  return etiquetasDondeImpone(motores, 'listaBlanca')
}

function etiquetasDondeImpone(motores: readonly string[], quien: 'tessera' | 'clasificador' | 'listaBlanca'): string {
  const presentes = new Set(motores)
  return listaLegible(
    Object.values(MOTORES)
      .filter((d) => presentes.has(d.id) && quienImponeSoloLectura(d) === quien)
      .map((d) => d.etiqueta)
  )
}

/**
 * La frase para los motores con servidor sin candado (SQL Server), o [] si no hay
 * ninguno montado. La usan este aviso y el bloque de memoria.
 */
export function frasesClasificador(motores: readonly string[]): string[] {
  const deClasificador = etiquetasConClasificador(motores)
  if (deClasificador === '') return []
  return [
    `En las de ${deClasificador} el servidor no tiene candado de solo lectura: lo impone Tessera.`,
    'En las de solo lectura, tdb rechaza antes de enviarla toda escritura, todo EXEC (también',
    'de procedimientos que solo leen) y toda transacción, y ejecuta cada lote dentro de una',
    'transacción que revierte al acabar. La garantía completa es que la conexión use un',
    'usuario de la base con solo db_datareader.'
  ]
}

/**
 * La frase para los motores con candado de LISTA BLANCA (MongoDB, Redis), o
 * [] si no hay ninguno: con solo motores SQL el texto no cambia. Dice lo mismo que la de SQL
 * Server sin nada de SQL: quién lo impone, cómo, y que la garantía real es un usuario de solo
 * lectura (rol `read`, ACL `+@read`), que es lo que ninguna lista blanca sustituye.
 */
export function frasesListaBlanca(motores: readonly string[]): string[] {
  const deListaBlanca = etiquetasConListaBlanca(motores)
  if (deListaBlanca === '') return []
  return [
    `En las de ${deListaBlanca} el solo lectura lo impone Tessera: interpreta cada operación y`,
    'solo deja pasar las de lectura de su lista blanca. La garantía completa es que la',
    'conexión use un usuario de solo lectura.'
  ]
}

/**
 * Lo que habla un motor, para decírselo al agente sin nombrar el producto
 * a mano: «SQL de SQLite», «consultas de MongoDB», «comandos de Redis». La etiqueta sale del
 * descriptor; la palabra, de su familia (un `switch` con `nunca`: una familia nueva decide aquí).
 */
export function lenguajeDe(d: DescriptorMotor): string {
  switch (d.familia) {
    case 'sql':
      return `SQL de ${d.etiqueta}`
    case 'documentos':
      return `consultas de ${d.etiqueta}`
    case 'claves':
      return `comandos de ${d.etiqueta}`
    default:
      return nunca(d, 'lenguajeDe')
  }
}

/**
 * El nombre del dialecto que la línea de una conexión dice, o null si no dice
 * ninguno (ver el ADR: solo el que un agente no escribe por defecto). Por el formateador
 * del descriptor, en un `switch` que cierra con `nunca`: un dialecto nuevo se decide aquí.
 * Un motor que no es SQL no tiene formateador: dice lo que habla
 * (`lenguajeDe`), para que el agente no le escriba SQL.
 */
export function nombreDialecto(d: DescriptorMotor): string | null {
  switch (d.familia) {
    case 'sql':
      break
    case 'documentos':
    case 'claves':
      return lenguajeDe(d)
    default:
      return nunca(d, 'nombreDialecto')
  }
  const f = d.sql.formateador.dialecto
  switch (f) {
    case 'plsql':
    case 'postgresql':
    case 'sqlite':
      return null
    case 'transactsql':
      return 'T-SQL'
    default:
      return nunca(f, 'nombreDialecto')
  }
}

/**
 * ¿Tiene esta conexión un usuario que enseñar? No en una base sin
 * credenciales (SQLite), ni en una cuyo motor declara el usuario OPCIONAL (MongoDB, Redis)
 * y no lo lleva: se conecta sin autenticar. Se decide por lo que el motor DECLARA
 * (`pideUsuarioYClave`, `usaOpcional`), no por su familia. Un motor que no está en el
 * registro sigue enseñándolo, como antes.
 */
export function tieneUsuarioQueEnsenar(c: Pick<DbConnection, 'motor' | 'user'>): boolean {
  if (!esMotor(c.motor)) return true
  const d = MOTORES[c.motor]
  if (!pideUsuarioYClave(d)) return false
  return !(usaOpcional(d, 'user') && !c.user)
}

/**
 * El usuario como lo escribe su motor: `DOMINIO\usuario` con una cuenta de dominio
 * (la misma regla que el destino 'conUsuario' de SQL Server); si no, el de siempre.
 */
export function usuarioConDominio(c: Pick<DbConnection, 'user' | 'autenticacion' | 'dominio'>): string {
  const a = esAutenticacion(c.autenticacion) ? c.autenticacion : 'sql'
  return pideDominio(a) && c.dominio ? `${c.dominio}\\${c.user}` : c.user
}

/**
 * Los consejos del dialecto para los motores de `motores` que lo necesitan (hoy,
 * T-SQL), o [] si no hay ninguno montado: con solo Oracle, PG y SQLite el texto no cambia.
 */
export function consejosDialecto(motores: readonly string[]): string[] {
  const presentes = new Set(motores)
  const tsql = listaLegible(
    Object.values(MOTORES)
      .filter((d) => presentes.has(d.id) && nombreDialecto(d) === 'T-SQL')
      .map((d) => d.etiqueta)
  )
  if (tsql === '') return []
  return [
    `El SQL de las de ${tsql} es T-SQL: TOP (n) en vez de LIMIT, nombres entre [corchetes], GO`,
    'en su propia línea separa lotes, y en una conexión sin base fija las tablas de otra base',
    'se nombran base.esquema.tabla (también en `tdb describe`).'
  ]
}

/**
 * El tercer dato de la línea de una conexión: su usuario, o —en una base sin credenciales,
 * que no lo tiene— el SQL que habla (ver el ADR). Un motor que no está en el registro
 * sigue con el usuario, como antes. Con un dialecto que se nombra (T-SQL), el
 * usuario lleva detrás el dialecto, y una cuenta de dominio se escribe `DOMINIO\usuario`.
 */
export function usuarioODialecto(c: Pick<DbConnection, 'motor' | 'user' | 'autenticacion' | 'dominio'>): string {
  if (!esMotor(c.motor)) return `usuario ${c.user}`
  const d = MOTORES[c.motor]
  // Sin usuario que enseñar (SQLite; MongoDB o Redis sin autenticar), lo
  // que habla: «SQL de SQLite» como siempre, «consultas de MongoDB», «comandos de Redis».
  if (!tieneUsuarioQueEnsenar(c)) return lenguajeDe(d)
  const dialecto = nombreDialecto(d)
  return `usuario ${usuarioConDominio(c)}${dialecto ? `, ${dialecto}` : ''}`
}

/**
 * La regla para las de PRODUCCIÓN: la misma que el bloque de
 * memoria del espacio de datos y `tdb ls`. En producción Tessera pide confirmación al
 * usuario antes de cada escritura desde su interfaz, pero el agente escribe por `tdb`,
 * que no pasa por ese diálogo: el texto es la única barrera que ve. Solo sale si hay
 * alguna montada de producción; las demás líneas no cambian ni un carácter.
 */
export const REGLA_PRODUCCION =
  'Las marcadas PRODUCCIÓN: no escribas en ellas (INSERT, UPDATE, DELETE, DDL, COMMIT…) salvo que el usuario te lo pida explícitamente.'

/** Primera línea en el agente de un PROYECTO (el texto de siempre). */
export const PRIMERA_LINEA_PROYECTO = 'Tienes bases de datos montadas en este proyecto, consultables con `tdb`.'
/** Primera línea en el agente del ESPACIO DE DATOS (vista Bases de datos). */
export const PRIMERA_LINEA_ESPACIO =
  'Como agente de datos del perfil, tienes bases de datos montadas, consultables con `tdb`.'

/**
 * Aviso de arranque para las conexiones YA VALIDADAS (existentes y del perfil de la
 * sesión: eso lo decide `DbController`). Null si no hay ninguna: sin bases no hay
 * nada que avisar, y un aviso vacío le haría buscar bases que no tiene.
 *
 * `espacioDatos` dice si la sesión es la del espacio de datos del perfil. Solo cambia
 * la primera línea; el resto del texto vale igual en los dos sitios.
 */
export function briefingBasesAgente(
  conexiones: readonly ConexionAviso[],
  espacioDatos: boolean
): string | null {
  if (conexiones.length === 0) return null

  const lineas = conexiones.map((c) => {
    const destino = destinoLegible(c)
    const marca = c.entorno === 'produccion' ? ' — PRODUCCIÓN' : ''
    return `- ${c.alias} (${c.motor}, ${destino}, ${usuarioODialecto(c)})${c.readonly ? ' — solo lectura' : ''}${marca}`
  })
  const hayProduccion = conexiones.some((c) => c.entorno === 'produccion')
  // Quién impone el solo lectura (ver el ADR). Sin ninguna de Tessera, la frase de
  // siempre; con alguna, la que dice la verdad de cada una.
  const deTessera = etiquetasConCandadoDeTessera(conexiones.map((c) => c.motor))
  const hayDelServidor = conexiones.some((c) => !esMotor(c.motor) || quienImponeSoloLectura(MOTORES[c.motor]) === 'servidor')
  // Con SOLO motores de servidor sin candado (SQL Server), quien impone es Tessera.
  // Lo mismo con los de lista blanca (MongoDB, Redis).
  const soloClasificador =
    deTessera === '' &&
    !hayDelServidor &&
    (etiquetasConClasificador(conexiones.map((c) => c.motor)) !== '' ||
      etiquetasConListaBlanca(conexiones.map((c) => c.motor)) !== '')
  const quienImpone =
    deTessera === ''
      ? [
          soloClasificador
            ? 'lectura las impone Tessera, así que puedes explorar sin riesgo de escribir.'
            : 'lectura las impone el servidor, así que puedes explorar sin riesgo de escribir.'
        ]
      : [
          hayDelServidor
            ? `lectura las impone el servidor (en las de ${deTessera}, que son archivos, Tessera), así que puedes`
            : `lectura las impone Tessera (las de ${deTessera} son archivos, sin servidor), así que puedes`,
          'explorar sin riesgo de escribir.',
          `En ${deTessera}, ATTACH, VACUUM INTO y cargar extensiones están cerrados siempre, también`,
          'en las de escritura: tdb solo abre el archivo de la conexión.'
        ]
  // Los de servidor sin candado (SQL Server), con su frase aparte, y los consejos de
  // su dialecto.
  quienImpone.push(...frasesClasificador(conexiones.map((c) => c.motor)))
  quienImpone.push(...frasesListaBlanca(conexiones.map((c) => c.motor)))
  quienImpone.push(...consejosDialecto(conexiones.map((c) => c.motor)))
  return [
    espacioDatos ? PRIMERA_LINEA_ESPACIO : PRIMERA_LINEA_PROYECTO,
    'Al arrancar esta sesión eran:',
    ...lineas,
    ...(hayProduccion ? [REGLA_PRODUCCION] : []),
    '',
    // El aviso se hornea en la LÍNEA DE ARRANQUE, así que es una foto del momento
    // del spawn. Como el montaje ahora se aplica EN CALIENTE, esa foto envejece
    // durante la sesión: el usuario puede montar otra base a mitad de una
    // conversación. Por eso el texto no enumera como verdad absoluta, avisa de que
    // puede cambiar y manda comprobarlo; si no, el agente respondería "no tengo esa
    // base" justo después de que la acabaras de montar.
    'ESA LISTA PUEDE CAMBIAR durante la sesión (se montan y desmontan en caliente).',
    'Ejecuta `tdb ls` para ver las que hay AHORA antes de darla por buena.',
    '',
    'Comandos: `tdb ls`, `tdb schema <nombre>`, `tdb describe <nombre> <TABLA>`,',
    '`tdb query <nombre> "<SQL>"` (tope de filas; usa --limit N para ampliar).',
    'Para SQL largo o con comillas, porcentajes o saltos de línea, pásalo por la',
    'entrada estándar con un heredoc ENTRECOMILLADO, que no lo altera:',
    "  tdb query <nombre> --stdin <<'SQL'",
    '  SELECT ...',
    '  SQL',
    'Si algo falla y no sabes por qué, `tdb doctor` dice qué falta.',
    'No pidas al usuario URLs ni credenciales: ya las tienes. Las marcadas como solo',
    ...quienImpone,
    'Si hay varias, cuida de consultar la que corresponde: pueden ser entornos',
    'distintos (dev/QA/producción) de la misma aplicación.'
  ].join('\n')
}
