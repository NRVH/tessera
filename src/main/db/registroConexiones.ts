// =============================================================================
// El archivo del registro de conexiones (`db-connections.json`): leerlo y escribirlo sin destruir lo que
// esta versión no entiende («lo que no entiendo, no lo toco»). Puro, sin `electron`. Una sola lista de
// entradas, conocidas y ajenas mezcladas en su orden; un archivo que no se sabe leer se bloquea
// (`formatoAjeno`) en vez de sobrescribirse. Los avisos viven en `controlador/mensajesRegistro.ts`.
// Decisiones: docs/decisiones/bd/conexiones-registro-crash-safe.md
// =============================================================================

import { esEntorno, type DbComparteId, type DbConexionAjena, type DbIntrospeccion, type DbMotor } from '../../shared/db-ipc.ts'
import { normalizarEsquemasVisibles } from '../../shared/dbEsquemas.ts'
import { esObjeto } from '../util/valores.ts'
import { IDS_MOTORES, tieneFormaDelMotor } from '../../shared/motores/index.ts'
import { conservarAlEditar, esClaveGobernada, type ConexionPersistida } from './conservarAlEditar.ts'
import {
  MENSAJE_FORMATO_AJENO,
  mensajeEscrituraRegistroFallida,
  mensajeRegistroIlegible,
  type CausaRegistroIlegible,
  type EstadoRespaldo
} from './controlador/mensajesRegistro.ts'

export {
  MENSAJE_FORMATO_AJENO,
  SUFIJO_COPIA_ILEGIBLE,
  mensajeCopiaIlegibleFallida,
  mensajeEscrituraRegistroFallida,
  mensajeRegistroIlegible,
  mensajeRegistroRecuperado,
  sufijosCopiaIlegible,
  type CausaRegistroIlegible,
  type EstadoRespaldo
} from './controlador/mensajesRegistro.ts'

/**
 * Versión del FORMATO que escribe esta versión de Tessera. Solo sube si cambia la forma
 * del archivo, no por añadir un motor o un campo opcional (eso lo cubre la regla).
 */
export const VERSION_REGISTRO = 1

/**
 * Motores que esta versión sabe usar. Lo demás es ajeno. Ya no es una lista a mano: son
 * los ids del registro de descriptores (`IDS_MOTORES`, en su orden), y se exporta con su
 * nombre de siempre porque la importan `lecturaSegura` y `test-shim`. Para PREGUNTAR si
 * un motor lo es, `esMotor` (`hasOwnProperty`, da lo mismo que el `includes` de antes con
 * cualquier valor: ni un no-texto ni «constructor» son motores); ver el ADR.
 */
export const MOTORES_CONOCIDOS: readonly DbMotor[] = IDS_MOTORES

/** Motor que se enseña de una ajena cuyo registro no trae uno legible. */
export const MOTOR_ILEGIBLE = 'desconocido'

/**
 * ¿Es contenido que no se puede leer: algo que no es JSON y no está vacío? Es lo único que se pierde si se
 * sustituye sin más. Lo usan la guarda de escritura (`avisoAlSobrescribir`) y la copia aparte del roto.
 */
export function esContenidoIlegible(texto: string): boolean {
  // `trim` también quita el BOM: un archivo que solo trae eso está vacío.
  return leerRegistro(texto) === null && texto.trim() !== ''
}

/**
 * ¿Un error DEL SISTEMA en crudo, de los que Node crea en `fs` (`syscall`, y casi siempre
 * `path`)? Su `message` lleva las rutas que tocó, así que no puede ir al renderer tal cual.
 */
function esErrorDelSistema(e: unknown): boolean {
  return typeof e === 'object' && e !== null && typeof (e as { syscall?: unknown }).syscall === 'string'
}

/**
 * El texto de un fallo de una operación del REGISTRO para el renderer: el `message` de
 * siempre (los avisos del store ya dicen qué pasó y qué hacer, y el renderer los enseña tal
 * cual), salvo el de un error del sistema en crudo, que se cambia por
 * `mensajeEscrituraRegistroFallida` con su código. Es la GUARDA de las fronteras (el IPC de
 * db y `fijarEsquemas`): el store ya envuelve su escritura (`ConnectionStore.persistir`), y
 * esto impide que otra llamada a `fs` que se añada mañana vuelva a colar una ruta.
 */
export function mensajeDeFalloDelRegistro(e: unknown): string {
  if (esErrorDelSistema(e)) return mensajeEscrituraRegistroFallida(codigoDeError(e, 'error de E/S'))
  return e instanceof Error ? e.message : String(e)
}

/** Una conexión que esta versión entiende: `registro` para trabajar, `resto` para el disco. */
export interface EntradaConocida {
  tipo: 'conocida'
  /** Solo claves GOBERNADAS con valores ENTENDIDOS: de aquí sale el DTO. */
  registro: ConexionPersistida
  /**
   * Lo que no se gobierna o no se entiende, tal como vino. Vuelve al disco con la
   * entrada y nunca llega al DTO. Una clave que `registro` también tenga NO se escribe
   * desde aquí: gana el registro (ver `consolidar`).
   */
  resto: Record<string, unknown>
  /**
   * Valores ENTENDIDOS que se normalizaron al leer (`esquemas`, `introspeccion`) y cuyo
   * crudo no era ya la forma normal: por clave, el crudo tal cual y la forma normal (en
   * JSON). Mientras el registro siga con esa forma normal —nadie la cambió—, al disco va
   * el CRUDO. Ver `separarConocida`. Ausente = no había nada que recordar.
   */
  leidos?: Record<string, { crudo: unknown; normal: string }>
}

/** Una entrada que esta versión no entiende: se conserva entera, sin mirarla por dentro. */
export interface EntradaAjena {
  tipo: 'ajena'
  crudo: unknown
  /**
   * Tiene la forma de una conocida, pero su id ya lo tiene una conocida
   * ANTERIOR del archivo (ver `entradasDeLista`). Ausente = ajena por su motor o su forma.
   */
  idRepetido?: true
}

/** Una entrada del registro, conocida o ajena. */
export type Entrada = EntradaConocida | EntradaAjena

interface RegistroBase {
  /** La que se escribirá: max(leída, `VERSION_REGISTRO`). Nunca baja. */
  version: number
  /** En el ORDEN del archivo, conocidas y ajenas mezcladas (ver el ADR). */
  entradas: Entrada[]
  /** Claves de la raíz que no son `version` ni `connections`. */
  raiz: Record<string, unknown>
}

