// =============================================================================
// El `*` de la lista de un SELECT para «Expandir columnas»: dónde está, con qué
// calificador y las tablas del FROM de SU nivel, o null si sustituirlo por una lista
// explícita cambiaría el resultado.
// Puro: depende de `clausulasSql`, `referenciasSql`, `tokensSql` y `shared/sql`.
// Decisiones: docs/decisiones/bd/ui-autocompletado-fks-y-estrella.md
// =============================================================================

import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import { dividirSentencias, sentenciaEnCursor, type Sentencia } from '../../../../../shared/sql/divisorSql.ts'
import { tokenizar, type Token } from '../../../../../shared/sql/lexicoSql.ts'
import { recorrer } from './clausulasSql.ts'
import { esNombreDeCte, leerRef, type RefTabla } from './referenciasSql.ts'
import { conjunto, es, esIdent, esPalabra, nombreDe, significativos } from './tokensSql.ts'

/** Un `*` de la lista de un SELECT, con lo que hace falta para sustituirlo por columnas. */
export interface EstrellaSelect {
  /** Rango del comodín en el texto, calificador incluido (`*` o `e.*`). */
  desde: number
  hasta: number
  /** `e.*`: el calificador plegado, parte a parte; null para el `*` suelto. */
  calificador: string[] | null
  /** El calificador TAL CUAL se escribió (`e`, `"Mi T"`): con él se califican las columnas. */
  calificadorEscrito: string | null
  /**
   * Las tablas del FROM de ESE select, en su orden. null si el `*` no se puede
   * sustituir sin cambiar el resultado: una fuente que no es del catálogo (subconsulta,
   * función de tabla, CTE), un NATURAL JOIN o un JOIN … USING (el `*` funde las
   * columnas comunes en una sola, la lista explícita las repetiría), o un PIVOT.
   */
  tablas: RefTabla[] | null
}

/** Lo que cierra la lista del FROM de una consulta, a su nivel de paréntesis. */
const FIN_DE_FROM = conjunto(`
  WHERE GROUP ORDER HAVING CONNECT START UNION INTERSECT MINUS EXCEPT WINDOW LIMIT
  OFFSET FETCH FOR MODEL QUALIFY RETURNING INTO
`)
/** Tras estas, el `*` ya no es la unión de las columnas de las tablas. */
const ROMPEN_ESTRELLA = conjunto('NATURAL USING PIVOT UNPIVOT MATCH_RECOGNIZE')
/** Lo que puede preceder al comodín de la lista del SELECT. */
const ANTES_DE_ESTRELLA = conjunto('SELECT DISTINCT ALL UNIQUE')

function nombresDeCte(sig: readonly Token[], d: DialectoSql, texto: string | undefined): Set<string> {
  const r = new Set<string>()
  for (let i = 0; i < sig.length; i++) if (esIdent(sig[i]) && esNombreDeCte(sig, i)) r.add(nombreDe(sig[i], d, texto))
  return r
}

/** Índice del FROM que sigue a `sig[desde]` en su MISMO nivel de paréntesis, o -1. */
function indiceDelFrom(sig: readonly Token[], desde: number): number {
  let prof = 0
  for (let m = desde; m < sig.length; m++) {
    const t = sig[m]
    if (t.tipo === 'parenA') prof++
    else if (t.tipo === 'parenC') {
      if (prof === 0) return -1
      prof--
    } else if (prof === 0 && esPalabra(t, 'FROM') && !esPalabra(sig[m - 1], 'DISTINCT')) return m
  }
  return -1
}

/** Lo que sigue a una fuente del FROM: otra fuente (tras coma, JOIN o APPLY), el fin o algo que rompe el `*`. */
type TrasFuente = { tipo: 'otra'; desde: number } | { tipo: 'fin' } | { tipo: 'rompe' }

