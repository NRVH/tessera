// =============================================================================
// Lote de la consola SQL: las sentencias de un «Ejecutar» o «Ejecutar todo» y el estado
// de cada una. Puro e inmutable: cada operación devuelve un lote nuevo, o el MISMO si no
// cambia nada. El renderer manda UNA sentencia por invoke y este módulo es su libro de
// cuentas (`siguiente`, `iniciar`, `registrar`, `marcarLocal`, `detener`). `i` es la
// posición DENTRO del lote, no `Sentencia.indice`.
// Decisiones: docs/decisiones/bd/ui-consola-estado.md
// =============================================================================

import type { DbResultadoSentencia } from '../../../../../shared/db-explorador-ipc.ts'
import type { Sentencia } from '../../../../../shared/sql/divisorSql.ts'
import { descriptorMarca, type DescriptorMarca, type EstadoMarca } from './marcasConsola.ts'
import {
  cantidad,
  contarCompilacion,
  textoError,
  textoErrorResultado,
  type ObjetoCompilado
} from './salidaConsola.ts'

export type EstadoLote = 'corriendo' | 'terminado' | 'detenido' | 'cancelado'

export interface SentenciaLote {
  readonly s: Sentencia
  readonly estado: EstadoMarca
  /** Duración final (la del servidor), o null si no terminó. */
  readonly ms: number | null
  /** Instante en que se envió (reloj del llamador), o null. */
  readonly inicio: number | null
  /** Resumen para el tooltip: «40 filas», «[ORA-00942] …», el motivo de un bloqueo. */
  readonly detalle: string | null
  /** Código del error del servidor (`ORA-00942`, un SQLSTATE), si lo hubo. */
  readonly codigo: string | null
  /** Posición del error (UTF-16, relativa al inicio de la sentencia), si la hubo. */
  readonly posicion: number | null
  /** Avisos de compilación de una ✓ (la vuelven ámbar: `descriptorMarca`). */
  readonly avisos: number
}

/** Un lote de la consola: sus sentencias, el estado de cada una y el del conjunto. */
export interface Lote {
  readonly id: number
  readonly sentencias: readonly SentenciaLote[]
  readonly estado: EstadoLote
  /**
   * Es un «Explicar plan»: UNA sentencia que se manda a `explicar` y NO se
   * ejecuta. Va por el lote para heredar lo que ya hace una ejecución —■ y «Forzar»,
   * el cronómetro, «¿Detener y cerrar?», el ✗ del servidor en su posición—, pero su
   * marca no es la ✓ de «esto corrió» (ver `descriptorMarca`).
   */
  readonly plan?: boolean
}

export interface ResumenLote {
  total: number
  ok: number
  error: number
  cancelada: number
  omitida: number
  cliente: number
  pendiente: number
  corriendo: number
}

/** Motivo local de una sentencia que no va al servidor. */
export type TipoLocal = 'cliente' | 'bloqueada'

function item(s: Sentencia): SentenciaLote {
  return { s, estado: 'pendiente', ms: null, inicio: null, detalle: null, codigo: null, posicion: null, avisos: 0 }
}

/** Lote nuevo con todo `pendiente`. Uno vacío nace `terminado`. `plan`: un «Explicar plan». */
export function crearLote(id: number, sentencias: readonly Sentencia[], opciones: { plan?: boolean } = {}): Lote {
  const l: Lote = {
    id,
    sentencias: sentencias.map(item),
    estado: sentencias.length === 0 ? 'terminado' : 'corriendo'
  }
  return opciones.plan === true ? { ...l, plan: true } : l
}

/** ¿Ya no queda nada en cola ni corriendo? */
export function finalizado(l: Lote): boolean {
  return l.sentencias.every((x) => x.estado !== 'pendiente' && x.estado !== 'corriendo')
}

/** ¿Hay algo en marcha o en cola? (■ habilitado, «¿Detener y cerrar?»). */
export function enCurso(l: Lote | null): boolean {
  return l !== null && !finalizado(l)
}

/**
 * La próxima sentencia que hay que mandar, o null: el lote ya no corre, hay una
 * sentencia en vuelo (una ejecución por consola) o no queda ninguna en cola.
 */
export function siguiente(l: Lote): number | null {
  if (l.estado !== 'corriendo') return null
  let primera = -1
  for (let i = 0; i < l.sentencias.length; i++) {
    const e = l.sentencias[i].estado
    if (e === 'corriendo') return null
    if (e === 'pendiente' && primera < 0) primera = i
  }
  return primera >= 0 ? primera : null
}

