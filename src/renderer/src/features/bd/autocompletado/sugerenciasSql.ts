// =============================================================================
// Sugerencias del autocompletado SQL: del `Contexto` a la lista ya FILTRADA y
// ORDENADA que pinta Monaco, y lo que falta cargar antes de construirla.
// Puro: lee el catálogo por una `FuenteCatalogo` síncrona. Las piezas viven en
// `fuenteCatalogo`, `candidatosSql`, `relacionesFk` y `expandirEstrella`; aquí se
// reexporta lo que usan los demás módulos.
// Decisiones: docs/decisiones/bd/ui-autocompletado-filtro-y-orden.md
// =============================================================================

import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import { descriptorSql } from '../../../../../shared/motores/index.ts'
import {
  anadirAlias,
  anadirClaves,
  anadirColumnas,
  anadirObjetos,
  comparar,
  LIMITE_SUGERENCIAS,
  mejores,
  sugerencia,
  type Candidato,
  type OpcionesSugerencias,
  type Sugerencia
} from './candidatosSql.ts'
import type { Contexto } from './contextoSql.ts'
import type { EstrellaSelect } from './estrellaSql.ts'
import { tablasDeEstrella } from './expandirEstrella.ts'
import { ajenaAlCatalogo, esquemaDeRef, resolverMiembro, type FuenteCatalogo } from './fuenteCatalogo.ts'
import type { RefTabla } from './referenciasSql.ts'
import { anadirCondiciones, anadirJoins } from './relacionesFk.ts'

export { LIMITE_SUGERENCIAS, type Sugerencia, type TipoSugerencia } from './candidatosSql.ts'
export { listaDeEstrella, sugerenciaEstrella } from './expandirEstrella.ts'
export {
  esquemaDeRef,
  esquemasLocales,
  resolverMiembro,
  type DbObjetoNombre,
  type FuenteCatalogo
} from './fuenteCatalogo.ts'
export { aliasLibre } from './relacionesFk.ts'

export interface PendientesCarga {
  /** Tablas cuyas columnas hacen falta y no están en caché (`base`: de otra base). */
  columnas: Array<{ esquema: string; tabla: string; base?: string }>
  /** Esquemas nombrados con `ESQ.` cuyos objetos no están cargados. */
  esquemas: string[]
  /** Tablas cuyas claves ajenas hacen falta (tras JOIN u ON) y no están en caché. */
  fks: Array<{ esquema: string; tabla: string }>
  /**
   * Esquemas de OTRA base nombrados con `BASE.ESQ.` cuyos objetos no están cargados.
   * Solo aparece si hay alguno: con Oracle, PG y SQLite no aparece nunca.
   */
  deBase?: Array<{ base: string; esquema: string }>
}

interface AcumuladorPendientes {
  r: PendientesCarga
  /** `alDia`: también si las que hay están obsoletas (las de «Expandir columnas»). */
  columnasDe(esquema: string, tabla: string, alDia?: boolean, base?: string): void
  objetosDe(esquema: string, base?: string): void
  fksDe(ref: RefTabla): void
}

/** Acumulador de pendientes sin repetidos. */
function acumuladorPendientes(fuente: FuenteCatalogo, d: DialectoSql): AcumuladorPendientes {
  const r: PendientesCarga = { columnas: [], esquemas: [], fks: [] }
  const pseudo = descriptorSql(d).catalogo.pseudoEsquemaPublico
  return {
    r,
    columnasDe(esquema: string, tabla: string, alDia = false, base?: string): void {
      if (base !== undefined) {
        // De otra base: sin sinónimos ni obsolescencia (no hay fila que lo marque).
        if (fuente.columnas(esquema, tabla, base) !== null) return
        if (r.columnas.some((c) => c.esquema === esquema && c.tabla === tabla && c.base === base)) return
        r.columnas.push({ esquema, tabla, base })
        return
      }
      if (fuente.columnas(esquema, tabla) !== null && !(alDia && fuente.obsoleto?.('columnas', esquema, tabla))) return
      if (r.columnas.some((c) => c.esquema === esquema && c.tabla === tabla && c.base === undefined)) return
      r.columnas.push({ esquema, tabla })
    },
    objetosDe(esquema: string, base?: string): void {
      if (base !== undefined) {
        if (fuente.objetos(esquema, base).length > 0) return
        const lista = r.deBase ?? (r.deBase = [])
        if (!lista.some((x) => x.base === base && x.esquema === esquema)) lista.push({ base, esquema })
        return
      }
      // El pseudo-esquema no es un esquema: sus objetos son los públicos, que se cargan aparte.
      if (pseudo !== null && esquema === pseudo) return
      if (fuente.objetos(esquema).length === 0 && r.esquemas.indexOf(esquema) < 0) r.esquemas.push(esquema)
    },
    fksDe(ref: RefTabla): void {
      // Una tabla ajena al catálogo: sus FKs serían las de otra tabla.
      if (!fuente.fks || ajenaAlCatalogo(ref)) return
      const e = esquemaDeRef(ref, fuente, d)
      // Las obsoletas también: nadie más las recarga (se siguen leyendo si no llegan a tiempo).
      if (e === null || (fuente.fks(e, ref.nombre) !== null && !fuente.obsoleto?.('fks', e, ref.nombre))) return
      if (r.fks.some((c) => c.esquema === e && c.tabla === ref.nombre)) return
      r.fks.push({ esquema: e, tabla: ref.nombre })
    }
  }
}

/**
 * Lo que el proveedor tiene que cargar (con su tope de espera) antes de volver a
 * llamar a `construirSugerencias`. Vacío si ya está todo.
 */