/**
 * El archivo tal como se leyó. `formatoAjeno` es la marca de NO TOCARLO —no se lista, no
 * se escribe, no se poda, y dar de alta falla diciéndolo—, por cualquiera de sus dos
 * causas: JSON que no es un registro que esta versión sepa escribir sin destruirlo (ver
 * `leerRegistro`), o un archivo que no se pudo leer y sin `.bak` que lo supla —o que no se
 * deja abrir, con `.bak` o sin él— (ver `lecturaConRespaldo`). `aviso` es el porqué que se enseña, y existe exactamente
 * cuando la marca: una UNIÓN y no dos campos sueltos, para que el compilador no deje
 * construir un registro bloqueado sin decir por qué.
 */
export type Registro = RegistroBase & ({ formatoAjeno: false; aviso: null } | { formatoAjeno: true; aviso: string })

/** Punto de código del BOM (U+FEFF), como en `tdb`: un editor de Windows lo añade. */
const BOM = 0xfeff

/** Un registro sin entradas, escribible. */
export function registroVacio(): Registro {
  return { version: VERSION_REGISTRO, entradas: [], raiz: {}, formatoAjeno: false, aviso: null }
}

/** Un registro que no se toca, con su porqué (ver `Registro`). Sin entradas: no se interpreta nada. */
function registroBloqueado(aviso: string, raiz: Record<string, unknown> = {}, version = VERSION_REGISTRO): Registro {
  return { version, entradas: [], raiz, formatoAjeno: true, aviso }
}

/**
 * Lee el texto del archivo. Tres salidas, según lo que se pueda PERDER al escribir:
 *
 *   - `null` = no es JSON (el llamador recurre al `.bak`, como siempre). Incluye el
 *     archivo de CERO bytes (o solo espacios): puede ser una edición a mano o una
 *     escritura truncada por otro programa, y de las dos lecturas se elige la que no
 *     pierde nada — resucitar desde el `.bak` se deshace borrando; lo contrario, no.
 *     Qué pasa si TAMPOCO hay `.bak` lo decide `leerRegistroConRespaldo`: con contenido,
 *     el archivo no se toca; vacío de verdad, se escribe.
 *   - VACÍO y escribible: `null`, `[]`, o un objeto sin `connections` (o con
 *     `connections: null`). No tienen nada que perder, y son la forma de vaciarlo a
 *     mano; ahí manda quien lo vació (el `.bak` NO lo resucita).
 *   - `formatoAjeno` (legible, pero NO se escribe): una raíz que no es un objeto y no
 *     está vacía (una lista CON entradas, un número, un texto, un booleano), un
 *     `connections` que no es una lista, o una `version` que no es un número finito.
 *     las dos primeras contaban como vacías —heredado del lector viejo— y
 *     una `version: "2"` se leía como 1, así que la primera alta sobrescribía el
 *     archivo entero con `{ version: 1, connections: [nueva] }`. Un formato futuro que
 *     fuera una lista, o que declarase su versión como texto, se perdía entero.
 *
 * El BOM se quita antes de parsear: `JSON.parse` lo rechaza, y un archivo tocado con el
 * Bloc de notas acababa tratado como corrupto y sustituido por el `.bak`, que es más
 * viejo — la edición a mano se perdía en la siguiente escritura.
 */
export function leerRegistro(texto: string): Registro | null {
  let doc: unknown
  try {
    doc = JSON.parse(texto.charCodeAt(0) === BOM ? texto.slice(1) : texto)
  } catch {
    return null
  }
  // Solo lo que no tiene NADA que perder cuenta como vacío y escribible.
  if (doc === null || (Array.isArray(doc) && doc.length === 0)) return registroVacio()
  // Cualquier otra raíz que no sea un objeto —una lista con entradas, un número, un
  // texto, un booleano— no es un registro que esta versión sepa escribir: no se toca.
  if (!esObjeto(doc)) return registroBloqueado(MENSAJE_FORMATO_AJENO)
  const raiz = Object.fromEntries(Object.entries(doc).filter(([k]) => k !== 'version' && k !== 'connections'))
  const leida = doc.version
  // Ausente o `null`: la propia (un registro de antes de que existiera el campo). Un
  // número FINITO: max(leída, la propia), nunca baja. Cualquier otra cosa declara un
  // formato que esta versión no entiende, y escribir encima sería bajarlo a 1.
  if (leida !== undefined && leida !== null && !(typeof leida === 'number' && Number.isFinite(leida))) {
    return registroBloqueado(MENSAJE_FORMATO_AJENO, raiz)
  }
  const version = typeof leida === 'number' ? Math.max(leida, VERSION_REGISTRO) : VERSION_REGISTRO
  const lista = doc.connections
  if (lista === undefined || lista === null) return { version, entradas: [], raiz, formatoAjeno: false, aviso: null }
  if (!Array.isArray(lista)) return registroBloqueado(MENSAJE_FORMATO_AJENO, raiz, version)
  return { version, entradas: entradasDeLista(lista), raiz, formatoAjeno: false, aviso: null }
}

/**
 * Las entradas de `connections`, en su orden. Una de forma conocida cuyo id ya lo tiene una
 * conocida ANTERIOR pasa a ser AJENA (`idRepetido`), con su crudo TAL CUAL.
 *
 * POR QUÉ. Solo lo produce una edición a mano (copiar y pegar una entrada), pero entonces
 * todo lo que va por id —`get`, `update`, `secretOf`, el DELETE, las sesiones del explorador,
 * el puente de `tdb`— resuelve a la PRIMERA: la segunda se pintaba con su alias y abría el
 * servidor de la otra con su contraseña, también desde otro perfil (los ids son de todo el
 * registro, no de un perfil), y editarla editaba la otra. No hay forma de distinguirlas sin
 * cambiar el id, y cambiarlo es tocar lo que no se entiende (los montajes de los proyectos
 * apuntan a ese id). Así que la segunda se trata como cualquier otra cosa que esta versión no
 * sabe usar: se ve atenuada con su porqué (`DbConexionAjena.idRepetido`), se conserva en disco
 * tal cual, en su sitio, y se puede eliminar sin tocar la otra (`DbBorrarConexion.ajena`).
 *
 * La PRIMERA manda por ser la que ya ganaba en todo lo demás: con ella siguen sus montajes,
 * sus consolas y su historial, que cuelgan del id. Una ajena de motor o de forma con ese mismo
 * id no cuenta como «anterior»: no es una conexión que se use. `tdb` lee el archivo con la
 * MISMA regla (`marcarIdsRepetidos` en `tdbConexiones.cjs`, fijada por la tabla de paridad de `test-shim`).
 */
