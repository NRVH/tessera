#!/usr/bin/env node
// =============================================================================
// Prueba de `planMongodb.cjs` (npm run test:plan-mongodb): el resultado de `explain` como plan del visor.
// Cubre un find con índice y estadísticas, el recorrido de colección entera, una agregación, el motor por
// ranuras, un cluster con shards, el aviso de muchos documentos examinados y una forma que no reconoce.
// =============================================================================

import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const { planDeExplain } = require_('./planMongodb.cjs') as {
  planDeExplain: (ex: unknown, ms: number) => {
    nodos: Array<{ id: number; padre: number | null; operacion: string; opciones?: string; objeto?: string; filas?: number; detalle?: string[] }>
    texto: string
    tiempos: { totalMs: number; ejecucionMs: number; lecturaMs: number }
    avisos?: string[]
  }
}

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: Array<{ name: string; pass: boolean }> = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence.slice(0, 300)}`)
}
const j = (v: unknown): string => JSON.stringify(v) ?? 'undefined'

hr('(1) find con índice y executionStats')
{
  const ex = {
    queryPlanner: { winningPlan: { stage: 'FETCH', inputStage: { stage: 'IXSCAN', indexName: 'edad_1', direction: 'forward' } } },
    executionStats: {
      executionSuccess: true,
      nReturned: 3,
      executionTimeMillis: 4,
      totalKeysExamined: 3,
      totalDocsExamined: 3,
      executionStages: {
        stage: 'FETCH',
        nReturned: 3,
        executionTimeMillisEstimate: 1,
        docsExamined: 3,
        filter: { activo: { $eq: true } },
        inputStage: { stage: 'IXSCAN', nReturned: 3, keysExamined: 3, indexName: 'edad_1', keyPattern: { edad: 1 }, direction: 'forward', indexBounds: { edad: ['[30, inf.0]'] } }
      }
    }
  }
  const p = planDeExplain(ex, 9)
  check('dos pasos: FETCH con el IXSCAN debajo', j(p.nodos.map((n) => [n.id, n.padre, n.operacion])) === j([[0, null, 'FETCH'], [1, 0, 'IXSCAN']]), j(p.nodos))
  const ix = p.nodos[1]
  check('el IXSCAN lleva su índice, la dirección y lo que devolvió', ix.objeto === 'edad_1' && ix.opciones === 'forward' && ix.filas === 3, j(ix))
  check('el detalle dice claves, límites y filtro', (ix.detalle ?? []).some((d) => d.startsWith('claves examinadas: 3')) && (ix.detalle ?? []).some((d) => d.startsWith('límites:')) && (p.nodos[0].detalle ?? []).some((d) => d.startsWith('filtro:')), j(p.nodos.map((n) => n.detalle)))
  check('el tiempo de ejecución es el del servidor y el total el de la petición', p.tiempos.ejecucionMs === 4 && p.tiempos.totalMs === 9, j(p.tiempos))
  check('sin avisos cuando examina lo que devuelve', p.avisos === undefined, j(p.avisos))
  check('el texto es el explain entero en notación del shell', p.texto.includes('winningPlan') && p.texto.includes('edad_1'), p.texto.slice(0, 80))
}

hr('(1b) Con `promoteValues: false` los números llegan envueltos')
{
  const { Int32, Long, Double } = (require_('mongodb') as { BSON: Record<string, any> }).BSON
  const ex = {
    queryPlanner: { winningPlan: { stage: 'IXSCAN', indexName: 'a_1' } },
    executionStats: {
      nReturned: new Int32(2),
      executionTimeMillis: new Int32(7),
      totalDocsExamined: new Long(3000),
      executionStages: { stage: 'IXSCAN', nReturned: new Int32(2), keysExamined: new Double(3000), indexName: 'a_1' }
    }
  }
  const p = planDeExplain(ex, 9)
  check('filas, claves y tiempo se leen aunque vengan envueltos', p.nodos[0].filas === 2 && (p.nodos[0].detalle ?? []).includes('claves examinadas: 3000') && p.tiempos.ejecucionMs === 7, j(p))
  check('… y el aviso de muchos examinados también', (p.avisos ?? []).some((a) => a.includes('3000') && a.includes('2')), j(p.avisos))
}

hr('(2) Colección entera y muchos documentos examinados')
{
  const ex = {
    queryPlanner: { winningPlan: { stage: 'COLLSCAN', direction: 'forward', filter: { a: { $eq: 1 } } } },
    executionStats: { nReturned: 2, executionTimeMillis: 30, totalDocsExamined: 5000, executionStages: { stage: 'COLLSCAN', nReturned: 2, docsExamined: 5000 } }
  }
  const p = planDeExplain(ex, 31)
  check('COLLSCAN avisa de que recorre la colección entera', (p.avisos ?? []).some((a) => a.includes('COLLSCAN')), j(p.avisos))
  check('… y de que examina 5000 para devolver 2', (p.avisos ?? []).some((a) => a.includes('5000') && a.includes('2')), j(p.avisos))
  const sinStats = planDeExplain({ queryPlanner: { winningPlan: { stage: 'COLLSCAN' } } }, 1)
  check('sin executionStats se dibuja el plan elegido, con el aviso de COLLSCAN', sinStats.nodos.length === 1 && sinStats.nodos[0].operacion === 'COLLSCAN' && (sinStats.avisos ?? []).length === 1, j(sinStats))
}

hr('(3) Una agregación, el motor por ranuras y un cluster')
{
  const agg = {
    stages: [
      { $cursor: { queryPlanner: { winningPlan: { stage: 'IXSCAN', indexName: 'a_1' } } } },
      { $group: { _id: '$a', n: { $sum: 1 } } },
      { $sort: { n: -1 } }
    ]
  }
  const p = planDeExplain(agg, 2)
  check(
    'agregación: la última etapa es la raíz y el cursor cuelga de la primera',
    j(p.nodos.map((n) => [n.padre, n.operacion])) === j([[null, '$sort'], [0, '$group'], [1, 'IXSCAN']]),
    j(p.nodos.map((n) => [n.padre, n.operacion]))
  )
  const sbe = planDeExplain({ queryPlanner: { winningPlan: { queryPlan: { stage: 'COLLSCAN', planNodeId: 1 }, slotBasedPlan: { stages: '...' } } } }, 1)
  check('motor por ranuras: el árbol clásico cuelga de queryPlan', sbe.nodos.length === 1 && sbe.nodos[0].operacion === 'COLLSCAN', j(sbe.nodos))
  const cluster = {
    queryPlanner: { winningPlan: { stage: 'SHARD_MERGE', shards: [{ shardName: 'rs1', winningPlan: { stage: 'IXSCAN', indexName: 'x_1' } }, { shardName: 'rs2', winningPlan: { stage: 'COLLSCAN' } }] } }
  }
  const c = planDeExplain(cluster, 1)
  check(
    'cluster: SHARD_MERGE con un SHARD por servidor y su plan debajo',
    j(c.nodos.map((n) => [n.operacion, n.objeto ?? null])) === j([['SHARD_MERGE', null], ['SHARD', 'rs1'], ['IXSCAN', 'x_1'], ['SHARD', 'rs2'], ['COLLSCAN', null]]),
    j(c.nodos.map((n) => [n.operacion, n.objeto ?? null]))
  )
}

hr('(4) Lo que no reconoce no rompe')
{
  for (const raro of [null, 5, 'texto', [], {}, { queryPlanner: {} }, { queryPlanner: { winningPlan: 7 } }, { stages: [null, 3] }]) {
    let p: ReturnType<typeof planDeExplain> | null = null
    let fallo = ''
    try {
      p = planDeExplain(raro, 1)
    } catch (e) {
      fallo = (e as Error).message
    }
    check(`${j(raro)}: un solo paso con el aviso de que no se dibuja, y el texto`, p !== null && p.nodos.length >= 1 && typeof p.texto === 'string', fallo || j(p?.nodos))
  }
  const ciclo: Record<string, unknown> = { stage: 'FETCH' }
  ciclo.inputStage = ciclo
  const p = planDeExplain({ queryPlanner: { winningPlan: ciclo } }, 1)
  check('un árbol que se contiene a sí mismo se corta por profundidad', p.nodos.length > 1 && p.nodos.length <= 70, String(p.nodos.length))
}

const pasan = results.filter((r) => r.pass).length
console.log(`\nVEREDICTO: ${pasan}/${results.length} PASS${pasan === results.length ? ' — TODO PASS' : ' — HAY FAIL'}`)
process.exit(pasan === results.length ? 0 : 1)
