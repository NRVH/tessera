// =============================================================================
// Qué recursos de un .html no van a cargar en la vista previa. Un iframe sobre `blob:` falla en
// dos casos: los relativos (un blob no tiene carpeta) y los absolutos (hereda la CSP del renderer).
// Solo cuentan los subrecursos, no los enlaces. No es un parser: nada de seguridad se decide aquí.
// Puro: lo carga `node` a secas.
// =============================================================================

/** Un recurso que la vista no va a poder cargar, y por qué. */
export interface RecursoBloqueado {
  /** La URL tal cual aparece en el archivo. */
  url: string
  /**
   * 'relativo' = no resuelve (el blob no tiene carpeta).
   * 'red'      = resuelve pero la CSP del renderer lo bloquea.
   */
  motivo: 'relativo' | 'red'
}

/** `src` carga siempre; `href` sólo cuando es de un `<link>` (hoja de estilos, icono). */
const SUBRECURSOS = /(?:\bsrc\s*=|<link\b[^>]*?\bhref\s*=)\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi

/** Esquemas que ya resuelven sin carpeta: sólo pueden fallar por la CSP. */
const CON_ESQUEMA = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

/** Los que NO cargan solos porque ni siquiera son una petición: anclas y vacíos. */
const NO_ES_PETICION = /^(?:#|$)/

/** Esquemas embebidos en el documento, que sí cargan (`data:` y `blob:` los permite la CSP). */
const EMBEBIDO = /^(?:data|blob):/i

/** Los subrecursos que NO cargan en la vista previa, con su motivo; como mucho `tope`. */
export function recursosBloqueados(html: string, tope = 6): RecursoBloqueado[] {
  const fuera: RecursoBloqueado[] = []
  const vistos = new Set<string>()
  for (const m of html.matchAll(SUBRECURSOS)) {
    const url = (m[1] ?? m[2] ?? m[3] ?? '').trim()
    if (NO_ES_PETICION.test(url) || EMBEBIDO.test(url)) continue
    if (vistos.has(url)) continue
    vistos.add(url)
    fuera.push({ url, motivo: CON_ESQUEMA.test(url) ? 'red' : 'relativo' })
    if (fuera.length >= tope) break
  }
  return fuera
}

/** ¿Hay algo que no va a cargar? Atajo legible para la condición del aviso. */
export function tieneRecursosBloqueados(html: string): boolean {
  return recursosBloqueados(html, 1).length > 0
}

/** El texto del aviso, o `null` si no hay nada que avisar. Vive aquí para poder fijarlo con un test. */
export function avisoVistaHtml(html: string): string | null {
  const bloqueados = recursosBloqueados(html)
  if (bloqueados.length === 0) return null
  const relativos = bloqueados.filter((r) => r.motivo === 'relativo').map((r) => r.url)
  const red = bloqueados.filter((r) => r.motivo === 'red').map((r) => r.url)

  const partes: string[] = []
  if (relativos.length > 0) {
    partes.push(`la página se carga sin su carpeta, así que no resuelven: ${relativos.join(', ')}`)
  }
  if (red.length > 0) {
    partes.push(`esta vista no sale a la red, así que no se descargan: ${red.join(', ')}`)
  }
  return `Faltan recursos y por eso la página puede verse sin formato — ${partes.join('; y ')}. Tampoco se ejecuta JavaScript.`
}