export function entradasDeLista(lista: readonly unknown[]): Entrada[] {
  const usados = new Set<string>()
  return lista.map((crudo): Entrada => {
    const e = entradaDe(crudo)
    if (e.tipo !== 'conocida') return e
    if (usados.has(e.registro.id)) return { tipo: 'ajena', crudo, idRepetido: true }
    usados.add(e.registro.id)
    return e
  })
}

/** Lo que se sabe de UN archivo (el principal o el `.bak`) tras intentar leerlo. */
type LecturaArchivo =
  | { tipo: 'registro'; reg: Registro }
  | { tipo: 'ausente' }
  /** Cero bytes o solo espacios (o solo el BOM): no hay nada que perder. */
  | { tipo: 'vacio' }
  | CausaRegistroIlegible

/** El código de un error de E/S (`EACCES`, `EBUSY`…), o una etiqueta si no trae ninguno. */
function codigoDeError(e: unknown, siNoHay = 'error de lectura'): string {
  const codigo = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined
  return typeof codigo === 'string' && codigo !== '' ? codigo : siNoHay
}

function leerArchivo(leerTexto: (ruta: string) => string | null, ruta: string): LecturaArchivo {
  let texto: string | null
  try {
    texto = leerTexto(ruta)
  } catch (e) {
    return { tipo: 'inaccesible', codigo: codigoDeError(e) }
  }
  if (texto === null) return { tipo: 'ausente' }
  const reg = leerRegistro(texto)
  if (reg !== null) return { tipo: 'registro', reg }
  // `trim` de JavaScript también quita el BOM (U+FEFF es espacio para él), así que un
  // archivo que solo trae el BOM del Bloc de notas cuenta como vacío, que es lo que es.
  return texto.trim() === '' ? { tipo: 'vacio' } : { tipo: 'roto' }
}

/** Lo que devuelve `lecturaConRespaldo`: el registro, y de dónde salió. */
export interface LecturaConRespaldo {
  reg: Registro
  /**
   * De qué archivo sale `reg`: el principal, el `.bak`, o ninguno (vacío sin nada que
   * leer, o bloqueado por ilegible). `tdb doctor` dice lo mismo con el principal ausente.
   */
  origen: 'principal' | 'respaldo' | 'ninguno'
  /**
   * El principal tiene contenido que NO ES JSON y se suplió con un `.bak` que sí se puede
   * escribir: el caso del rescate con copia aparte (ver el ADR). El store lo avisa
   * (`mensajeRegistroRecuperado`) y guarda la copia antes de la primera escritura.
   */
  rescateDeRoto: boolean
}

/**
 * El registro tal como lo lee el main, con su RESPALDO: el principal si es legible
 * (aunque esté vacío, para que vaciarlo a mano no resucite conexiones borradas desde el
 * `.bak`); si falta, está vacío o no es JSON, el `.bak`. Si el `.bak` tampoco se lee,
 * depende de lo que había en el principal (ver el ADR):
 *   - con CONTENIDO que no es JSON: bloqueado, con `mensajeRegistroIlegible`. No se lista,
 *     no se escribe y no se poda nada.
 *   - nada (no existe, o cero bytes / solo espacios): vacío y escribible, como siempre.
 * Y un principal que NO SE DEJA ABRIR se bloquea SIEMPRE, aunque el `.bak` se lea: no se
 * puede guardar aparte lo que no se puede leer, y la primera escritura lo sustituiría
 * renombrando. Antes se usaba el `.bak`, que es UNA escritura más viejo: un bloqueo al
 * arrancar bastaba para que la primera escritura pusiera encima de lo último guardado lo
 * de la vez anterior.
 *
 * Es la regla de `ConnectionStore.read`, sacada aquí para que la use también quien busca
 * en el registro FUERA del store (el smoke de solo lectura, `buscarEnRegistro`): antes ese
 * buscaba en el principal a pelo, sin `.bak` ni formato ajeno, y podía encontrar lo que la
 * app no enseña o no ver lo que sí. `tdb` no puede importarla —corre suelto,
 * sin el código del main— y lleva una copia, `leerRegistroConexiones`, que fija `test-shim`.
 *
 * @param leerTexto el contenido de una ruta; `null` si NO EXISTE; y si existe pero no se
 *                  puede leer (sin permiso, bloqueado), que LANCE: su `code` va al aviso.
 *                  Distinguir las dos cosas es lo que impide tomar por vacío un archivo
 *                  que no se pudo abrir: `writeFileAtomicSync` lo sustituye renombrando
 *                  (en macOS basta con poder escribir en la CARPETA, aunque el archivo
 *                  no se deje leer). Se inyecta para que esto siga siendo puro y probable.
 */
export function lecturaConRespaldo(leerTexto: (ruta: string) => string | null, ruta: string): LecturaConRespaldo {
  const principal = leerArchivo(leerTexto, ruta)
  if (principal.tipo === 'registro') return { reg: principal.reg, origen: 'principal', rescateDeRoto: false }
  const respaldo = leerArchivo(leerTexto, `${ruta}.bak`)
  const estado: EstadoRespaldo =
    respaldo.tipo === 'registro' ? 'legible' : respaldo.tipo === 'ausente' ? 'ausente' : 'inservible'
  if (principal.tipo === 'inaccesible') {
    return { reg: registroBloqueado(mensajeRegistroIlegible(principal, estado)), origen: 'ninguno', rescateDeRoto: false }
  }
  if (respaldo.tipo === 'registro') {
    // Un `.bak` de formato ajeno también se «usa» (bloquea con SU aviso), pero no se va a
    // escribir nada, así que no hay rescate que avisar ni copia que guardar.
    return { reg: respaldo.reg, origen: 'respaldo', rescateDeRoto: principal.tipo === 'roto' && !respaldo.reg.formatoAjeno }
  }
  if (principal.tipo === 'roto') {
    return { reg: registroBloqueado(mensajeRegistroIlegible(principal, estado)), origen: 'ninguno', rescateDeRoto: false }
  }
  return { reg: registroVacio(), origen: 'ninguno', rescateDeRoto: false }
}

