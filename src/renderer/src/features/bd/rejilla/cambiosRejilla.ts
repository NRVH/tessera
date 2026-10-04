// =============================================================================
// Cambios pendientes de la rejilla de una pestaña de tabla: editar, añadir, borrar y
// revertir (inmutable, copiando los mapas una vez por operación en bloque), qué no se edita
// y la selección cuando la vista cambia de forma. Puro: lo prueban el renderer y el main
// con `node`. Reexporta el modelo, el envío y el diálogo, que viven en `cambiosRejilla*.ts`.
// Decisiones: docs/decisiones/bd/ui-rejilla-modelo-cambios.md
// =============================================================================

import type { DbCelda, DbColumnaResultado, DbIdentidadFila, DbValorEdicion } from '../../../../../shared/db-explorador-ipc.ts'
import { COLUMNA_ROWID } from '../../../../../shared/sql/dmlRejilla.ts'
import {
  estaBorrada,
  filaEnVista,
  filaNueva,
  mismoValor,
  posicionEnVista,
  SIN_VALORES,
  type CambiosRejilla,
  type FilaEditada,
  type FilaNueva,
  type RefFila
} from './cambiosRejillaModelo.ts'
import type { Celda, Seleccion } from './seleccionRejilla.ts'
import { esColumnaBinaria } from './visorValor.ts'

export * from './cambiosRejillaModelo.ts'
export * from './cambiosRejillaEnvio.ts'
export * from './cambiosRejillaDialogo.ts'

/** La columna OCULTA del ROWID: se define una vez, en `shared/sql/dmlRejilla.ts`. */
export { COLUMNA_ROWID }

// --- La selección cuando la vista cambia de FORMA ------------------------------------------
// La selección y el visor son POSICIONES de la vista, pero quitar filas NUEVAS sube todas
// las del servidor y una posición guardada pasaría a nombrar OTRA fila (el siguiente Supr
// marcaría filas que nadie eligió). Cuando la vista cambia de forma, la selección se
// REUBICA por la identidad de sus filas y se RECORTA a las que siguen existiendo.

/** Una vista de la rejilla: en qué posición se pinta cada fila. */
export interface VistaFilas {
  readonly cambios: CambiosRejilla
  readonly numServidor: number
}

/**
 * ¿Pinta cada fila en la misma posición? Sí con las MISMAS nuevas en el mismo orden: las
 * del servidor van detrás, y anexar una página solo añade al final (lo que se va se
 * acota aparte).
 */
export function mismaFormaVista(a: CambiosRejilla, b: CambiosRejilla): boolean {
  if (a.nuevas === b.nuevas) return true
  if (a.nuevas.length !== b.nuevas.length) return false
  for (let i = 0; i < a.nuevas.length; i++) if (a.nuevas[i].id !== b.nuevas[i].id) return false
  return true
}

/** Dónde se pinta AHORA la fila que estaba en la posición `d` (null si ya no existe). */
export function reubicarPosicion(d: number, antes: VistaFilas, despues: VistaFilas): number | null {
  const ref = filaEnVista(antes.cambios, d, antes.numServidor)
  return ref ? posicionEnVista(despues.cambios, ref, despues.numServidor) : null
}

/** Una celda (la del visor) en la vista nueva: su fila por identidad; null si ya no está. */
export function reubicarCelda(celda: Celda | null, antes: VistaFilas, despues: VistaFilas): Celda | null {
  if (!celda || mismaFormaVista(antes.cambios, despues.cambios)) return celda
  const f = reubicarPosicion(celda.f, antes, despues)
  return f === null ? null : { f, c: celda.c }
}

/**
 * La selección en la vista nueva: las filas que ELIGIÓ el usuario y que siguen existiendo,
 * en su sitio nuevo, con las mismas columnas y la misma dirección. Sin cambio de forma, la
 * MISMA selección. Si no queda ninguna, o las que quedan no son contiguas (se colaría una
 * fila que no se eligió), `null`: dejar la celda activa en el hueco la pondría sobre una
 * fila que nadie eligió.
 */
