// =============================================================================
// Pila de niveles del autocompletado SQL: recorre los tokens anteriores al cursor,
// abre un nivel por cada `(` y anota en cada uno su cláusula (SELECT, FROM, ON…) y
// sus tablas; `decidir` dice qué cabe en la posición del cursor.
// Puro: depende de `tokensSql`, `referenciasSql` y `shared/sql`; lo usan
// `contextoSql` y `estrellaSql`.
// Decisiones: docs/decisiones/bd/ui-autocompletado-contexto.md
// =============================================================================

import type { DbTipoObjeto } from '../../../../../shared/db-explorador-ipc.ts'
import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import type { Token } from '../../../../../shared/sql/lexicoSql.ts'
import { PALABRAS_CONECTORAS } from '../../../../../shared/sql/palabrasSql.ts'
import { clasificarParen, leerRef, listaDelFrom, type ClaseNivel, type RefTabla } from './referenciasSql.ts'
import { conjunto, es, esPalabra } from './tokensSql.ts'

/** Lo que puede ir en un FROM, un JOIN, un UPDATE o un INSERT. */
export const TIPOS_RELACION: readonly DbTipoObjeto[] = [
  'tabla',
  'vista',
  'vistaMaterializada',
  'tablaForanea',
  'tablaVirtual',
  'sinonimo'
]
/** Lo que se invoca con CALL / EXEC. */
const TIPOS_INVOCABLES: readonly DbTipoObjeto[] = ['rutina', 'paquete', 'sinonimo']

/** Tras estas, un `(` vacío espera una subconsulta: se ofrece SELECT/WITH. */
const ABREN_SUBCONSULTA = conjunto('FROM JOIN EXISTS AS LATERAL UNION INTERSECT MINUS EXCEPT INTO')

/** Palabras tras las que la expresión NO está completa (esperan un operando). */
const NO_OPERANDO = conjunto('PRIOR ESCAPE NOCYCLE SIBLINGS')

/** Verbos cuya sentencia nombra un objeto por su tipo: `DROP VIEW v`, `ALTER PACKAGE p`. */
const VERBOS_DE_OBJETO = conjunto('CREATE DROP ALTER COMMENT GRANT REVOKE REFRESH AUDIT ANALYZE')

const TIPOS_POR_PALABRA: ReadonlyMap<string, readonly DbTipoObjeto[]> = new Map<string, readonly DbTipoObjeto[]>([
  ['VIEW', ['vista']],
  ['SEQUENCE', ['secuencia']],
  ['SYNONYM', ['sinonimo']],
  ['PACKAGE', ['paquete']],
  ['PROCEDURE', ['rutina']],
  ['FUNCTION', ['rutina']],
  ['TYPE', ['tipoObjeto', 'tipoColeccion', 'tipo']],
  ['TRIGGER', ['disparador']]
])

export type Clausula =
  // de columnas
  | 'SELECT'
  | 'EXPR'
  | 'ON'
  | 'SET'
  // de objetos
  | 'FROM'
  | 'JOIN'
  | 'INTO'
  | 'UPDATE'
  | 'USING'
  | 'TABLE'
  | 'DESC'
  | 'RUTINA'
  | 'ON_OBJETO'
  | 'OBJETO'
  // de gramática
  | 'VALUES'
  | 'CONJUNTO'
  | 'UPDATE_INTERNO'
  | 'OTRA'

const CLAUSULAS_DE_COLUMNAS: ReadonlySet<Clausula> = new Set<Clausula>(['SELECT', 'EXPR', 'ON', 'SET'])

/** Cláusulas que introducen un objeto, con los tipos que admiten (undefined = todos). */
const TIPOS_DE_INTRODUCTOR: ReadonlyMap<Clausula, readonly DbTipoObjeto[] | undefined> = new Map<
  Clausula,
  readonly DbTipoObjeto[] | undefined
>([
  ['FROM', TIPOS_RELACION],
  ['JOIN', TIPOS_RELACION],
  ['INTO', TIPOS_RELACION],
  ['UPDATE', TIPOS_RELACION],
  ['USING', TIPOS_RELACION],
  ['TABLE', TIPOS_RELACION],
  ['DESC', undefined],
  ['ON_OBJETO', undefined],
  ['RUTINA', TIPOS_INVOCABLES],
  ['OBJETO', undefined]
])

/** Tras `AS` en estas cláusulas se está escribiendo un alias: no se sugiere nada. */
const ALIAS_TRAS_AS: ReadonlySet<Clausula> = new Set<Clausula>(['SELECT', 'FROM', 'JOIN', 'USING', 'INTO', 'UPDATE'])