function conItem(l: Lote, i: number, cambio: Partial<SentenciaLote>): SentenciaLote[] {
  return l.sentencias.map((x, k) => (k === i ? { ...x, ...cambio } : x))
}

/** Lo que queda en cola pasa a `omitida`. */
function omitirPendientes(ss: readonly SentenciaLote[]): SentenciaLote[] {
  return ss.map((x) => (x.estado === 'pendiente' ? { ...x, estado: 'omitida' as const } : x))
}

/** Estado del lote tras un cambio que NO para el lote. */
function estadoTrasAvance(previo: EstadoLote, ss: readonly SentenciaLote[]): EstadoLote {
  if (previo !== 'corriendo') return previo
  return ss.every((x) => x.estado !== 'pendiente' && x.estado !== 'corriendo') ? 'terminado' : 'corriendo'
}

function valido(l: Lote, i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < l.sentencias.length
}

/** La sentencia `i` se envió en `ahora`. Solo desde `pendiente` y con el lote corriendo. */
export function iniciar(l: Lote, i: number, ahora: number): Lote {
  if (!valido(l, i) || l.estado !== 'corriendo' || l.sentencias[i].estado !== 'pendiente') return l
  return { ...l, sentencias: conItem(l, i, { estado: 'corriendo', inicio: ahora }) }
}

/** Resumen del resultado para el tooltip del glifo. */
export function detalleResultado(r: DbResultadoSentencia): string {
  switch (r.tipo) {
    case 'filas': {
      const n = filasDePagina(r.pagina.filasJson)
      return cantidad(n, 'fila', 'filas') + (r.pagina.hayMas ? ' (hay más)' : '')
    }
    case 'afectadas':
      return cantidad(r.filas, 'fila afectada', 'filas afectadas')
    case 'hecho':
      return r.comando ? r.comando : 'Completado'
    case 'error':
      return textoError(r.error)
  }
}

/**
 * Filas que trae una página SIN parsearla: se cuentan los `[` de nivel 2 fuera de
 * cadenas. El parseo de verdad (y su validación) lo hace la rejilla una sola vez;
 * para el tooltip basta con contar. Son las filas de ESTA página.
 */
export function filasDePagina(filasJson: string): number {
  let nivel = 0
  let n = 0
  let enCadena = false
  for (let i = 0; i < filasJson.length; i++) {
    const c = filasJson.charCodeAt(i)
    if (enCadena) {
      if (c === 92) i++ // barra invertida: salta el carácter escapado
      else if (c === 34) enCadena = false
      continue
    }
    if (c === 34) enCadena = true
    else if (c === 91) {
      nivel++
      if (nivel === 2) n++
    } else if (c === 93) nivel--
  }
  return n
}

/**
 * Registra el resultado de la sentencia `i`. Un error (incluida la sesión perdida)
 * PARA el lote (`detenido`) y una cancelación lo CANCELA; en los dos casos lo que
 * quedaba en cola pasa a `omitida`. Solo se registra una sentencia que no tenga ya
 * resultado.
 */
export function registrar(l: Lote, i: number, r: DbResultadoSentencia): Lote {
  if (!valido(l, i)) return l
  const actual = l.sentencias[i].estado
  if (actual !== 'corriendo' && actual !== 'pendiente') return l
  const ms = r.tiempos ? r.tiempos.totalMs : null
  if (r.tipo === 'error') {
    const cancelada = r.error.motivo === 'cancelada'
    const ss = omitirPendientes(
      conItem(l, i, {
        estado: cancelada ? 'cancelada' : 'error',
        ms,
        // Un CREATE que dejó la unidad inválida dice QUÉ se creó y cuántos errores
        // tiene (`textoErrorResultado`), también en el tooltip del glifo.
        detalle: cancelada ? null : textoErrorResultado(r, objetoDe(l.sentencias[i].s)),
        codigo: cancelada ? null : r.error.codigo || null,
        posicion: typeof r.error.posicion === 'number' ? r.error.posicion : null,
        avisos: 0
      })
    )
    // Si ya se había pedido Stop (`cancelado`), una respuesta de error no lo
    // convierte en «detenido»: lo que manda es que el usuario lo paró.
    const estado: EstadoLote = cancelada || l.estado === 'cancelado' ? 'cancelado' : 'detenido'
    return { ...l, sentencias: ss, estado }
  }
  // Solo un «hecho» trae compilación con la unidad válida (avisos): ✓ ámbar.
  const avisos = r.tipo === 'hecho' ? contarCompilacion(r.compilacion).avisos : 0
  const detalle = avisos > 0 ? `Compilado con ${cantidad(avisos, 'aviso', 'avisos')}` : detalleResultado(r)
  const ss = conItem(l, i, { estado: 'ok', ms, detalle, codigo: null, posicion: null, avisos })
  return { ...l, sentencias: ss, estado: estadoTrasAvance(l.estado, ss) }
}