export function reubicarSeleccion(sel: Seleccion, antes: VistaFilas, despues: VistaFilas): Seleccion {
  if (!sel || mismaFormaVista(antes.cambios, despues.cambios)) return sel
  const f0 = Math.min(sel.ancla.f, sel.foco.f)
  const f1 = Math.max(sel.ancla.f, sel.foco.f)
  const kAntes = antes.cambios.nuevas.length
  const kDespues = despues.cambios.nuevas.length
  let g0 = Number.POSITIVE_INFINITY
  let g1 = Number.NEGATIVE_INFINITY
  let quedan = 0
  // Las NUEVAS del rango, por su id (son las que el usuario añadió a mano: pocas).
  let posNueva: Map<number, number> | null = null
  for (let d = Math.max(0, f0); d <= Math.min(f1, kAntes - 1); d++) {
    if (posNueva === null) posNueva = new Map(despues.cambios.nuevas.map((n, i) => [n.id, i]))
    const p = posNueva.get(antes.cambios.nuevas[d].id)
    if (p === undefined) continue
    g0 = Math.min(g0, p)
    g1 = Math.max(g1, p)
    quedan++
  }
  // Las del SERVIDOR del rango: no desaparecen de la vista (borrar solo las marca) y se
  // mueven todas juntas lo que cambió el número de nuevas. Sin recorrerlas: con Mod+A
  // sobre 20 000 filas sería un bucle por cada cambio de forma.
  const s0 = Math.max(f0, kAntes) - kAntes
  const s1 = Math.min(f1 - kAntes, antes.numServidor - 1, despues.numServidor - 1)
  if (s1 >= s0) {
    g0 = Math.min(g0, kDespues + s0)
    g1 = Math.max(g1, kDespues + s1)
    quedan += s1 - s0 + 1
  }
  if (quedan === 0 || g1 - g0 + 1 !== quedan) return null
  const bajando = sel.ancla.f <= sel.foco.f
  return {
    ancla: { f: bajando ? g0 : g1, c: sel.ancla.c },
    foco: { f: bajando ? g1 : g0, c: sel.foco.c }
  }
}

// --- Operaciones ------------------------------------------------------------------------

function conEditada(c: CambiosRejilla, f: number, e: FilaEditada | null): CambiosRejilla {
  const actual = c.editadas.get(f)
  if (e === null && actual === undefined) return c
  const editadas = new Map(c.editadas)
  if (e === null) editadas.delete(f)
  else editadas.set(f, e)
  return { ...c, editadas }
}

/** Una fila editada vacía (sin celdas ni borrado) no existe: null. */
function normalizada(valores: ReadonlyMap<number, DbValorEdicion>, borrada: boolean): FilaEditada | null {
  return valores.size === 0 && !borrada ? null : { valores, borrada }
}

function conNueva(c: CambiosRejilla, id: number, valores: ReadonlyMap<number, DbValorEdicion>): CambiosRejilla {
  let cambio = false
  const nuevas = c.nuevas.map((n) => {
    if (n.id !== id) return n
    cambio = true
    return { id, valores }
  })
  return cambio ? { ...c, nuevas } : c
}

/**
 * Escribe un valor en una celda. `original` es lo que se leyó del servidor (para una
 * fila nueva no se mira): si el valor vuelve a ser el original, el cambio de esa celda
 * DESAPARECE. Una fila borrada no se edita (devuelve lo mismo).
 */
