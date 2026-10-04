// =============================================================================
// Modelo de los cambios pendientes de la rejilla: sus tipos, las consultas que no cambian
// nada (cuántos hay, cómo se ve una celda) y la vista con las filas nuevas arriba.
// Puro; lo reexporta `cambiosRejilla.ts`, que es el módulo que importan los demás.
// Decisiones: docs/decisiones/bd/ui-rejilla-modelo-cambios.md
// =============================================================================

import type { DbCelda, DbIdentidadFila, DbValorEdicion } from '../../../../../shared/db-explorador-ipc.ts'

// --- Tipos -------------------------------------------------------------------------

/** Una fila de la rejilla: del servidor (índice en lo cargado) o nueva (id propio). */
export type RefFila = { readonly tipo: 'servidor'; readonly f: number } | { readonly tipo: 'nueva'; readonly id: number }

/** Lo pendiente de una fila del servidor. */
export interface FilaEditada {
  /** Columna -> valor nuevo. Solo las celdas que difieren del original. */
  readonly valores: ReadonlyMap<number, DbValorEdicion>
  readonly borrada: boolean
}

/** Una fila añadida. Las columnas que no están en `valores` van con su DEFAULT. */
export interface FilaNueva {
  readonly id: number
  readonly valores: ReadonlyMap<number, DbValorEdicion>
}

/** Todo lo pendiente de una pestaña de tabla hasta «Enviar». */
export interface CambiosRejilla {
  /** Índice de la fila del servidor -> sus cambios. */
  readonly editadas: ReadonlyMap<number, FilaEditada>
  /** En orden de creación: así se pintan (arriba) y así se insertan. */
  readonly nuevas: readonly FilaNueva[]
  readonly siguienteId: number
}

/** Sin nada pendiente. */
export const SIN_CAMBIOS: CambiosRejilla = { editadas: new Map(), nuevas: [], siguienteId: 1 }

/** Los valores de una fila sin celdas cambiadas. */
export const SIN_VALORES: ReadonlyMap<number, DbValorEdicion> = new Map()

// --- Consultas ------------------------------------------------------------------------

/** Cuántos `DbCambioFila` saldrían al enviar (lo que dice «Enviar (N)»). */
export function numCambios(c: CambiosRejilla): number {
  let n = c.nuevas.length
  c.editadas.forEach((e) => {
    if (e.borrada || e.valores.size > 0) n++
  })
  return n
}

/** ¿Hay algo que enviar? */
export function hayCambios(c: CambiosRejilla): boolean {
  return numCambios(c) > 0
}

/** Cuántos cambios de cada clase hay. */
export interface ResumenCambios {
  actualizar: number
  insertar: number
  borrar: number
}

/** Cuenta los cambios por clase. */
export function resumenCambios(c: CambiosRejilla): ResumenCambios {
  let actualizar = 0
  let borrar = 0
  c.editadas.forEach((e) => {
    if (e.borrada) borrar++
    else if (e.valores.size > 0) actualizar++
  })
  return { actualizar, insertar: c.nuevas.length, borrar }
}

/** «3 cambios», «1 cambio». */
export function textoCambios(n: number): string {
  return n === 1 ? '1 cambio' : `${n} cambios`
}

/** «1 actualización, 2 inserciones y 1 borrado» (solo lo que hay). */
export function textoResumen(r: ResumenCambios): string {
  const partes: string[] = []
  if (r.actualizar > 0) partes.push(r.actualizar === 1 ? '1 actualización' : `${r.actualizar} actualizaciones`)
  if (r.insertar > 0) partes.push(r.insertar === 1 ? '1 inserción' : `${r.insertar} inserciones`)
  if (r.borrar > 0) partes.push(r.borrar === 1 ? '1 borrado' : `${r.borrar} borrados`)
  if (partes.length <= 1) return partes.join('')
  return partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1]
}

/** ¿Nombran la misma fila? */
export function mismaRef(a: RefFila, b: RefFila): boolean {
  return a.tipo === b.tipo && (a.tipo === 'servidor' ? a.f === (b as { f: number }).f : a.id === (b as { id: number }).id)
}

/** La fila nueva con ese id, o undefined. */
export function filaNueva(c: CambiosRejilla, id: number): FilaNueva | undefined {
  for (const n of c.nuevas) if (n.id === id) return n
  return undefined
}

/**
 * ¿Coincide lo escrito con lo que se leyó? NULL solo con NULL; un booleano de PG con su
 * texto (`true`/`false`, que es lo que la rejilla enseña y el editor propone).
 */
export function mismoValor(original: DbCelda | undefined, valor: DbValorEdicion): boolean {
  if (original === null || original === undefined) return valor === null
  if (valor === null) return false
  if (typeof original === 'boolean') return (original ? 'true' : 'false') === valor
  return original === valor
}

/** El texto con el que arranca el editor de una celda (NULL = vacío). */
export function textoParaEditar(v: DbCelda | undefined): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return v
}

