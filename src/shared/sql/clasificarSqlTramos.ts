// =============================================================================
// T-SQL: partir una unidad en TRAMOS (uno por sentencia) y reconocer las construcciones de ALCANCE
// DE LOTE. SQL Server ejecuta juntas dos sentencias sin `;`, así que el clasificador mira la unidad
// entera; una regla de continuación mal ceñida esconde una escritura, por eso cada una lleva su caso.
// Decisiones: docs/decisiones/bd/sql-tsql-unidad-entera.md
// =============================================================================

import { deDialecto, reglasDe, type DialectoSql, type ReglasDialecto } from './dialectosSql.ts'
import { DML, finDelParentesis, leerNombre, pal, type Vista } from './clasificarSqlBase.ts'
import { esSignificativo, type Token } from './lexicoSql.ts'
import { conjunto } from './conjuntoSql.ts'
import { RESERVADAS } from './palabrasSql.ts'

/** Palabras RESERVADAS de T-SQL que, a profundidad 0, empiezan una sentencia. */
const INICIO_TSQL = conjunto(
  'SELECT INSERT UPDATE DELETE MERGE CREATE ALTER DROP TRUNCATE EXEC EXECUTE SET DECLARE BEGIN END ' +
    'ELSE IF WHILE COMMIT ROLLBACK SAVE USE PRINT RAISERROR WAITFOR DBCC KILL BACKUP RESTORE BULK ' +
    'GRANT REVOKE DENY GOTO RETURN BREAK CONTINUE OPEN CLOSE DEALLOCATE FETCH CHECKPOINT RECONFIGURE ' +
    'SHUTDOWN WRITETEXT UPDATETEXT READTEXT REVERT SETUSER ADD'
)

/**
 * Los comienzos de sentencia que NO son reservadas, con lo que tiene que venir detrás para que lo
 * sean ('' = cualquier cosa). Solo parten tras la CONDICIÓN de un IF o un WHILE: detrás de otra
 * sentencia sin `;` el servidor no las compila y ahí serían un alias.
 */
const INICIO_NO_RESERVADO: ReadonlyMap<string, string> = new Map([
  ['ENABLE', 'TRIGGER'],
  ['DISABLE', 'TRIGGER'],
  ['SEND', 'ON'],
  ['MOVE', 'CONVERSATION'],
  ['GET', 'CONVERSATION'],
  ['RECEIVE', ''],
  ['THROW', '']
])

/** ¿Empieza en `k` una de `INICIO_NO_RESERVADO` (no detrás de un `.`)? */
function inicioNoReservado(v: Vista, k: number, w: string): boolean {
  const detras = INICIO_NO_RESERVADO.get(w)
  if (detras === undefined) return false
  const antes = v.t[k - 1]
  if (antes && antes.tipo === 'punto') return false
  return detras === '' || pal(v, k + 1) === detras
}

/** Índice donde acaba la cabecera de un ALTER que lleva SET en su gramática, o -1. */
function finDeCabeceraDeAlter(v: Vista, ini: number): number {
  const o = pal(v, ini + 1)
  if (o === 'DATABASE') {
    if (pal(v, ini + 2) === 'SCOPED' && pal(v, ini + 3) === 'CONFIGURATION') {
      const fin = ini + 4
      return pal(v, fin) === 'FOR' && pal(v, fin + 1) === 'SECONDARY' ? fin + 2 : fin
    }
    const n = leerNombre(v, ini + 2)
    return n ? n.siguiente : -1
  }
  if (o === 'SERVER' && pal(v, ini + 2) === 'CONFIGURATION') return ini + 3
  if (o === 'FULLTEXT' && pal(v, ini + 2) === 'INDEX' && pal(v, ini + 3) === 'ON') {
    const n = leerNombre(v, ini + 4)
    return n ? n.siguiente : -1
  }
  return -1
}

/**
 * ¿El SET en `k` es gramática del ALTER que empieza en `ini`, y no la sentencia SET que va detrás?
 * Solo en los ALTER que lo llevan: con paréntesis (`ALTER TABLE t SET (…)`) o JUSTO tras la cabecera
 * (`ALTER DATABASE d SET …`); con «el primer SET» se tragaba el SET que el servidor SÍ ejecuta.
 */
function setDeAlter(v: Vista, ini: number, k: number): boolean {
  const sig = v.t[k + 1]
  if (sig && sig.tipo === 'parenA') return true
  return finDeCabeceraDeAlter(v, ini) === k
}

