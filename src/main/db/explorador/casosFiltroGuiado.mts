// =============================================================================
// Casos comunes del filtro guiado contra un servidor real: los importan las secciones «filtro
// guiado» de `test-db-{postgres,sqlite,sqlserver,oracle}` para probar los cuatro motores con
// las mismas filas. No empieza por `test-`: la batería no lo corre. Cada test siembra su tabla
// con el DDL de su dialecto y le pasa aquí cómo abrirla por el `ExploradorController` real.
// Comprueba, por id: texto, números exactos, fechas por día y con hora, booleano, unión, orden
// con paginado y Contar, y el error del servidor dentro de una condición.
// =============================================================================

import type { DbFiltroGuiado, DbCondicionFiltro, DbOrdenColumna } from '../../../shared/filtroGuiado.ts'
import type { DbPagina, DbRespuesta, DbTablaAbierta } from '../../../shared/db-explorador-ipc.ts'

export interface EntornoFiltroGuiado {
  /** Para los nombres de las comprobaciones. */
  motor: string
  /** Los nombres EXACTOS de las columnas (Oracle los pliega a mayúsculas). */
  col: { id: string; nombre: string; sueldo: string; grande: string; alta: string; activo: string }
  /** Los dos enteros grandes sembrados en las filas 1 y 2. */
  grandes: [string, string]
  /** ¿`activo` es un booleano del motor (PG boolean, SQL Server bit)? Si no, se salta. */
  booleano: boolean
  /**
   * Qué pasa con una columna que no existe: 'condicion' = error con su POSICIÓN, que vuelve
   * como la condición culpable (PG, Oracle); 'error' = error sin posición que ubicar (SQL
   * Server da la línea donde EMPIEZA la sentencia); 'literal' = ni siquiera es un error
   * (SQLite lee `"NO_EXISTE"` como el TEXTO 'NO_EXISTE' y la condición se evalúa contra él).
   */
  columnaInexistente: 'condicion' | 'error' | 'literal'
  abrir: (p: { peticionId: string; filtro?: DbFiltroGuiado; orden?: DbOrdenColumna[]; maxFilas?: number }) => Promise<DbRespuesta<DbTablaAbierta>>
  leerMas: (lector: string, maxFilas: number) => Promise<DbRespuesta<DbPagina>>
  contar: (lector: string, peticionId: string) => Promise<DbRespuesta<number>>
  check: (name: string, pass: boolean, evidence: string) => void
}

/** Los ids de una página, en orden, como texto. */
function idsDe(columnas: Array<{ nombre: string }>, filasJson: string, colId: string): string[] {
  const i = columnas.findIndex((c) => c.nombre === colId)
  return (JSON.parse(filasJson) as unknown[][]).map((f) => String(f[i]))
}

const J = (v: unknown): string => JSON.stringify(v)

type Union = DbFiltroGuiado['union']
type Operador = DbCondicionFiltro['operador']

/** Lo que comparten las secciones: abrir con un filtro y comprobar los ids que salen. */
interface Contexto {
  e: EntornoFiltroGuiado
  pet: () => string
  caso: (nombre: string, condiciones: DbCondicionFiltro[], esperados: string[], union?: Union) => Promise<void>
}

function crearContexto(e: EntornoFiltroGuiado): Contexto {
  let n = 0
  const pet = (): string => `fg-${e.motor}-${++n}`
  /** Abre con el filtro y devuelve los ids ORDENADOS numéricamente (o el error). */
  const ids = async (condiciones: DbCondicionFiltro[], union: Union): Promise<string[] | string> => {
    const r = await e.abrir({ peticionId: pet(), filtro: { union, condiciones }, maxFilas: 100 })
    if (!r.ok) return `(error ${J(r.error)})`
    const res = r.valor.resultado
    if (res.tipo !== 'filas') return `(error ${J(res.error)})`
    return idsDe(res.columnas, res.pagina.filasJson, e.col.id).sort((a, b) => Number(a) - Number(b))
  }
  const caso = async (nombre: string, condiciones: DbCondicionFiltro[], esperados: string[], union: Union = 'todas'): Promise<void> => {
    const r = await ids(condiciones, union)
    e.check(`${e.motor} · ${nombre} -> [${esperados.join(',')}]`, J(r) === J(esperados), J(r))
  }
  return { e, pet, caso }
}

