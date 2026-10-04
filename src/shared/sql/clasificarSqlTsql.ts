// =============================================================================
// T-SQL: la clasificación de una UNIDAD. Se parte en tramos (`clasificarSqlTramos.ts`), cada tramo
// se clasifica con lo propio del dialecto o con la genérica ajustada, y la clase de la unidad es la
// del tramo MÁS PELIGROSO (escribe si alguno escribe, el peligro más grave, los SET de todos).
// Decisiones: docs/decisiones/bd/sql-tsql-unidad-entera.md
// =============================================================================

import { base, finDelParentesis, lectura, leerNombre, pal, refDe, crearVista, type Vista } from './clasificarSqlBase.ts'
import { analizarSelect } from './clasificarSqlConsulta.ts'
import { conjunto } from './conjuntoSql.ts'
import { clasificarDesde } from './clasificarSqlDesde.ts'
import { alcanceDeLote, EJECUTA_FUERA, tramosTsql } from './clasificarSqlTramos.ts'
import { PARAMETRO_USE } from './clasificarSqlTipos.ts'
import type { ClaseSentencia, Clasificacion, PeligroSentencia, SesionSentencia } from './clasificarSqlTipos.ts'

/** Tras OUTPUT, lo que cierra la cláusula sin que haya aparecido su INTO: devuelve filas. */
const CIERRA_OUTPUT = conjunto('OUTPUT FROM WHERE VALUES SELECT DEFAULT EXEC EXECUTE OPTION WHEN')
/** Sentencias de control que no escriben ni devuelven filas. */
const CONTROL_NEUTRO = conjunto('IF WHILE ELSE BREAK CONTINUE RETURN GOTO PRINT THROW')
/** No admiten transacción (6615, 3021, 574). */
const FUERA_DE_TX = conjunto('KILL BACKUP RESTORE RECONFIGURE')

/** Un tramo que no escribe ni devuelve filas. */
function neutro(verbo: string): Clasificacion {
  return lectura('consulta', verbo, { consultaPura: true })
}

function tienePalabra(v: Vista, w: string): boolean {
  return v.t.some((t) => t.tipo === 'palabra' && t.valor === w)
}

function subvista(v: Vista, desde: number, hasta: number): Vista {
  return crearVista(v.t.slice(desde, hasta), v.d, v.texto)
}

/** El orden de peligro de las clases (el `Record` exige una por clase). */
const RANGO: Readonly<Record<ClaseSentencia, number>> = {
  cliente: 0,
  sesion: 1,
  consulta: 2,
  tx: 3,
  bloqueo: 5,
  dml: 6,
  ddl: 7,
  otra: 8,
  rutina: 9,
  plsql: 10
}

/** El COMMIT pesa más que el resto de la clase tx: es lo que pide la confirmación de producción. */
function rango(c: Clasificacion): number {
  return RANGO[c.clase] + (c.clase === 'tx' && c.verbo === 'COMMIT' ? 1 : 0)
}

const GRAVEDAD: Readonly<Record<PeligroSentencia, number>> = { dmlSinWhere: 1, truncate: 2, dropObjeto: 3 }

/** `SET …` de T-SQL (ver `clasificarTramoTsql`). */
function analizarSetTsql(v: Vista, i: number): Clasificacion {
  const t1 = v.t[i + 1]
  // `SET @x = …` asigna una variable del lote (un cursor, `SET @c = CURSOR FOR …`, no se sabe).
  if (t1 && t1.tipo === 'palabra' && t1.valor[0] === '@') return tienePalabra(v, 'CURSOR') ? base('SET CURSOR') : neutro('SET')
  // `SET TRANSACTION ISOLATION LEVEL …` es de SESIÓN en T-SQL (no abre ni cierra nada).
  if (pal(v, i + 1) === 'TRANSACTION') {
    return lectura('sesion', 'SET TRANSACTION', { sesion: { accion: 'set', parametros: ['transaction'] } })
  }
  // `SET NOCOUNT, QUOTED_IDENTIFIER ON`: una LISTA de opciones, una por coma (medido): con solo la
  // primera, QUOTED_IDENTIFIER se colaría. `SET STATISTICS IO, TIME ON` es una sola opción.
  const ps: string[] = []
  let k = i + 1
  while (k < v.t.length) {
    const x = v.t[k]
    if (x.tipo !== 'palabra' && x.tipo !== 'identCitado') break
    const p = x.valor.toLowerCase()
    if (ps.indexOf(p) < 0) ps.push(p)
    if (p === 'statistics') break
    while (k < v.t.length && !(v.t[k].tipo === 'coma' && v.prof[k] === v.prof[i])) k++
    k++
  }
  return lectura('sesion', 'SET', { sesion: ps.length > 0 ? { accion: 'set', parametros: ps } : { accion: 'otra', parametros: [] } })
}

