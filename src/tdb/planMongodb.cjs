// =============================================================================
// El resultado de `explain` de MongoDB como PLAN para el visor del explorador: el árbol de etapas
// (`COLLSCAN`, `IXSCAN`, `FETCH`, `SORT`…) con lo que mide `executionStats` (documentos devueltos, claves
// y documentos examinados, tiempo) y los avisos que importan (recorrer la colección entera, examinar
// mucho más de lo que se devuelve). Puro y tolerante: una forma que no reconoce acaba en un solo paso
// con el texto del servidor, nunca en un error. Depende de `textoMongodb.cjs`; lo usa `sesionMongodb.cjs`.
// Decisiones: docs/decisiones/bd/mongodb-explain-y-exportar.md
// =============================================================================
'use strict'

const { texto } = require('./textoMongodb.cjs')

/** Examinar al menos tantos documentos, y diez veces más de los que se devuelven, merece un aviso. */
const MIN_EXAMINADOS_AVISO = 1000
const FACTOR_EXAMINADOS_AVISO = 10
const TOPE_PROFUNDIDAD_PLAN = 64

function esObjeto(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** Un número del explain, que con `promoteValues: false` llega envuelto (`Int32`, `Double`, `Long`); undefined si no lo es. */
function numero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (v === null || typeof v !== 'object') return undefined
  if (v._bsontype === 'Int32' || v._bsontype === 'Double') return numero(v.value)
  if (v._bsontype === 'Long') return v.toNumber()
  return undefined
}

function vacio(v) {
  return !esObjeto(v) || Object.keys(v).length === 0
}

/** Las líneas de detalle de una etapa: filtro, límites del índice, y lo que midió la ejecución. */
function detalleDe(st) {
  const d = []
  if (!vacio(st.filter)) d.push(`filtro: ${texto(st.filter, true)}`)
  if (!vacio(st.keyPattern)) d.push(`clave: ${texto(st.keyPattern, true)}`)
  if (!vacio(st.indexBounds)) d.push(`límites: ${texto(st.indexBounds, true)}`)
  if (!vacio(st.sortPattern)) d.push(`orden: ${texto(st.sortPattern, true)}`)
  if (!vacio(st.transformBy)) d.push(`proyección: ${texto(st.transformBy, true)}`)
  const cifras = [
    ['límite', st.limitAmount, ''],
    ['salto', st.skipAmount, ''],
    ['claves examinadas', st.keysExamined, ''],
    ['documentos examinados', st.docsExamined, ''],
    ['tiempo estimado', st.executionTimeMillisEstimate, ' ms']
  ]
  for (const [nombre, v, unidad] of cifras) {
    const n = numero(v)
    if (n !== undefined) d.push(`${nombre}: ${n}${unidad}`)
  }
  if (st.isMultiKey === true) d.push('índice multiclave')
  if (st.usedDisk === true) d.push('ordena usando el disco')
  return d
}

/** Los hijos de una etapa: cualquier propiedad que sea otra etapa, o una lista de ellas. */
function hijosDe(st) {
  const hijos = []
  for (const k of Object.keys(st)) {
    const v = st[k]
    if (k === 'shards') continue
    if (esObjeto(v) && typeof v.stage === 'string') hijos.push(v)
    else if (Array.isArray(v)) for (const x of v) if (esObjeto(x) && typeof x.stage === 'string') hijos.push(x)
  }
  return hijos
}

/** Añade al plan `st` y su subárbol; devuelve el id del nodo. */
function anadirEtapa(plan, st, padre, profundidad) {
  const nodo = { id: plan.nodos.length, padre, operacion: typeof st.stage === 'string' ? st.stage : 'ETAPA' }
  if (typeof st.direction === 'string') nodo.opciones = st.direction
  const objeto = typeof st.indexName === 'string' ? st.indexName : undefined
  if (objeto) nodo.objeto = objeto
  const filas = numero(st.nReturned)
  if (filas !== undefined) nodo.filas = filas
  const detalle = detalleDe(st)
  if (detalle.length > 0) nodo.detalle = detalle
  plan.nodos.push(nodo)
  if (profundidad >= TOPE_PROFUNDIDAD_PLAN) return nodo.id
  for (const h of hijosDe(st)) anadirEtapa(plan, h, nodo.id, profundidad + 1)
  if (Array.isArray(st.shards)) anadirShards(plan, st.shards, nodo.id, profundidad + 1)
  return nodo.id
}