export function editarCelda(
  c: CambiosRejilla,
  ref: RefFila,
  col: number,
  valor: DbValorEdicion,
  original: DbCelda | undefined
): CambiosRejilla {
  if (ref.tipo === 'nueva') {
    const n = filaNueva(c, ref.id)
    if (!n) return c
    if (n.valores.has(col) && n.valores.get(col) === valor) return c
    const valores = new Map(n.valores)
    valores.set(col, valor)
    return conNueva(c, ref.id, valores)
  }
  const e = c.editadas.get(ref.f)
  if (e?.borrada) return c
  const previo = e?.valores ?? SIN_VALORES
  if (mismoValor(original, valor)) {
    if (!previo.has(col)) return c
    const valores = new Map(previo)
    valores.delete(col)
    return conEditada(c, ref.f, normalizada(valores, false))
  }
  if (previo.has(col) && previo.get(col) === valor) return c
  const valores = new Map(previo)
  valores.set(col, valor)
  return conEditada(c, ref.f, { valores, borrada: false })
}

/** Quita el cambio de una celda (en una fila nueva, la devuelve a su DEFAULT). */
export function revertirCelda(c: CambiosRejilla, ref: RefFila, col: number): CambiosRejilla {
  if (ref.tipo === 'nueva') {
    const n = filaNueva(c, ref.id)
    if (!n || !n.valores.has(col)) return c
    const valores = new Map(n.valores)
    valores.delete(col)
    return conNueva(c, ref.id, valores)
  }
  const e = c.editadas.get(ref.f)
  if (!e || !e.valores.has(col)) return c
  const valores = new Map(e.valores)
  valores.delete(col)
  return conEditada(c, ref.f, normalizada(valores, e.borrada))
}

/** Añade una fila nueva (al final de las nuevas, que se pintan arriba). */
export function anadirFila(c: CambiosRejilla): { cambios: CambiosRejilla; id: number } {
  const id = c.siguienteId
  return { cambios: { ...c, nuevas: [...c.nuevas, { id, valores: SIN_VALORES }], siguienteId: id + 1 }, id }
}

// --- En bloque: los mapas se copian UNA vez por operación --------------------------------

/**
 * Lo que una operación en bloque va cambiando: las filas editadas (copiadas la primera
 * vez que hace falta), las nuevas que se quitan y los valores nuevos de las que se tocan.
 * `cerrar` monta el resultado, o devuelve el MISMO objeto si no cambió nada.
 */
class Bloque {
  private readonly base: CambiosRejilla
  private editadas: Map<number, FilaEditada> | null = null
  private readonly quitar = new Set<number>()
  private readonly valoresNuevas = new Map<number, ReadonlyMap<number, DbValorEdicion>>()
  private porId: Map<number, FilaNueva> | null = null

  // Sin propiedades de parámetro: el type-stripping de Node (los tests) no las admite.
  constructor(base: CambiosRejilla) {
    this.base = base
  }

  editada(f: number): FilaEditada | undefined {
    return (this.editadas ?? this.base.editadas).get(f)
  }

  /** Pone (o quita, con null) lo pendiente de una fila del servidor. */
  ponerEditada(f: number, e: FilaEditada | null): void {
    if (e === null && !this.editada(f)) return
    if (this.editadas === null) this.editadas = new Map(this.base.editadas)
    if (e === null) this.editadas.delete(f)
    else this.editadas.set(f, e)
  }

  /** La fila nueva con ese id tal como va quedando, o undefined (no existe o se quita). */
  nueva(id: number): FilaNueva | undefined {
    if (this.quitar.has(id)) return undefined
    if (this.porId === null) this.porId = new Map(this.base.nuevas.map((n) => [n.id, n]))
    const n = this.porId.get(id)
    if (!n) return undefined
    const v = this.valoresNuevas.get(id)
    return v ? { id, valores: v } : n
  }

  ponerValoresNueva(id: number, valores: ReadonlyMap<number, DbValorEdicion>): void {
    this.valoresNuevas.set(id, valores)
  }

  quitarNueva(id: number): void {
    if (this.nueva(id)) this.quitar.add(id)
  }