function trasFuente(sig: readonly Token[], desde: number): TrasFuente {
  let prof = 0
  for (let m = desde; m < sig.length; m++) {
    const t = sig[m]
    if (t.tipo === 'parenA') prof++
    else if (t.tipo === 'parenC') {
      if (prof === 0) return { tipo: 'fin' }
      prof--
    } else if (prof === 0) {
      if (t.tipo === 'coma' || esPalabra(t, 'JOIN', 'APPLY')) return { tipo: 'otra', desde: m + 1 }
      if (t.tipo === 'palabra' && ROMPEN_ESTRELLA.has(t.valor)) return { tipo: 'rompe' }
      if (t.tipo === 'palabra' && FIN_DE_FROM.has(t.valor)) return { tipo: 'fin' }
    }
  }
  return { tipo: 'fin' }
}

/**
 * Las tablas del FROM que sigue a `sig[desde]` en su MISMO nivel de paréntesis, o
 * null si alguna no es sustituible (ver `EstrellaSelect.tablas`); [] si no hay FROM.
 */
function tablasDelFrom(sig: readonly Token[], desde: number, d: DialectoSql, texto: string | undefined): RefTabla[] | null {
  const f = indiceDelFrom(sig, desde)
  if (f < 0) return []
  const ctes = nombresDeCte(sig, d, texto)
  const tablas: RefTabla[] = []
  let m = f + 1
  for (;;) {
    const l = leerRef(sig, m, d, texto, true)
    if (!l.ref || (l.ref.esquema === null && ctes.has(l.ref.nombre))) return null
    tablas.push(l.ref)
    const s = trasFuente(sig, l.fin)
    if (s.tipo === 'rompe') return null
    if (s.tipo === 'fin') return tablas
    m = s.desde
  }
}

/** Índice del primer `*` que toca `[desde, hasta]`, o -1. */
function indiceEstrella(sig: readonly Token[], desde: number, hasta: number): number {
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i]
    if (t.desde > hasta) return -1
    if (t.tipo === 'operador' && t.valor === '*' && t.hasta >= desde) return i
  }
  return -1
}

/** Inicio de la cadena de calificadores `a.b.` pegada al comodín de `sig[k]`. */
function inicioCalificador(sig: readonly Token[], k: number): number {
  let ini = k
  while (
    ini >= 2 &&
    es(sig[ini - 1], 'punto') &&
    esIdent(sig[ini - 2]) &&
    sig[ini - 2].hasta === sig[ini - 1].desde &&
    sig[ini - 1].hasta === sig[ini].desde
  ) {
    ini -= 2
  }
  return ini
}

function precedeComodin(previo: Token | undefined): boolean {
  return es(previo, 'coma') || (previo !== undefined && previo.tipo === 'palabra' && ANTES_DE_ESTRELLA.has(previo.valor))
}

/**
 * El `*` de la lista de un SELECT que toca el rango `[desde, hasta]` (un cursor si son
 * iguales), o null. No lo es el de `count(*)`, el de una multiplicación ni el de un
 * `*` fuera de la lista del SELECT. Mismas coordenadas que `contextoEnTexto`.
 */
export function estrellaEn(
  texto: string,
  desde: number,
  hasta: number,
  d: DialectoSql,
  sentencias?: readonly Sentencia[]
): EstrellaSelect | null {
  const ss = sentencias ?? dividirSentencias(texto, d)
  const s = sentenciaEnCursor(ss, texto, desde)
  if (!s) return null
  const sig = significativos(tokenizar(texto, d, Math.min(s.desde, desde), Math.max(s.hasta, hasta)))
  const k = indiceEstrella(sig, desde, hasta)
  if (k < 0) return null
  const ini = inicioCalificador(sig, k)
  if (!precedeComodin(sig[ini - 1])) return null
  // Tiene que estar en la LISTA del SELECT de su nivel (no en los argumentos de una función).
  const pila = recorrer(sig.slice(0, ini), d, texto)
  const n = pila[pila.length - 1]
  if (n.clase === 'funcion' || n.clausula !== 'SELECT') return null
  const calificador: string[] = []
  for (let j = ini; j < k; j += 2) calificador.push(nombreDe(sig[j], d, texto))
  return {
    desde: sig[ini].desde,
    hasta: sig[k].hasta,
    calificador: calificador.length > 0 ? calificador : null,
    calificadorEscrito: ini < k && texto !== undefined ? texto.slice(sig[ini].desde, sig[k - 1].desde) : null,
    tablas: tablasDelFrom(sig, k + 1, d, texto)
  }
}