/** Los saltos de línea como los deja un <textarea>: CRLF y CR pasan a LF. */
export function normalizarSaltos(t: string): string {
  return t.replace(/\r\n?/g, '\n')
}

/**
 * ¿Lo que hay en el editor de celda es un CAMBIO? Abierto escribiendo (`sucio`), sí; si
 * no, solo si difiere del texto con el que se abrió CON LOS SALTOS NORMALIZADOS: el
 * `value` del <textarea> ya no trae los CRLF que se le dieron.
 */
export function textoEditorCambiado(sucio: boolean, valorInicial: string, texto: string): boolean {
  return sucio || normalizarSaltos(texto) !== normalizarSaltos(valorInicial)
}

/**
 * El valor que se escribe desde el editor. Si el texto con el que se abrió usaba CRLF en
 * TODOS sus saltos, lo escrito vuelve a llevarlos (el <textarea> los convirtió a LF); si
 * mezclaba o usaba LF, se queda como está. Así tocar una letra no reescribe los saltos.
 */
export function valorDesdeEditor(valorInicial: string, texto: string): string {
  if (!valorInicial.includes('\r\n')) return texto
  // ¿Algún salto que NO sea CRLF? (un LF suelto o un CR suelto): entonces no es de CRLF.
  if (/(^|[^\r])\n|\r(?!\n)/.test(valorInicial)) return texto
  return normalizarSaltos(texto).replace(/\n/g, '\r\n')
}

/**
 * ¿Se puede editar AHORA? Con identidad de fila y SIN otra lectura en vuelo. Mientras
 * llega otro resultado (Refrescar, filtrar, la relectura tras «Enviar»), la rejilla
 * sigue enseñando el ANTERIOR; un cambio hecho ahí apuntaría por su posición a una fila
 * del resultado NUEVO —con filas borradas o insertadas de por medio, a OTRA— y «Enviar»
 * la actualizaría con la clave de esa otra fila.
 */
export function sePuedeEditar(identidad: DbIdentidadFila | null, cargando: boolean): boolean {
  return identidad !== null && identidad.tipo !== 'ninguna' && !cargando
}

// --- La vista: filas nuevas arriba, luego las del servidor ------------------------------

/** Filas que pinta la rejilla: las nuevas más las cargadas. */
export function numFilasVista(c: CambiosRejilla, numServidor: number): number {
  return c.nuevas.length + numServidor
}

/** Qué fila hay en la posición `d` de la rejilla (null si cae fuera). */
export function filaEnVista(c: CambiosRejilla, d: number, numServidor: number): RefFila | null {
  if (!Number.isInteger(d) || d < 0) return null
  const k = c.nuevas.length
  if (d < k) return { tipo: 'nueva', id: c.nuevas[d].id }
  return d - k < numServidor ? { tipo: 'servidor', f: d - k } : null
}

/** En qué posición de la rejilla se pinta una fila (null si ya no existe). */
export function posicionEnVista(c: CambiosRejilla, ref: RefFila, numServidor: number): number | null {
  if (ref.tipo === 'nueva') {
    for (let i = 0; i < c.nuevas.length; i++) if (c.nuevas[i].id === ref.id) return i
    return null
  }
  return ref.f >= 0 && ref.f < numServidor ? c.nuevas.length + ref.f : null
}

/** Las filas de la rejilla entre dos posiciones (inclusivas), sin las que no existen. */
export function filasEnRango(c: CambiosRejilla, d0: number, d1: number, numServidor: number): RefFila[] {
  const out: RefFila[] = []
  for (let d = Math.max(0, d0); d <= d1; d++) {
    const r = filaEnVista(c, d, numServidor)
    if (r) out.push(r)
  }
  return out
}

/** La celda tal como se ve: el valor pendiente si lo hay, si no el cargado. */
export interface ValorVisto {
  valor: DbCelda
  /** Fila nueva y columna sin escribir: va con su DEFAULT. */
  porDefecto: boolean
  /** Tiene un cambio pendiente. */
  cambiada: boolean
}

/** Cómo se ve la celda `col` de la fila `ref`, con lo pendiente encima de lo cargado. */
export function valorVisto(
  c: CambiosRejilla,
  ref: RefFila,
  col: number,
  filas: readonly (readonly DbCelda[])[]
): ValorVisto {
  if (ref.tipo === 'nueva') {
    const n = filaNueva(c, ref.id)
    if (n && n.valores.has(col)) return { valor: n.valores.get(col) ?? null, porDefecto: false, cambiada: true }
    return { valor: null, porDefecto: true, cambiada: false }
  }
  const e = c.editadas.get(ref.f)
  if (e && e.valores.has(col)) return { valor: e.valores.get(col) ?? null, porDefecto: false, cambiada: true }
  const fila = filas[ref.f]
  return { valor: fila && col < fila.length ? fila[col] : null, porDefecto: false, cambiada: false }
}

/** ¿La fila del servidor está marcada para borrar? */
export function estaBorrada(c: CambiosRejilla, ref: RefFila): boolean {
  return ref.tipo === 'servidor' && c.editadas.get(ref.f)?.borrada === true
}