/** Un paso `SHARD` por servidor de un cluster, con el plan que eligió debajo. */
function anadirShards(plan, shards, padre, profundidad) {
  for (const sh of shards) {
    if (!esObjeto(sh)) continue
    const raiz = sh.executionStages || sh.winningPlan || (esObjeto(sh.queryPlanner) ? sh.queryPlanner.winningPlan : null)
    const id = plan.nodos.length
    plan.nodos.push({ id, padre, operacion: 'SHARD', ...(typeof sh.shardName === 'string' ? { objeto: sh.shardName } : {}) })
    if (esObjeto(raiz)) anadirEtapa(plan, raiz, id, profundidad)
  }
}

/** La parte con el plan: el propio explain, o el de la primera etapa `$cursor` de una agregación. */
function cuerpoDe(ex) {
  if (esObjeto(ex.queryPlanner)) return ex
  if (Array.isArray(ex.stages)) {
    for (const st of ex.stages) if (esObjeto(st) && esObjeto(st.$cursor)) return st.$cursor
  }
  return null
}

/** La raíz del árbol de etapas de un cuerpo de explain: las estadísticas de ejecución si las hay, y si no el plan elegido. */
function raizDe(cuerpo) {
  const ejecucion = esObjeto(cuerpo.executionStats) ? cuerpo.executionStats.executionStages : null
  if (esObjeto(ejecucion)) return ejecucion
  const ganador = esObjeto(cuerpo.queryPlanner) ? cuerpo.queryPlanner.winningPlan : null
  if (!esObjeto(ganador)) return null
  // Con el motor de ejecución por ranuras el árbol clásico cuelga de `queryPlan`.
  return esObjeto(ganador.queryPlan) ? ganador.queryPlan : ganador
}

function avisosDe(plan, cuerpo) {
  const avisos = []
  if (plan.nodos.some((n) => n.operacion === 'COLLSCAN')) {
    avisos.push('Recorre la colección entera (COLLSCAN): ningún índice sirve para esta consulta.')
  }
  const e = esObjeto(cuerpo.executionStats) ? cuerpo.executionStats : null
  if (e) {
    const examinados = numero(e.totalDocsExamined)
    const devueltos = numero(e.nReturned)
    if (examinados !== undefined && devueltos !== undefined && examinados >= MIN_EXAMINADOS_AVISO && examinados >= FACTOR_EXAMINADOS_AVISO * Math.max(devueltos, 1)) {
      avisos.push(`Examina ${examinados} documentos para devolver ${devueltos}: un índice más selectivo lo reduciría.`)
    }
    if (e.executionSuccess === false) avisos.push('La ejecución no terminó bien: las cifras pueden estar incompletas.')
  }
  return avisos
}

/** Las etapas de una agregación detrás del cursor, de la última a la primera, encadenadas como padre e hijo. */
function anadirAgregacion(plan, ex) {
  let padre = null
  let cuerpo = null
  for (let i = ex.stages.length - 1; i >= 0; i--) {
    const st = ex.stages[i]
    if (!esObjeto(st)) continue
    if (esObjeto(st.$cursor)) {
      cuerpo = st.$cursor
      const raiz = raizDe(cuerpo)
      if (raiz) anadirEtapa(plan, raiz, padre, 0)
      continue
    }
    const nombre = Object.keys(st)[0] || 'ETAPA'
    const id = plan.nodos.length
    plan.nodos.push({ id, padre, operacion: nombre, detalle: [texto(st[nombre], true)] })
    padre = id
  }
  return cuerpo
}

/**
 * El plan del visor (`DbPlan`) de un resultado de `explain`. `ms` es lo que tardó la petición entera;
 * `executionTimeMillis` de las estadísticas, el tiempo de la ejecución.
 */
function planDeExplain(explain, ms) {
  const plan = { nodos: [], texto: texto(explain), tiempos: { totalMs: ms, ejecucionMs: ms, lecturaMs: 0 } }
  let cuerpo = null
  try {
    if (esObjeto(explain) && Array.isArray(explain.stages)) {
      cuerpo = anadirAgregacion(plan, explain)
    } else if (esObjeto(explain)) {
      cuerpo = cuerpoDe(explain)
      const raiz = cuerpo ? raizDe(cuerpo) : null
      if (raiz) anadirEtapa(plan, raiz, null, 0)
    }
  } catch {
    plan.nodos = []
  }
  if (plan.nodos.length === 0) plan.nodos.push({ id: 0, padre: null, operacion: 'EXPLAIN', detalle: ['El servidor no devolvió un plan que Tessera sepa dibujar: el texto lo trae entero.'] })
  const tiempo = cuerpo && esObjeto(cuerpo.executionStats) ? numero(cuerpo.executionStats.executionTimeMillis) : undefined
  if (tiempo !== undefined) plan.tiempos.ejecucionMs = tiempo
  const avisos = cuerpo ? avisosDe(plan, cuerpo) : []
  if (avisos.length > 0) plan.avisos = avisos
  return plan
}

module.exports = { planDeExplain }
