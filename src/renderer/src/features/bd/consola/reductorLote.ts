// =============================================================================
// Sub-reductor de las acciones del LOTE de una consola SQL: crear, prevuelo, iniciar,
// terminar, plan, local y detener. Cada respuesta se ata a su lote por id: una de un lote
// viejo no pinta en el nuevo. Puro; lo llama `reducirConsola` de `estadoConsola.ts`.
// Decisiones: docs/decisiones/bd/ui-consola-estado.md
// =============================================================================

import type { DbPlan } from '../../../../../shared/db-explorador-ipc.ts'
import type { Sentencia } from '../../../../../shared/sql/divisorSql.ts'
import { TITULO_PLAN } from '../resultados/planResultado.ts'
import { aplicarLote, empezarLote } from '../resultados/pestanasResultado.ts'
import { detener, iniciar, marcarLocal, registrarPlan, type Lote } from './lote.ts'
import {
  activarSalida,
  conLectores,
  conSalida,
  errorComoResultado,
  type AccionDe,
  type EstadoConsola,
  type ResultadoConsola
} from './modeloConsola.ts'
import {
  TEXTO_CLIENTE,
  detallePlan,
  etiquetaSentencia,
  textoEco,
  textoEcoPlan,
  textoNadaEjecutado,
  textoPlan,
  type NuevaEntrada
} from './salidaConsola.ts'
import { cierreDeLote, terminada } from './terminadaConsola.ts'

/** Las acciones que atiende este sub-reductor. */
export type AccionLote = AccionDe<
  | 'loteCreado'
  | 'prevueloRechazado'
  | 'sentenciaIniciada'
  | 'sentenciaTerminada'
  | 'planTerminado'
  | 'sentenciaLocal'
  | 'detener'
>

/** El esquema del eco: el que manda el hook o, si no lo sabe, el de la sesión. */
function esquemaDeEco(e: EstadoConsola, esquema: string | null | undefined): string | null {
  if (esquema !== undefined) return esquema
  return e.sesion ? e.sesion.esquema : null
}

function resultadoDePlan(a: AccionDe<'planTerminado'>, plan: DbPlan, lote: Lote, s: Sentencia): ResultadoConsola {
  const base: ResultadoConsola = {
    lector: null,
    loteId: lote.id,
    sentencia: a.indice,
    sql: s.texto,
    clase: s.clase,
    columnas: [],
    datos: null,
    errorDatos: null,
    filasPrimeraPagina: 0,
    tiempos: plan.tiempos,
    afectadas: null,
    noReleible: true,
    reejecutada: false,
    sinLector: null,
    tabla: null,
    esquemaSesion: a.esquema,
    plan
  }
  return a.binds ? { ...base, binds: a.binds } : base
}

/**
 * El plan de un lote de plan. Si falló, es el ✗ de una sentencia. Si llegó, la sentencia
 * termina `ok` con su marca de plan y se abre «Plan», que SOLO sustituye a otro plan sin
 * fijar: los resultados que se estaban mirando se quedan para compararlos.
 */
function planTerminado(e: EstadoConsola, a: AccionDe<'planTerminado'>): EstadoConsola {
  const previo = e.lote
  if (!previo || previo.id !== a.loteId) return e
  if (!a.respuesta.ok) {
    return terminada(e, {
      tipo: 'sentenciaTerminada',
      loteId: a.loteId,
      indice: a.indice,
      resultado: errorComoResultado(a.respuesta.error),
      esquema: a.esquema,
      ahora: a.ahora,
      posicionModelo: a.posicionModelo
    })
  }
  const plan = a.respuesta.valor
  const lote = registrarPlan(previo, a.indice, plan.tiempos.totalMs, detallePlan(plan.nodos.length))
  if (lote === previo) return e
  const resultado = resultadoDePlan(a, plan, lote, previo.sentencias[a.indice].s)
  const anteriores = e.resultados.resultados
  const cambio = aplicarLote(e.resultados, [{ titulo: TITULO_PLAN, resultado }], {
    lote: lote.id,
    sustituir: (p) => !p.fijada && anteriores[p.id]?.plan !== undefined
  })
  const nuevas: NuevaEntrada[] = [{ tipo: 'completado', texto: textoPlan(plan.nodos.length, plan.tiempos.totalMs) }]
  for (const t of plan.avisos ?? []) if (t && t.trim() !== '') nuevas.push({ tipo: 'aviso', texto: t.trim() })
  nuevas.push(...cierreDeLote(previo, lote))
  return {
    ...e,
    lote,
    resultados: cambio.estado,
    lectoresPorCerrar: conLectores(e.lectoresPorCerrar, cambio.lectoresPorCerrar),
    salida: conSalida(e, nuevas, a.ahora)
  }
}

