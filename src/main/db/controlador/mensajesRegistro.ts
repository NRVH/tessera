// =============================================================================
// Los avisos del registro de conexiones (`db-connections.json`) que llegan al usuario: formato ajeno,
// archivo ilegible, principal recuperado del `.bak`, copia aparte fallida y escritura fallida. Son textos
// fijos que nombran el archivo y nunca su ruta; `tdb` lleva copia de algunos y `test-shim` los compara.
// Los reexporta `registroConexiones.ts`, que es por donde se importan.
// Decisiones: docs/decisiones/bd/conexiones-registro-crash-safe.md
// =============================================================================

/**
 * El aviso de cuando el formato entero no es uno que esta versión sepa escribir. Nombra los dos orígenes
 * posibles (una versión más nueva o una edición a mano) y dice que tras corregirlo hay que reiniciar,
 * porque el registro se lee una vez, al arrancar.
 */
export const MENSAJE_FORMATO_AJENO =
  'Esta versión de Tessera no reconoce el formato del registro de conexiones ' +
  '(db-connections.json) y no sabe escribirlo sin estropearlo, así que no lo toca. ' +
  'Puede venir de una versión más nueva de Tessera (actualiza para añadir conexiones) ' +
  'o de una edición a mano del archivo (corrígelo y reinicia Tessera, que lo lee al arrancar).'

/**
 * Por qué no se puede leer el registro: tiene contenido y no es JSON, o existe y no se deja abrir
 * (`codigo`: el del error, `EACCES`, `EBUSY`…).
 */
export type CausaRegistroIlegible = { tipo: 'roto' } | { tipo: 'inaccesible'; codigo: string }

/**
 * Qué pasa con el `.bak` de un registro bloqueado por ilegible: no hay (`ausente`), hay y tampoco se lee
 * (`inservible`), o se lee pero no se usa (`legible`, con un principal que no se deja abrir).
 */
export type EstadoRespaldo = 'ausente' | 'inservible' | 'legible'

/**
 * El aviso de un registro que no se puede leer y por eso no se toca: nombra el archivo, dice qué hacer y
 * qué pasa con el `.bak`. `tdb` lleva una copia de este texto (`mensajeRegistroIlegible` en `tdbRegistro.cjs`).
 */
export function mensajeRegistroIlegible(causa: CausaRegistroIlegible, respaldo: EstadoRespaldo): string {
  const que = causa.tipo === 'roto' ? 'no es JSON válido' : `no se pudo abrir (${causa.codigo})`
  const copia =
    respaldo === 'inservible'
      ? ', y su copia de respaldo (db-connections.json.bak) tampoco sirve'
      : respaldo === 'legible'
        ? ', y su copia de respaldo (db-connections.json.bak), aunque se lee, no se usa: la próxima ' +
          'escritura sustituiría el registro sin haber podido guardarlo aparte'
        : ''
  const remedio =
    causa.tipo === 'roto'
      ? 'corrígelo (suele ser una edición a mano: una coma de más, una comilla sin cerrar)'
      : 'revisa sus permisos, o si otro programa lo tiene abierto en exclusiva,'
  // Lo que pasa mientras tanto no va aquí: lo dice cada superficie a su manera.
  return (
    `No se puede leer el registro de conexiones (db-connections.json): ${que}${copia}. ` +
    `Tessera no lo toca para no perder lo que tiene dentro: ${remedio} y reinicia Tessera, ` +
    'que lo lee al arrancar.'
  )
}

/** Lo que se añade al nombre del principal para guardar aparte un principal roto: `db-connections.json.ilegible`. */
export const SUFIJO_COPIA_ILEGIBLE = '.ilegible'

/** Cuántos nombres con fecha se prueban si el mismo segundo ya tiene copia. */
const COPIAS_POR_SEGUNDO = 9

/**
 * Los sufijos que se prueban, en orden, para la copia aparte del principal roto: `.ilegible`, el mismo con
 * la fecha y hora locales, y `-2`, `-3`… Quien los prueba crea el archivo con `wx`, así que un nombre
 * ocupado nunca se pisa. Con la fecha por parámetro, para que su prueba no dependa del reloj.
 */