  cerrar(): CambiosRejilla {
    let r = this.base
    if (this.editadas !== null) r = { ...r, editadas: this.editadas }
    if (this.quitar.size > 0 || this.valoresNuevas.size > 0) {
      let cambio = false
      const nuevas: FilaNueva[] = []
      for (const n of r.nuevas) {
        if (this.quitar.has(n.id)) {
          cambio = true
          continue
        }
        const v = this.valoresNuevas.get(n.id)
        if (v !== undefined && v !== n.valores) {
          cambio = true
          nuevas.push({ id: n.id, valores: v })
        } else {
          nuevas.push(n)
        }
      }
      if (cambio) r = { ...r, nuevas }
    }
    return r
  }
}

/**
 * Borra filas: las del servidor quedan MARCADAS (tachadas hasta Enviar, conservando sus
 * celdas editadas por si se revierte); las nuevas se quitan sin más.
 */
export function borrarFilas(c: CambiosRejilla, refs: readonly RefFila[]): CambiosRejilla {
  const b = new Bloque(c)
  for (const ref of refs) {
    if (ref.tipo === 'nueva') {
      b.quitarNueva(ref.id)
      continue
    }
    const e = b.editada(ref.f)
    if (e?.borrada) continue
    b.ponerEditada(ref.f, { valores: e?.valores ?? SIN_VALORES, borrada: true })
  }
  return b.cerrar()
}

/** Revierte filas ENTERAS: quita sus celdas cambiadas y su borrado, y quita las nuevas. */
export function revertirFilas(c: CambiosRejilla, refs: readonly RefFila[]): CambiosRejilla {
  const b = new Bloque(c)
  for (const ref of refs) {
    if (ref.tipo === 'nueva') b.quitarNueva(ref.id)
    else b.ponerEditada(ref.f, null)
  }
  return b.cerrar()
}

/**
 * «Revertir selección»: lo pendiente DENTRO de un rango. En las filas editadas, las
 * celdas de esas columnas; una fila borrada del rango deja de estarlo; en una nueva, las
 * celdas de esas columnas vuelven a su DEFAULT y, si el rango cubre TODAS las columnas,
 * la fila entera se quita (es lo que se seleccionó: la fila).
 */
export function revertirRango(
  c: CambiosRejilla,
  refs: readonly RefFila[],
  c0: number,
  c1: number,
  numColumnas: number
): CambiosRejilla {
  const filaEntera = c0 <= 0 && c1 >= numColumnas - 1
  const b = new Bloque(c)
  for (const ref of refs) {
    if (ref.tipo === 'nueva') {
      if (filaEntera) {
        b.quitarNueva(ref.id)
        continue
      }
      const n = b.nueva(ref.id)
      if (!n) continue
      const valores = sinColumnas(n.valores, c0, c1)
      if (valores !== n.valores) b.ponerValoresNueva(ref.id, valores)
      continue
    }
    const e = b.editada(ref.f)
    if (!e) continue
    const valores = sinColumnas(e.valores, c0, c1)
    if (valores === e.valores && !e.borrada) continue
    b.ponerEditada(ref.f, normalizada(valores, false))
  }
  return b.cerrar()
}

/** Una celda que escribir con `editarCeldas` (lo mismo que recibe `editarCelda`). */
export interface EdicionCelda {
  ref: RefFila
  col: number
  valor: DbValorEdicion
  /** Lo leído del servidor (en una fila nueva no se mira). */
  original: DbCelda | undefined
}

/** Escribe una celda de una fila NUEVA dentro de un bloque; `propios` son sus mapas ya copiados. */
function editarNuevaEnBloque(
  b: Bloque,
  propios: Map<number, Map<number, DbValorEdicion>>,
  id: number,
  col: number,
  valor: DbValorEdicion
): void {
  const n = b.nueva(id)
  if (!n) return
  if (n.valores.has(col) && n.valores.get(col) === valor) return
  let v = propios.get(id)
  if (!v) {
    v = new Map(n.valores)
    propios.set(id, v)
    b.ponerValoresNueva(id, v)
  }
  v.set(col, valor)
}

/**
 * Escribe MUCHAS celdas de una vez («Poner NULL» sobre una selección): el mismo
 * resultado que encadenar `editarCelda`, copiando los mapas una vez.
 */