/** `lecturaConRespaldo` sin el origen: para quien solo necesita el registro (el smoke, las pruebas). */
export function leerRegistroConRespaldo(leerTexto: (ruta: string) => string | null, ruta: string): Registro {
  return lecturaConRespaldo(leerTexto, ruta).reg
}

/**
 * ¿Se puede sustituir lo que hay AHORA en el principal? La regla de
 * `leerRegistroConRespaldo` aplicada al MOMENTO DE ESCRIBIR (ver el ADR): el store
 * lee el archivo una sola vez, y lo que el usuario rompa a mano con Tessera abierta no lo
 * vería nadie antes de que la siguiente escritura lo sustituyera.
 *
 * @param actual   el texto del principal ahora mismo; `null` si no existe.
 * @param conocido el que este proceso leyó o escribió la última vez: `null` si no existía,
 *                 `undefined` si no se pudo leer (entonces cualquier contenido es nuevo).
 * @returns `null` si se puede escribir encima, o el aviso de por qué no:
 *   - SIN CAMBIOS desde entonces: se escribe. Incluye el principal que ya estaba roto al
 *     arrancar y se suplió con el `.bak` (decidido: se usa el `.bak`, y la primera
 *     escritura lo sustituye DESPUÉS de guardarlo aparte, cosa del store; ver el ADR).
 *   - Borrado, cero bytes o solo espacios: se escribe; no hay nada que perder.
 *   - Contenido que NO ES JSON: `mensajeRegistroIlegible` (sin hablar del `.bak`: aquí no
 *     se ha mirado, y no cambia lo que hay que hacer).
 *   - JSON con un formato que esta versión no reconoce: su aviso (`MENSAJE_FORMATO_AJENO`),
 *     por la misma regla de siempre.
 *   - JSON que esta versión sabe escribir: se escribe (una edición válida se pisa, como
 *     antes; no es lo que arregla esto, ver el ADR). SALVO si lo que se leyó era el
 *     roto rescatado con el `.bak` (`conocido` ilegible): entonces es el usuario que lo
 *     CORRIGIÓ con Tessera abierta, y se niega con `MENSAJE_RESCATADO_CORREGIDO`.
 *
 * Esa excepción está medida: el aviso de la
 * recuperación manda al usuario a mirar el archivo, quien quita la coma de más con Tessera
 * abierta, y la escritura siguiente —que ya no ve nada ilegible, así que no copia nada—
 * guardaba su arreglo en el `.bak` y ponía encima lo del `.bak` viejo; la otra, pisaba ese
 * `.bak`. Dos escrituras rutinarias (una verificación, un reordenamiento) y la edición a
 * mano que la copia aparte existe para conservar no quedaba en ningún archivo. El caso
 * general (un registro bueno editado con Tessera abierta) no cambia: lo que está en memoria
 * es ese mismo archivo más lo que hizo Tessera; aquí es otro, el `.bak`, una escritura más
 * viejo. Solo pasa en el rescate: un roto sin `.bak` legible bloquea el registro entero, y
 * no llega a escribir. Vaciarlo (cero bytes, solo espacios) o apartarlo sigue dejando
 * escribir: no hay nada que perder, y apartarlo es la salida que da el aviso de la copia.
 *
 * Y EL CASO GENERAL TAMBIÉN: un registro bueno editado con
 * Tessera abierta se niega con `MENSAJE_CAMBIADO_FUERA`, salvo que su contenido sea el
 * mismo (solo cambió el formato del texto). La excepción de arriba se quedó corta: el
 * `.bak` guarda una edición válida una sola escritura, y la siguiente la perdía igual.
 */
export function avisoAlSobrescribir(actual: string | null, conocido: string | null | undefined): string | null {
  if (actual === null || actual === conocido) return null
  if (esContenidoIlegible(actual)) return mensajeRegistroIlegible({ tipo: 'roto' }, 'ausente')
  const reg = leerRegistro(actual)
  if (reg === null) return null
  if (reg.formatoAjeno) return reg.aviso
  if (typeof conocido === 'string' && esContenidoIlegible(conocido)) return MENSAJE_RESCATADO_CORREGIDO
  // Un cambio VÁLIDO hecho por fuera con Tessera abierta. No se pisa «porque el `.bak` lo
  // guarda»: el `.bak` lo guarda UNA escritura, y la siguiente escritura rutinaria (una
  // verificación, un reordenamiento) lo perdería sin rastro. Se niega igual que el resto,
  // hasta reiniciar, que es cuando Tessera lo lee. Solo si el CONTENIDO cambió: un archivo guardado de nuevo por un
  // editor, con otros espacios o saltos de línea, es el mismo registro y se escribe.
  // Sin entradas no hay nada que perder (un `{"connections":[]}` escrito a mano, o creado
  // cuando al arrancar no existía): se escribe, como con un archivo vacío.
  if (reg.entradas.length === 0) return null
  const previo = typeof conocido === 'string' ? leerRegistro(conocido) : null
  if (previo !== null && !previo.formatoAjeno && serializarRegistro(previo) === serializarRegistro(reg)) return null
  return MENSAJE_CAMBIADO_FUERA
}

/**
 * El registro cambió fuera de Tessera mientras estaba abierta (una edición a mano, otra
 * copia de Tessera con los mismos datos): no se sobrescribe, para no perder ese cambio.
 */
export const MENSAJE_CAMBIADO_FUERA =
  'No se guardó el cambio: el registro de conexiones (db-connections.json) cambió fuera de ' +
  'Tessera mientras estaba abierta, y sobrescribirlo perdería ese cambio. Reinicia Tessera, ' +
  'que lo lee al arrancar.'

/**
 * El error de una escritura que NO se hizo porque el principal roto que se suplió con el
 * `.bak` se CORRIGIÓ a mano con Tessera abierta (ver `avisoAlSobrescribir`): lo que Tessera
 * tiene en memoria sale del `.bak`, no de ese arreglo, y sustituirlo lo perdería. Dice qué
 * pasó y que reiniciar lo resuelve (el store lee el registro al arrancar, y entonces el
 * principal, ya legible, manda).
 */
