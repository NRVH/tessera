#!/usr/bin/env node
// =============================================================================
// Prueba de las pestañas de resultado de la consola de MongoDB (npm run test:resultados-consola-docs):
// una por sentencia con algo que enseñar, la colección como título, las de un lote se suman, el
// lote siguiente sustituye las no fijadas (y devuelve sus lectores), el fallo lleva a «Salida» y
// elegir un documento es de su pestaña.
// =============================================================================

import type { DbDocResultado } from '../../../../../shared/db-documentos-ipc.ts'
import { ID_SALIDA, estadoInicialResultados, fijar } from '../resultados/pestanasResultado.ts'
import {
  anadirResultadoDocs,
  metaResultadoDocs,
  resultadoDeRespuesta,
  seleccionarDocumento,
  irASalidaDocs,
  type EstadoResultadosDocs,
  type ResultadoDocs
} from './resultadosConsolaDocs.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

const j = (x: unknown): string => JSON.stringify(x)

function documentos(coleccion: string | null, n: number, lector: string | null): DbDocResultado {
  const docs = Array.from({ length: n }, (_, i) => ({ idEjson: `{"$oid":"${i}"}`, texto: `{ _id: ${i} }`, celdas: {} }))
  return { tipo: 'documentos', pagina: { lector, documentos: docs, columnas: ['_id'], ms: 3 }, base: 'tienda', coleccion }
}
const valor = (texto: string): DbDocResultado => ({ tipo: 'valor', texto, base: 'tienda' })

function anadir(e: EstadoResultadosDocs, r: DbDocResultado, lote: number, sentencia = 'db.x.find()'): { e: EstadoResultadosDocs; lectores: string[] } {
  const nuevo = resultadoDeRespuesta(r, sentencia) as ResultadoDocs
  const c = anadirResultadoDocs(e, nuevo, lote)
  return { e: c.estado, lectores: c.lectoresPorCerrar }
}
const titulos = (e: EstadoResultadosDocs): string[] => e.pestanas.map((p) => p.titulo)