export function editarCeldas(c: CambiosRejilla, ediciones: Iterable<EdicionCelda>): CambiosRejilla {
  const b = new Bloque(c)
  /** Los mapas de valores que ya son PROPIOS de esta operación (se pueden mutar). */
  const propiosServidor = new Map<number, Map<number, DbValorEdicion>>()
  const propiosNuevas = new Map<number, Map<number, DbValorEdicion>>()
  for (const ed of ediciones) {
    const { ref, col, valor } = ed
    if (ref.tipo === 'nueva') {
      editarNuevaEnBloque(b, propiosNuevas, ref.id, col, valor)
      continue
    }
    const e = b.editada(ref.f)
    if (e?.borrada) continue
    const previo = e?.valores ?? SIN_VALORES
    const vuelveAlOriginal = mismoValor(ed.original, valor)
    if (vuelveAlOriginal ? !previo.has(col) : previo.has(col) && previo.get(col) === valor) continue
    let v = propiosServidor.get(ref.f)
    if (!v) {
      v = new Map(previo)
      propiosServidor.set(ref.f, v)
    }
    if (vuelveAlOriginal) v.delete(col)
    else v.set(col, valor)
    b.ponerEditada(ref.f, normalizada(v, false))
  }
  return b.cerrar()
}

/** Los valores sin las columnas c0..c1; el MISMO mapa si no había ninguna. */
function sinColumnas(
  valores: ReadonlyMap<number, DbValorEdicion>,
  c0: number,
  c1: number
): ReadonlyMap<number, DbValorEdicion> {
  let out: Map<number, DbValorEdicion> | null = null
  for (const col of valores.keys()) {
    if (col < c0 || col > c1) continue
    if (out === null) out = new Map(valores)
    out.delete(col)
  }
  return out ?? valores
}

/**
 * ¿Hay algo que revertir dentro del rango? (para habilitar la entrada del menú). Es
 * `revertirRango(...) !== c` sin construir nada: solo mira, y para en lo primero que
 * encuentra (el test lo compara con esa definición).
 */
export function hayCambiosEnRango(
  c: CambiosRejilla,
  refs: readonly RefFila[],
  c0: number,
  c1: number,
  numColumnas: number
): boolean {
  const filaEntera = c0 <= 0 && c1 >= numColumnas - 1
  const hayColumna = (valores: ReadonlyMap<number, DbValorEdicion>): boolean => {
    for (const col of valores.keys()) if (col >= c0 && col <= c1) return true
    return false
  }
  let porId: Map<number, FilaNueva> | null = null
  for (const ref of refs) {
    if (ref.tipo === 'nueva') {
      if (porId === null) porId = new Map(c.nuevas.map((n) => [n.id, n]))
      const n = porId.get(ref.id)
      if (n && (filaEntera || hayColumna(n.valores))) return true
      continue
    }
    const e = c.editadas.get(ref.f)
    if (e && (e.borrada || hayColumna(e.valores))) return true
  }
  return false
}

// --- Qué se puede editar ------------------------------------------------------------------

export const MOTIVO_BINARIA = 'Columna binaria: su valor no se escribe como texto desde la rejilla.'
export const MOTIVO_ROWID = 'Columna interna de Tessera (ROWID).'
export const MOTIVO_RECORTADA =
  'El valor llegó recortado (más de 64 KiB): editarlo aquí guardaría solo el trozo que se ve.'
export const MOTIVO_BORRADA = 'La fila está marcada para borrar: revierte el borrado para editarla.'

/**
 * Las columnas que el MAIN dice que no se editan (`DbTablaAbierta.noEditables`: las
 * binarias, las generadas, las identidad ALWAYS y, en Oracle, los tipos que no se
 * escriben como texto), por NOMBRE EXACTO. La primera que se repita manda.
 */