export const MENSAJE_RESCATADO_CORREGIDO =
  'No se guardó el cambio: el registro de conexiones (db-connections.json) ya es JSON válido, pero ' +
  'Tessera sigue con las conexiones de su copia de respaldo (db-connections.json.bak), que leyó al ' +
  'arrancar porque entonces no lo era, y sustituirlo ahora perdería lo que corregiste. Reinicia ' +
  'Tessera, que lo lee al arrancar.'

/**
 * El nombre con que se enseña una entrada cruda en un texto: su alias si trae uno legible,
 * si no su id, y si tampoco, «(sin nombre)». El MISMO criterio que `nombreDe` de `tdb` y
 * que `describirAjena` (que no llega al tercer caso porque sin id no lista la entrada):
 * con `String(c.alias)`, una entrada sin alias se llamaba «undefined», y buscar
 * «undefined» la encontraba.
 */
export function nombreDeEntrada(crudo: Record<string, unknown>): string {
  if (typeof crudo.alias === 'string' && crudo.alias.trim() !== '') return crudo.alias
  if (typeof crudo.id === 'string' && crudo.id.trim() !== '') return crudo.id
  return '(sin nombre)'
}

function entradaDe(crudo: unknown): Entrada {
  return (esObjeto(crudo) ? separarConocida(crudo) : null) ?? { tipo: 'ajena', crudo }
}

/**
 * La forma mínima que esta versión sabe usar (la validación de siempre al leer, que
 * antes DESCARTABA lo que no pasaba y ahora lo deja como ajeno): id, perfil y alias de
 * texto, y la FORMA DE SU MOTOR (`tieneFormaDelMotor`: un motor del registro con los
 * campos de su `conexion.forma` y su tipo; host de texto y puerto numérico en Oracle y PG,
 * el archivo de texto en SQLite). Antes de SQLite la forma de red estaba
 * escrita aquí a mano, como en `ConnectionStore.validate` y `formaConocida` de `tdb`; los
 * tres la leen ahora del descriptor (`tdb`, de su copia cruzada por `test-motores-tdb`), y
 * `test-shim` los cruza de punta a punta.
 */
function tieneFormaConocida(c: Record<string, unknown>): boolean {
  return (
    typeof c.id === 'string' &&
    typeof c.profileId === 'string' &&
    typeof c.alias === 'string' &&
    tieneFormaDelMotor(c)
  )
}

/**
 * Separa una entrada cruda en lo que esta versión gobierna y entiende (`registro`) y lo
 * demás (`resto`). `null` si no tiene la forma conocida: es AJENA.
 *
 * Los valores entendidos se NORMALIZAN para USARLOS (los esquemas pierden duplicados, la
 * foto de la introspección gana `en: 0` si no lo traía), pero al disco vuelve el CRUDO
 * mientras nadie los cambie (`leidos`): antes se escribían normalizados, y
 * normalizar es RECONSTRUIR — `{ modo, porDefecto, esquemas }` y nada más—, así que
 * una clave que una versión más nueva guardara DENTRO (unos `patrones` en los esquemas,
 * un `totalBases` en la foto) o una lista más larga que el tope de esta se perdía en la
 * primera escritura rutinaria, igual que las ajenas antes de este módulo.
 */
export function separarConocida(crudo: Record<string, unknown>): EntradaConocida | null {
  if (!tieneFormaConocida(crudo)) return null
  const pares = Object.entries(crudo).filter(([, v]) => v !== undefined)
  const registro: Record<string, unknown> = Object.fromEntries(pares.filter(([k]) => esClaveGobernada(k)))
  const resto: Record<string, unknown> = Object.fromEntries(pares.filter(([k]) => !esClaveGobernada(k)))
  const leidos: Record<string, { crudo: unknown; normal: string }> = {}

  // Gobernadas con un VALOR que no se entiende: fuera del registro (el DTO no las
  // enseña) y al resto (el disco las conserva). Ver el ADR.
  if ('entorno' in registro && !esEntorno(registro.entorno)) {
    resto.entorno = registro.entorno
    delete registro.entorno
  }
  // (MongoDB.) Lo mismo con `srv` (booleano) y `opcionesUri` (texto): un
  // valor de otro tipo (una edición a mano) no llega al DTO ni al trabajador, y se conserva
  // en disco. `tdb` lee el JSON por su cuenta y aplica la misma regla de tipos.
  if ('srv' in registro && typeof registro.srv !== 'boolean') {
    resto.srv = registro.srv
    delete registro.srv
  }
  if ('opcionesUri' in registro && typeof registro.opcionesUri !== 'string') {
    resto.opcionesUri = registro.opcionesUri
    delete registro.opcionesUri
  }
  const normalizadas: Array<[string, (v: unknown) => unknown]> = [
    ['esquemas', normalizarEsquemasVisibles],
    // Las bases visibles del nivel «Bases»: la forma de los esquemas.
    ['bases', normalizarEsquemasVisibles],
    ['introspeccion', normalizarIntrospeccion]
  ]
  for (const [clave, normalizar] of normalizadas) {
    if (!(clave in registro)) continue
    const original = registro[clave]
    const normal = normalizar(original)
    if (normal === undefined) {
      resto[clave] = original
      delete registro[clave]
      continue
    }
    registro[clave] = normal
    const textoNormal = JSON.stringify(normal)
    if (JSON.stringify(original) !== textoNormal) leidos[clave] = { crudo: original, normal: textoNormal }
  }
  const entrada: EntradaConocida = { tipo: 'conocida', registro: registro as unknown as ConexionPersistida, resto }
  if (Object.keys(leidos).length > 0) entrada.leidos = leidos
  return entrada
}

/**
 * La entrada conocida tal como va al disco: el registro y, detrás, lo del resto que el
 * registro no tenga. No muta.
 *
 * Un valor normalizado al leer que sigue IGUAL (misma forma normal) sale como se leyó
 * (ver `leidos`); si alguien lo cambió —el popover de esquemas, la introspección
 * refrescada, una edición que lo retira—, sale el nuevo. La comparación es por VALOR y
 * no por identidad, así que también cubre una mutación en el sitio.
 */
export function crudoDeConocida(e: EntradaConocida): Record<string, unknown> {
  const propias = Object.entries(e.registro)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]): [string, unknown] => {
      const leido = e.leidos && Object.prototype.hasOwnProperty.call(e.leidos, k) ? e.leidos[k] : undefined
      return leido && JSON.stringify(v) === leido.normal ? [k, leido.crudo] : [k, v]
    })
  const claves = new Set(propias.map(([k]) => k))
  return Object.fromEntries([...propias, ...Object.entries(e.resto).filter(([k]) => !claves.has(k))])
}