function condTexto(e: EntornoFiltroGuiado, operador: Operador, valor?: string): DbCondicionFiltro {
  return { columna: e.col.nombre, categoria: 'texto', operador, ...(valor !== undefined ? { valor } : {}) }
}

function condNumero(columna: string, operador: Operador, valor?: string, valor2?: string): DbCondicionFiltro {
  return {
    columna,
    categoria: 'numero',
    operador,
    ...(valor !== undefined ? { valor } : {}),
    ...(valor2 !== undefined ? { valor2 } : {})
  }
}

function condFecha(e: EntornoFiltroGuiado, operador: Operador, valor?: string, valor2?: string): DbCondicionFiltro {
  return {
    columna: e.col.alta,
    categoria: 'fecha',
    operador,
    ...(valor !== undefined ? { valor } : {}),
    ...(valor2 !== undefined ? { valor2 } : {})
  }
}

async function casosTexto({ e, caso }: Contexto): Promise<void> {
  const t = (operador: Operador, valor?: string): DbCondicionFiltro => condTexto(e, operador, valor)
  await caso('contiene «ana» sin distinguir mayúsculas', [t('contiene', 'ana')], ['1', '2', '6'])
  await caso('contiene «a_b»: el `_` es literal (anaXb NO casa)', [t('contiene', 'a_b')], ['2'])
  await caso('contiene «0%»: el `%` es literal', [t('contiene', '0%')], ['3'])
  await caso('empieza por «AN»', [t('empiezaPor', 'AN')], ['1', '2', '6'])
  await caso('= «Ana»', [t('igual', 'Ana')], ['1'])
  await caso('≠ «Ana» incluye NULL y vacío', [t('distinto', 'Ana')], ['2', '3', '4', '5', '6'])
  await caso("está vacío = NULL y ''", [t('vacio')], ['4', '5'])
  await caso('no está vacío', [t('noVacio')], ['1', '2', '3', '6'])
}

async function casosNumeros({ e, caso }: Contexto): Promise<void> {
  const { col } = e
  await caso('sueldo = 12.5 (decimal)', [condNumero(col.sueldo, 'igual', '12.5')], ['1', '6'])
  await caso('sueldo = 12.50 (canónico)', [condNumero(col.sueldo, 'igual', '+12.50')], ['1', '6'])
  await caso('sueldo > 10', [condNumero(col.sueldo, 'mayor', '10')], ['1', '6'])
  await caso('sueldo < 0 (negativo decimal)', [condNumero(col.sueldo, 'menor', '0')], ['3'])
  await caso('sueldo entre -5 y 10 (extremos incluidos)', [condNumero(col.sueldo, 'entre', '-5', '10')], ['2', '3', '5'])
  await caso('sueldo ≠ 12.5 incluye NULL', [condNumero(col.sueldo, 'distinto', '12.5')], ['2', '3', '4', '5'])
  await caso('entero grande = G1 EXACTO (no casa G2)', [condNumero(col.grande, 'igual', e.grandes[0])], ['1'])
  await caso('entero grande > G1', [condNumero(col.grande, 'mayor', e.grandes[0])], ['2'])
  await caso('columna ENTERA contra un decimal: id > 4.5', [condNumero(col.id, 'mayor', '4.5')], ['5', '6'])
  await caso('columna entera: id entre 2 y 3', [condNumero(col.id, 'entre', '2', '3')], ['2', '3'])
}

