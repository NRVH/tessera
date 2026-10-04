// =============================================================================
// Lógica pura de la barra de filtro guiado y del orden por la cabecera, común a la pestaña
// de tabla y a la de colección. Clic = asc → desc → sin orden y deja esa columna sola;
// Mayús+clic la añade al final (el gesto de varias claves de las hojas de cálculo). Lo que
// la tabla manda al main, al abrir y al exportar, sale de UNA función (`camposDeFiltroTabla`),
// con el modo aplicado y nunca `where` y `filtro` a la vez. Sin JSX, DOM ni `process`.
// Decisiones: docs/decisiones/bd/ui-rejilla-filtro-guiado.md
// =============================================================================

import {
  aridad,
  categoriaDeTipoLogico,
  OPERADORES_POR_CATEGORIA,
  validarFiltro,
  type DbCategoriaFiltro,
  type DbCondicionFiltro,
  type DbFiltroGuiado,
  type DbOperadorFiltro,
  type DbOrdenColumna
} from '../../../../../shared/filtroGuiado.ts'
import type { DbTipoLogico } from '../../../../../shared/db-explorador-ipc.ts'

/** Una columna que se puede elegir en la barra, con la categoría que decide sus operadores. */
export interface ColumnaFiltrable {
  nombre: string
  categoria: DbCategoriaFiltro
}

export const FILTRO_GUIADO_VACIO: DbFiltroGuiado = { union: 'todas', condiciones: [] }

/** El operador con el que nace una condición según la categoría. */
function operadorInicial(c: DbCategoriaFiltro): DbOperadorFiltro {
  return c === 'texto' ? 'contiene' : c === 'otro' ? 'noVacio' : 'igual'
}

/** Una condición nueva sobre `columna` (o la primera), con el operador por defecto de su tipo. */
export function condicionNueva(columnas: readonly ColumnaFiltrable[], columna?: string): DbCondicionFiltro | null {
  const col = (columna !== undefined ? columnas.find((c) => c.nombre === columna) : undefined) ?? columnas[0]
  if (col === undefined) return null
  const operador = operadorInicial(col.categoria)
  const c: DbCondicionFiltro = { columna: col.nombre, categoria: col.categoria, operador }
  if (aridad(operador) >= 1) c.valor = ''
  return c
}

/** Deja los valores que pide el operador (vacía los que sobran, crea los que faltan). */
function ajustarValores(c: DbCondicionFiltro): DbCondicionFiltro {
  const n = aridad(c.operador)
  const r: DbCondicionFiltro = { columna: c.columna, categoria: c.categoria, operador: c.operador }
  if (n >= 1) r.valor = c.valor ?? ''
  if (n >= 2) r.valor2 = c.valor2 ?? ''
  return r
}

/**
 * Cambia la columna de una condición. Si la categoría es otra y el operador no le vale, pasa
 * al inicial de la nueva (y también si le vale pero no se había escrito ningún valor); el
 * valor se conserva cuando el operador sigue pidiéndolo.
 */
export function cambiarColumna(c: DbCondicionFiltro, col: ColumnaFiltrable): DbCondicionFiltro {
  const vale = OPERADORES_POR_CATEGORIA[col.categoria].indexOf(c.operador) >= 0
  // (Grupo C.) Si aún no se escribió nada y la columna es de OTRO tipo, el operador vuelve
  // al inicial del tipo nuevo: la fila nace sobre la primera columna (un número, «=») y
  // quien elige después una de texto espera «contiene», no el «=» que heredó sin pedirlo.
  // Con un valor escrito, o con «está vacío» (que no lleva), se respeta lo elegido.
  const sinEscribir = aridad(c.operador) > 0 && (c.valor ?? '') === '' && (c.valor2 ?? '') === ''
  const conserva = vale && !(col.categoria !== c.categoria && sinEscribir)
  return ajustarValores({ ...c, columna: col.nombre, categoria: col.categoria, operador: conserva ? c.operador : operadorInicial(col.categoria) })
}

export function cambiarOperador(c: DbCondicionFiltro, operador: DbOperadorFiltro): DbCondicionFiltro {
  return ajustarValores({ ...c, operador })
}

/** Reemplaza la condición `i` (inmutable). */
export function conCondicion(f: DbFiltroGuiado, i: number, c: DbCondicionFiltro): DbFiltroGuiado {
  return { ...f, condiciones: f.condiciones.map((x, k) => (k === i ? c : x)) }
}

export function sinCondicion(f: DbFiltroGuiado, i: number): DbFiltroGuiado {
  return { ...f, condiciones: f.condiciones.filter((_, k) => k !== i) }
}

/**
 * Las condiciones cuya columna ya no está en el resultado (otra tabla con el mismo filtro, una
 * columna borrada): se quitan en vez de mandarlas a un error del servidor.
 */
export function podarColumnas(f: DbFiltroGuiado, columnas: readonly ColumnaFiltrable[]): DbFiltroGuiado {
  const nombres = new Set(columnas.map((c) => c.nombre))
  const quedan = f.condiciones.filter((c) => nombres.has(c.columna))
  return quedan.length === f.condiciones.length ? f : { ...f, condiciones: quedan }
}