/**
 * Quita del `resto` lo que el registro ya decide. Un valor no entendido deja de
 * conservarse en cuanto hay uno entendido (el usuario eligió un entorno, marcó
 * esquemas, o el main refrescó la introspección); si se quedara, volvería a aparecer el
 * día que el registro perdiera esa clave (un entorno quitado, un cambio de motor).
 */
function consolidar(e: EntradaConocida): void {
  for (const [k, v] of Object.entries(e.registro)) {
    if (v !== undefined && Object.prototype.hasOwnProperty.call(e.resto, k)) delete e.resto[k]
  }
}

/**
 * El texto del archivo. Consolida las entradas conocidas (ver `consolidar`); las ajenas
 * y la raíz van tal cual. Lanza si el registro está bloqueado (formato ajeno, o archivo
 * que no se pudo leer), con su aviso: escribirlo sería destruirlo.
 */
export function serializarRegistro(reg: Registro): string {
  if (reg.formatoAjeno) throw new Error(reg.aviso)
  const connections = reg.entradas.map((e) => {
    if (e.tipo === 'ajena') return e.crudo
    consolidar(e)
    return crudoDeConocida(e)
  })
  return JSON.stringify({ version: reg.version, connections, ...reg.raiz }, null, 2) + '\n'
}

/** Los registros conocidos, en el orden del archivo (MISMOS objetos: mutarlos es mutar el registro). */
export function conocidas(reg: Registro): ConexionPersistida[] {
  return reg.entradas.flatMap((e) => (e.tipo === 'conocida' ? [e.registro] : []))
}

/** Id de una entrada, o `null` si no trae uno legible (entonces no se puede ni borrar). */
export function idDeEntrada(e: Entrada): string | null {
  if (e.tipo === 'conocida') return e.registro.id
  return esObjeto(e.crudo) && typeof e.crudo.id === 'string' && e.crudo.id !== '' ? e.crudo.id : null
}

/** Perfil de una entrada, o `null` si no trae uno legible (no es de nadie que se sepa). */
export function perfilDeEntrada(e: Entrada): string | null {
  if (e.tipo === 'conocida') return e.registro.profileId
  return esObjeto(e.crudo) && typeof e.crudo.profileId === 'string' ? e.crudo.profileId : null
}

/**
 * Lo que se enseña de una ajena. `null` si no tiene id y perfil legibles: no se puede
 * atribuir a nadie ni borrar por id, así que no se lista (sigue conservándose).
 */
export function describirAjena(crudo: unknown): DbConexionAjena | null {
  if (!esObjeto(crudo)) return null
  const { id, profileId, alias, motor } = crudo
  if (typeof id !== 'string' || id === '' || typeof profileId !== 'string') return null
  return {
    id,
    profileId,
    alias: typeof alias === 'string' && alias.trim() !== '' ? alias : id,
    motor: typeof motor === 'string' && motor.trim() !== '' ? motor : MOTOR_ILEGIBLE
  }
}

/**
 * Con quién comparte su id una ajena por id repetido, AHORA (ver `DbComparteId`): se mira al
 * listar, no al leer, porque la conocida puede cambiar de alias o eliminarse con la app
 * abierta, y el aviso contaría entonces lo que ya no es.
 *
 * `profileId` es el perfil de LA COPIA, no el de quien pregunta: el alias de la otra solo se
 * da si las dos son del mismo perfil (las conexiones son privadas de su perfil). Exportada
 * porque el smoke de solo lectura (`buscarEnRegistro`) re-derivaba
 * esta misma decisión con el perfil de la TERMINAL, y sin terminal (`null`) enseñaba el alias
 * de una conexión de otro perfil que la UI y `tdb` esconden. Una sola regla, aquí.
 */
export function comparteId(reg: Registro, id: string, profileId: string): DbComparteId {
  const duena = conocidas(reg).find((c) => c.id === id)
  if (!duena) return { tipo: 'eliminada' }
  return duena.profileId === profileId ? { tipo: 'conexion', alias: duena.alias } : { tipo: 'otroPerfil' }
}

/** `orden` numérico de una entrada, o `null`. */
function ordenDe(e: Entrada): number | null {
  const o = e.tipo === 'conocida' ? e.registro.orden : esObjeto(e.crudo) ? e.crudo.orden : undefined
  return typeof o === 'number' && Number.isFinite(o) ? o : null
}

/**
 * Las ajenas de un perfil, con el MISMO criterio de orden que `ConnectionStore.list`
 * (su `orden`, y las que no lo tienen al final por alias): la versión que las creó las
 * ordena con ese mismo campo, así que el sitio relativo es el que tenían allí.
 */
export function ajenasDelPerfil(reg: Registro, profileId: string): DbConexionAjena[] {
  const filas: Array<{ a: DbConexionAjena; orden: number }> = []
  for (const e of reg.entradas) {
    if (e.tipo !== 'ajena') continue
    const a = describirAjena(e.crudo)
    if (!a || a.profileId !== profileId) continue
    if (e.idRepetido) a.idRepetido = comparteId(reg, a.id, profileId)
    filas.push({ a, orden: ordenDe(e) ?? Number.MAX_SAFE_INTEGER })
  }
  return filas
    .sort((x, y) => (x.orden !== y.orden ? x.orden - y.orden : x.a.alias.localeCompare(y.a.alias)))
    .map((f) => f.a)
}

/**
 * Posición de una conexión NUEVA en su perfil: detrás de todas, CONTANDO las ajenas.
 * Sin ellas, la nueva tomaría un `orden` que ya usa una ajena y la versión que la creó
 * las pintaría empatadas. Una conocida sin `orden` cuenta como -1 (regla de siempre).
 */
export function siguienteOrden(reg: Registro, profileId: string): number {
  const usados = reg.entradas
    .filter((e) => perfilDeEntrada(e) === profileId)
    .flatMap((e) => {
      const o = ordenDe(e)
      if (o !== null) return [o]
      return e.tipo === 'conocida' ? [-1] : []
    })
  return usados.length ? Math.max(...usados) + 1 : 0
}