export function pendientesDeCarga(ctx: Contexto, fuente: FuenteCatalogo, d: DialectoSql): PendientesCarga {
  const a = acumuladorPendientes(fuente, d)
  switch (ctx.tipo) {
    case 'columnas':
      for (const ref of ctx.tablas) {
        const e = esquemaDeRef(ref, fuente, d)
        if (e !== null) a.columnasDe(e, ref.nombre, false, ref.base)
      }
      // Las FKs de la tabla del JOIN traen las dos direcciones con cada una de la izquierda.
      if (ctx.condicion) a.fksDe(ctx.condicion.nueva)
      break
    case 'miembro': {
      const dm = resolverMiembro(ctx.calificador, ctx.tablas, fuente, d)
      if (dm.tipo === 'columnas') a.columnasDe(dm.esquema, dm.tabla, false, dm.base)
      else if (dm.tipo === 'objetos') a.objetosDe(dm.esquema)
      break
    }
    case 'objetos':
      if (ctx.esquema !== null) a.objetosDe(ctx.esquema, ctx.base)
      if (ctx.join) for (const ref of ctx.join.previas) a.fksDe(ref)
      break
  }
  return a.r
}

/** Lo que hace falta para «Expandir columnas»: las columnas de cada tabla del FROM. */
export function pendientesDeEstrella(e: EstrellaSelect, fuente: FuenteCatalogo, d: DialectoSql): PendientesCarga {
  const a = acumuladorPendientes(fuente, d)
  for (const ref of tablasDeEstrella(e, fuente, d) ?? []) {
    const esq = esquemaDeRef(ref, fuente, d)
    if (esq !== null) a.columnasDe(esq, ref.nombre, true)
  }
  return a.r
}

// --- Construcción -----------------------------------------------------------------

type ContextoDe<T extends Contexto['tipo']> = Extract<Contexto, { tipo: T }>

function candidatosDeObjetos(acc: Candidato[], ctx: ContextoDe<'objetos'>, fuente: FuenteCatalogo, d: DialectoSql): void {
  if (ctx.join) anadirJoins(acc, ctx.prefijo.toLowerCase(), ctx.join, ctx.esquema, fuente, d)
  anadirObjetos(acc, ctx.prefijo.toLowerCase(), fuente, d, {
    esquema: ctx.esquema,
    tipos: ctx.tipos,
    conEsquemas: ctx.esquema === null,
    ...(ctx.base !== undefined ? { base: ctx.base } : {})
  })
}

function candidatosDeColumnas(
  acc: Candidato[],
  ctx: ContextoDe<'columnas'>,
  fuente: FuenteCatalogo,
  d: DialectoSql,
  porDefecto: 'mayus' | 'minus'
): void {
  const p = ctx.prefijo.toLowerCase()
  if (ctx.condicion) anadirCondiciones(acc, p, ctx.condicion, fuente, d)
  const hechas = new Set<string>()
  for (const ref of ctx.tablas) {
    const e = esquemaDeRef(ref, fuente, d)
    if (e === null) continue
    const clave = JSON.stringify(ref.base !== undefined ? [e, ref.nombre, ref.base] : [e, ref.nombre])
    if (hechas.has(clave)) continue
    hechas.add(clave)
    const cols = ref.base !== undefined ? fuente.columnas(e, ref.nombre, ref.base) : fuente.columnas(e, ref.nombre)
    if (cols) anadirColumnas(acc, p, ref.nombre, cols)
  }
  anadirAlias(acc, p, ctx.tablas)
  if (ctx.conObjetos) anadirObjetos(acc, p, fuente, d, { esquema: null, conEsquemas: false })
  if (ctx.conClaves) anadirClaves(acc, ctx.prefijo, d, porDefecto)
}

function candidatosDeMiembro(acc: Candidato[], ctx: ContextoDe<'miembro'>, fuente: FuenteCatalogo, d: DialectoSql): void {
  const p = ctx.prefijo.toLowerCase()
  const dm = resolverMiembro(ctx.calificador, ctx.tablas, fuente, d)
  if (dm.tipo === 'columnas') {
    const cols = dm.base !== undefined ? fuente.columnas(dm.esquema, dm.tabla, dm.base) : fuente.columnas(dm.esquema, dm.tabla)
    if (cols) anadirColumnas(acc, p, dm.tabla, cols)
  } else if (dm.tipo === 'objetos') {
    anadirObjetos(acc, p, fuente, d, { esquema: dm.esquema, conEsquemas: false })
  }
}

/**
 * Las sugerencias para `ctx`, filtradas por subcadena sin distinguir
 * mayúsculas y ordenadas por `orden` (como mucho `limite`).
 */
export function construirSugerencias(ctx: Contexto, fuente: FuenteCatalogo, op: OpcionesSugerencias): Sugerencia[] {
  const d = op.dialecto
  const porDefecto = op.cajaClaves ?? 'mayus'
  const acc: Candidato[] = []
  switch (ctx.tipo) {
    case 'ninguno':
      return []
    case 'palabrasClave':
      anadirClaves(acc, ctx.prefijo, d, porDefecto)
      break
    case 'objetos':
      candidatosDeObjetos(acc, ctx, fuente, d)
      break
    case 'columnas':
      candidatosDeColumnas(acc, ctx, fuente, d, porDefecto)
      break
    case 'miembro':
      candidatosDeMiembro(acc, ctx, fuente, d)
      break
  }
  const limite = op.limite ?? LIMITE_SUGERENCIAS
  return mejores(acc, limite, comparar).map((c) => sugerencia(c, op))
}
