#!/usr/bin/env node
// =============================================================================
// Prueba del lote de plan y los parámetros en el estado de la consola (npm run
// test:db-consola-plan): eco, marca y pestaña «Plan», qué sustituye, el ✗ y el ⊘, los
// binds en la pestaña, el rechazo por `parametros`, qué se explica y los acordes de la
// sección (nunca a través de un diálogo o un portal).
// =============================================================================

import type { DbPlan, DbResultadoFilas, DbTiempos } from '../../../../../shared/db-explorador-ipc.ts'
import { dividirSentencias } from '../../../../../shared/sql/divisorSql.ts'
import { ID_SALIDA } from '../resultados/pestanasResultado.ts'
import { crearLote, marcaDe } from './lote.ts'
import {
  PISTA_SIN_SENTENCIA,
  estadoInicialConsola,
  explicarPideValores,
  nuevoLoteId,
  reducirConsola,
  type AccionConsola,
  type EstadoConsola
} from './estadoConsola.ts'
import { textoEntrada } from './salidaConsola.ts'
import { PISTA_VARIAS_PLAN, atajoDeSeccion, sentenciaExplicable, textoProgreso } from './vivoConsola.ts'
import type { TeclaAcorde } from '../../../util/atajos.ts'

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
const j = (v: unknown): string => JSON.stringify(v)

const T0 = new Date(2026, 8, 26, 10, 0, 0).getTime()
function tiempos(total: number): DbTiempos {
  return { totalMs: total, ejecucionMs: total, lecturaMs: 0 }
}
function d(e: EstadoConsola, ...acciones: AccionConsola[]): EstadoConsola {
  let x = e
  for (const a of acciones) x = reducirConsola(x, a)
  return x
}
function lineas(e: EstadoConsola): string[] {
  return e.salida.entradas.map((x) => `${x.tipo}:${textoEntrada(x)}`)
}

const PLAN: DbPlan = {
  nodos: [
    { id: 0, padre: null, operacion: 'SELECT STATEMENT', coste: 3 },
    { id: 1, padre: 0, operacion: 'TABLE ACCESS', opciones: 'FULL', objeto: 'HR.T', coste: 3 }
  ],
  texto: 'Plan hash value: 1',
  tiempos: tiempos(12),
  avisos: ['PLAN_TABLE se revirtió al terminar']
}

function filas(n: number): DbResultadoFilas {
  const f = Array.from({ length: n }, (_x, i) => [String(i)])
  return {
    tipo: 'filas',
    columnas: [{ nombre: 'N', tipoMotor: 'NUMBER', tipoLogico: 'numero' }],
    pagina: { filasJson: JSON.stringify(f), desde: 0, hayMas: false },
    lector: null,
    tiempos: tiempos(5)
  }
}

/** Una ejecución normal de una sentencia con resultado de filas. */
function ejecutar(e: EstadoConsola, sql: string, binds?: Record<string, string | null>): EstadoConsola {
  const ss = dividirSentencias(sql, e.dialecto)
  const id = nuevoLoteId(e)
  return d(
    e,
    { tipo: 'loteCreado', lote: crearLote(id, ss) },
    { tipo: 'sentenciaIniciada', loteId: id, indice: 0, ahora: T0, esquema: 'HR' },
    { tipo: 'sentenciaTerminada', loteId: id, indice: 0, resultado: filas(2), sentencia: ss[0], esquema: 'HR', ahora: T0 + 5, binds }
  )
}

/** Un lote de plan, iniciado (sin respuesta todavía). */
function explicarIniciado(e: EstadoConsola, sql: string): { e: EstadoConsola; id: number } {
  const ss = dividirSentencias(sql, e.dialecto)
  const id = nuevoLoteId(e)
  return {
    id,
    e: d(e, { tipo: 'loteCreado', lote: crearLote(id, ss.slice(0, 1), { plan: true }) }, { tipo: 'sentenciaIniciada', loteId: id, indice: 0, ahora: T0, esquema: 'HR' })
  }
}