export interface Nivel {
  clase: ClaseNivel
  previo: string | null
  ref: RefTabla | null
  /** Primera palabra del nivel ('' si empezó con otra cosa; null si aún está vacío). */
  primera: string | null
  clausula: Clausula | null
  tipos: readonly DbTipoObjeto[] | undefined
  /** Tokens del nivel tras su cláusula; un grupo ya cerrado cuenta como su `)`. */
  tras: Token[]
  /** Hubo FROM/JOIN/USING: el ON es el de un join (columnas), no el de CREATE INDEX. */
  vioFrom: boolean
  /** Hubo UPDATE: el SET es el de un UPDATE (columnas), no el de ALTER SESSION. */
  vioUpdate: boolean
  /** Tablas del FROM y de los JOIN de la consulta de ESTE nivel, en orden. */
  refs: RefTabla[]
  /** La tabla del último JOIN (null si fue una subconsulta o una función de tabla). */
  ultimaJoin: RefTabla | null
  /** El último JOIN lleva ON (no es NATURAL, CROSS ni un APPLY). */
  joinConOn: boolean
  /** La palabra que abrió la cláusula actual (su caja manda en lo que se inserta). */
  palabraClausula: Token | null
}

function nuevoNivel(clase: ClaseNivel, previo: string | null, ref: RefTabla | null): Nivel {
  return {
    clase,
    previo,
    ref,
    primera: null,
    clausula: null,
    tipos: undefined,
    tras: [],
    vioFrom: false,
    vioUpdate: false,
    refs: [],
    ultimaJoin: null,
    joinConOn: false,
    palabraClausula: null
  }
}

/** Lo que puede ir entre NATURAL/CROSS y su JOIN. */
const ENTRE_TIPO_Y_JOIN = conjunto('LEFT RIGHT FULL INNER OUTER')

/**
 * ¿El JOIN de `sig[i]` lleva ON? No en `NATURAL [LEFT|…] [OUTER] JOIN`, `CROSS JOIN`
 * ni `CROSS/OUTER APPLY`: sugerir ahí una condición daría SQL que no compila.
 */
function joinLlevaOn(sig: readonly Token[], i: number): boolean {
  if (sig[i].valor === 'APPLY') return false
  let k = i - 1
  while (k >= 0 && sig[k].tipo === 'palabra' && ENTRE_TIPO_Y_JOIN.has(sig[k].valor)) k--
  return !esPalabra(sig[k], 'NATURAL', 'CROSS')
}

/**
 * Anota en `n` las tablas que introduce la cláusula que empieza en `sig[i]`: la lista
 * de un FROM, la tabla de un JOIN. Un SELECT nuevo en el mismo nivel (tras UNION)
 * empieza otra consulta y olvida las de la anterior.
 */
function anotarRefs(n: Nivel, c: Clausula, sig: readonly Token[], i: number, d: DialectoSql, texto: string | undefined): void {
  if (c === 'SELECT') {
    n.refs = []
    n.ultimaJoin = null
  } else if (c === 'FROM') {
    n.refs.push(...listaDelFrom(sig, i, d, texto))
  } else if (c === 'JOIN') {
    const l = leerRef(sig, i + 1, d, texto, true)
    n.ultimaJoin = l.ref
    n.joinConOn = joinLlevaOn(sig, i)
    if (l.ref) n.refs.push(l.ref)
  }
}

export type Posicion =
  | { tipo: 'ninguno' }
  | { tipo: 'claves' }
  | { tipo: 'objetos'; tipos?: readonly DbTipoObjeto[] }
  | { tipo: 'columnas'; soloDe: RefTabla | null; conClaves: boolean }

const CLAVES: Posicion = { tipo: 'claves' }
const NADA: Posicion = { tipo: 'ninguno' }

function objetosPos(tipos: readonly DbTipoObjeto[] | undefined): Posicion {
  return tipos ? { tipo: 'objetos', tipos } : { tipo: 'objetos' }
}

interface CambioClausula {
  clausula: Clausula
  tipos?: readonly DbTipoObjeto[]
}

/** Palabras que abren siempre la misma cláusula. */
const CLAUSULA_FIJA: ReadonlyMap<string, Clausula> = new Map<string, Clausula>([
  ['SELECT', 'SELECT'],
  ['JOIN', 'JOIN'],
  ['APPLY', 'JOIN'],
  ['WHERE', 'EXPR'],
  ['HAVING', 'EXPR'],
  ['RETURNING', 'EXPR'],
  ['INTO', 'INTO'],
  ['USING', 'USING'],
  ['TABLE', 'TABLE'],
  ['CALL', 'RUTINA'],
  ['VALUES', 'VALUES'],
  ['UNION', 'CONJUNTO'],
  ['INTERSECT', 'CONJUNTO'],
  ['MINUS', 'CONJUNTO'],
  ['EXCEPT', 'CONJUNTO'],
  ['LIMIT', 'OTRA'],
  ['OFFSET', 'OTRA'],
  ['FETCH', 'OTRA']
])

