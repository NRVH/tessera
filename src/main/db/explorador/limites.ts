// =============================================================================
// Topes y plazos del explorador de bases de datos, cada uno con su porqué al lado. Puro: las
// pruebas los importan para fijar comportamiento sin repetir el número. No viven aquí los de
// la UI ni los ajustables (`shared/ajustesBd.ts`), los plazos del protocolo
// (`sesiones/correlador.ts`) ni los topes de bytes del trabajador (`src/tdb/celdas.cjs`).
// Decisiones: docs/decisiones/bd/sesiones-procesos-y-autoridad.md
// =============================================================================

import type { DbRolSesion } from '../../../shared/db-explorador-ipc.ts'
import { DB_INACTIVIDAD_CONSOLA_MIN_POR_DEFECTO, inactividadConsolaMs } from '../../../shared/ajustesBd.ts'

const SEGUNDO = 1000
const MINUTO = 60 * SEGUNDO

// --- Procesos y sesiones -----------------------------------------------------

/**
 * Procesos de sesión vivos a la vez (uno por conexión). Cada uno es un Electron
 * en modo Node, unos 40 MB. Al llegar al tope se expulsa por LRU uno OCIOSO y SIN
 * transacción; si no hay ninguno, la petición falla con `motivo: 'limite'` en vez
 * de matar trabajo del usuario.
 */
export const MAX_PROCESOS = 8

/**
 * Procesos PROPIOS de consola vivos a la vez (un motor que no se puede interrumpir,
 * `procesoPorSesion` del descriptor; hoy SQLite). Cada consola SQLite tiene el
 * suyo porque su Stop es matarlo (node:sqlite no tiene interrupt), y cada uno son ~37 MiB
 * (medido con la base abierta). Cuentan APARTE de `MAX_PROCESOS`, que sigue midiendo
 * CONEXIONES: si contaran allí, tres consolas de una SQLite dejarían sin sitio a tres
 * conexiones de Oracle. 8, como el tope de consolas vivas por conexión: al pasarse se
 * expulsa por LRU una consola ociosa y sin cambios pendientes (se reabre al usarla, 62 ms);
 * si no hay ninguna, `limite`. Descartado: un tope por conexión (8 × 8 = 64 procesos
 * posibles, más de 2 GiB).
 */
export const MAX_PROCESOS_CONSOLA = 8

/**
 * Sesiones de consola vivas por conexión. Cada consola tiene su propia sesión de
 * base de datos (su transacción), y cada sesión ocupa recursos del SERVIDOR, que
 * no es nuestro: sin tope, un usuario con veinte pestañas de consola abiertas
 * mantendría veinte sesiones contra una base compartida. Al pasarse se cierra la
 * menos usada sin transacción (aviso `expulsada`).
 */
export const MAX_CONSOLAS_VIVAS_POR_CONEXION = 8

/**
 * Lectores (cursores con filas por leer) vivos por sesión. En Oracle cuentan
 * contra `OPEN_CURSORS` (300 por defecto en 11g, compartido con los cursores
 * implícitos de PL/SQL): 8 deja margen de sobra. Al pasarse se cierra el más
 * viejo; su rejilla ofrece "Volver a ejecutar".
 */
export const MAX_LECTORES_POR_SESION = 8

// --- Inactividad y barrido ---------------------------------------------------

/**
 * `meta` (árbol y autocompletado) y `datos` (rejillas) no guardan nada del
 * usuario: se reabren solas y en silencio. 10 minutos evitan tener sesiones
 * ociosas colgando de una VPN toda la jornada.
 */
export const INACTIVIDAD_META_MS = 10 * MINUTO
export const INACTIVIDAD_DATOS_MS = 10 * MINUTO

/**
 * Una consola SÍ guarda estado del usuario (sus `ALTER SESSION`/`SET`), así que
 * aguanta más. Y NUNCA se cierra con una transacción pendiente o fallida: eso lo
 * decide la máquina de estados (`maquinaSesion.ts`), no este número.
 *
 * Es el valor POR DEFECTO de un ajuste («Cerrar la sesión
 * inactiva tras», Configuración › «Bases de datos»), y sale de allí
 * (`shared/ajustesBd.ts`) para que los dos no puedan discrepar. El gestor lo recibe
 * con `fijarAjustes` y lo pasa a `umbralInactividadMs`.
 */
export const INACTIVIDAD_CONSOLA_MS = inactividadConsolaMs(DB_INACTIVIDAD_CONSOLA_MIN_POR_DEFECTO)

/**
 * Un proceso sin ninguna sesión abierta sale tras este plazo. No es cero para que
 * una secuencia "cerrar consola / abrir otra" no pague un arranque de Electron y
 * una escalada thin→thick entre medias.
 */
export const PROCESO_SIN_SESIONES_MS = 60 * SEGUNDO

/** Cada cuánto corre `barrer(ahora)` en el main. La resolución de los plazos de arriba. */
export const BARRIDO_MS = 30 * SEGUNDO

/**
 * Plazo de inactividad según el rol de la sesión. `consolaMs`: el del ajuste del usuario
 * (`Infinity` = Nunca); `meta` y `datos` no son ajustables (ver `shared/ajustesBd.ts`).
 */
