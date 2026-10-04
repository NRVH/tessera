// =============================================================================
// Códec de texto del editor: DETECCIÓN de codificación y (de)codificación, por encima de
// iconv-lite (los muchos charsets) + jschardet (autodetección). Aislado aquí para que FileService
// solo pida "dame el texto y su encoding" / "escribe con este encoding". Los ids son los del
// catálogo compartido (shared/encodings). También lo usan git (blobs) y la búsqueda.
// PRINCIPIO: UTF-8 es el DEFAULT FUERTE. Si el buffer es UTF-8 válido se usa UTF-8 (lo normal, y
// sin pérdida); jschardet SOLO se consulta para buffers que NO son UTF-8 válido. Así un archivo
// UTF-8 nunca se muestra como mojibake por una clasificación dudosa.
// =============================================================================

import iconv from 'iconv-lite'
import jschardet from 'jschardet'
import { encodingSpec } from '../../shared/encodings'

/** Bytes que muestrea jschardet (prefijo): detectar sobre 2 MiB bloquearía el main. */
const DETECT_SAMPLE_BYTES = 64 * 1024

/** Bytes que se inspeccionan para decidir si un buffer es binario (ver isBinaryBuffer). */
const BINARY_SNIFF_BYTES = 8000

/**
 * Mapa NOMBRE-DE-JSCHARDET (en minúsculas) -> id del catálogo. jschardet devuelve
 * nombres tipo "windows-1252", "ISO-8859-2", "SHIFT_JIS"… que traducimos a nuestros
 * ids estables. Lo que no esté aquí cae al fallback de `detectEncoding`. UTF-8/ascii
 * no hacen falta: `detectEncoding` ya resuelve UTF-8 antes de mirar jschardet.
 */
const JSCHARDET_TO_ID: Record<string, string> = {
  'windows-1252': 'windows1252',
  'iso-8859-1': 'iso88591',
  'iso-8859-2': 'iso88592',
  'iso-8859-5': 'iso88595',
  'iso-8859-7': 'iso88597',
  'windows-1250': 'windows1250',
  'windows-1251': 'windows1251',
  'windows-1253': 'windows1253',
  'windows-1255': 'windows1255',
  'koi8-r': 'koi8r',
  'shift_jis': 'shiftjis',
  'euc-jp': 'eucjp',
  'gb2312': 'gbk',
  'gb18030': 'gb18030',
  big5: 'big5',
  'euc-kr': 'euckr',
  'tis-620': 'windows874'
}

/**
 * ¿`buffer` es UTF-8 válido? Validación estricta por secuencias de bytes (no por
 * caracteres de reemplazo, que un UTF-8 legítimo puede contener). Rechaza lead bytes
 * inválidos, continuaciones erróneas, sobre-codificaciones y codepoints fuera de
 * rango o de área surrogate.
 *
 * `allowTruncatedTail` (= el archivo se truncó a 2 MiB): SOLO entonces se tolera una
 * secuencia multibyte incompleta AL FINAL —el corte pudo partir un carácter—. En un
 * archivo COMPLETO un lead byte al final sin sus continuaciones NO es UTF-8 válido
 * (sería, p. ej., un latin1 acabado en 'é' 0xE9), así que se rechaza y cae a la
 * detección legacy. Aun tolerándola, las continuaciones que SÍ están deben ser
 * válidas (0x80-0xBF).
 */
function isUtf8(buffer: Buffer, allowTruncatedTail: boolean): boolean {
  const n = buffer.length
  let i = 0
  while (i < n) {
    const b = buffer[i]
    if (b <= 0x7f) {
      i++
      continue
    }
    let extra: number
    let min: number
    if (b >= 0xc2 && b <= 0xdf) {
      extra = 1
      min = 0x80
    } else if (b >= 0xe0 && b <= 0xef) {
      extra = 2
      min = 0x800
    } else if (b >= 0xf0 && b <= 0xf4) {
      extra = 3
      min = 0x10000
    } else {
      return false // lead byte inválido (0x80-0xC1, 0xF5-0xFF)
    }
    if (i + extra >= n) {
      if (!allowTruncatedTail) return false // archivo completo: no puede acabar a medias
      for (let k = 1; i + k < n; k++) {
        if ((buffer[i + k] & 0xc0) !== 0x80) return false // continuación presente inválida
      }
      return true
    }
    let cp = b & (0x7f >> extra)
    for (let k = 1; k <= extra; k++) {
      const c = buffer[i + k]
      if ((c & 0xc0) !== 0x80) return false // continuación inválida
      cp = (cp << 6) | (c & 0x3f)
    }
    if (cp < min) return false // sobre-codificación
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return false // fuera de rango / surrogate
    i += extra + 1
  }
  return true
}