function main(): void {
  hr('(1) Un lote de plan')

  const ini = explicarIniciado(estadoInicialConsola('oracle'), 'delete from t where id = :id')
  check('(1a) el lote es de plan', ini.e.lote?.plan === true, j(ini.e.lote?.plan))
  check('(1b) eco Oracle: EXPLAIN PLAN FOR', lineas(ini.e)[0] === 'eco:HR> EXPLAIN PLAN FOR delete from t where id = :id', lineas(ini.e)[0])
  const pgIni = explicarIniciado(estadoInicialConsola('postgres'), 'select 1')
  check('(1c) eco PG: EXPLAIN', lineas(pgIni.e)[0] === 'eco:HR> EXPLAIN select 1', lineas(pgIni.e)[0])
  check('(1d) la barra dice «Obteniendo el plan», no «Ejecutando»', (textoProgreso(ini.e.lote, T0 + 3000) ?? '').startsWith('Obteniendo el plan'), String(textoProgreso(ini.e.lote, T0 + 3000)))
  const corriendo = marcaDe(ini.e.lote!.sentencias[0], T0 + 3000, true)
  check('(1e) mientras corre: sin barra de «ejecutado»', corriendo.claseBarra === null && corriendo.claseGlifo === 'db-glifo-corriendo', j(corriendo))

  const fin = d(ini.e, { tipo: 'planTerminado', loteId: ini.id, indice: 0, respuesta: { ok: true, valor: PLAN }, esquema: 'HR', ahora: T0 + 12, binds: { ID: '5' } })
  const m = marcaDe(fin.lote!.sentencias[0], T0 + 20, true)
  check('(1f) terminado: glifo de plan, NO la ✓, y sin barra', m.claseGlifo === 'db-glifo-plan' && m.claseBarra === null, j(m))
  check('(1g) su tooltip dice que no se ejecutó', m.hover.includes('NO se ejecutó') && m.despues === '12 ms', m.hover)
  check('(1h) el lote acaba', fin.lote?.estado === 'terminado', String(fin.lote?.estado))
  const lf = lineas(fin)
  check('(1i) la Salida: el plan (sin decir que corrió) y el aviso del main', lf[1] === 'completado:Plan de ejecución: 2 pasos en 12 ms (la sentencia no se ejecutó)' && lf[2] === 'aviso:PLAN_TABLE se revirtió al terminar', j(lf))
  const p = fin.resultados.pestanas
  check('(1j) una pestaña «Plan», activa', p.length === 1 && p[0].titulo === 'Plan' && fin.resultados.activa === p[0].id, j(p))
  const rp = fin.resultados.resultados[p[0].id]
  check('(1k) la pestaña lleva el plan, sus binds y ninguna fila ni lector', rp.plan === PLAN && j(rp.binds) === '{"ID":"5"}' && rp.datos === null && rp.lector === null && rp.columnas.length === 0, j({ plan: !!rp.plan, binds: rp.binds }))

  hr('(2) Qué sustituye el plan')

  const conFilas = ejecutar(estadoInicialConsola('oracle'), 'select * from t')
  const idFilas = conFilas.resultados.pestanas[0].id
  const x = explicarIniciado(conFilas, 'select * from t')
  const conPlan = d(x.e, { tipo: 'planTerminado', loteId: x.id, indice: 0, respuesta: { ok: true, valor: PLAN }, esquema: 'HR', ahora: T0 })
  check('(2a) la pestaña de filas SIGUE y se añade «Plan»', j(conPlan.resultados.pestanas.map((q) => q.titulo)) === '["HR.T","Plan"]', j(conPlan.resultados.pestanas.map((q) => q.titulo)))
  check('(2b) el resultado de filas no se toca', conPlan.resultados.resultados[idFilas] === conFilas.resultados.resultados[idFilas], 'mismo objeto')
  const y = explicarIniciado(conPlan, 'select * from t')
  const dosPlanes = d(y.e, { tipo: 'planTerminado', loteId: y.id, indice: 0, respuesta: { ok: true, valor: PLAN }, esquema: 'HR', ahora: T0 })
  check('(2c) otro plan sustituye al plan anterior sin fijar (no se apilan)', j(dosPlanes.resultados.pestanas.map((q) => q.titulo)) === '["HR.T","Plan"]', j(dosPlanes.resultados.pestanas.map((q) => q.titulo)))
  const idPlan = dosPlanes.resultados.pestanas[1].id
  const fijado = d(dosPlanes, { tipo: 'pestana', accion: 'fijar', id: idPlan })
  const z = explicarIniciado(fijado, 'select * from t')
  const conFijado = d(z.e, { tipo: 'planTerminado', loteId: z.id, indice: 0, respuesta: { ok: true, valor: PLAN }, esquema: 'HR', ahora: T0 })
  check('(2d) un plan FIJADO se queda y el nuevo sale como «Plan (2)»', j(conFijado.resultados.pestanas.map((q) => q.titulo)) === '["Plan","HR.T","Plan (2)"]', j(conFijado.resultados.pestanas.map((q) => q.titulo)))
  const otra = ejecutar(conPlan, 'select * from t')
  check('(2e) la siguiente EJECUCIÓN sustituye todo lo no fijado, el plan incluido', j(otra.resultados.pestanas.map((q) => q.titulo)) === '["HR.T"]', j(otra.resultados.pestanas.map((q) => q.titulo)))

  hr('(3) Un plan que falla o se cancela')

  const f1 = explicarIniciado(estadoInicialConsola('oracle'), 'select * from noexiste')
  const err = d(f1.e, {
    tipo: 'planTerminado',
    loteId: f1.id,
    indice: 0,
    respuesta: { ok: false, error: { motivo: 'servidor', codigo: 'ORA-00942', mensaje: 'ORA-00942: table or view does not exist', posicion: 14 } },
    esquema: 'HR',
    ahora: T0,
    posicionModelo: { linea: 1, columna: 15 }
  })
  check('(3a) ✗ en el lote', err.lote?.sentencias[0].estado === 'error' && err.lote?.estado === 'detenido', j(err.lote?.sentencias[0].estado))
  check('(3b) la Salida: el error con «ir a la posición» y activa', lineas(err)[1] === 'error:[ORA-00942] table or view does not exist · ir a la posición (línea 1, columna 15)' && err.resultados.activa === ID_SALIDA, lineas(err)[1])
  check('(3c) ninguna pestaña «Plan»', err.resultados.pestanas.length === 0, 'vacío')
  const me = marcaDe(err.lote!.sentencias[0], T0, true)
  check('(3d) la marca: ✗ con el código, sin barra', me.claseGlifo === 'db-glifo-error' && me.claseBarra === null && me.despues === 'ORA-00942', j(me))
  const c1 = explicarIniciado(estadoInicialConsola('postgres'), 'select 1')
  const can = d(c1.e, { tipo: 'planTerminado', loteId: c1.id, indice: 0, respuesta: { ok: false, error: { motivo: 'cancelada', mensaje: 'cancelada' } }, esquema: null, ahora: T0 })
  check('(3e) cancelado: ⊘ y «Cancelada tras…»', can.lote?.sentencias[0].estado === 'cancelada' && lineas(can)[1].startsWith('aviso:Cancelada tras'), j(lineas(can)))
  const viejo = d(err, { tipo: 'planTerminado', loteId: 999, indice: 0, respuesta: { ok: true, valor: PLAN }, esquema: null, ahora: T0 })
  check('(3f) la respuesta de un lote que ya no es el actual se ignora', viejo === err, 'mismo estado')

  hr('(4) Los binds viajan con la pestaña de filas')

  const conB = ejecutar(estadoInicialConsola('postgres'), 'select $1', { '1': 'x' })
  const rB = conB.resultados.resultados[conB.resultados.pestanas[0].id]
  check('(4a) la pestaña guarda los binds', j(rB.binds) === '{"1":"x"}', j(rB.binds))
  const sinB = ejecutar(estadoInicialConsola('postgres'), 'select 1')
  const rS = sinB.resultados.resultados[sinB.resultados.pestanas[0].id]
  check('(4b) sin parámetros, el campo ni aparece', !('binds' in rS), j(Object.keys(rS)))

  hr('(5) El main rechaza por `parametros`')

  const ssP = dividirSentencias('select :a from dual;\nselect 2 from dual;', 'oracle')
  const e0 = estadoInicialConsola('oracle')
  const idP = nuevoLoteId(e0)
  const rech = d(
    e0,
    { tipo: 'loteCreado', lote: crearLote(idP, ssP) },
    { tipo: 'sentenciaIniciada', loteId: idP, indice: 0, ahora: T0, esquema: 'HR' },
    {
      tipo: 'sentenciaTerminada',
      loteId: idP,
      indice: 0,
      resultado: { tipo: 'error', error: { motivo: 'parametros', mensaje: 'Falta el valor de :A' }, tiempos: tiempos(0) },
      esquema: 'HR',
      ahora: T0
    }
  )
  check('(5a) la Salida dice «No se envió» antes que el motivo', lineas(rech)[1] === 'error:No se envió: Falta el valor de :A · ir a la sentencia 1', lineas(rech)[1])
  check('(5b) el lote se para: la segunda queda omitida', rech.lote?.sentencias[1].estado === 'omitida', String(rech.lote?.sentencias[1].estado))

  hr('(6) Mitades negativas')

  const normal = ejecutar(estadoInicialConsola('oracle'), 'select * from t')
  const mn = marcaDe(normal.lote!.sentencias[0], T0, normal.lote!.plan === true)
  check('(6a) un lote normal NO es de plan y lleva su ✓ con barra', normal.lote?.plan === undefined && mn.claseGlifo === 'db-glifo-ok' && mn.claseBarra === 'db-barra-ok', j(mn))
  check('(6b) su eco no lleva EXPLAIN', lineas(normal)[0] === 'eco:HR> select * from t', lineas(normal)[0])
  const eN = estadoInicialConsola('oracle')
  const idN = nuevoLoteId(eN)
  const enCurso = d(
    eN,
    { tipo: 'loteCreado', lote: crearLote(idN, dividirSentencias('select 1 from dual', 'oracle')) },
    { tipo: 'sentenciaIniciada', loteId: idN, indice: 0, ahora: T0, esquema: 'HR' }
  )
  check('(6c) un lote normal en curso dice «Ejecutando»', textoProgreso(enCurso.lote, T0) === 'Ejecutando', String(textoProgreso(enCurso.lote, T0)))

  hr('(7) Qué se explica (sentenciaExplicable, con la regla compartida con el main)')

  const una = sentenciaExplicable(dividirSentencias('select * from t', 'oracle'))
  check('(7a) una consulta: se explica', una.ok, j(una))
  const dml = sentenciaExplicable(dividirSentencias('delete from t where id = 1', 'postgres'))
  check('(7b) un DML: se explica', dml.ok, j(dml))
  const varias = sentenciaExplicable(dividirSentencias('select 1 from dual;\nselect 2 from dual;', 'oracle'))
  check('(7c) dos sentencias: pista de UNA', !varias.ok && varias.pista === PISTA_VARIAS_PLAN, j(varias))
  const conCliente = sentenciaExplicable(dividirSentencias('SET SERVEROUTPUT ON\nselect 1 from dual', 'oracle'))
  check('(7d) un comando del cliente en la selección no cuenta', conCliente.ok && conCliente.sentencia.verbo === 'SELECT', j(conCliente.ok))
  const ddl = sentenciaExplicable(dividirSentencias('create table x (a int)', 'postgres'))
  check('(7e) un DDL: no, y la pista es la del main', !ddl.ok && ddl.pista.startsWith('Solo se puede explicar'), j(ddl))
  const ya = sentenciaExplicable(dividirSentencias('explain analyze delete from t', 'postgres'))
  check('(7f) un EXPLAIN ANALYZE escrito a mano NO (ejecutaría el DELETE)', !ya.ok, j(ya))
  const nada = sentenciaExplicable([])
  check('(7g) sin sentencia bajo el cursor: la pista de siempre', !nada.ok && nada.pista === PISTA_SIN_SENTENCIA, j(nada))
  const soloCliente = sentenciaExplicable(dividirSentencias('SET SERVEROUTPUT ON', 'oracle'))
  check('(7h) solo un comando del cliente: no, con su motivo', !soloCliente.ok && soloCliente.pista !== PISTA_SIN_SENTENCIA, j(soloCliente))
  // Los valores de los parámetros al explicar: Oracle no los mira
  // (EXPLAIN PLAN no hace bind peeking; el main no los exige y en thick ni los manda),
  // así que ahí NO se abre el diálogo. PG sí: el planificador los usa y el main los exige.
  check(
    '(7i) Oracle explica SIN pedir valores; PostgreSQL los pide (mitad negativa)',
    explicarPideValores('oracle') === false && explicarPideValores('postgres') === true,
    j({ oracle: explicarPideValores('oracle'), postgres: explicarPideValores('postgres') })
  )

  hr('(8) Los acordes que atiende la SECCIÓN: nunca a través de un diálogo')

  // Eventos de teclado mínimos (lo que `TeclaAcorde` pide), como en `test-atajos`.
  const tecla = (
    key: string,
    code: string,
    m: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; repeat?: boolean } = {}
  ): TeclaAcorde & { repeat?: boolean } => ({
    key,
    code,
    ctrlKey: m.ctrlKey === true,
    metaKey: m.metaKey === true,
    altKey: m.altKey === true,
    shiftKey: m.shiftKey === true,
    repeat: m.repeat === true
  })
  const LIBRE = { detenible: false, dialogoAbierto: false, desdePortal: false }
  const explicarWin = tecla('E', 'KeyE', { ctrlKey: true, shiftKey: true })
  const historialMac = tecla('h', 'KeyH', { metaKey: true, shiftKey: true })
  const formatearWin = tecla('l', 'KeyL', { ctrlKey: true, altKey: true })
  const detenerWin = tecla('F2', 'F2', { ctrlKey: true })

  check('(8a) con el foco en la rejilla o la Salida: explica', atajoDeSeccion(explicarWin, LIBRE, 'windows') === 'explicar', 'explicar')
  check('(8b) ⇧⌘H en Mac: historial', atajoDeSeccion(historialMac, LIBRE, 'mac') === 'historial', 'historial')
  check('(8c) Ctrl+Alt+L: formatear', atajoDeSeccion(formatearWin, LIBRE, 'windows') === 'formatear', 'formatear')
  check(
    '(8d) con el «¿Ejecutar DELETE sin WHERE?» ABIERTO, Ctrl+Shift+E NO explica',
    atajoDeSeccion(explicarWin, { ...LIBRE, dialogoAbierto: true }, 'windows') === null,
    'el ConfirmDialog no corta el burbujeo: sin esto arrancaba un plan y la ejecución confirmada se perdía'
  )
  check(
    '(8e) con un diálogo abierto tampoco se formatea ni se abre el historial',
    atajoDeSeccion(formatearWin, { ...LIBRE, dialogoAbierto: true }, 'windows') === null &&
      atajoDeSeccion(historialMac, { ...LIBRE, dialogoAbierto: true }, 'mac') === null,
    'el texto no cambia bajo una confirmación pendiente'
  )
  check(
    '(8f) una tecla que llega por un PORTAL (visor de valor, menú) no dispara ningún atajo de la sección',
    atajoDeSeccion(explicarWin, { ...LIBRE, desdePortal: true }, 'windows') === null &&
      atajoDeSeccion(formatearWin, { ...LIBRE, desdePortal: true }, 'windows') === null,
    'React burbujea el portal por el árbol de componentes'
  )
  check(
    '(8g) la autorrepetición no relanza nada',
    atajoDeSeccion(tecla('E', 'KeyE', { ctrlKey: true, shiftKey: true, repeat: true }), LIBRE, 'windows') === null,
    'repeat'
  )
  check(
    '(8h) Detener sigue como antes: también con un diálogo abierto (el de «Forzar» sale con una sentencia que no para)',
    atajoDeSeccion(detenerWin, { detenible: true, dialogoAbierto: true, desdePortal: true }, 'windows') === 'detener' &&
      atajoDeSeccion(detenerWin, LIBRE, 'windows') === null,
    'sin nada que parar, no'
  )
  check(
    '(8i) una tecla cualquiera: nada',
    atajoDeSeccion(tecla('a', 'KeyA'), LIBRE, 'windows') === null,
    'null'
  )

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