export function umbralInactividadMs(rol: DbRolSesion, consolaMs: number = INACTIVIDAD_CONSOLA_MS): number {
  if (rol === 'consola') return consolaMs
  if (rol === 'datos') return INACTIVIDAD_DATOS_MS
  return INACTIVIDAD_META_MS
}

// --- Tiempos de sentencia ------------------------------------------------------

/**
 * `callTimeout` (Oracle) / `statement_timeout` (PG) de la sesión `meta`. Una
 * consulta de catálogo que tarda más que esto está atascada (el caso más lento
 * previsto, ALL_OBJECTS de una 11g por VPN, es del orden de 10 s, y además el
 * índice de autocompletado se pide esquema a esquema). `datos` y consolas van a 0:
 * sin límite, porque el usuario tiene Stop. El vigilante de `meta` en el protocolo
 * (`PLAZOS_TRABAJADOR_MS.meta`) es mayor a propósito: primero tiene que saltar este.
 */
export const TIMEOUT_SQL_META_MS = 60 * SEGUNDO

// --- Cierre de la app ----------------------------------------------------------

/** `cerrarTodo(plazo)`: tiempo para que cada trabajador haga rollback + close. */
export const CIERRE_TRABAJADORES_MS = 2500
/** Espera máxima al acuse `dbx:consolas:vaciadas` del renderer antes de cerrar. */
export const ACUSE_VACIADO_MS = 1000

// --- Tamaños -------------------------------------------------------------------

/**
 * Nombres del índice de autocompletado. Con `todos` los esquemas y 151 esquemas
 * en una 11g, el índice pasaba de 500 000 entradas. Al llegar al tope se corta y
 * la UI lo avisa (`DbIndiceNombres.truncado`).
 */
export const TOPE_INDICE_AUTOCOMPLETADO = 200_000

/**
 * Elementos por lista `IN (…)` de Oracle: ORA-01795 ("maximum number of
 * expressions in a list is 1000"). El catálogo trocea los binds de esquemas en
 * listas de este tamaño.
 */
export const MAX_ELEMENTOS_LISTA_IN = 1000

// --- Exportar y valor completo ---------------------------------------------------

/**
 * Tope de `filasJson` por respuesta del trabajador al EXPORTAR (unidades UTF-16). La
 * rejilla usa 4 Mi porque lo que llega se pinta; exportar lo escribe en disco y
 * suelta, así que una página de 5000 filas con LOB enteros puede llegar más gorda.
 * 16 Mi (32 MB en memoria) acota lo que se tiene a la vez; si una página no cabe, el
 * trabajador la corta y la siguiente lectura sigue donde se quedó.
 */
export const TOPE_RESPUESTA_EXPORTACION = 16 * 1024 * 1024

/**
 * Archivos exportados que «Mostrar en la carpeta» recuerda (token -> ruta). Solo la
 * notificación de las últimas exportaciones lo ofrece; el tope evita que la tabla
 * crezca toda la jornada.
 */
export const EXPORTACIONES_RECORDADAS = 20

/** Cada cuánto, como mucho, se emite el progreso de una exportación. */
export const PROGRESO_EXPORTACION_MS = 250

// --- Historial de consultas ------------------------------------------------

/**
 * Entradas que se conservan por perfil. 5000 son semanas de trabajo diario (lo habitual en
 * un cliente de BD son miles por fuente) y el archivo se queda en pocos MB.
 */
export const TOPE_HISTORIAL_POR_PERFIL = 5000
/**
 * Entradas de más antes de compactar: sin margen, una vez lleno se reescribiría el
 * archivo entero en CADA sentencia; con 1000, una reescritura cada mil.
 */
export const MARGEN_COMPACTAR_HISTORIAL = 1000
/** Tamaño máximo del archivo de un perfil (unidades UTF-16), con muchas sentencias largas. */
export const TOPE_BYTES_HISTORIAL = 16 * 1024 * 1024
/**
 * Sentencias más largas que esto NO se guardan (256 Ki): suelen ser volcados de datos
 * y recortarlas dejaría un SQL roto con pinta de re-ejecutable.
 */
export const TOPE_SQL_HISTORIAL = 256 * 1024
/** Lo que devuelve `HISTORIAL_LISTAR` sin `limite`, y lo máximo (contrato). */
export const HISTORIAL_LISTAR_POR_DEFECTO = 200
export const HISTORIAL_LISTAR_MAX = 1000

// --- Explain ---------------------------------------------------------------------------

/** Tope de la celda con el JSON del plan de PG (un plan enorme pasa del 64 Ki de la rejilla). */
export const TOPE_PLAN_PG = 16 * 1024 * 1024

/**
 * Lo mismo para el XML de SHOWPLAN_XML de SQL Server, que es más verboso que
 * el JSON de PG (un plan de una consulta con una docena de joins pasa de 200 Ki). El servidor
 * lo corta con TEXTSIZE (el trabajador lo ajusta al tope), así que un plan más grande llega
 * recortado y se dice, en vez de enseñar un XML a medias.
 */
export const TOPE_PLAN_SQLSERVER = 16 * 1024 * 1024
