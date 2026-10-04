// =============================================================================
// Catálogo de codificaciones de texto soportadas por el editor (indicador +
// selector de la barra de estado). Datos PUROS (sin dependencias): el MAIN los usa
// para decodificar/codificar con iconv-lite (`iconv` + `bom`), y el RENDERER para
// pintar la etiqueta del encoding actual y las opciones del selector (`id` + `label`).
//
// `id` es una clave estable propia (no la de iconv) para no acoplar el contrato IPC
// a los alias de iconv-lite. La lista sigue el conjunto habitual de los editores.
// =============================================================================

export interface EncodingSpec {
  /** Clave estable que viaja por IPC (FileContent.encoding, WriteFileRequest.encoding). */
  id: string
  /** Etiqueta legible para el indicador y el selector. */
  label: string
  /** Nombre que entiende iconv-lite para (de)codificar. */
  iconv: string
  /** true si esta codificación lleva BOM (se añade al escribir, se descarta al leer). */
  bom?: boolean
}

/** Codificación por defecto cuando no se detecta otra cosa. */
export const DEFAULT_ENCODING = 'utf8'

export const ENCODINGS: readonly EncodingSpec[] = [
  { id: 'utf8', label: 'UTF-8', iconv: 'utf8' },
  { id: 'utf8bom', label: 'UTF-8 con BOM', iconv: 'utf8', bom: true },
  { id: 'utf16le', label: 'UTF-16 LE', iconv: 'utf16-le', bom: true },
  { id: 'utf16be', label: 'UTF-16 BE', iconv: 'utf16-be', bom: true },
  { id: 'windows1252', label: 'Occidental (Windows 1252)', iconv: 'windows-1252' },
  { id: 'iso88591', label: 'Occidental (ISO 8859-1)', iconv: 'iso-8859-1' },
  { id: 'iso885915', label: 'Occidental (ISO 8859-15)', iconv: 'iso-8859-15' },
  { id: 'macroman', label: 'Occidental (Mac Roman)', iconv: 'macroman' },
  { id: 'windows1250', label: 'Europa Central (Windows 1250)', iconv: 'windows-1250' },
  { id: 'iso88592', label: 'Europa Central (ISO 8859-2)', iconv: 'iso-8859-2' },
  { id: 'windows1251', label: 'Cirílico (Windows 1251)', iconv: 'windows-1251' },
  { id: 'iso88595', label: 'Cirílico (ISO 8859-5)', iconv: 'iso-8859-5' },
  { id: 'koi8r', label: 'Cirílico (KOI8-R)', iconv: 'koi8-r' },
  { id: 'windows1253', label: 'Griego (Windows 1253)', iconv: 'windows-1253' },
  { id: 'iso88597', label: 'Griego (ISO 8859-7)', iconv: 'iso-8859-7' },
  { id: 'windows1254', label: 'Turco (Windows 1254)', iconv: 'windows-1254' },
  { id: 'windows1255', label: 'Hebreo (Windows 1255)', iconv: 'windows-1255' },
  { id: 'windows1256', label: 'Árabe (Windows 1256)', iconv: 'windows-1256' },
  { id: 'windows1257', label: 'Báltico (Windows 1257)', iconv: 'windows-1257' },
  { id: 'windows1258', label: 'Vietnamita (Windows 1258)', iconv: 'windows-1258' },
  { id: 'windows874', label: 'Tailandés (Windows 874)', iconv: 'windows-874' },
  { id: 'shiftjis', label: 'Japonés (Shift JIS)', iconv: 'shift_jis' },
  { id: 'eucjp', label: 'Japonés (EUC-JP)', iconv: 'euc-jp' },
  { id: 'gbk', label: 'Chino simplificado (GBK)', iconv: 'gbk' },
  { id: 'gb18030', label: 'Chino simplificado (GB18030)', iconv: 'gb18030' },
  { id: 'big5', label: 'Chino tradicional (Big5)', iconv: 'big5' },
  { id: 'euckr', label: 'Coreano (EUC-KR)', iconv: 'euc-kr' }
] as const

/** Índice id -> spec (para el main y el renderer). */
const BY_ID = new Map(ENCODINGS.map((e) => [e.id, e]))

/** Spec por id, o la de UTF-8 si el id es desconocido (nunca devuelve undefined). */
export function encodingSpec(id: string): EncodingSpec {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_ENCODING)!
}

/** Etiqueta legible de un id (o el propio id si no está en el catálogo). */
export function encodingLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id
}
