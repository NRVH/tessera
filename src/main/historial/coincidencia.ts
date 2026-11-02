// =============================================================================
// La coincidencia de `tctx buscar`: todas las palabras en el mensaje, en cualquier orden y también dentro de
// otra palabra, o la frase exacta (entre comillas o con `--exacta`); sin distinguir mayúsculas ni marcas
// (tildes, diéresis, la virgulilla de la ñ). Nada de expresiones del usuario. Y el trozo del mensaje
// alrededor de lo encontrado, en una línea. Puro: lo prueba `test-buscar-historial.mts`.
// Decisiones: docs/decisiones/agentes/buscar-en-el-historial.md
// =============================================================================

/** Lo más largo que puede ser el texto de una búsqueda (lo comprueban también `tctx` y la operación). */
export const MAX_TEXTO_BUSQUEDA = 200
/** Lo que mide como mucho el trozo de un mensaje, en caracteres, sin las marcas de recorte. */
export const ANCHO_TROZO = 300

const ELIPSIS = '…'
/** Cuánto se mira hacia atrás o hacia delante para no partir una palabra al recortar. */
const HOLGURA_PALABRA = 30
/** Las comillas que encierran una frase: las rectas y las tipográficas que deja un teclado o un corrector. */
const COMILLAS: ReadonlyArray<[string, string]> = [['"', '"'], ['“', '”'], ['«', '»']]

/** Qué se busca, ya normalizado. */
export interface Consulta {
  terminos: string[]
  frase: boolean
}

/**
 * El texto en minúsculas, sin marcas combinantes y con cada tirada de blancos como un espacio. La sigma griega
 * se unifica antes: `toLowerCase` da una u otra según lo que la rodea, y aquí el resultado de un texto entero
 * tiene que ser el de normalizar sus caracteres uno a uno (lo que hace el trozo).
 */
export function normalizarBusqueda(texto: string): string {
  return texto.replace(/[Σς]/g, 'σ').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ')
}

/** La consulta de un texto, o null si no queda nada que buscar. */
export function analizarConsulta(texto: string, exacta = false): Consulta | null {
  let t = texto.trim()
  let frase = exacta
  for (const [abre, cierra] of COMILLAS) {
    if (t.length >= 2 && t.startsWith(abre) && t.endsWith(cierra)) {
      t = t.slice(abre.length, t.length - cierra.length)
      frase = true
      break
    }
  }
  const normal = normalizarBusqueda(t).trim()
  if (normal === '') return null
  if (frase) return { terminos: [normal], frase: true }
  return { terminos: [...new Set(normal.split(' '))], frase: false }
}

/** ¿El texto, ya normalizado, tiene todos los términos? */
export function coincide(normalizado: string, c: Consulta): boolean {
  return c.terminos.every((t) => normalizado.includes(t))
}

/** La normalización carácter a carácter, con dónde empieza en el original cada carácter normalizado. */
function normalizarConMapa(texto: string): { normal: string; origen: number[] } {
  let normal = ''
  const origen: number[] = []
  let enBlanco = false
  for (let i = 0; i < texto.length; ) {
    const ch = String.fromCodePoint(texto.codePointAt(i) as number)
    if (/\s/.test(ch)) {
      if (!enBlanco) {
        normal += ' '
        origen.push(i)
      }
      enBlanco = true
    } else {
      enBlanco = false
      const n = normalizarBusqueda(ch)
      for (let k = 0; k < n.length; k++) origen.push(i)
      normal += n
    }
    i += ch.length
  }
  origen.push(texto.length)
  return { normal, origen }
}

/** Dónde empieza en el original el primer término que aparece; sin ninguno, el principio. */
function primeraAparicion(texto: string, c: Consulta): number {
  const { normal, origen } = normalizarConMapa(texto)
  let pos = -1
  for (const t of c.terminos) {
    const i = normal.indexOf(t)
    if (i >= 0 && (pos < 0 || i < pos)) pos = i
  }
  return pos < 0 ? 0 : origen[pos]
}

function esBajoDeSustituto(texto: string, i: number): boolean {
  const c = texto.charCodeAt(i)
  return c >= 0xdc00 && c <= 0xdfff
}

/** Mueve un corte al blanco más cercano en esa dirección, si hay uno a mano; nunca entre dos mitades de un emoji. */
function ajustarCorte(texto: string, corte: number, haciaDelante: boolean): number {
  let c = corte
  for (let paso = 0; paso < HOLGURA_PALABRA; paso++) {
    const i = haciaDelante ? corte + paso : corte - paso
    if (i <= 0 || i >= texto.length) break
    if (/\s/.test(texto[i])) {
      c = i
      break
    }
  }
  if (c > 0 && c < texto.length && esBajoDeSustituto(texto, c)) c += haciaDelante ? 1 : -1
  return c
}

/**
 * El trozo del mensaje alrededor de la primera aparición, de `ancho` caracteres como mucho, en una línea y
 * con «…» donde se recortó. Lo encontrado queda en el primer tercio: lo que sigue suele explicarlo.
 */
export function trozoAlrededor(texto: string, c: Consulta, ancho: number = ANCHO_TROZO): string {
  const inicio = primeraAparicion(texto, c)
  let desde = Math.max(0, inicio - Math.floor(ancho / 3))
  const hasta0 = Math.min(texto.length, desde + ancho)
  desde = Math.max(0, hasta0 - ancho)
  const ini = desde > 0 ? ajustarCorte(texto, desde, true) : 0
  const fin = hasta0 < texto.length ? ajustarCorte(texto, hasta0, false) : texto.length
  const cuerpo = texto.slice(ini, Math.max(ini, fin)).replace(/\s+/g, ' ').trim()
  return `${ini > 0 ? ELIPSIS : ''}${cuerpo}${fin < texto.length ? ELIPSIS : ''}`
}