/** ¿Un OUTPUT del DML devuelve filas al cliente (no lleva su INTO)? (`clausulaOutput`) */
function outputAlCliente(v: Vista): boolean {
  for (let k = 0; k < v.t.length; k++) {
    // Solo el OUTPUT de la propia sentencia: el de un DML componible anidado alimenta al de fuera.
    if (pal(v, k) !== 'OUTPUT' || v.prof[k] !== 0) continue
    const p0 = v.prof[k]
    let alCliente = true
    for (let j = k + 1; j < v.t.length; j++) {
      if (v.prof[j] !== p0) continue
      if (v.t[j].tipo === 'puntoYComa') break
      const w = pal(v, j)
      if (w === 'INTO') {
        alCliente = false
        break
      }
      if (w && CIERRA_OUTPUT.has(w)) break
    }
    if (alCliente) return true
  }
  return false
}

/** `SELECT @x = …` (tras DISTINCT/ALL/TOP (n) [PERCENT] [WITH TIES]): asigna, no devuelve filas. */
function asignaVariables(v: Vista, i: number): boolean {
  let k = i + 1
  for (;;) {
    const w = pal(v, k)
    if (w === 'DISTINCT' || w === 'ALL' || w === 'PERCENT') k++
    else if (w === 'WITH' && pal(v, k + 1) === 'TIES') k += 2
    else if (w === 'TOP') {
      const x = v.t[k + 1]
      k = x && x.tipo === 'parenA' ? finDelParentesis(v, k + 2) + 1 : k + 2
    } else break
  }
  const a = v.t[k]
  const b = v.t[k + 1]
  return !!a && a.tipo === 'palabra' && a.valor[0] === '@' && !!b && b.tipo === 'operador' && b.valor[b.valor.length - 1] === '='
}

/** ALTER PROCEDURE/FUNCTION/TRIGGER/VIEW redefine el objeto como un CREATE OR ALTER: se nombra igual. */
function objetoDeAlter(v: Vista, i: number): Clasificacion['objetoCreado'] {
  const tipo = pal(v, i + 1)
  if (!(tipo === 'PROC' || tipo === 'PROCEDURE' || tipo === 'FUNCTION' || tipo === 'TRIGGER' || tipo === 'VIEW')) return null
  const n = leerNombre(v, i + 2)
  return n ? { ...refDe(n), tipo: tipo === 'PROC' ? 'PROCEDURE' : tipo, offsetTipo: v.t[i + 1].desde } : null
}

/** `WITH x AS (…) SELECT … INTO #t FROM x` también crea la tabla (el genérico solo mira un SELECT inicial). */
function selectIntoDeWith(v: Vista, i: number): Clasificacion | null {
  for (let k = i + 1; k < v.t.length; k++) {
    if (v.prof[k] !== v.prof[i] || pal(v, k) !== 'SELECT') continue
    const s = analizarSelect(v, k)
    return s.clase === 'ddl' ? s : null
  }
  return null
}

/** Lo que T-SQL cambia de la clasificación genérica de un tramo (`clasificarDesde`). */
function ajustarTsql(v: Vista, i: number, c: Clasificacion): Clasificacion {
  const r: Clasificacion = { ...c }
  nombrarProcedure(r)
  if (pal(v, i) === 'ALTER' && !r.objetoCreado) {
    const o = objetoDeAlter(v, i)
    if (o) r.objetoCreado = o
  }
  if (pal(v, i) === 'WITH' && r.clase === 'consulta' && v.r.selectIntoCreaTabla) {
    const s = selectIntoDeWith(v, i)
    if (s) return s
  }
  return ajustarFilas(v, i, r)
}