/**
 * Los `n` primeros valores de `orden` que NO usa ninguna ajena del perfil, para
 * repartirlos entre sus conocidas al reordenar: `reorder` numeraba las
 * conocidas 0..n-1 sin mirar a las ajenas, y una conocida acababa con el mismo `orden`
 * que una ajena —el empate que `siguienteOrden` evita al dar de alta—, así que la
 * versión que las entiende todas perdía el sitio de la ajena entre ellas. Así, las
 * ajenas se quedan donde estaban y las conocidas llenan los huecos en el orden pedido.
 * Sin ajenas en el perfil es 0..n-1, lo de siempre.
 */
export function huecosDeOrden(reg: Registro, profileId: string, n: number): number[] {
  const ocupados = new Set<number>()
  for (const e of reg.entradas) {
    if (e.tipo !== 'ajena' || perfilDeEntrada(e) !== profileId) continue
    const o = ordenDe(e)
    if (o !== null) ocupados.add(o)
  }
  const huecos: number[] = []
  for (let i = 0; huecos.length < n; i++) if (!ocupados.has(i)) huecos.push(i)
  return huecos
}

/** Cuál de las entradas con un mismo id se borra (ver `quitarPorId`). */
export type TipoEntrada = Entrada['tipo']

/**
 * El tipo de entrada que pide el renderer en `DELETE` (`DbBorrarConexion.ajena`): `true`
 * la ajena, `false` la conocida. Cualquier otra cosa —ausente, de una versión anterior
 * del renderer, o algo que no es un booleano— es `undefined`: la que resuelve el id, la
 * conocida. Nunca se adivina «ajena» de un valor raro: borrar la ajena por error dejaría
 * viva la conocida que el usuario quiso eliminar.
 */
export function tipoEntradaPedida(ajena: unknown): TipoEntrada | undefined {
  if (ajena === true) return 'ajena'
  if (ajena === false) return 'conocida'
  return undefined
}

/**
 * Las entradas sin LA que se pidió (conocida o ajena: se borran por el mismo camino), el
 * perfil de la quitada (`null` si no había ninguna o no traía perfil) y cuántas quedan
 * con ese mismo id.
 *
 * UNA SOLA ENTRADA. Antes se quitaban TODAS las del id, y una conocida y una
 * ajena que lo compartían —solo pasa por una edición a mano, o por pegar a mano una
 * conexión de otra versión— se iban juntas al eliminar una, sin que el diálogo, que
 * nombra solo la que se pulsó, lo dijera. `tipo` dice cuál: la fila que se pulsó sabe si
 * es conocida o ajena. Sin él, la que resuelve ese id en el resto del store —la
 * conocida, que es la que ven `get`, `update` o `secretOf`— y si no hay, la primera
 * ajena. Dos del MISMO tipo con el mismo id (también a mano) se borran de una en una,
 * la primera primero, que es la misma a la que resuelve el id en todo lo demás. Solo
 * pueden ser dos AJENAS: la segunda conocida de un id ya se lee como
 * ajena (`entradasDeLista`), así que la fila pulsada de una conocida y la de su copia se
 * distinguen por el tipo; y entre dos ajenas, por el `alias` de la fila pulsada
 * (`DbBorrarConexion.alias`: la copia de una conocida y una de motor con su mismo id, p. ej.).
 * Si ninguna ajena de ese id lleva ese alias, NO se quita ninguna: una vista vieja no puede
 * llevarse otra en su lugar. Dos ajenas con el mismo id Y el mismo alias son idénticas para la
 * UI, y se borran de una en una, la primera primero.
 *   Y SOLO ENTRE LAS DEL PERFIL de la fila pulsada (`perfil`, `DbBorrarConexion.profileId`).
 * La UI lista las ajenas de UN perfil, pero el id y el alias se buscaban en
 * TODO el registro: con la misma copia pegada en dos perfiles —o una en su perfil y otra en el
 * de la original—, eliminar la de este se llevaba la PRIMERA del archivo, la del otro, y la
 * pulsada seguía en su sitio (y el renderer desmontaba el id en este perfil aunque su entrada
 * siguiera). Con el perfil, la del otro no es candidata; si ninguna de este casa, no se quita
 * nada, igual que con un alias que no casa. Sin perfil (un llamador de antes), todo el
 * registro, como siempre: una conocida es única por id (`entradasDeLista`) y no cambia nada.
 * `quedan` cuenta las que siguen con ese id (conocidas o ajenas). NO decide qué se
 * limpia por id al borrar: eso es de la CONOCIDA, la única que el explorador abre, y se
 * limpia salvo que siga habiendo una conocida con ese id (ver `ConnectionStore.remove`).
 */
export function quitarPorId(
  entradas: readonly Entrada[],
  id: string,
  tipo?: TipoEntrada,
  alias?: string,
  perfil?: string
): { entradas: Entrada[]; perfil: string | null; quitadas: number; quedan: number; tipo: TipoEntrada | null } {
  const delId = entradas.filter((e) => idDeEntrada(e) === id)
  const candidatas = perfil === undefined ? delId : delId.filter((e) => perfilDeEntrada(e) === perfil)
  // Con el alias de la fila AJENA pulsada, esa y ninguna otra: se compara
  // con el MISMO alias que la UI enseña (`describirAjena`), y si ninguna casa no se borra nada.
  const elegida =
    tipo === 'ajena' && alias !== undefined
      ? candidatas.find((e) => e.tipo === 'ajena' && describirAjena(e.crudo)?.alias === alias)
      : tipo !== undefined
        ? candidatas.find((e) => e.tipo === tipo)
        : (candidatas.find((e) => e.tipo === 'conocida') ?? candidatas[0])
  if (!elegida) return { entradas: [...entradas], perfil: null, quitadas: 0, quedan: delId.length, tipo: null }
  return {
    entradas: entradas.filter((e) => e !== elegida),
    perfil: perfilDeEntrada(elegida),
    quitadas: 1,
    quedan: delId.length - 1,
    tipo: elegida.tipo
  }
}