/** Tras BEGIN, lo que hace de él una SENTENCIA (transacción, Service Broker) y no un bloque. */
const TRAS_BEGIN_SENTENCIA = conjunto('TRAN TRANSACTION DISTRIBUTED DIALOG CONVERSATION')
/** Funciones que ejecutan texto en OTRO servidor: lo que sea, también escribir. */
export const EJECUTA_FUERA = conjunto('OPENQUERY OPENROWSET OPENDATASOURCE')
const UNE_CONSULTAS = conjunto('UNION ALL EXCEPT INTERSECT')
/** Delante de MERGE, lo que la hace una sugerencia de JOIN (`INNER MERGE JOIN`). */
const ANTES_DE_MERGE_JOIN = conjunto('INNER LEFT RIGHT FULL OUTER CROSS')
const PRINCIPALES_DE_WITH = conjunto('SELECT INSERT UPDATE DELETE MERGE')

/**
 * Qué construcción de ALCANCE DE LOTE abre estos tokens (la entrada de `hastaSeparadorLote` que
 * casa, o 'ETIQUETA' para `x:`), o null. BEGIN seguido de TRAN/DISTRIBUTED/DIALOG/CONVERSATION es
 * una sentencia, no un bloque.
 */
export function alcanceDeLote(sig: readonly Token[], r: ReglasDialecto): string | null {
  if (r.hastaSeparadorLote.length === 0 || sig.length === 0) return null
  const p = (k: number): string | null => (sig[k] && sig[k].tipo === 'palabra' ? sig[k].valor : null)
  if (sig[0].tipo === 'palabra' && sig[1] && sig[1].tipo === 'operador' && sig[1].valor === ':') return 'ETIQUETA'
  for (const seq of r.hastaSeparadorLote) {
    const ws = seq.split(' ')
    let casa = true
    for (let k = 0; k < ws.length && casa; k++) casa = p(k) === ws[k]
    if (!casa) continue
    if (ws.length === 1 && ws[0] === 'BEGIN' && TRAS_BEGIN_SENTENCIA.has(p(1) || '')) continue
    return seq
  }
  return null
}

/**
 * ¿Estos tokens (desde el inicio de la sentencia) abren una construcción de ALCANCE DE LOTE
 * (CREATE PROCEDURE, DECLARE, IF, BEGIN…, o una etiqueta), que llega hasta el separador de lotes y
 * conserva sus `;`? Siempre false en un dialecto sin ellas. Lo usan el divisor y los avisos.
 */
export function esAlcanceDeLote(tokens: readonly Token[], d: DialectoSql): boolean {
  const r = reglasDe(d)
  if (r.hastaSeparadorLote.length === 0) return false
  return alcanceDeLote(tokens.filter(esSignificativo), r) !== null
}

/** Cuántos tokens ocupa un tramo de longitud FIJA que empieza en `k` (0 si no lo es). */
function longitudFija(v: Vista, k: number): number {
  const w = pal(v, k)
  const w1 = pal(v, k + 1)
  const t1 = v.t[k + 1]
  if (v.t[k].tipo === 'palabra' && t1 && t1.tipo === 'operador' && t1.valor === ':') return 2 // etiqueta
  switch (w) {
    case 'BEGIN':
      return w1 && TRAS_BEGIN_SENTENCIA.has(w1) ? 0 : longitudDeBloque(w1)
    case 'END':
      return w1 === 'CONVERSATION' ? 0 : longitudDeBloque(w1)
    case 'ELSE':
    case 'BREAK':
    case 'CONTINUE':
      return 1
    case 'GOTO':
      return 2
    default:
      return 0
  }
}

/** `BEGIN TRY`/`END CATCH` ocupan dos palabras; `BEGIN`/`END` solas, una. */
function longitudDeBloque(w1: string | null): number {
  return w1 === 'TRY' || w1 === 'CATCH' ? 2 : 1
}

interface EstadoTramos {
  v: Vista
  tramos: Array<[number, number]>
  anidados: Array<[number, number]>
  /** Inicio del tramo abierto, o -1. */
  ini: number
  verbo: string | null
  fijo: number
  /** Profundidad de CASE…END abiertos. */
  casos: number
  setDelUpdate: boolean
  addDelAlter: boolean
  principal: boolean
  permisos: boolean
  hayOffset: boolean
}

function cerrarTramo(e: EstadoTramos, k: number): void {
  if (e.ini >= 0 && k > e.ini) e.tramos.push([e.ini, k])
  e.ini = -1
}