function main(): void {
  hr('(1) Qué abre pestaña')
  check(
    '(1a) documentos y valor abren pestaña; una escritura o un `use`, no',
    resultadoDeRespuesta(documentos('pedidos', 2, null), 's') !== null &&
      resultadoDeRespuesta(valor('3'), 's') !== null &&
      resultadoDeRespuesta({ tipo: 'escritura', casados: 1, modificados: 1, insertados: 0, borrados: 0, base: 'tienda' } as DbDocResultado, 's') === null &&
      resultadoDeRespuesta({ tipo: 'base', base: 'otra' }, 's') === null,
    'documentos · valor · escritura · base'
  )
  const d = resultadoDeRespuesta(documentos('pedidos', 2, 'L1'), 'db.pedidos.find()')
  check('(1b) con documentos, el primero queda elegido', d?.tipo === 'documentos' && d.seleccionado === 0, j(d && d.tipo === 'documentos' ? d.seleccionado : null))
  const vacio = resultadoDeRespuesta(documentos('pedidos', 0, null), 's')
  check('(1c) sin documentos, ninguno elegido', vacio?.tipo === 'documentos' && vacio.seleccionado === null, 'null')

  hr('(2) Un lote con varias sentencias: una pestaña por resultado')
  let e = estadoInicialResultados<ResultadoDocs>()
  ;({ e } = anadir(e, documentos('pedidos', 2, 'L1'), 1))
  ;({ e } = anadir(e, valor('42'), 1, 'db.pedidos.countDocuments()'))
  ;({ e } = anadir(e, documentos(null, 1, null), 1, 'db.aggregate([])'))
  check('(2a) tres pestañas, con la colección o «Resultado k» del lote', j(titulos(e)) === j(['pedidos', 'Resultado 2', 'Resultado 3']), j(titulos(e)))
  check('(2b) activa la última', e.activa === e.pestanas[2].id, e.activa)
  const mismo = anadir(e, documentos('pedidos', 1, null), 1)
  check('(2c) la misma colección dos veces en el lote: «pedidos (2)»', titulos(mismo.e)[3] === 'pedidos (2)', titulos(mismo.e)[3])

  hr('(3) El lote siguiente sustituye las no fijadas y cierra sus lectores')
  const conFijada = fijar(e, e.pestanas[1].id)
  const sig = anadir(conFijada, documentos('clientes', 1, null), 2)
  check('(3a) queda la fijada y la nueva', j(titulos(sig.e)) === j(['Resultado 2', 'clientes']), j(titulos(sig.e)))
  check('(3b) el lector de la sustituida se devuelve para cerrarlo', j(sig.lectores) === j(['L1']), j(sig.lectores))
  const k = anadir(sig.e, valor('1'), 2).e.pestanas.at(-1)?.titulo
  check('(3c) la k cuenta solo el lote nuevo, sin repetir el título de una fijada', k === 'Resultado 2 (2)', String(k))

  hr('(4) Un fallo lleva a «Salida»')
  const fallo = irASalidaDocs(e)
  check('(4a) conserva las pestañas y activa «Salida»', fallo.pestanas.length === 3 && fallo.activa === ID_SALIDA, fallo.activa)
  check('(4b) ya en «Salida», el MISMO estado', irASalidaDocs(fallo) === fallo, 'mismo estado')

  hr('(5) Elegir un documento es de su pestaña')
  const id0 = e.pestanas[0].id
  const elegido = seleccionarDocumento(e, id0, 1)
  const r0 = elegido.resultados[id0]
  check('(5a) cambia el elegido de esa pestaña', r0.tipo === 'documentos' && r0.seleccionado === 1, j(r0.tipo === 'documentos' ? r0.seleccionado : null))
  check('(5b) en una pestaña de valor no hace nada', seleccionarDocumento(e, e.pestanas[1].id, 0) === e, 'mismo estado')

  hr('(6) Metadatos')
  check('(6a) documentos con más y colección', metaResultadoDocs(e.resultados[id0]) === '2 documentos (hay más) · pedidos', metaResultadoDocs(e.resultados[id0]))
  check('(6b) un valor', metaResultadoDocs(e.resultados[e.pestanas[1].id]) === 'Valor', 'Valor')

  hr('(7) El plan de un explain')
  const plan: DbDocResultado = {
    tipo: 'plan',
    base: 'tienda',
    plan: {
      nodos: [
        { id: 0, padre: null, operacion: 'FETCH' },
        { id: 1, padre: 0, operacion: 'IXSCAN', objeto: 'edad_1' }
      ],
      texto: '{ }',
      tiempos: { totalMs: 12, ejecucionMs: 4, lecturaMs: 0 }
    }
  }
  const rp = resultadoDeRespuesta(plan, 'db.pedidos.find().explain()')
  check('(7a) un plan abre pestaña, con la sentencia que lo pidió', rp?.tipo === 'plan' && rp.lector === null && rp.sentencia === 'db.pedidos.find().explain()', j(rp?.tipo))
  const conPlan = anadir(estadoInicialResultados<ResultadoDocs>(), plan, 1).e
  check('(7b) se titula «Plan»', j(titulos(conPlan)) === j(['Plan']), j(titulos(conPlan)))
  check('(7c) su meta cuenta los pasos y el tiempo', metaResultadoDocs(conPlan.resultados[conPlan.pestanas[0].id]) === '2 pasos · 12 ms', metaResultadoDocs(conPlan.resultados[conPlan.pestanas[0].id]))
  check('(7d) elegir un documento en un plan no hace nada', seleccionarDocumento(conPlan, conPlan.pestanas[0].id, 0) === conPlan, 'mismo estado')
}

main()
const allPass = results.every((r) => r.pass)
console.log(`\nVEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
