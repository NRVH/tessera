// =============================================================================
// Lectura de un TROZO de un JSONL (la cabeza o la cola) con sus líneas parseadas, para los
// lectores de los transcripts de los agentes (contexto, uso de cuenta, marcas de turno): abrir un
// fichero de megas y quedarse con sus últimas decenas de KiB. Un solo dueño de dos trampas: el
// corte parte una línea (la primera al leer la cola, la última al leer la cabeza; se tira solo si
// hubo recorte) y el agente escribe en vivo (un `JSON.parse` que lanza se salta, no tumba la
// lectura). Sin caché: quien llama ya cachea por (mtime, size).
// =============================================================================

import { open, stat } from 'node:fs/promises'

/**
 * Una línea de transcript ya parseada. Los campos declarados son los que comparten
 * los dos formatos (Claude Code y Codex); el resto se accede por índice porque cada
 * agente —y cada versión de cada agente— trae los suyos.
 */
export type LineaJsonl = Record<string, unknown> & {
  type?: string
  subtype?: string
  timestamp?: unknown
  payload?: Record<string, unknown>
}

/** Qué extremo del fichero se lee. */
export type ExtremoJsonl = 'head' | 'tail'

/** Hasta dónde crece la cola que busca una línea (`hastaQue`): el transcript puede ser de cientos de megas. */
export const TOPE_COLA_CRECIENTE = 8 * 1024 * 1024

/**
 * Lee `bytes` del extremo `extremo` de `file` y devuelve sus líneas parseadas, en el
 * orden del fichero. `size` es el tamaño ya conocido (del `stat` del walk) para no
 * repetir la llamada; con 0 se consulta aquí. Con `hastaQue`, una cola sin ninguna línea
 * que lo cumpla se vuelve a leer cuatro veces mayor, hasta `TOPE_COLA_CRECIENTE`: una sola
 * línea del transcript (la petición entera a la API) puede ocupar más que la ventana.
 */
export async function leerLineasJsonl(
  file: string,
  size: number,
  bytes: number,
  extremo: ExtremoJsonl,
  hastaQue?: (linea: LineaJsonl) => boolean
): Promise<LineaJsonl[]> {
  const conocido = size || (await stat(file)).size
  let ventana = Math.max(1, bytes)
  for (;;) {
    const lineas = await leerTrozo(file, conocido, ventana, extremo)
    const basta = hastaQue === undefined || extremo === 'head' || ventana >= conocido || ventana >= TOPE_COLA_CRECIENTE
    if (basta || lineas.some(hastaQue)) return lineas
    ventana = Math.min(ventana * 4, TOPE_COLA_CRECIENTE)
  }
}

/** Un trozo de `bytes` del extremo `extremo`, con sus líneas enteras parseadas. */
async function leerTrozo(file: string, conocido: number, bytes: number, extremo: ExtremoJsonl): Promise<LineaJsonl[]> {
  const querido = Math.min(conocido, bytes)
  const desde = extremo === 'tail' ? conocido - querido : 0
  const handle = await open(file, 'r')
  let crudo: string
  try {
    const buf = Buffer.alloc(querido)
    const { bytesRead } = await handle.read(buf, 0, querido, desde)
    crudo = buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
  const lineas = crudo.split('\n')
  // Solo si hubo recorte: con el fichero entero en el buffer no hay línea partida.
  if (extremo === 'tail' && desde > 0) lineas.shift()
  if (extremo === 'head' && conocido > querido) lineas.pop()
  const out: LineaJsonl[] = []
  for (const linea of lineas) {
    const t = linea.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t))
    } catch {
      // línea a medio escribir o corrupta: se ignora sin tumbar el resto
    }
  }
  return out
}
