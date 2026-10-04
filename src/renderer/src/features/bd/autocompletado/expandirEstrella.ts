// =============================================================================
// «Expandir columnas»: la lista explícita que sustituye al `*` de un SELECT, solo si
// todas sus columnas están en caché y al día, y el ítem de completado que la ofrece.
// Puro: depende de `candidatosSql`, `fuenteCatalogo`, `relacionesFk` y `estrellaSql`.
// Decisiones: docs/decisiones/bd/ui-autocompletado-fks-y-estrella.md
// =============================================================================

import { citarSiHaceFalta } from '../../../../../shared/sql/identificadoresSql.ts'
import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import type { OpcionesSugerencias, Sugerencia } from './candidatosSql.ts'
import type { EstrellaSelect } from './estrellaSql.ts'
import { ajenaAlCatalogo, esquemaDeRef, type FuenteCatalogo } from './fuenteCatalogo.ts'
import type { RefTabla } from './referenciasSql.ts'
import { expuestoDe } from './relacionesFk.ts'

function tablasCubiertas(e: EstrellaSelect, fuente: FuenteCatalogo, d: DialectoSql): RefTabla[] | null {
  if (!e.tablas || e.tablas.length === 0) return null
  if (e.calificador === null) return e.tablas
  const n = e.calificador.length
  const x = e.calificador[n - 1]
  if (n >= 2) {
    const esq = e.calificador[n - 2]
    const r = e.tablas.find((t) => t.nombre === x && t.alias === null && (t.esquema === esq || esquemaDeRef(t, fuente, d) === esq))
    return r ? [r] : null
  }
  const porAlias = e.tablas.find((t) => t.alias === x)
  if (porAlias) return [porAlias]
  const porNombre = e.tablas.find((t) => t.alias === null && t.nombre === x)
  return porNombre ? [porNombre] : null
}

/**
 * Las tablas que cubre el comodín: todas las del FROM, o la del calificador (`e.*`,
 * resuelto como un `e.` de miembro: alias, luego nombre). null si no se puede, también
 * si alguna es ajena al catálogo (sus columnas serían las de otra tabla).
 */
export function tablasDeEstrella(e: EstrellaSelect, fuente: FuenteCatalogo, d: DialectoSql): RefTabla[] | null {
  const cubiertas = tablasCubiertas(e, fuente, d)
  return cubiertas && cubiertas.some((t) => ajenaAlCatalogo(t)) ? null : cubiertas
}

/**
 * La lista de columnas que sustituye al `*`, o null si falta alguna en caché o el `*`
 * no es sustituible. Calificadas con el calificador escrito si lo había; si no, con el
 * alias (o el nombre) de cada tabla cuando hay más de una.
 */
export function listaDeEstrella(e: EstrellaSelect, fuente: FuenteCatalogo, d: DialectoSql): string | null {
  const tablas = tablasDeEstrella(e, fuente, d)
  if (!tablas) return null
  const partes: string[] = []
  for (const t of tablas) {
    const esq = esquemaDeRef(t, fuente, d)
    const cols = esq === null ? null : fuente.columnas(esq, t.nombre)
    // Obsoletas: un `ALTER TABLE … ADD` dejaría la lista con MENOS columnas que el `*`,
    // sin ningún error. Se espera a las nuevas (`pendientesDeEstrella` las pide).
    if (!cols || cols.length === 0 || (esq !== null && fuente.obsoleto?.('columnas', esq, t.nombre))) return null
    const q = e.calificadorEscrito !== null ? e.calificadorEscrito : tablas.length > 1 ? expuestoDe(t, d) : null
    for (const c of cols) partes.push((q !== null ? q + '.' : '') + citarSiHaceFalta(c, d))
  }
  return partes.join(', ')
}

/** Cuánto de la lista se enseña en el detalle del ítem. */
const VISTA_PREVIA_ESTRELLA = 48

/** El ítem «Expandir columnas» para un `*`, o null si aún no se puede (ver `listaDeEstrella`). */
export function sugerenciaEstrella(e: EstrellaSelect, texto: string, fuente: FuenteCatalogo, op: OpcionesSugerencias): Sugerencia | null {
  const lista = listaDeEstrella(e, fuente, op.dialecto)
  if (lista === null) return null
  const vista = lista.length > VISTA_PREVIA_ESTRELLA ? lista.slice(0, VISTA_PREVIA_ESTRELLA - 1) + '…' : lista
  return {
    etiqueta: 'Expandir columnas',
    detalle: ' (' + vista + ')',
    descripcion: '',
    tipo: 'expandir',
    insertar: lista,
    orden: '/0000000expandir',
    rango: { desde: e.desde, hasta: e.hasta },
    filtro: texto.slice(e.desde, e.hasta)
  }
}