export function sufijosCopiaIlegible(fecha: Date): string[] {
  const dos = (n: number): string => String(n).padStart(2, '0')
  const sello =
    `${fecha.getFullYear()}${dos(fecha.getMonth() + 1)}${dos(fecha.getDate())}-` +
    `${dos(fecha.getHours())}${dos(fecha.getMinutes())}${dos(fecha.getSeconds())}`
  const conFecha = `${SUFIJO_COPIA_ILEGIBLE}-${sello}`
  return [SUFIJO_COPIA_ILEGIBLE, conFecha, ...Array.from({ length: COPIAS_POR_SEGUNDO - 1 }, (_, i) => `${conFecha}-${i + 2}`)]
}

/**
 * El aviso no bloqueante de un registro cuyo principal no es JSON y se suplió con el `.bak`
 * (`DbListaConexiones.recuperado`). `sufijoCopia` es `null` mientras no se ha escrito (se dice en futuro,
 * con el nombre que se intentará primero) y el de la copia ya guardada después: cada variante cuenta el
 * estado de cuando se dice. Avisa de que a lo rescatado puede faltarle el último cambio.
 */
export function mensajeRegistroRecuperado(sufijoCopia: string | null): string {
  return sufijoCopia === null
    ? 'El registro de conexiones (db-connections.json) no es JSON válido: se usan las conexiones ' +
        'de su copia de respaldo (db-connections.json.bak), a la que puede faltarle el último cambio. ' +
        'Antes de volver a guardarlo, Tessera conservará el archivo dañado aparte, como ' +
        `db-connections.json${SUFIJO_COPIA_ILEGIBLE} (con la fecha detrás si ese nombre ya existe), ` +
        'para que no se pierda lo que tenía.'
    : 'El registro de conexiones (db-connections.json) no era JSON válido: se recuperaron las ' +
        'conexiones de su copia de respaldo (db-connections.json.bak), a la que puede faltarle el ' +
        'último cambio, y el archivo dañado se conservó aparte, como ' +
        `db-connections.json${sufijoCopia}, antes de sustituirlo: si echas algo en falta, está ahí.`
}

/**
 * El error de una escritura que no se hizo porque la copia aparte del principal roto no se pudo guardar:
 * sin copia no se sustituye. `fase` dice qué falló: `escribir` la copia (lo normal) o `leer` el principal
 * para copiarlo, que apunta a otro remedio.
 */
export function mensajeCopiaIlegibleFallida(codigo: string, fase: 'escribir' | 'leer' = 'escribir'): string {
  const inicio =
    'No se guardó el cambio: el registro de conexiones (db-connections.json) no es JSON válido, ' +
    'y antes de sustituirlo Tessera guarda una copia aparte ' +
    `(db-connections.json${SUFIJO_COPIA_ILEGIBLE}), `
  return fase === 'leer'
    ? `${inicio}pero ahora el archivo no se deja leer para copiarlo (${codigo}). El archivo no se ` +
        'toca: revisa sus permisos, o si otro programa lo tiene abierto en exclusiva, y vuelve a ' +
        'intentarlo.'
    : `${inicio}que no se pudo escribir (${codigo}). El archivo no se toca: revisa los permisos ` +
        'de su carpeta, o apártalo tú (muévelo a otro sitio) y vuelve a intentarlo.'
}

/**
 * El error de una escritura del registro que falló en la E/S misma. Sustituye al de `fs`, que lleva en su
 * `message` las rutas del host. Nombra el archivo, el código, que el registro sigue como estaba y el remedio
 * de cada causa; sin plataforma a propósito, porque el código no distingue antivirus de permiso.
 */
export function mensajeEscrituraRegistroFallida(codigo: string): string {
  const remedio =
    codigo === 'ENOSPC'
      ? 'No queda espacio en el disco: libera espacio y vuelve a intentarlo.'
      : codigo === 'EBUSY'
        ? 'Otro programa lo tiene abierto en exclusiva: ciérralo y vuelve a intentarlo.'
        : codigo === 'EACCES' || codigo === 'EPERM' || codigo === 'EROFS'
          ? 'Revisa los permisos de su carpeta, o si otro programa (un antivirus, una sincronización ' +
            'en la nube) lo tiene abierto, y vuelve a intentarlo.'
          : 'Vuelve a intentarlo; si se repite, revisa los permisos de su carpeta y el espacio libre en el disco.'
  return (
    `No se guardó el cambio: no se pudo escribir el registro de conexiones (db-connections.json) (${codigo}). ` +
    `El registro sigue como estaba. ${remedio}`
  )
}
