// =============================================================================
// GET de texto con tope por la red de Chromium (`net.fetch`), con el proxy y los
// certificados del sistema. Lo usa el servicio de los agentes nativos para leer versiones
// publicadas; `src/main/agents/componer.ts` se lo inyecta como `fetchTexto`.
// =============================================================================

import { net } from 'electron'

/**
 * Descarga `url` como texto; falla si tarda más de `timeoutMs` (cuerpo incluido) o si el
 * HTTP no es 2xx, porque una página de error del proxy no es una versión.
 */
export async function fetchTextoConTope(url: string, timeoutMs: number): Promise<string> {
  const ac = new AbortController()
  const temporizador = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await net.fetch(url, { signal: ac.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.text()
  } catch (err) {
    if (ac.signal.aborted) throw new Error(`sin respuesta en ${Math.round(timeoutMs / 1000)} s`, { cause: err })
    throw err
  } finally {
    clearTimeout(temporizador)
  }
}
