// =============================================================================
// Qué entradas de un ZIP son enlaces simbólicos y a qué apuntan, para instalar aplanado el
// Instant Client de Linux (`libclntsh.so -> libclntsh.so.19.1`): `fflate` da el destino del enlace
// como si fuera el contenido. Se lee del directorio central. Puro. Gemelo de `src/tdb/zipPlano.cjs`
// (el main no importa los `.cjs` de `tdb`); `test-zip-con-enlaces.mts` cruza los dos.
// Decisiones: docs/decisiones/bd/drivers-catalogo-y-matriz-oracle.md
// =============================================================================

const FIRMA_FIN = 0x06054b50
const FIRMA_CENTRAL = 0x02014b50
const SISTEMA_UNIX = 3
const TIPO_ARCHIVO = 0o170000
const TIPO_ENLACE = 0o120000

/** Los nombres de las entradas hechas en Unix con el tipo de enlace; un ZIP ilegible da ninguno. */
export function enlacesDelZip(zip: Uint8Array): Set<string> {
  const enlaces = new Set<string>()
  const vista = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  let fin = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (vista.getUint32(i, true) === FIRMA_FIN) {
      fin = i
      break
    }
  }
  if (fin < 0) return enlaces
  const total = vista.getUint16(fin + 10, true)
  let p = vista.getUint32(fin + 16, true)
  const texto = new TextDecoder()
  for (let n = 0; n < total && p + 46 <= zip.length; n++) {
    if (vista.getUint32(p, true) !== FIRMA_CENTRAL) break
    const hechoEn = vista.getUint16(p + 4, true) >> 8
    const largoNombre = vista.getUint16(p + 28, true)
    const largoExtra = vista.getUint16(p + 30, true)
    const largoComentario = vista.getUint16(p + 32, true)
    const atributos = vista.getUint32(p + 38, true)
    if (hechoEn === SISTEMA_UNIX && ((atributos >>> 16) & TIPO_ARCHIVO) === TIPO_ENLACE) {
      enlaces.add(texto.decode(zip.subarray(p + 46, p + 46 + largoNombre)))
    }
    p += 46 + largoNombre + largoExtra + largoComentario
  }
  return enlaces
}

/**
 * Destino válido de un enlace del paquete: un nombre de la MISMA carpeta (se aplana), sin barras
 * ni `..`; `null` si no. Uno que saliera de ella apuntaría a cualquier sitio del disco.
 */
export function destinoDeEnlace(datos: Uint8Array): string | null {
  const destino = new TextDecoder().decode(datos)
  // eslint-disable-next-line no-control-regex
  if (destino === '' || destino === '.' || destino === '..' || /[/\\\u0000-\u001f]/.test(destino)) return null
  return destino
}