/** ¿Dos filtros son el mismo? (para saber si lo escrito difiere de lo aplicado). */
export function mismoFiltro(a: DbFiltroGuiado, b: DbFiltroGuiado): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * El clic en la cabecera de `columna` (ver la cabecera del archivo). `multiple` = Mayús.
 * Sin Mayús: esa columna sola, ciclando la dirección que tuviera (si era parte de un orden
 * de varias, empieza el ciclo desde la suya). Con Mayús: la cicla en su sitio o la añade.
 */
export function ciclarOrden(orden: readonly DbOrdenColumna[], columna: string, multiple: boolean): DbOrdenColumna[] {
  const i = orden.findIndex((o) => o.columna === columna)
  const actual = i >= 0 ? orden[i].dir : null
  const siguiente: 'asc' | 'desc' | null = actual === null ? 'asc' : actual === 'asc' ? 'desc' : null
  if (!multiple) return siguiente === null ? [] : [{ columna, dir: siguiente }]
  if (i < 0) return [...orden, { columna, dir: 'asc' }]
  if (siguiente === null) return orden.filter((_, k) => k !== i)
  return orden.map((o, k) => (k === i ? { columna, dir: siguiente } : o))
}

/** La dirección y la prioridad (1-based, solo si hay varias) de una columna, para la flecha. */
export function ordenDeColumna(
  orden: readonly DbOrdenColumna[],
  columna: string
): { dir: 'asc' | 'desc'; prioridad: number | null } | null {
  const i = orden.findIndex((o) => o.columna === columna)
  if (i < 0) return null
  return { dir: orden[i].dir, prioridad: orden.length > 1 ? i + 1 : null }
}

/** Quita del orden las columnas que ya no están en el resultado (misma idea que `podarColumnas`). */
export function podarOrden(orden: readonly DbOrdenColumna[], columnas: readonly { nombre: string }[]): readonly DbOrdenColumna[] {
  const nombres = new Set(columnas.map((c) => c.nombre))
  const quedan = orden.filter((o) => nombres.has(o.columna))
  return quedan.length === orden.length ? orden : quedan
}

/** La palabra delante de la condición `i`: «donde» la primera, luego «y» u «o» según la unión. */
export function conectorCondicion(union: DbFiltroGuiado['union'], i: number): 'donde' | 'y' | 'o' {
  if (i === 0) return 'donde'
  return union === 'todas' ? 'y' : 'o'
}

/**
 * Las columnas de un resultado SQL que se ofrecen en la barra, en su orden, con la categoría
 * que decide sus operadores. Un nombre repetido (dos columnas iguales en una vista rara) se
 * ofrece UNA vez: la condición se identifica por el nombre y la segunda sería la misma.
 */
export function columnasFiltrablesSql(columnas: readonly { nombre: string; tipoLogico: DbTipoLogico }[]): ColumnaFiltrable[] {
  const vistas = new Set<string>()
  const r: ColumnaFiltrable[] = []
  for (const c of columnas) {
    if (vistas.has(c.nombre)) continue
    vistas.add(c.nombre)
    r.push({ nombre: c.nombre, categoria: categoriaDeTipoLogico(c.tipoLogico) })
  }
  return r
}

/** El error que señala la barra: en la fila `condicion`, o en la barra entera (null). */
export interface ErrorBarraFiltro {
  condicion: number | null
  mensaje: string
}

/** Lo que falla en el filtro guiado ANTES de mandarlo, o null. El índice -1 es de la barra. */
export function problemaDelGuiado(f: DbFiltroGuiado): ErrorBarraFiltro | null {
  const p = validarFiltro(f)
  if (p === null) return null
  return { condicion: p.indice >= 0 ? p.indice : null, mensaje: p.mensaje }
}

// --- La pestaña de TABLA (SQL) ----------------------------------------------------

/** El filtro de la pestaña de tabla: el modo que se aplicó, lo de cada modo y el orden. */
export interface FiltroTabla {
  /** «guiado» (por defecto) o «sql» (el WHERE libre). Se manda SOLO lo de este modo. */
  modo: 'guiado' | 'sql'
  guiado: DbFiltroGuiado
  where: string
  /** El orden de la cabecera; vale en los dos modos. */
  orden: readonly DbOrdenColumna[]
}

export const FILTRO_TABLA_VACIO: FiltroTabla = { modo: 'guiado', guiado: FILTRO_GUIADO_VACIO, where: '', orden: [] }

/**
 * Los campos de `DbAbrirTabla` / `DbOrigenExportacion` que salen del filtro: el WHERE libre
 * solo en modo «sql» y si no está en blanco; el guiado solo en modo «guiado» y con alguna
 * condición; el orden si hay alguno. Nunca `orderBy`, nunca `where` y `filtro` a la vez.
 */
export function camposDeFiltroTabla(f: FiltroTabla): { where?: string; filtro?: DbFiltroGuiado; orden?: DbOrdenColumna[] } {
  const r: { where?: string; filtro?: DbFiltroGuiado; orden?: DbOrdenColumna[] } = {}
  if (f.modo === 'sql') {
    if (f.where.trim() !== '') r.where = f.where
  } else if (f.guiado.condiciones.length > 0) {
    r.filtro = f.guiado
  }
  if (f.orden.length > 0) r.orden = [...f.orden]
  return r
}
