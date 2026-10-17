// =============================================================================
// Catálogo de codificaciones de texto soportadas por el editor (indicador +
// selector de la barra de estado). Datos PUROS (sin dependencias): el MAIN los usa
// para decodificar/codificar con iconv-lite (`iconv` + `bom`), y el RENDERER para
// pintar la etiqueta del encoding actual y las opciones del selector (`id` + etiqueta).
//
// `id` es una clave estable propia (no la de iconv) para no acoplar el contrato IPC
// a los alias de iconv-lite. La lista sigue el conjunto habitual de los editores. Las
// etiquetas dependen del idioma de la interfaz, así que se piden por función.
// =============================================================================
import { crearTextos } from './i18n.ts'

export interface EncodingSpec {
  /** Clave estable que viaja por IPC (FileContent.encoding, WriteFileRequest.encoding). */
  id: string
  /** Nombre que entiende iconv-lite para (de)codificar. */
  iconv: string
  /** true si esta codificación lleva BOM (se añade al escribir, se descarta al leer). */
  bom?: boolean
}

/** Codificación por defecto cuando no se detecta otra cosa. */
export const DEFAULT_ENCODING = 'utf8'

export const ENCODINGS: readonly EncodingSpec[] = [
  { id: 'utf8', iconv: 'utf8' },
  { id: 'utf8bom', iconv: 'utf8', bom: true },
  { id: 'utf16le', iconv: 'utf16-le', bom: true },
  { id: 'utf16be', iconv: 'utf16-be', bom: true },
  { id: 'windows1252', iconv: 'windows-1252' },
  { id: 'iso88591', iconv: 'iso-8859-1' },
  { id: 'iso885915', iconv: 'iso-8859-15' },
  { id: 'macroman', iconv: 'macroman' },
  { id: 'windows1250', iconv: 'windows-1250' },
  { id: 'iso88592', iconv: 'iso-8859-2' },
  { id: 'windows1251', iconv: 'windows-1251' },
  { id: 'iso88595', iconv: 'iso-8859-5' },
  { id: 'koi8r', iconv: 'koi8-r' },
  { id: 'windows1253', iconv: 'windows-1253' },
  { id: 'iso88597', iconv: 'iso-8859-7' },
  { id: 'windows1254', iconv: 'windows-1254' },
  { id: 'windows1255', iconv: 'windows-1255' },
  { id: 'windows1256', iconv: 'windows-1256' },
  { id: 'windows1257', iconv: 'windows-1257' },
  { id: 'windows1258', iconv: 'windows-1258' },
  { id: 'windows874', iconv: 'windows-874' },
  { id: 'shiftjis', iconv: 'shift_jis' },
  { id: 'eucjp', iconv: 'euc-jp' },
  { id: 'gbk', iconv: 'gbk' },
  { id: 'gb18030', iconv: 'gb18030' },
  { id: 'big5', iconv: 'big5' },
  { id: 'euckr', iconv: 'euc-kr' }
] as const

/** Las etiquetas por id, en los dos idiomas. */
const txEncodings = crearTextos(
  {
    etiquetas: {
      utf8: 'UTF-8',
      utf8bom: 'UTF-8 con BOM',
      utf16le: 'UTF-16 LE',
      utf16be: 'UTF-16 BE',
      windows1252: 'Occidental (Windows 1252)',
      iso88591: 'Occidental (ISO 8859-1)',
      iso885915: 'Occidental (ISO 8859-15)',
      macroman: 'Occidental (Mac Roman)',
      windows1250: 'Europa Central (Windows 1250)',
      iso88592: 'Europa Central (ISO 8859-2)',
      windows1251: 'Cirílico (Windows 1251)',
      iso88595: 'Cirílico (ISO 8859-5)',
      koi8r: 'Cirílico (KOI8-R)',
      windows1253: 'Griego (Windows 1253)',
      iso88597: 'Griego (ISO 8859-7)',
      windows1254: 'Turco (Windows 1254)',
      windows1255: 'Hebreo (Windows 1255)',
      windows1256: 'Árabe (Windows 1256)',
      windows1257: 'Báltico (Windows 1257)',
      windows1258: 'Vietnamita (Windows 1258)',
      windows874: 'Tailandés (Windows 874)',
      shiftjis: 'Japonés (Shift JIS)',
      eucjp: 'Japonés (EUC-JP)',
      gbk: 'Chino simplificado (GBK)',
      gb18030: 'Chino simplificado (GB18030)',
      big5: 'Chino tradicional (Big5)',
      euckr: 'Coreano (EUC-KR)'
    } as Record<string, string>
  },
  {
    etiquetas: {
      utf8: 'UTF-8',
      utf8bom: 'UTF-8 with BOM',
      utf16le: 'UTF-16 LE',
      utf16be: 'UTF-16 BE',
      windows1252: 'Western (Windows 1252)',
      iso88591: 'Western (ISO 8859-1)',
      iso885915: 'Western (ISO 8859-15)',
      macroman: 'Western (Mac Roman)',
      windows1250: 'Central European (Windows 1250)',
      iso88592: 'Central European (ISO 8859-2)',
      windows1251: 'Cyrillic (Windows 1251)',
      iso88595: 'Cyrillic (ISO 8859-5)',
      koi8r: 'Cyrillic (KOI8-R)',
      windows1253: 'Greek (Windows 1253)',
      iso88597: 'Greek (ISO 8859-7)',
      windows1254: 'Turkish (Windows 1254)',
      windows1255: 'Hebrew (Windows 1255)',
      windows1256: 'Arabic (Windows 1256)',
      windows1257: 'Baltic (Windows 1257)',
      windows1258: 'Vietnamese (Windows 1258)',
      windows874: 'Thai (Windows 874)',
      shiftjis: 'Japanese (Shift JIS)',
      eucjp: 'Japanese (EUC-JP)',
      gbk: 'Simplified Chinese (GBK)',
      gb18030: 'Simplified Chinese (GB18030)',
      big5: 'Traditional Chinese (Big5)',
      euckr: 'Korean (EUC-KR)'
    }
  }
)

/** Índice id -> spec (para el main y el renderer). */
const BY_ID = new Map(ENCODINGS.map((e) => [e.id, e]))

/** Spec por id, o la de UTF-8 si el id es desconocido (nunca devuelve undefined). */
export function encodingSpec(id: string): EncodingSpec {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_ENCODING)!
}

/** Etiqueta legible de un id (o el propio id si no está en el catálogo). */
export function encodingLabel(id: string): string {
  return BY_ID.has(id) ? (txEncodings().etiquetas[id] ?? id) : id
}

/** Las opciones del selector, con la etiqueta en el idioma de la interfaz. */
export function encodingOpciones(): { id: string; label: string }[] {
  return ENCODINGS.map((e) => ({ id: e.id, label: encodingLabel(e.id) }))
}