/**
 * Qué se hace, tras un DELETE, con lo que cuelga del id en el explorador (sesiones con su
 * pool autenticado, consolas, historial, caché del catálogo). Es de la CONOCIDA a la que
 * resuelve el id —la única que el explorador abre—, así que depende de qué se borró y de
 * a qué resuelve el id DESPUÉS:
 *   - 'borrada': ya no queda ninguna conocida con ese id. Se limpia todo
 *     (`onConexionBorrada`), también si se borró una ajena y no había conocida (sus
 *     consolas de cuando era conocida van a la papelera, como con cualquier borrado).
 *   - 'ninguna': se borró una AJENA y sigue la conocida que compartía su id. Lo que cuelga
 *     del id es de esa conocida, que no ha cambiado: no se toca.
 *   - 'cambiada': se borró una CONOCIDA y queda OTRA con el mismo id (dos conocidas con un
 *     id repetido: solo por una edición a mano).
 *     El id pasa a resolver a otra conexión —otro servidor, otro usuario—, y las
 *     sesiones abiertas son de la borrada. Con 'ninguna' seguían vivas y una consola que
 *     el panel pintaba bajo la que queda ejecutaba contra el servidor de la borrada. Es
 *     lo mismo que editar la conexión (`onConexionEditada`: se retiran sus procesos y se
 *     invalida la caché), sin mandar a la papelera las consolas, que siguen con el id.
 *     Ya no la produce ninguna lectura del registro (la segunda
 *     conocida de un id se lee como ajena, `entradasDeLista`): se queda como DEFENSA, por si
 *     algún camino futuro dejara dos conocidas con un id. Borrar la conocida que comparte id
 *     con una ajena por id repetido es 'borrada' (no queda conocida): se limpia todo y se
 *     desmonta, y la ajena no hereda sus montajes; al reiniciar, será la conocida de ese id.
 *   - 'delPerfil': se borró una AJENA y la conocida de su id es de
 *     OTRO perfil (la copia pegada en otro perfil, `DbComparteId` 'otroPerfil'). Lo que cuelga
 *     del id A SECAS —las sesiones con su pool, la caché del catálogo— es de esa conocida, que
 *     no ha cambiado, y NO se toca: cerrarlas revertiría la transacción pendiente de alguien
 *     de otro perfil. Pero lo que cuelga de (perfil, id) —las consolas y el historial de ESTE
 *     perfil (de cuando la copia se abría como la original) y sus montajes en los proyectos de
 *     este perfil— ya no es de nadie: se limpia (`onConexionOlvidadaEnPerfil`, que en la app
 *     es `ExploradorController.alOlvidarConexionEnPerfil`; y el renderer desmonta el id solo
 *     en los proyectos de ESTE perfil, sin llevarse los del otro: ver
 *     `DbConexionBorrada.conocidaEnOtroPerfil` y `olvidarEnPerfilTrasBorrar`). Antes, `quedaConocida` miraba TODOS los perfiles y
 *     daba 'ninguna': las consolas se quedaban huérfanas. Ceñir `quedaConocida` al perfil sin
 *     más habría dado 'borrada', que cierra las sesiones de la conocida del otro perfil y
 *     desmonta su id en TODOS los proyectos: por eso es una salida propia.
 * Si no se borró nada, 'ninguna': no se avisa de un borrado que no ocurrió.
 *
 * `quedaConocida` es la conocida del id en el perfil de la borrada, y `conocidaEnOtroPerfil`
 * la de otro (`ConnectionStore.borrar`); nunca las dos, porque una conocida es única por id.
 * Si se borró una CONOCIDA y queda la de otro perfil (tampoco puede pasar hoy: la única de un
 * id era la borrada), el id pasa a resolver a otra conexión: 'cambiada', por la misma defensa.
 */
export type LimpiezaTrasBorrar = 'ninguna' | 'borrada' | 'cambiada' | 'delPerfil'

export function limpiezaTrasBorrar(r: {
  borrada: boolean
  tipo: TipoEntrada | null
  quedaConocida: boolean
  conocidaEnOtroPerfil?: boolean
}): LimpiezaTrasBorrar {
  if (!r.borrada) return 'ninguna'
  const otro = r.conocidaEnOtroPerfil === true
  if (r.tipo === 'conocida') return r.quedaConocida || otro ? 'cambiada' : 'borrada'
  if (r.quedaConocida) return 'ninguna'
  return otro ? 'delPerfil' : 'borrada'
}

/**
 * Las entradas de perfiles que siguen existiendo. Las ajenas se podan igual que las
 * conocidas (una SQLite de un perfil borrado es igual de huérfana); las que no traen un
 * perfil legible se CONSERVAN: no se sabe de quién son, y «no lo toco».
 */
export function podarPerfiles(entradas: readonly Entrada[], idsVivos: ReadonlySet<string>): Entrada[] {
  return entradas.filter((e) => {
    const perfil = perfilDeEntrada(e)
    return perfil === null || idsVivos.has(perfil)
  })
}

/**
 * La entrada tras editarla desde el formulario. `conservarAlEditar` decide qué
 * sobrevive —y trabaja sobre el crudo COMPLETO del previo, así que sus reglas deciden
 * también sobre las claves futuras y los valores no entendidos—; aquí se vuelve a
 * SEPARAR, porque su resultado puede traer claves que el DTO no debe ver.
 *
 * @param nuevo el registro reconstruido del formulario, con `secretEnc` ya cifrado si
 *              la contraseña es un texto nuevo (ver `conservarAlEditar`).
 */
export function editarConocida(previa: EntradaConocida, nuevo: ConexionPersistida, password?: string): EntradaConocida {
  const previoCrudo = crudoDeConocida(previa) as unknown as ConexionPersistida
  const editado = conservarAlEditar(previoCrudo, nuevo, password)
  const separada = separarConocida(editado as unknown as Record<string, unknown>)
  // No puede pasar (el formulario se validó antes y da la forma conocida), pero si
  // pasara, tragárselo guardaría una conexión que la siguiente lectura trataría de ajena.
  if (!separada) throw new Error(`La conexión "${nuevo.alias}" no tiene una forma válida.`)
  return separada
}

/**
 * Valida una foto de introspección. Devuelve `undefined` si no tiene forma: el total
 * tiene que ser un entero >= 0 y el esquema por defecto un texto; `en`, si falta o
 * no es un número, pasa a 0 (fecha desconocida) en vez de tirar la foto entera.
 */
export function normalizarIntrospeccion(raw: unknown): DbIntrospeccion | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const o = raw as { totalEsquemas?: unknown; esquemaPorDefecto?: unknown; en?: unknown }
  const total = o.totalEsquemas
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) return undefined
  if (typeof o.esquemaPorDefecto !== 'string') return undefined
  const en = typeof o.en === 'number' && Number.isFinite(o.en) ? o.en : 0
  return { totalEsquemas: total, esquemaPorDefecto: o.esquemaPorDefecto, en }
}