export function noEditablesPorNombre(
  lista: readonly { columna: string; motivo: string }[] | undefined
): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  for (const n of lista ?? []) {
    if (typeof n?.columna !== 'string' || out.has(n.columna)) continue
    out.set(n.columna, typeof n.motivo === 'string' && n.motivo.trim() !== '' ? n.motivo : 'No se puede editar desde la rejilla.')
  }
  return out
}

/**
 * Por qué una COLUMNA entera no se edita, o null si se edita. Manda lo que dice el main
 * (`delMain`, de `noEditablesPorNombre`); la binaria se comprueba además aquí, por si el
 * main no lo mandara: escribir texto en un BLOB nunca es lo que se quiere, y el main lo
 * rechazaría igual al enviar.
 */
export function motivoColumnaNoEditable(
  col: DbColumnaResultado,
  indice: number,
  numColumnas: number,
  delMain?: ReadonlyMap<string, string>
): string | null {
  if (col.nombre === COLUMNA_ROWID && indice === numColumnas - 1) return MOTIVO_ROWID
  const delServidor = delMain?.get(col.nombre)
  if (delServidor !== undefined) return delServidor
  if (esColumnaBinaria(col.tipoLogico, col.tipoMotor)) return MOTIVO_BINARIA
  return null
}

/** Los motivos de todas las columnas (null = editable), en su orden. */
export function motivosColumnas(
  columnas: readonly DbColumnaResultado[],
  delMain?: ReadonlyMap<string, string>
): (string | null)[] {
  return columnas.map((col, i) => motivoColumnaNoEditable(col, i, columnas.length, delMain))
}

/** Por qué no se edita UNA celda (la columna, recortada, o la fila borrada), o null. */
export function motivoCeldaNoEditable(
  c: CambiosRejilla,
  ref: RefFila,
  motivoColumna: string | null,
  recortada: boolean
): string | null {
  if (motivoColumna) return motivoColumna
  if (estaBorrada(c, ref)) return MOTIVO_BORRADA
  // Ni siquiera «Poner NULL»: el usuario no ha visto el valor entero que tiraría.
  if (recortada && ref.tipo === 'servidor') return MOTIVO_RECORTADA
  return null
}

// --- La identidad con la que se edita -----------------------------------------------------

/**
 * La identidad que vale para EDITAR, comprobada contra lo que llegó: sin identidad es
 * 'ninguna' sin motivo; una 'pk' cuyas columnas no están todas en el resultado, o un
 * 'rowid' cuya columna no es la última, 'ninguna' con el porqué. El `readonly` de la
 * conexión no se mira: es de los agentes; la solo lectura impuesta ya llega así del main.
 */
export function identidadParaEditar(identidad: DbIdentidadFila | undefined, columnas: readonly DbColumnaResultado[]): DbIdentidadFila {
  if (!identidad) return { tipo: 'ninguna', motivo: '' }
  if (identidad.tipo === 'ninguna') return identidad
  const nombres = columnas.map((c) => c.nombre)
  if (identidad.tipo === 'rowid') {
    if (nombres.length === 0 || nombres[nombres.length - 1] !== identidad.columna) {
      return { tipo: 'ninguna', motivo: 'No llegó el ROWID con el que encontrar cada fila: vuelve a abrir la tabla.' }
    }
    return identidad
  }
  if (identidad.columnas.length === 0) return { tipo: 'ninguna', motivo: 'La tabla no tiene clave con la que encontrar la fila.' }
  for (const k of identidad.columnas) {
    if (nombres.indexOf(k) < 0) {
      return { tipo: 'ninguna', motivo: `Falta la columna ${k} de la clave en el resultado: vuelve a abrir la tabla.` }
    }
  }
  return identidad
}

/** ¿La última columna es la oculta del ROWID? (la rejilla pinta todas menos esa) */
export function hayColumnaOculta(columnas: readonly DbColumnaResultado[]): boolean {
  return columnas.length > 0 && columnas[columnas.length - 1].nombre === COLUMNA_ROWID
}