interface EntornoPalabra {
  prev: Token | undefined
  n: Nivel
  /** Primer token de la sentencia, en el nivel raíz. */
  alInicio: boolean
}

type ClausulaSegun = (e: EntornoPalabra) => Clausula | null

// El DESC de SQL*Plus y el EXEC/EXECUTE de cliente solo cuentan a inicio de sentencia:
// el DESC de ORDER BY o un EXECUTE IMMEDIATE dentro de un bloque no están al inicio.
function alInicioComo(c: Clausula): ClausulaSegun {
  return (e) => (e.alInicio ? c : null)
}

/** Palabras cuya cláusula depende de lo que las rodea (null = no la cambian). */
const CLAUSULA_SEGUN: ReadonlyMap<string, ClausulaSegun> = new Map<string, ClausulaSegun>([
  ['FROM', (e) => (esPalabra(e.prev, 'DISTINCT') ? null : 'FROM')],
  ['ON', (e) => (e.n.vioFrom ? 'ON' : 'ON_OBJETO')],
  ['SET', (e) => (e.n.vioUpdate ? 'SET' : 'OTRA')],
  ['BY', (e) => (esPalabra(e.prev, 'ORDER', 'GROUP', 'PARTITION', 'CONNECT', 'SIBLINGS') ? 'EXPR' : null)],
  ['WITH', (e) => (esPalabra(e.prev, 'START') ? 'EXPR' : null)],
  ['UPDATE', (e) => (esPalabra(e.prev, 'FOR', 'DO', 'THEN') ? 'UPDATE_INTERNO' : 'UPDATE')],
  ['TRUNCATE', alInicioComo('TABLE')],
  ['DESC', alInicioComo('DESC')],
  ['DESCRIBE', alInicioComo('DESC')],
  ['EXEC', alInicioComo('RUTINA')],
  ['EXECUTE', alInicioComo('RUTINA')]
])

/** En `CREATE/DROP/ALTER… <TIPO>`: el objeto que se nombra, por su tipo. */
function clausulaDeObjeto(v: string, prev: Token | undefined, n: Nivel, raiz: Nivel): CambioClausula | null {
  if (n !== raiz || raiz.primera === null || !VERBOS_DE_OBJETO.has(raiz.primera)) return null
  if (v === 'VIEW' && esPalabra(prev, 'MATERIALIZED')) return { clausula: 'OBJETO', tipos: ['vistaMaterializada'] }
  const tipos = TIPOS_POR_PALABRA.get(v)
  return tipos ? { clausula: 'OBJETO', tipos } : null
}

/** ¿La cláusula `n` cambia con la palabra `sig[i]`? */
function clausulaDe(sig: readonly Token[], i: number, n: Nivel, raiz: Nivel): CambioClausula | null {
  const v = sig[i].valor
  const prev = i > 0 ? sig[i - 1] : undefined
  const fija = CLAUSULA_FIJA.get(v)
  if (fija !== undefined) return { clausula: fija }
  const segun = CLAUSULA_SEGUN.get(v)
  if (segun !== undefined) {
    const c = segun({ prev, n, alInicio: n === raiz && i === 0 })
    return c === null ? null : { clausula: c }
  }
  return clausulaDeObjeto(v, prev, n, raiz)
}

/** La expresión que acaba en `tras` está completa (lo siguiente puede ser AND, FROM, AS…). */
function terminaOperando(tras: readonly Token[]): boolean {
  const u = tras[tras.length - 1]
  switch (u.tipo) {
    case 'identCitado':
    case 'cadena':
    case 'numero':
    case 'bind':
    case 'parenC':
      return true
    case 'palabra':
      return !PALABRAS_CONECTORAS.has(u.valor) && !NO_OPERANDO.has(u.valor)
    case 'operador': {
      // `*` comodín (`select *`, `e.*`), no la multiplicación.
      if (u.valor !== '*') return false
      const p = tras[tras.length - 2]
      return p === undefined || es(p, 'coma') || es(p, 'punto') || esPalabra(p, 'DISTINCT', 'ALL')
    }
    default:
      return false
  }
}

function segunClausula(c: Clausula, tipos: readonly DbTipoObjeto[] | undefined, tras: readonly Token[]): Posicion {
  const ult = tras.length > 0 ? tras[tras.length - 1] : undefined
  if (esPalabra(ult, 'AS')) return ALIAS_TRAS_AS.has(c) ? NADA : CLAVES
  if (TIPOS_DE_INTRODUCTOR.has(c)) {
    if (!ult || (c === 'FROM' && ult.tipo === 'coma')) {
      return objetosPos(c === 'OBJETO' ? tipos : TIPOS_DE_INTRODUCTOR.get(c))
    }
    return CLAVES
  }
  if (CLAUSULAS_DE_COLUMNAS.has(c)) {
    return { tipo: 'columnas', soloDe: null, conClaves: !ult || terminaOperando(tras) }
  }
  return CLAVES
}

