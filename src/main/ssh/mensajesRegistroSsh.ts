// =============================================================================
// Los avisos del registro SSH (`ssh-connections.json`) que llegan al usuario: formato ajeno,
// archivo ilegible, recuperado del `.bak`, cambiado por fuera, copia aparte fallida y escritura
// fallida. Textos fijos que nombran el archivo y nunca su ruta. Puro y sin imports.
// Calca `db/controlador/mensajesRegistro.ts`, que no se toca: `tdb` guarda copia de aquellos textos.
// Decisiones: docs/decisiones/ssh/registro-y-claves.md
// =============================================================================

/** Cómo se nombra el archivo en todos los avisos. */
const ARCHIVO = 'el registro de conexiones SSH (ssh-connections.json)'

/** Un formato entero que esta versión no sabe escribir sin estropearlo. */
export const MENSAJE_FORMATO_AJENO_SSH =
  `Esta versión de Tessera no reconoce el formato de ${ARCHIVO} y no sabe escribirlo sin ` +
  'estropearlo, así que no lo toca. Puede venir de una versión más nueva de Tessera (actualice ' +
  'Tessera para añadir conexiones) o de una edición manual del archivo (corríjalo y reinicie Tessera, que ' +
  'lo lee al iniciar).'

/** Por qué no se puede leer: tiene contenido y no es JSON, o existe y no se deja abrir. */
export type CausaIlegibleSsh = { tipo: 'roto' } | { tipo: 'inaccesible'; codigo: string }

/** Qué pasa con el `.bak` de un registro bloqueado por ilegible. */
export type EstadoRespaldoSsh = 'ausente' | 'inservible' | 'legible'

/** El aviso de un registro que no se puede leer y por eso no se toca. */
export function mensajeRegistroIlegibleSsh(causa: CausaIlegibleSsh, respaldo: EstadoRespaldoSsh): string {
  const que = causa.tipo === 'roto' ? 'no es JSON válido' : `no se pudo abrir (${causa.codigo})`
  const copia =
    respaldo === 'inservible'
      ? ', y su copia de respaldo (ssh-connections.json.bak) tampoco sirve'
      : respaldo === 'legible'
        ? ', y su copia de respaldo (ssh-connections.json.bak), aunque se lee, no se usa: la próxima ' +
          'escritura sustituiría el registro sin haber podido guardarlo aparte'
        : ''
  const remedio =
    causa.tipo === 'roto'
      ? 'corríjalo (suele ser una edición manual: una coma de más, una comilla sin cerrar)'
      : 'revise sus permisos, o si otro programa lo tiene abierto en exclusiva,'
  return (
    `No se puede leer ${ARCHIVO}: ${que}${copia}. Tessera no lo toca para no perder lo que tiene ` +
    `dentro: ${remedio} y reinicie Tessera, que lo lee al iniciar.`
  )
}

/** Lo que se añade al nombre del principal roto al guardarlo aparte. */
export const SUFIJO_COPIA_ILEGIBLE_SSH = '.ilegible'

/** Cuántos nombres con fecha se prueban si el mismo segundo ya tiene copia. */
const COPIAS_POR_SEGUNDO = 9

/** Los sufijos que se prueban, en orden, para la copia aparte (con la fecha por parámetro). */
export function sufijosCopiaIlegibleSsh(fecha: Date): string[] {
  const dos = (n: number): string => String(n).padStart(2, '0')
  const sello =
    `${fecha.getFullYear()}${dos(fecha.getMonth() + 1)}${dos(fecha.getDate())}-` +
    `${dos(fecha.getHours())}${dos(fecha.getMinutes())}${dos(fecha.getSeconds())}`
  const conFecha = `${SUFIJO_COPIA_ILEGIBLE_SSH}-${sello}`
  return [SUFIJO_COPIA_ILEGIBLE_SSH, conFecha, ...Array.from({ length: COPIAS_POR_SEGUNDO - 1 }, (_, i) => `${conFecha}-${i + 2}`)]
}