function abrirTramo(e: EstadoTramos, k: number): void {
  cerrarTramo(e, k)
  e.ini = k
  e.verbo = pal(e.v, k)
  e.fijo = longitudFija(e.v, k)
  e.setDelUpdate = false
  e.addDelAlter = false
  e.principal = false
  e.permisos = e.verbo === 'GRANT' || e.verbo === 'REVOKE' || e.verbo === 'DENY'
  e.hayOffset = false
}

/** `ON DELETE|UPDATE [SET NULL|SET DEFAULT]` de una FK, dentro de un CREATE o un ALTER. */
function accionDeFk(v: Vista, k: number, w: string, pw: string | null): boolean {
  return (
    ((w === 'UPDATE' || w === 'DELETE') && pw === 'ON') ||
    (w === 'SET' && (pw === 'DELETE' || pw === 'UPDATE') && pal(v, k - 2) === 'ON')
  )
}

function continuaGeneral(e: EstadoTramos, w: string, pw: string | null, nw: string | null): boolean {
  // Sugerencia de JOIN (`INNER MERGE JOIN`): MERGE es reservada y solo compila así.
  if (w === 'MERGE' && (nw === 'JOIN' || nw === 'UNION' || (pw !== null && ANTES_DE_MERGE_JOIN.has(pw)))) return true
  if (w === 'SELECT' && pw !== null && UNE_CONSULTAS.has(pw)) return true
  // `OFFSET n ROWS FETCH NEXT …`: sin el OFFSET antes, un FETCH tras un alias `rows` es el de un cursor.
  return w === 'FETCH' && (pw === 'ROWS' || pw === 'ROW') && e.hayOffset
}

/** `ALTER …`: ADD (el primero), ALTER COLUMN, DROP y el SET de su gramática, una vez. */
function continuaAlter(e: EstadoTramos, k: number, w: string, pw: string | null, nw: string | null): boolean {
  const v = e.v
  if (accionDeFk(v, k, w, pw) || (w === 'IF' && nw === 'EXISTS')) return true
  if (w === 'ADD') {
    // `ALTER EVENT SESSION` encadena varios ADD; en los demás, solo el primero es del ALTER.
    if (e.addDelAlter && pal(v, e.ini + 1) !== 'EVENT') return false
    e.addDelAlter = true
    return true
  }
  if (w === 'ALTER') return nw === 'COLUMN'
  // `DROP TABLE u` detrás, con TABLE reservada, ya es otra sentencia.
  if (w === 'DROP') return nw === null || nw === 'COLUMN' || nw === 'CONSTRAINT' || !deDialecto(RESERVADAS, v.d).has(nw)
  if (w === 'SET' && !e.setDelUpdate && setDeAlter(v, e.ini, k)) {
    e.setDelUpdate = true
    return true
  }
  return false
}

/** CREATE: `ADD` es gramática solo en `CREATE EVENT SESSION` y `CREATE … AUDIT SPECIFICATION`. */
function continuaCreate(e: EstadoTramos, k: number, w: string, pw: string | null): boolean {
  const v = e.v
  if (w === 'ADD') return pal(v, e.ini + 1) === 'EVENT' || (pal(v, e.ini + 2) === 'AUDIT' && pal(v, e.ini + 3) === 'SPECIFICATION')
  return accionDeFk(v, k, w, pw)
}

/** Las reglas de continuación de cada verbo del tramo abierto (ver `continua`). */
function continuaPorVerbo(e: EstadoTramos, k: number, w: string, pw: string | null, nw: string | null): boolean {
  switch (e.verbo) {
    case 'WITH':
      // El verbo principal tras las CTE; desde ahí, las reglas de ese verbo.
      if (!PRINCIPALES_DE_WITH.has(w)) return false
      e.verbo = w
      return true
    case 'UPDATE':
      // El SET del DML; `UPDATE STATISTICS t` no lo tiene: el que venga detrás es otra sentencia.
      if (w !== 'SET' || e.setDelUpdate || pal(e.v, e.ini + 1) === 'STATISTICS') return false
      e.setDelUpdate = true
      return true
    case 'INSERT':
      if (w !== 'SELECT' || e.principal) return false
      e.principal = true
      return true
    case 'CREATE':
      return continuaCreate(e, k, w, pw)
    case 'ALTER':
      return continuaAlter(e, k, w, pw, nw)
    default:
      return continuaOtroVerbo(e.verbo, w, pw, nw)
  }
}