/** Transparente: una expresión entre paréntesis vale lo que la cláusula que la contiene. */
function segunContenedor(pila: readonly Nivel[], n: Nivel): Posicion {
  for (let k = pila.length - 2; k >= 0; k--) {
    const p = pila[k]
    if (p.clase === 'funcion') return { tipo: 'columnas', soloDe: null, conClaves: true }
    if (p.clausula !== null) {
      if (!CLAUSULAS_DE_COLUMNAS.has(p.clausula)) return CLAVES
      return { tipo: 'columnas', soloDe: null, conClaves: n.tras.length === 0 || terminaOperando(n.tras) }
    }
    if (p.clase !== 'grupo') return CLAVES
  }
  return CLAVES
}

/** Grupo sin cláusula propia: un `(` recién abierto o una expresión entre paréntesis. */
function decidirGrupo(pila: readonly Nivel[], n: Nivel): Posicion {
  const padre = pila[pila.length - 2]
  if (n.tras.length === 0 && n.previo !== null && ABREN_SUBCONSULTA.has(n.previo)) return CLAVES
  if (n.previo === 'USING') {
    // `MERGE … USING (` espera una subconsulta; `JOIN t USING (`, columnas.
    return padre.primera === 'MERGE' ? CLAVES : { tipo: 'columnas', soloDe: null, conClaves: false }
  }
  return segunContenedor(pila, n)
}

/** Qué cabe en el nivel del cursor (el último de la pila). */
export function decidir(pila: readonly Nivel[]): Posicion {
  const n = pila[pila.length - 1]
  if (n.clase === 'funcion') return { tipo: 'columnas', soloDe: null, conClaves: true }
  if (n.clase === 'definicion') return CLAVES
  if (n.clausula !== null) return segunClausula(n.clausula, n.tipos, n.tras)
  if (n.clase === 'columnasDe') return { tipo: 'columnas', soloDe: n.ref, conClaves: false }
  if (n.clase === 'raiz') return CLAVES
  return decidirGrupo(pila, n)
}

function abrirClausula(n: Nivel, c: CambioClausula, t: Token): void {
  n.clausula = c.clausula
  n.tipos = c.tipos
  n.tras = []
  n.palabraClausula = t
  if (c.clausula === 'FROM' || c.clausula === 'JOIN' || c.clausula === 'USING') n.vioFrom = true
  if (c.clausula === 'UPDATE' || c.clausula === 'UPDATE_INTERNO') n.vioUpdate = true
}

/** Si la palabra `sig[i]` abre una cláusula en `n` (o se ignora), la aplica y da true. */
function consumirPalabra(
  sig: readonly Token[],
  i: number,
  n: Nivel,
  raiz: Nivel,
  d: DialectoSql,
  texto: string | undefined
): boolean {
  const t = sig[i]
  if (t.tipo !== 'palabra' || n.clase === 'funcion') return false
  // `PACKAGE BODY` / `TYPE BODY`: el BODY no cuenta como "ya se escribió el nombre".
  if (t.valor === 'BODY' && n.clausula === 'OBJETO' && n.tras.length === 0) return true
  const c = clausulaDe(sig, i, n, raiz)
  if (c === null) return false
  abrirClausula(n, c, t)
  anotarRefs(n, c.clausula, sig, i, d, texto)
  return true
}

/**
 * Recorre `sig` (lo anterior al elemento que se escribe) con una pila de niveles y la
 * devuelve tal como queda al final: el último es el nivel del cursor.
 */
export function recorrer(sig: readonly Token[], d: DialectoSql, texto: string | undefined): Nivel[] {
  const raiz = nuevoNivel('raiz', null, null)
  const pila: Nivel[] = [raiz]
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i]
    const n = pila[pila.length - 1]
    if (t.tipo === 'parenA') {
      if (n.primera === null) n.primera = ''
      const p = clasificarParen(sig, i, raiz.primera, d, texto)
      pila.push(nuevoNivel(p.clase, p.previo, p.ref))
    } else if (t.tipo === 'parenC') {
      if (pila.length > 1) pila.pop()
      pila[pila.length - 1].tras.push(t)
    } else {
      if (n.primera === null) n.primera = t.tipo === 'palabra' ? t.valor : ''
      if (!consumirPalabra(sig, i, n, raiz, d, texto)) n.tras.push(t)
    }
  }
  return pila
}