/** El aviso no bloqueante de un principal que no era JSON y se suplió con el `.bak`. */
export function mensajeRegistroRecuperadoSsh(sufijoCopia: string | null): string {
  return sufijoCopia === null
    ? `${mayuscula(ARCHIVO)} no es JSON válido: se usan las conexiones de su copia de respaldo ` +
        '(ssh-connections.json.bak), a la que puede faltarle el último cambio. Antes de volver a ' +
        'guardarlo, Tessera conservará el archivo dañado aparte, como ' +
        `ssh-connections.json${SUFIJO_COPIA_ILEGIBLE_SSH} (con la fecha detrás si ese nombre ya existe).`
    : `${mayuscula(ARCHIVO)} no era JSON válido: se recuperaron las conexiones de su copia de ` +
        'respaldo (ssh-connections.json.bak), a la que puede faltarle el último cambio, y el archivo ' +
        `dañado se conservó aparte, como ssh-connections.json${sufijoCopia}: si falta algún dato, está en ese archivo.`
}

/** Una escritura que no se hizo porque el principal cambió por fuera con Tessera abierta. */
export const MENSAJE_CAMBIADO_FUERA_SSH =
  `No se guardó el cambio: ${ARCHIVO} cambió fuera de Tessera mientras estaba abierta, y ` +
  'sobrescribirlo perdería ese cambio. Reinicie Tessera, que lo lee al iniciar.'

/** El principal roto que se suplió con el `.bak` se corrigió a mano con Tessera abierta. */
export const MENSAJE_RESCATADO_CORREGIDO_SSH =
  `No se guardó el cambio: ${ARCHIVO} ya es JSON válido, pero Tessera sigue con las conexiones ` +
  'de su copia de respaldo (ssh-connections.json.bak), que leyó al iniciar porque entonces no lo ' +
  'era, y sustituirlo ahora perdería lo que usted corrigió. Reinicie Tessera, que lo lee al iniciar.'

/** La copia aparte del principal roto no se pudo guardar: sin copia no se sustituye. */
export function mensajeCopiaIlegibleFallidaSsh(codigo: string, fase: 'escribir' | 'leer' = 'escribir'): string {
  const inicio =
    `No se guardó el cambio: ${ARCHIVO} no es JSON válido, y antes de sustituirlo Tessera guarda ` +
    `una copia aparte (ssh-connections.json${SUFIJO_COPIA_ILEGIBLE_SSH}), `
  return fase === 'leer'
    ? `${inicio}pero ahora el archivo no se deja leer para copiarlo (${codigo}). El archivo no se ` +
        'toca: revise sus permisos, o si otro programa lo tiene abierto en exclusiva, y vuelva a intentarlo.'
    : `${inicio}que no se pudo escribir (${codigo}). El archivo no se toca: revise los permisos ` +
        'de su carpeta, o aparte el archivo (muévalo a otra ubicación) y vuelva a intentarlo.'
}

/** Una escritura que falló en la E/S misma; sustituye al error de `fs`, que lleva la ruta del host. */
export function mensajeEscrituraFallidaSsh(codigo: string): string {
  const remedio =
    codigo === 'ENOSPC'
      ? 'No queda espacio en el disco: libere espacio y vuelva a intentarlo.'
      : codigo === 'EBUSY'
        ? 'Otro programa lo tiene abierto en exclusiva: ciérrelo y vuelva a intentarlo.'
        : codigo === 'EACCES' || codigo === 'EPERM' || codigo === 'EROFS'
          ? 'Revise los permisos de su carpeta, o si otro programa (un antivirus, una sincronización ' +
            'en la nube) lo tiene abierto, y vuelva a intentarlo.'
          : 'Vuelva a intentarlo; si se repite, revise los permisos de su carpeta y el espacio libre en el disco.'
  return `No se guardó el cambio: no se pudo escribir ${ARCHIVO} (${codigo}). El registro sigue como estaba. ${remedio}`
}

function mayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}