/** Verbos cuya continuación no lleva estado: MERGE, BULK INSERT, cursores, SELECT … FOR UPDATE y DROP IF EXISTS. */
function continuaOtroVerbo(verbo: string | null, w: string, pw: string | null, nw: string | null): boolean {
  switch (verbo) {
    case 'MERGE':
      return true // sus ramas (UPDATE SET, INSERT, DELETE) hasta su `;` obligatorio
    case 'BULK':
      return w === 'INSERT' && pw === 'BULK'
    case 'DECLARE':
    case 'SET':
      // Un cursor: `DECLARE c CURSOR FOR SELECT … FOR UPDATE OF a`, `SET @c = CURSOR FOR …`.
      return (w === 'SELECT' || w === 'UPDATE') && pw === 'FOR'
    case 'SELECT':
      // `SELECT … FOR UPDATE` no compila en T-SQL fuera de un cursor: se lee como el bloqueo genérico.
      return w === 'UPDATE' && pw === 'FOR'
    case 'DROP':
      return w === 'IF' && nw === 'EXISTS'
    default:
      return false
  }
}

/**
 * CADA REGLA DE CONTINUACIÓN ES UNA PUERTA: una palabra de escritura que se toma por continuación
 * deja de contar como sentencia. Por eso cada una se ciñe al tramo donde es gramática, y todas
 * exigen texto que COMPILE (un error de compilación aborta el lote entero sin ejecutar nada).
 */
function continua(e: EstadoTramos, k: number, w: string): boolean {
  const pw = pal(e.v, k - 1)
  const nw = pal(e.v, k + 1)
  if (continuaGeneral(e, w, pw, nw)) return true
  if (e.permisos) return true // GRANT SELECT, INSERT ON … (hasta su TO/FROM)
  return continuaPorVerbo(e, k, w, pw, nw)
}

/** DML componible dentro de un paréntesis: `(DELETE … OUTPUT …)` dentro de un INSERT … SELECT. */
function registrarAnidado(e: EstadoTramos, k: number): void {
  const v = e.v
  const w = pal(v, k)
  const prev = v.t[k - 1]
  if (!(w && DML.has(w) && prev && prev.tipo === 'parenA')) return
  const nw = pal(v, k + 1)
  if (!(w === 'MERGE' && (nw === 'JOIN' || nw === 'UNION'))) e.anidados.push([k, finDelParentesis(v, k)])
}

/** Lo que hace el token `k` con el tramo abierto: lo cierra, abre otro o lo deja seguir. */
function pasoTramo(e: EstadoTramos, k: number): void {
  const v = e.v
  if (v.prof[k] > 0) {
    registrarAnidado(e, k)
    if (e.ini >= 0) return
  }
  if (v.t[k].tipo === 'puntoYComa') {
    cerrarTramo(e, k)
    return
  }
  if (e.ini < 0 || (e.fijo > 0 && k >= e.ini + e.fijo)) {
    abrirTramo(e, k)
    return
  }
  const w = pal(v, k)
  if (!w || consumeCase(e, w)) return
  if (e.permisos && (w === 'TO' || w === 'FROM')) e.permisos = false
  if (w === 'OFFSET') e.hayOffset = true
  if (empiezaSentencia(e, k, w)) abrirTramo(e, k)
}

/** CASE…END dentro del tramo: sus END y ELSE no son de la sentencia. Devuelve true si `w` lo consume. */
function consumeCase(e: EstadoTramos, w: string): boolean {
  if (w === 'CASE') {
    e.casos++
    return true
  }
  if ((w === 'END' || w === 'ELSE') && e.casos > 0) {
    if (w === 'END') e.casos--
    return true
  }
  return false
}

/** ¿`w` en `sig[k]` empieza otra sentencia? Una no reservada tras un IF/WHILE, o una reservada que no continúa la actual. */
function empiezaSentencia(e: EstadoTramos, k: number, w: string): boolean {
  if ((e.verbo === 'IF' || e.verbo === 'WHILE') && inicioNoReservado(e.v, k, w)) return true
  return INICIO_TSQL.has(w) && !continua(e, k, w)
}

/**
 * Los tramos de una unidad de T-SQL (`[desde, hasta)` sobre los tokens significativos) y los DML
 * componibles anidados.
 */
export function tramosTsql(v: Vista): { tramos: Array<[number, number]>; anidados: Array<[number, number]> } {
  const e: EstadoTramos = {
    v,
    tramos: [],
    anidados: [],
    ini: -1,
    verbo: null,
    fijo: 0,
    casos: 0,
    setDelUpdate: false,
    addDelAlter: false,
    principal: false,
    permisos: false,
    hayOffset: false
  }
  for (let k = 0; k < v.t.length; k++) pasoTramo(e, k)
  cerrarTramo(e, v.t.length)
  return { tramos: e.tramos, anidados: e.anidados }
}