/** PROC es PROCEDURE (lo que el catálogo y el árbol conocen). */
function nombrarProcedure(r: Clasificacion): void {
  if (r.verbo === 'CREATE PROC' || r.verbo === 'ALTER PROC') r.verbo = r.verbo + 'EDURE'
  if (r.objetoCreado && r.objetoCreado.tipo === 'PROC') r.objetoCreado = { ...r.objetoCreado, tipo: 'PROCEDURE' }
}

/** Un DML con OUTPUT sin INTO devuelve filas; `SELECT @x = …` asigna y no las devuelve. */
function ajustarFilas(v: Vista, i: number, r: Clasificacion): Clasificacion {
  if (r.clase === 'dml' && v.r.clausulaOutput && outputAlCliente(v)) r.devuelveFilas = true
  if (r.verbo === 'SELECT' && r.clase === 'consulta' && asignaVariables(v, i)) r.devuelveFilas = false
  return r
}

/** END, BEGIN (bloque, transacción o Service Broker) y SAVE. */
function tramoDeBloque(w: string | null, w1: string | null): Clasificacion | null {
  switch (w) {
    case 'END':
      return w1 === 'CONVERSATION' ? base('END CONVERSATION') : neutro('END')
    case 'BEGIN':
      if (w1 === 'TRAN' || w1 === 'TRANSACTION') return lectura('tx', 'BEGIN TRANSACTION')
      if (w1 === 'DISTRIBUTED') return lectura('tx', 'BEGIN DISTRIBUTED TRANSACTION')
      if (w1 === 'DIALOG' || w1 === 'CONVERSATION') return base('BEGIN ' + w1)
      return neutro('BEGIN')
    case 'SAVE':
      return lectura('tx', 'SAVE TRANSACTION')
    default:
      return null
  }
}

/** Los verbos con clasificación propia de T-SQL; null si el tramo cae en la genérica ajustada. */
function tramoPropio(v: Vista, i: number, w: string | null, w1: string | null): Clasificacion | null {
  switch (w) {
    case 'DECLARE':
      return tienePalabra(v, 'CURSOR') ? base('DECLARE CURSOR') : neutro('DECLARE')
    case 'SET':
      return analizarSetTsql(v, i)
    case 'USE':
      return lectura('sesion', 'USE', { sesion: { accion: 'set', parametros: [PARAMETRO_USE] } })
    case 'RAISERROR':
      // `WITH LOG` escribe en el registro de errores del servidor.
      return v.t.some((x, k) => x.tipo === 'palabra' && x.valor === 'LOG' && v.prof[k] === v.prof[i]) ? base('RAISERROR') : neutro('RAISERROR')
    case 'WAITFOR':
      // WAITFOR DELAY/TIME solo espera; `WAITFOR (RECEIVE …)` consume de una cola.
      return w1 === 'DELAY' || w1 === 'TIME' ? neutro('WAITFOR') : base('WAITFOR')
    case 'BULK':
      return w1 === 'INSERT' ? { ...base('BULK INSERT'), clase: 'dml' } : null
    // STATISTICS es reservada: `UPDATE STATISTICS t` es mantenimiento, no un UPDATE sin WHERE.
    case 'UPDATE':
      return w1 === 'STATISTICS' ? base('UPDATE STATISTICS') : null
    case 'DENY':
      return { ...base('DENY'), clase: 'ddl' }
    default:
      return null
  }
}

/** Un tramo de T-SQL: lo propio del dialecto y, si no, la clasificación genérica ajustada. */
function clasificarTramoTsql(v: Vista): Clasificacion {
  let i = 0
  while (v.t[i] && v.t[i].tipo === 'parenA') i++
  const w = pal(v, i)
  const w1 = pal(v, i + 1)
  const t1 = v.t[i + 1]
  if (w && t1 && t1.tipo === 'operador' && t1.valor === ':') return neutro('ETIQUETA')
  if (w && CONTROL_NEUTRO.has(w)) return neutro(w)
  if (w && FUERA_DE_TX.has(w)) return { ...base(w), noTransaccional: true }
  return tramoDeBloque(w, w1) ?? tramoPropio(v, i, w, w1) ?? ajustarTsql(v, i, clasificarDesde(v, 0))
}