/**
 * Detecta la codificación de `buffer` y devuelve un id del catálogo. Orden:
 *   1) BOM (definitivo): UTF-8/UTF-16 LE/BE.
 *   2) UTF-8 válido -> 'utf8' (DEFAULT FUERTE: lo normal, y sin pérdida).
 *   3) jschardet (sobre un prefijo) con confianza >= 0.5, mapeado a un id legacy.
 *   4) Fallback: 'windows1252' (el legacy más común).
 *
 * `opts.rapido` SALTA el paso 3 y cae directo al 4. Es para el BARRIDO de la
 * búsqueda en archivos, y el motivo es de coste: los pasos 1 y 2 son barridos de
 * bytes que cuestan nada, pero jschardet corre varios probers sobre 64 KiB, y en
 * un proyecto legacy en windows-1252 eso le toca a CADA archivo. Con miles de
 * fuentes son decenas de segundos — el grueso del tiempo de búsqueda, gastado en
 * reconfirmar lo que el fallback ya iba a decir.
 *
 * Va como MODO de esta función y no como criterio aparte a propósito: si la
 * búsqueda tuviera su propia detección, acabaría discrepando con el editor sobre
 * la codificación del mismo archivo. Aquí es el mismo camino con un escalón menos.
 *
 * Lo que se pierde, dicho claramente: en un archivo Shift-JIS, KOI8-R o Big5, una
 * consulta con caracteres NO ASCII puede no casar. Una consulta ASCII casa igual
 * en todos ellos, y el caso frecuente —acentos en un archivo windows-1252— también
 * casa, porque windows-1252 es justo el fallback.
 */
export function detectEncoding(
  buffer: Buffer,
  truncated = false,
  opts: { rapido?: boolean } = {}
): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return 'utf8bom'
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf16le'
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf16be'

  if (isUtf8(buffer, truncated)) return 'utf8'

  if (opts.rapido === true) return 'windows1252'

  try {
    const res = jschardet.detect(buffer.subarray(0, DETECT_SAMPLE_BYTES))
    if (res && res.encoding && res.confidence >= 0.5) {
      const id = JSCHARDET_TO_ID[res.encoding.toLowerCase()]
      if (id) return id
    }
  } catch {
    // jschardet nunca debería lanzar; si lo hace, caemos al fallback de abajo.
  }

  return 'windows1252'
}

/** Decodifica `buffer` a texto Unicode según el id (descartando BOM si lo lleva). */
export function decodeText(buffer: Buffer, id: string): string {
  const spec = encodingSpec(id)
  // stripBOM: iconv quita el BOM de UTF-8/16 al decodificar, así el editor no lo ve.
  return iconv.decode(buffer, spec.iconv, { stripBOM: true })
}

/** Codifica `text` a bytes según el id (añadiendo BOM si la codificación lo lleva). */
export function encodeText(text: string, id: string = 'utf8'): Buffer {
  const spec = encodingSpec(id)
  return iconv.encode(text, spec.iconv, { addBOM: spec.bom })
}

/**
 * ¿Guardar `text` con la codificación `id` PERDERÍA caracteres? iconv sustituye lo
 * no representable por '?', corrompiendo en silencio. Solo puede pasar en charsets
 * NO Unicode (single-byte/DBCS): UTF-8/16 representan todo. Round-trip: si al
 * decodificar lo codificado no vuelve el texto original, hubo pérdida.
 */
export function losesDataOnEncode(text: string, id: string): boolean {
  const spec = encodingSpec(id)
  if (/^utf/i.test(spec.iconv)) return false // Unicode: nunca pierde
  const bytes = iconv.encode(text, spec.iconv, { addBOM: spec.bom })
  return iconv.decode(bytes, spec.iconv, { stripBOM: true }) !== text
}

/**
 * ¿Este buffer es BINARIO? Heurística del byte NUL en el primer tramo: el texto real
 * (en cualquiera de los charsets del catálogo) no lleva NUL, y los formatos binarios
 * lo sueltan casi siempre en la cabecera.
 *
 * Vive aquí —y no en FileService, de donde salió— porque también la necesita
 * GitService: un blob del ÍNDICE o de un COMMIT puede ser un PNG o un JAR, y antes se
 * colaba al diff como texto basura (todo se forzaba a utf8, así que nadie preguntaba).
 * Una sola heurística para los dos caminos = el mismo veredicto en el editor y en el
 * diff para el mismo archivo.
 *
 * OJO con el falso positivo: UTF-16 sin BOM está lleno de NUL y se clasificaría como
 * binario. Es aceptable porque `detectEncoding` resuelve UTF-16 ANTES por su BOM, y un
 * UTF-16 sin BOM ya era indistinguible de bytes crudos en el resto del sistema.
 */
export function isBinaryBuffer(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, BINARY_SNIFF_BYTES)
  for (let i = 0; i < limit; i++) {
    if (buffer[i] === 0) return true
  }
  return false
}