function prevueloRechazado(e: EstadoConsola, a: AccionDe<'prevueloRechazado'>): EstadoConsola {
  if (!e.lote || e.lote.id !== a.loteId || a.bloqueadas.length === 0) return e
  let lote = e.lote
  for (const b of a.bloqueadas) lote = marcarLocal(lote, b.indice, 'bloqueada', b.motivo)
  const nuevas: NuevaEntrada[] = [
    {
      tipo: 'error',
      texto: textoNadaEjecutado(
        a.bloqueadas.map((b) => b.indice + 1),
        lote.sentencias.length
      )
    }
  ]
  for (const b of a.bloqueadas) {
    nuevas.push({
      tipo: 'error',
      texto: b.motivo,
      ir: { loteId: lote.id, sentencia: b.indice, desplazamiento: 0, etiqueta: etiquetaSentencia(b.indice + 1) }
    })
  }
  return { ...e, lote, resultados: activarSalida(e.resultados), salida: conSalida(e, nuevas, a.ahora) }
}

function sentenciaIniciada(e: EstadoConsola, a: AccionDe<'sentenciaIniciada'>): EstadoConsola {
  if (!e.lote || e.lote.id !== a.loteId) return e
  const lote = iniciar(e.lote, a.indice, a.ahora)
  if (lote === e.lote) return e
  const s = lote.sentencias[a.indice].s
  const esquema = esquemaDeEco(e, a.esquema)
  const eco = lote.plan === true ? textoEcoPlan(esquema, s.texto, e.dialecto) : textoEco(esquema, s.texto)
  return {
    ...e,
    lote,
    pista: null,
    salida: conSalida(e, [{ tipo: 'eco', texto: eco }], a.ahora)
  }
}

function sentenciaLocal(e: EstadoConsola, a: AccionDe<'sentenciaLocal'>): EstadoConsola {
  const previo = e.lote
  if (!previo || previo.id !== a.loteId) return e
  const lote = marcarLocal(previo, a.indice, a.estado, a.motivo)
  if (lote === previo) return e
  const s = lote.sentencias[a.indice].s
  const nuevas: NuevaEntrada[] = []
  let resultados = e.resultados
  if (a.estado === 'cliente') {
    nuevas.push({ tipo: 'eco', texto: textoEco(esquemaDeEco(e, a.esquema), s.texto) })
    nuevas.push({ tipo: 'info', texto: a.motivo || TEXTO_CLIENTE })
  } else {
    nuevas.push({
      tipo: 'error',
      texto: a.motivo,
      ir: { loteId: lote.id, sentencia: a.indice, desplazamiento: 0, etiqueta: etiquetaSentencia(a.indice + 1) }
    })
    resultados = activarSalida(resultados)
  }
  nuevas.push(...cierreDeLote(previo, lote))
  return { ...e, lote, resultados, salida: conSalida(e, nuevas, a.ahora) }
}

function detenerLote(e: EstadoConsola, a: AccionDe<'detener'>): EstadoConsola {
  const previo = e.lote
  if (!previo || previo.id !== a.loteId) return e
  const lote = detener(previo)
  if (lote === previo) return e
  return { ...e, lote, salida: conSalida(e, cierreDeLote(previo, lote), a.ahora) }
}

/** Aplica una acción del lote; devuelve el MISMO estado si no cambia nada. */
export function reducirLote(e: EstadoConsola, a: AccionLote): EstadoConsola {
  switch (a.tipo) {
    case 'loteCreado':
      return { ...e, lote: a.lote, pista: null, resultados: empezarLote(e.resultados, a.lote.id) }
    case 'prevueloRechazado':
      return prevueloRechazado(e, a)
    case 'sentenciaIniciada':
      return sentenciaIniciada(e, a)
    case 'sentenciaTerminada':
      return terminada(e, a)
    case 'planTerminado':
      return planTerminado(e, a)
    case 'sentenciaLocal':
      return sentenciaLocal(e, a)
    case 'detener':
      return detenerLote(e, a)
  }
}