/** La más peligrosa de las partes; a igual peligro, la que devuelve filas (da nombre a la pestaña). */
function parteMasPeligrosa(partes: readonly Clasificacion[]): Clasificacion {
  let elegida = partes[0]
  for (const p of partes) {
    const a = rango(p)
    const b = rango(elegida)
    if (a > b || (a === b && p.devuelveFilas && !elegida.devuelveFilas)) elegida = p
  }
  return elegida
}

function peligroMayor(partes: readonly Clasificacion[]): PeligroSentencia | null {
  let peligro: PeligroSentencia | null = null
  for (const p of partes) if (p.peligro && (!peligro || GRAVEDAD[p.peligro] > GRAVEDAD[peligro])) peligro = p.peligro
  return peligro
}

/** Los SET de sesión de todas las partes, sin repetir; 'set' solo si todas lo son. */
function sesionCombinada(partes: readonly Clasificacion[]): SesionSentencia | null {
  const sesiones = partes.filter((p) => p.sesion !== null)
  if (sesiones.length === 0) return null
  const parametros: string[] = []
  for (const p of sesiones) for (const x of (p.sesion as SesionSentencia).parametros) if (parametros.indexOf(x) < 0) parametros.push(x)
  const todasSet = sesiones.every((p) => (p.sesion as SesionSentencia).accion === 'set')
  return { accion: todasSet ? 'set' : 'otra', parametros }
}

/** Junta los tramos de una unidad en UNA clasificación. */
function combinarTsql(partes: readonly Clasificacion[]): Clasificacion {
  if (partes.length === 0) return base('')
  if (partes.length === 1) return partes[0]
  const elegida = parteMasPeligrosa(partes)
  let objetoCreado = elegida.objetoCreado
  for (const p of partes) if (!objetoCreado && p.objetoCreado) objetoCreado = p.objetoCreado
  return {
    ...elegida,
    plsql: false,
    escribe: partes.some((p) => p.escribe),
    sinWhere: partes.some((p) => p.sinWhere),
    peligro: peligroMayor(partes),
    tablaUnica: null,
    objetoCreado,
    consultaPura:
      partes.some((p) => p.clase === 'consulta') &&
      partes.every((p) => p.clase === 'sesion' || (p.clase === 'consulta' && p.consultaPura)),
    devuelveFilas: partes.some((p) => p.devuelveFilas),
    noTransaccional: partes.some((p) => p.noTransaccional),
    sesion: sesionCombinada(partes)
  }
}

/** La clasificación de una unidad de T-SQL. */
export function clasificarUnidadTsql(v: Vista): Clasificacion {
  const alcance = alcanceDeLote(v.t, v.r)
  if (alcance !== null && (alcance.indexOf('CREATE ') === 0 || alcance.indexOf('ALTER ') === 0)) {
    return ajustarTsql(v, 0, clasificarDesde(v, 0))
  }
  const { tramos, anidados } = tramosTsql(v)
  const partes: Clasificacion[] = tramos.map(([a, b]) => clasificarTramoTsql(subvista(v, a, b)))
  // El DML componible no devuelve filas al cliente: su OUTPUT alimenta al de fuera.
  for (const [a, b] of anidados) partes.push({ ...clasificarTramoTsql(subvista(v, a, b)), devuelveFilas: false, tablaUnica: null })
  for (let k = 0; k < v.t.length; k++) {
    const w = pal(v, k)
    if (w && EJECUTA_FUERA.has(w)) partes.push(base(w))
    else if (w === 'NEXT' && pal(v, k + 1) === 'VALUE' && pal(v, k + 2) === 'FOR') partes.push(base('NEXT VALUE FOR'))
  }
  const c = combinarTsql(partes)
  const primeraConFilas = partes.findIndex((p, k) => k < tramos.length && p.devuelveFilas)
  if (primeraConFilas >= 0 && primeraConFilas < tramos.length - 1) c.masTrasLasFilas = true
  return c
}
