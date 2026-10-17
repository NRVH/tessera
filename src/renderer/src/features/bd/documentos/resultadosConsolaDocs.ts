// =============================================================================
// Los resultados de la consola de MongoDB, una pestaña por sentencia que devuelve algo que
// enseñar (documentos o un valor), con el modelo de pestañas de la consola SQL
// (`pestanasResultado.ts`): las no fijadas se sustituyen en la ejecución siguiente y sus
// lectores se cierran. Puro: lo prueba `test-resultados-consola-docs.mts`.
// Decisiones: docs/decisiones/bd/ui-documentos-consola.md
// =============================================================================

import type { DbDocDocumento, DbDocResultado } from '../../../../../shared/db-documentos-ipc.ts'
import type { DbPlan } from '../../../../../shared/db-explorador-ipc.ts'
import { resumenPlan, TITULO_PLAN } from '../resultados/planResultado.ts'
import { formatoDuracion } from '../consola/marcasConsola.ts'
import {
  ID_SALIDA,
  actualizarResultado,
  aplicarLote,
  type CambioResultados,
  type EstadoResultados
} from '../resultados/pestanasResultado.ts'
import { cantidad } from '../consola/salidaConsola.ts'
import { txConsolaDocs } from './textosConsolaDocs.ts'

/** Lo que enseña una pestaña de resultado de la consola de documentos. */
export type ResultadoDocs =
  | {
      tipo: 'documentos'
      columnas: string[]
      documentos: DbDocDocumento[]
      lector: string | null
      coleccion: string | null
      /** La base en la que corrió la sentencia, para volver a ejecutarla al exportar. */
      base: string | null
      ms: number
      /** El documento elegido en la tabla, el que enseña el panel JSON. */
      seleccionado: number | null
      /** La sentencia que lo devolvió, para el tooltip de la pestaña. */
      sentencia: string
    }
  | { tipo: 'valor'; texto: string; lector: null; sentencia: string }
  /** El `explain` de una consulta, en el visor de planes de la consola SQL. */
  | { tipo: 'plan'; plan: DbPlan; lector: null; sentencia: string }

export type EstadoResultadosDocs = EstadoResultados<ResultadoDocs>

/** El resultado que se enseña en una pestaña; null si la sentencia no devolvió nada que enseñar. */
export function resultadoDeRespuesta(r: DbDocResultado, sentencia: string): ResultadoDocs | null {
  if (r.tipo === 'documentos') {
    return {
      tipo: 'documentos',
      columnas: r.pagina.columnas,
      documentos: r.pagina.documentos,
      lector: r.pagina.lector,
      coleccion: r.coleccion,
      base: r.base,
      ms: r.pagina.ms,
      // El primero elegido: el panel JSON nunca empieza vacío si hay algo que enseñar.
      seleccionado: r.pagina.documentos.length > 0 ? 0 : null,
      sentencia
    }
  }
  if (r.tipo === 'valor') return { tipo: 'valor', texto: r.texto, lector: null, sentencia }
  if (r.tipo === 'plan') return { tipo: 'plan', plan: r.plan, lector: null, sentencia }
  return null
}

/** Título de la pestaña: la colección si la hay; el plan, «Plan»; si no, `Resultado k` (k-ésimo del lote). */
export function tituloResultadoDocs(r: ResultadoDocs, k: number): string {
  if (r.tipo === 'plan') return TITULO_PLAN
  return r.tipo === 'documentos' && r.coleccion ? r.coleccion : txConsolaDocs().resultadoK(k)
}

/**
 * Añade el resultado de una sentencia del lote `lote`: la primera del lote sustituye las no
 * fijadas de los anteriores, y las siguientes se suman. Activa la nueva salvo que el usuario
 * haya elegido otra mientras corría el lote.
 */
export function anadirResultadoDocs(e: EstadoResultadosDocs, r: ResultadoDocs, lote: number): CambioResultados<ResultadoDocs> {
  const k = e.lote === lote ? e.pestanas.filter((p) => p.lote === lote).length + 1 : 1
  return aplicarLote(e, [{ titulo: tituloResultadoDocs(r, k), resultado: r }], { lote })
}

/** Lleva a «Salida» (un fallo): no cuenta como elección del usuario. */
export function irASalidaDocs(e: EstadoResultadosDocs): EstadoResultadosDocs {
  return e.activa === ID_SALIDA ? e : { ...e, activa: ID_SALIDA }
}

/** Elige el documento `i` de la pestaña `id`. */
export function seleccionarDocumento(e: EstadoResultadosDocs, id: string, i: number): EstadoResultadosDocs {
  const r = e.resultados[id]
  if (!r || r.tipo !== 'documentos' || r.seleccionado === i) return e
  return actualizarResultado(e, id, { ...r, seleccionado: i })
}

/** «3 documentos (hay más) · pedidos», «4 pasos · 12 ms» (un plan) o «Valor». */
export function metaResultadoDocs(r: ResultadoDocs): string {
  const t = txConsolaDocs()
  if (r.tipo === 'plan') return `${cantidad(resumenPlan(r.plan).pasos, t.paso, t.pasos)} · ${formatoDuracion(r.plan.tiempos.totalMs)}`
  if (r.tipo !== 'documentos') return t.valor
  const n = cantidad(r.documentos.length, t.documento, t.documentos)
  return `${n}${r.lector ? t.haMas : ''}${r.coleccion ? ` · ${r.coleccion}` : ''}`
}