async function casosFechas({ e, caso }: Contexto): Promise<void> {
  const f = (operador: Operador, valor?: string, valor2?: string): DbCondicionFiltro => condFecha(e, operador, valor, valor2)
  await caso('alta = 2026-09-28 es el DÍA entero', [f('igual', '2026-09-28')], ['1', '2'])
  await caso('alta ≠ 2026-09-28 (fuera del día o NULL)', [f('distinto', '2026-09-28')], ['3', '4', '5', '6'])
  await caso('alta > 2026-09-28 es desde el 29', [f('mayor', '2026-09-28')], ['3'])
  await caso('alta < 2026-09-28 es antes del 28', [f('menor', '2026-09-28')], ['5', '6'])
  await caso('alta entre 2026-09-27 y 2026-09-28 (días enteros)', [f('entre', '2026-09-27', '2026-09-28')], ['1', '2', '5'])
  await caso('alta = 2026-09-28 23:59:59 (con hora, exacto)', [f('igual', '2026-09-28 23:59:59')], ['2'])
  await caso('alta > 2026-09-28T00:00 (con hora)', [f('mayor', '2026-09-28T00:00')], ['2', '3'])
  await caso('alta está vacío', [f('vacio')], ['4'])
}

async function casosBooleano({ e, caso }: Contexto): Promise<void> {
  if (!e.booleano) return
  const b = (operador: Operador, valor: string): DbCondicionFiltro => ({ columna: e.col.activo, categoria: 'booleano', operador, valor })
  await caso('activo = true', [b('igual', 'true')], ['1', '3', '6'])
  await caso('activo ≠ true incluye NULL', [b('distinto', 'sí')], ['2', '4', '5'])
}

async function casosUnion({ e, caso }: Contexto): Promise<void> {
  const { col } = e
  await caso('cualquiera: nombre = Ana O sueldo < 0', [condTexto(e, 'igual', 'Ana'), condNumero(col.sueldo, 'menor', '0')], ['1', '3'], 'cualquiera')
  await caso('todas: contiene ana Y sueldo = 12.5', [condTexto(e, 'contiene', 'ana'), condNumero(col.sueldo, 'igual', '12.5')], ['1', '6'])
}

/** Orden de dos columnas, paginado, «más» y Contar con el mismo filtro. */
async function casosOrdenYPaginado(ctx: Contexto): Promise<void> {
  const { col } = ctx.e
  const filtro: DbFiltroGuiado = { union: 'todas', condiciones: [condNumero(col.sueldo, 'noVacio')] }
  const orden: DbOrdenColumna[] = [{ columna: col.sueldo, dir: 'desc' }, { columna: col.id, dir: 'asc' }]
  const abierta = await primeraPaginaOrdenada(ctx, filtro, orden)
  if (abierta === null) return
  await masYContar(ctx, filtro, orden, abierta.lector, abierta.columnas)
}

/** La 1.ª página con filtro y orden: sin píldora de orden. Devuelve su lector, si lo hay. */
async function primeraPaginaOrdenada(
  { e, pet }: Contexto,
  filtro: DbFiltroGuiado,
  orden: DbOrdenColumna[]
): Promise<{ lector: string; columnas: Array<{ nombre: string }> } | null> {
  const r = await e.abrir({ peticionId: pet(), filtro, orden, maxFilas: 2 })
  const res = r.ok ? r.valor.resultado : null
  const p1 = res && res.tipo === 'filas' ? idsDe(res.columnas, res.pagina.filasJson, e.col.id) : null
  const lector = res && res.tipo === 'filas' ? res.lector : null
  const avisos = res && res.tipo === 'filas' ? res.avisos : undefined
  e.check(`${e.motor} · orden sueldo DESC, id ASC: 1.ª página [1,6], sin píldora de orden`, J(p1) === J(['1', '6']) && lector !== null && avisos === undefined, J({ p1, lector, avisos, r: r.ok ? undefined : r }))
  if (!(lector && res && res.tipo === 'filas')) return null
  return { lector, columnas: res.columnas }
}