/**
 * El PLAN de la sentencia `i` llegó bien. Termina como `ok` —el lote acaba
 * como cualquier otro—, con `detalle` para el tooltip; que no se EJECUTÓ lo dice la
 * marca del lote de plan, no el estado. Un error o una cancelación del plan van por
 * `registrar`, igual que los de una sentencia.
 */
export function registrarPlan(l: Lote, i: number, ms: number, detalle: string): Lote {
  if (!valido(l, i)) return l
  const actual = l.sentencias[i].estado
  if (actual !== 'corriendo' && actual !== 'pendiente') return l
  const ss = conItem(l, i, { estado: 'ok', ms, detalle, codigo: null, posicion: null, avisos: 0 })
  return { ...l, sentencias: ss, estado: estadoTrasAvance(l.estado, ss) }
}

/** El objeto que crea una sentencia, para los textos de compilación (o null). */
export function objetoDe(s: Sentencia): ObjetoCompilado | null {
  const o = s.objetoCreado
  return o ? { tipo: o.tipo, esquema: o.esquema, nombre: o.nombre } : null
}

/**
 * Marca una sentencia decidida en local, sin ir al servidor:
 * - `cliente`: ⊘, no se envía, el lote SIGUE.
 * - `bloqueada`: ✗ por solo lectura; PARA el lote (resto `omitida`). Se puede
 *   llamar varias veces (el prevuelo marca todas las que bloquea): una ya omitida
 *   también pasa a ✗.
 */
export function marcarLocal(l: Lote, i: number, tipo: TipoLocal, motivo: string): Lote {
  if (!valido(l, i)) return l
  const actual = l.sentencias[i].estado
  if (tipo === 'cliente') {
    if (actual !== 'pendiente') return l
    const ss = conItem(l, i, { estado: 'cliente', ms: null, detalle: motivo || null })
    return { ...l, sentencias: ss, estado: estadoTrasAvance(l.estado, ss) }
  }
  if (actual !== 'pendiente' && actual !== 'omitida') return l
  const ss = omitirPendientes(conItem(l, i, { estado: 'error', ms: null, detalle: motivo || null }))
  return { ...l, sentencias: ss, estado: l.estado === 'cancelado' ? 'cancelado' : 'detenido' }
}

/**
 * Stop: lo que queda en cola pasa a `omitida` y el lote queda `cancelado`. La que
 * esté corriendo se deja: su respuesta llegará por `registrar`.
 */
export function detener(l: Lote): Lote {
  if (l.estado !== 'corriendo') return l
  return { ...l, sentencias: omitirPendientes(l.sentencias), estado: 'cancelado' }
}

export function resumenLote(l: Lote): ResumenLote {
  const r: ResumenLote = {
    total: l.sentencias.length,
    ok: 0,
    error: 0,
    cancelada: 0,
    omitida: 0,
    cliente: 0,
    pendiente: 0,
    corriendo: 0
  }
  for (const x of l.sentencias) r[x.estado]++
  return r
}

/** Posiciones de las omitidas, en orden (lo que ofrece «Ejecutar las N restantes»). */
export function restantes(l: Lote): number[] {
  const out: number[] = []
  l.sentencias.forEach((x, i) => {
    if (x.estado === 'omitida') out.push(i)
  })
  return out
}

/** Tiempo que mostrar: el final, o el transcurrido si está corriendo. */
export function msDe(x: SentenciaLote, ahora: number): number | null {
  if (x.estado === 'corriendo') return x.inicio !== null ? Math.max(0, ahora - x.inicio) : null
  return x.ms
}

/**
 * Descriptor de la marca de una sentencia del lote (glifo, barra, tooltip, tiempo).
 * `plan`: la sentencia es la de un «Explicar plan» (`Lote.plan`).
 */
export function marcaDe(x: SentenciaLote, ahora: number, plan: boolean = false): DescriptorMarca {
  return descriptorMarca(x.estado, msDe(x, ahora), x.detalle ?? '', x.codigo, x.avisos, plan)
}