/** «Más» con el mismo filtro y orden, y Contar en una pestaña nueva. */
async function masYContar(
  { e, pet }: Contexto,
  filtro: DbFiltroGuiado,
  orden: DbOrdenColumna[],
  lector: string,
  cols: Array<{ nombre: string }>
): Promise<void> {
  const m2 = await e.leerMas(lector, 2)
  const p2 = m2.ok ? idsDe(cols, m2.valor.filasJson, e.col.id) : null
  const m3 = await e.leerMas(lector, 2)
  const p3 = m3.ok ? idsDe(cols, m3.valor.filasJson, e.col.id) : null
  e.check(`${e.motor} · «más» con el MISMO filtro y orden: [2,5] y [3]`, J(p2) === J(['2', '5']) && J(p3) === J(['3']), J({ p2, p3, m2: m2.ok ? null : m2, m3: m3.ok ? null : m3 }))
  // Contar necesita el lector vivo: una pestaña nueva, que se cuenta antes de leer más.
  const r2 = await e.abrir({ peticionId: pet(), filtro, orden, maxFilas: 2 })
  const l2 = r2.ok && r2.valor.resultado.tipo === 'filas' ? r2.valor.resultado.lector : null
  const cnt = l2 ? await e.contar(l2, pet()) : null
  e.check(`${e.motor} · Contar con el filtro: 5`, cnt !== null && cnt.ok && cnt.valor === 5, J(cnt))
}

/** Un error del servidor dentro de una condición: cómo vuelve según el motor. */
async function casosColumnaInexistente({ e, pet }: Contexto): Promise<void> {
  const { check } = e
  const r = await e.abrir({
    peticionId: pet(),
    filtro: { union: 'todas', condiciones: [condTexto(e, 'noVacio'), { columna: 'NO_EXISTE', categoria: 'texto', operador: 'igual', valor: 'x' }] },
    maxFilas: 10
  })
  const err = r.ok ? (r.valor.resultado.tipo === 'error' ? r.valor.resultado.error : null) : r.error
  switch (e.columnaInexistente) {
    case 'condicion':
      check(`${e.motor} · columna inexistente en la 2.ª condición -> campo 'filtro', condicion 1`, err !== null && err.campo === 'filtro' && err.condicion === 1, J(err))
      break
    case 'error':
      check(`${e.motor} · columna inexistente: vuelve el error del servidor (sin posición que ubicar)`, err !== null && err.motivo === 'servidor', J(err))
      break
    case 'literal': {
      const filas = r.ok && r.valor.resultado.tipo === 'filas' ? (JSON.parse(r.valor.resultado.pagina.filasJson) as unknown[]).length : null
      check(`${e.motor} · columna inexistente: SIN error, comparada como el texto 'NO_EXISTE' (0 filas; trampa conocida)`, err === null && filas === 0, J({ err, filas }))
      break
    }
    default: {
      const nunca: never = e.columnaInexistente
      throw new Error(`caso sin contemplar: ${String(nunca)}`)
    }
  }
}

// La tabla (id, nombre, sueldo, grande, alta, activo) es la misma en los cuatro motores:
//   1 'Ana' 12.5 G1 2026-09-28 00:00:00 (SQLite, sin hora) 1   · 2 'ANA_B' 10 G2 2026-09-28 23:59:59 0
//   3 '50% off' -3.25 5 2026-09-29 00:00:00 1                  · 4 NULL en todo (menos el id)
//   5 '' 7 7 2026-09-27 12:00:00 0 (en Oracle el '' es NULL)   · 6 'anaXb' 12.5 9 2026-09-01 10:00:00 1
// G1/G2 son dos enteros que solo difieren en la última cifra (de 30 cifras donde caben; 2^53+1 y
// 2^53+2 en SQLite): un double no los distingue.

/** Corre todos los casos del filtro guiado contra el motor de `e`. */
export async function probarFiltroGuiado(e: EntornoFiltroGuiado): Promise<void> {
  const ctx = crearContexto(e)
  await casosTexto(ctx)
  await casosNumeros(ctx)
  await casosFechas(ctx)
  await casosBooleano(ctx)
  await casosUnion(ctx)
  await casosOrdenYPaginado(ctx)
  await casosColumnaInexistente(ctx)
}
