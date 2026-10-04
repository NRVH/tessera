#!/usr/bin/env node
// =============================================================================
// Prueba del modelo de pestañas de resultado de la consola (npm run test:db-resultados):
// títulos con la caja de cada motor, lotes de golpe e incrementales, sustitución de las no
// fijadas con sus lectores, activación, fijar, cerrar e inmutabilidad.
// =============================================================================

import {
  ID_SALIDA,
  MAX_FIJADAS,
  estadoInicialResultados,
  tituloResultado,
  tituloSinRepetir,
  empezarLote,
  aplicarLote,
  activar,
  fijar,
  desfijar,
  puedeFijar,
  cerrar,
  cerrarOtrasNoFijadas,
  cerrarTodas,
  actualizarResultado,
  pestanaActiva,
  lectoresAbiertos,
  type EstadoResultados,
  type NuevoResultado
} from './pestanasResultado.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const j = (x: unknown): string => JSON.stringify(x)

interface Res {
  lector: string | null
  filas: number
}
type Estado = EstadoResultados<Res>

function nuevo(titulo: string, lector: string | null = null, filas = 1): NuevoResultado<Res> {
  return { titulo, resultado: { lector, filas } }
}
const titulos = (e: Estado): string[] => e.pestanas.map((p) => p.titulo)

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) tituloResultado')
  // -------------------------------------------------------------------------
  check(
    '(1a) Oracle sin comillas -> MAYÚSCULAS, con el esquema actual',
    tituloResultado({ esquema: null, nombre: 'profile' }, 'ADMDEMO', 'oracle', 1) === 'ADMDEMO.PROFILE',
    tituloResultado({ esquema: null, nombre: 'profile' }, 'ADMDEMO', 'oracle', 1)
  )
  check(
    '(1b) Oracle con esquema escrito: ése, en mayúsculas',
    tituloResultado({ esquema: 'hr', nombre: 'Employees' }, 'ADMDEMO', 'oracle', 1) === 'HR.EMPLOYEES',
    tituloResultado({ esquema: 'hr', nombre: 'Employees' }, 'ADMDEMO', 'oracle', 1)
  )
  check(
    '(1c) PG sin comillas -> minúsculas',
    tituloResultado({ esquema: 'Ventas', nombre: 'Clientes' }, 'public', 'postgres', 1) === 'ventas.clientes',
    tituloResultado({ esquema: 'Ventas', nombre: 'Clientes' }, 'public', 'postgres', 1)
  )
  check(
    '(1d) citados: se quedan como están, sin comillas y con "" deshecho',
    tituloResultado({ esquema: '"Mi Esq"', nombre: '"Tabla""X"' }, null, 'postgres', 1) === 'Mi Esq.Tabla"X' &&
      tituloResultado({ esquema: null, nombre: '"MiTabla"' }, 'ADMDEMO', 'oracle', 1) === 'ADMDEMO.MiTabla',
    tituloResultado({ esquema: '"Mi Esq"', nombre: '"Tabla""X"' }, null, 'postgres', 1)
  )
  check(
    '(1e) PG sólo pliega A-Z: la Ñ de una base UTF-8 no se toca',
    tituloResultado({ esquema: null, nombre: 'AÑO' }, 'public', 'postgres', 1) === 'public.aÑo',
    tituloResultado({ esquema: null, nombre: 'AÑO' }, 'public', 'postgres', 1)
  )
  check(
    '(1f) el esquema actual llega con su nombre real y NO se pliega',
    tituloResultado({ esquema: null, nombre: 'x' }, 'MiEsquema', 'postgres', 1) === 'MiEsquema.x',
    tituloResultado({ esquema: null, nombre: 'x' }, 'MiEsquema', 'postgres', 1)
  )
  check('(1g) sin esquema conocido: sólo la tabla', tituloResultado({ esquema: null, nombre: 'dual' }, null, 'oracle', 1) === 'DUAL', 'DUAL')
  // El plegado es el compartido (`plegarSinComillas`); en Oracle sube también lo no ASCII.
  check(
    '(1g2) Oracle pliega también lo no ASCII (año -> AÑO)',
    tituloResultado({ esquema: null, nombre: 'año' }, 'HR', 'oracle', 1) === 'HR.AÑO',
    tituloResultado({ esquema: null, nombre: 'año' }, 'HR', 'oracle', 1)
  )
  check('(1h) sin tabla única (JOIN, WITH…): Resultado k', tituloResultado(null, 'ADMDEMO', 'oracle', 3) === 'Resultado 3', 'Resultado 3')
  check('(1i) nombre vacío también es Resultado k', tituloResultado({ esquema: 'a', nombre: '  ' }, null, 'oracle', 2) === 'Resultado 2', 'ok')
  check(
    '(1j) tituloSinRepetir: menor n libre desde 2',
    tituloSinRepetir('A', new Set(['A', 'A (2)'])) === 'A (3)' && tituloSinRepetir('B', new Set(['A'])) === 'B' && tituloSinRepetir('A', new Set(['A', 'A (3)'])) === 'A (2)',
    'ok'
  )

  // -------------------------------------------------------------------------
  hr('(2) aplicarLote de golpe')
  // -------------------------------------------------------------------------
  const e0: Estado = estadoInicialResultados<Res>()
  check('(2a) inicial: sin pestañas, activa Salida', e0.pestanas.length === 0 && e0.activa === ID_SALIDA && ID_SALIDA === 'salida', j(e0))
  const l1 = aplicarLote(e0, [nuevo('ADMDEMO.ES_CONFIG', 'L1'), nuevo('ADMDEMO.USER_RESP', 'L2'), nuevo('ADMDEMO.ES_CONFIG', null)])
  const e1 = l1.estado
  check(
    '(2b) tres SELECT -> tres pestañas en orden, repetido con (2)',
    j(titulos(e1)) === j(['ADMDEMO.ES_CONFIG', 'ADMDEMO.USER_RESP', 'ADMDEMO.ES_CONFIG (2)']),
    j(titulos(e1))
  )
  check('(2c) activa la ÚLTIMA nueva', e1.activa === e1.pestanas[2].id && pestanaActiva(e1)?.titulo === 'ADMDEMO.ES_CONFIG (2)', e1.activa)
  check('(2d) primer lote: nada que cerrar', l1.lectoresPorCerrar.length === 0, j(l1.lectoresPorCerrar))
  check('(2e) ids únicos y nunca "salida"', new Set(e1.pestanas.map((p) => p.id)).size === 3 && e1.pestanas.every((p) => p.id !== ID_SALIDA), j(e1.pestanas.map((p) => p.id)))
  check('(2f) cada pestaña tiene su resultado', e1.pestanas.every((p) => e1.resultados[p.id] !== undefined), 'ok')
  check('(2g) inmutable: el estado de entrada no cambió', e0.pestanas.length === 0 && Object.keys(e0.resultados).length === 0, 'ok')

  // -------------------------------------------------------------------------
  hr('(3) el lote siguiente SUSTITUYE las no fijadas')
  // -------------------------------------------------------------------------
  const idUser = e1.pestanas[1].id
  const e1f = fijar(e1, idUser)
  check('(3a) fijar pasa al grupo de fijadas (primero)', e1f.pestanas[0].id === idUser && e1f.pestanas[0].fijada, j(titulos(e1f)))
  const l2 = aplicarLote(e1f, [nuevo('ADMDEMO.USER_RESP', 'L3')])
  const e2 = l2.estado
  check(
    '(3b) orden [fijada, nueva]; la nueva repetida con la fijada lleva (2)',
    j(titulos(e2)) === j(['ADMDEMO.USER_RESP', 'ADMDEMO.USER_RESP (2)']),
    j(titulos(e2))
  )
  check('(3c) los lectores de las SUSTITUIDAS salen a cerrar (no el de la fijada)', j(l2.lectoresPorCerrar) === j(['L1']), j(l2.lectoresPorCerrar))
  check('(3d) sus resultados se borran del mapa', Object.keys(e2.resultados).length === 2, j(Object.keys(e2.resultados)))
  check('(3e) la sustitución reutiliza el título libre ("ES_CONFIG" ya no está)', !titulos(e2).includes('ADMDEMO.ES_CONFIG'), j(titulos(e2)))
  const l3 = aplicarLote(e2, [])
  check(
    '(3f) un lote SIN filas (sólo UPDATE) también sustituye: la activa sustituida cae en Salida',
    j(titulos(l3.estado)) === j(['ADMDEMO.USER_RESP']) && l3.estado.activa === ID_SALIDA && j(l3.lectoresPorCerrar) === j(['L3']),
    `${j(titulos(l3.estado))} activa=${l3.estado.activa}`
  )

  // -------------------------------------------------------------------------
  hr('(4) lote INCREMENTAL (una llamada por sentencia)')
  // -------------------------------------------------------------------------
  let e = empezarLote(e1f, 7)
  const i1 = aplicarLote(e, [nuevo('Resultado 1', 'A')], { lote: 7 })
  e = i1.estado
  const i2 = aplicarLote(e, [nuevo('Resultado 1', 'B')], { lote: 7 })
  e = i2.estado
  check(
    '(4a) la segunda sentencia NO sustituye a la primera del mismo lote',
    j(titulos(e)) === j(['ADMDEMO.USER_RESP', 'Resultado 1', 'Resultado 1 (2)']),
    j(titulos(e))
  )
  check('(4b) lo sustituido sale una sola vez (en la primera llamada)', j(i1.lectoresPorCerrar) === j(['L1']) && i2.lectoresPorCerrar.length === 0, `${j(i1.lectoresPorCerrar)} / ${j(i2.lectoresPorCerrar)}`)
  check('(4c) cada resultado se activa al llegar', e.activa === e.pestanas[2].id, e.activa)
  const i3 = aplicarLote(e, [nuevo('X', 'C')], { lote: 8 })
  check('(4d) un lote con otro número sí sustituye las no fijadas', j(titulos(i3.estado)) === j(['ADMDEMO.USER_RESP', 'X']) && j(i3.lectoresPorCerrar) === j(['A', 'B']), j(titulos(i3.estado)))

  // -------------------------------------------------------------------------
  hr('(5) activación')
  // -------------------------------------------------------------------------
  const conError = aplicarLote(e1, [nuevo('R', 'Z')], { error: true })
  check('(5a) lote con error: activa Salida aunque haya nuevas', conError.estado.activa === ID_SALIDA, conError.estado.activa)
  let u = empezarLote(e1f, 20)
  u = aplicarLote(u, [nuevo('P1', 'p1')], { lote: 20 }).estado
  const elegida = u.pestanas[0].id // la fijada
  u = activar(u, elegida)
  check('(5b) activar marca la elección del usuario', u.activa === elegida && u.eligioEnLote, u.activa)
  u = aplicarLote(u, [nuevo('P2', 'p2')], { lote: 20 }).estado
  check('(5c) con elección durante el lote, el resultado nuevo NO roba la vista', u.activa === elegida, u.activa)
  u = aplicarLote(u, [nuevo('P3', 'p3')], { lote: 20, error: true }).estado
  check('(5d) pero un error sí lleva a Salida (hay que verlo)', u.activa === ID_SALIDA, u.activa)
  const sig = aplicarLote(u, [nuevo('Q', 'q')], { lote: 21 }).estado
  check('(5e) el lote siguiente olvida la elección: activa su última nueva', sig.activa === sig.pestanas[sig.pestanas.length - 1].id && !sig.eligioEnLote, sig.activa)
  // El usuario elige una pestaña vieja mientras corre la primera sentencia del lote
  // nuevo, y ese mismo lote la sustituye: su elección ya no apunta a nada.
  let v = aplicarLote(e0, [nuevo('Vieja', 'v')], { lote: 30 }).estado
  v = empezarLote(v, 31)
  v = activar(v, v.pestanas[0].id)
  v = aplicarLote(v, [nuevo('Nueva', 'n')], { lote: 31 }).estado
  check('(5f) si el lote sustituye la pestaña elegida, se activa la nueva', pestanaActiva(v)?.titulo === 'Nueva', pestanaActiva(v)?.titulo ?? 'null')
  check('(5g) activar un id inexistente no hace nada', activar(v, 'r999') === v, 'misma ref')
  check('(5h) activar Salida vale', activar(v, ID_SALIDA).activa === ID_SALIDA, 'ok')

  // -------------------------------------------------------------------------
  hr('(6) fijar, desfijar y cerrar')
  // -------------------------------------------------------------------------
  const base = aplicarLote(e0, [nuevo('A', 'la'), nuevo('B', 'lb'), nuevo('C', 'lc'), nuevo('D', 'ld')]).estado
  const [a, b, c, d] = base.pestanas.map((p) => p.id)
  let f = fijar(base, c)
  f = fijar(f, a)
  check('(6a) fijadas primero, cada una al FINAL del grupo al fijarla', j(titulos(f)) === j(['C', 'A', 'B', 'D']), j(titulos(f)))
  const df = desfijar(f, a)
  check('(6b) desfijar: vuelve a ser la PRIMERA de las no fijadas', j(titulos(df)) === j(['C', 'A', 'B', 'D']) && !df.pestanas[1].fijada, j(titulos(df)))
  check('(6c) fijar/desfijar sin cambio devuelve la MISMA referencia', fijar(f, a) === f && desfijar(base, a) === base && fijar(base, 'nope') === base, 'misma ref')
  let lleno: Estado = estadoInicialResultados<Res>()
  lleno = aplicarLote(lleno, Array.from({ length: MAX_FIJADAS + 1 }, (_, i) => nuevo(`T${i}`))).estado
  for (const p of lleno.pestanas.slice(0, MAX_FIJADAS)) lleno = fijar(lleno, p.id)
  const extra = lleno.pestanas[MAX_FIJADAS].id
  check(`(6d) tope de ${MAX_FIJADAS} fijadas`, !puedeFijar(lleno) && fijar(lleno, extra) === lleno, `fijadas=${lleno.pestanas.filter((p) => p.fijada).length}`)

  // cerrar la activa: vecina derecha; si no hay, la izquierda; si no, Salida
  const act = activar(base, b)
  const cb = cerrar(act, b)
  check('(6e) cerrar la activa: pasa a la vecina de la DERECHA', cb.estado.activa === c && j(cb.lectoresPorCerrar) === j(['lb']), cb.estado.activa)
  const cd = cerrar(activar(base, d), d)
  check('(6f) cerrar la última activa: pasa a la de la izquierda', cd.estado.activa === c, cd.estado.activa)
  let una = aplicarLote(e0, [nuevo('Sola', 's')]).estado
  const cu = cerrar(una, una.pestanas[0].id)
  una = cu.estado
  check('(6g) cerrar la única: Salida', una.activa === ID_SALIDA && una.pestanas.length === 0 && j(cu.lectoresPorCerrar) === j(['s']), una.activa)
  check('(6h) cerrar una NO activa no mueve la activa', cerrar(activar(base, a), c).estado.activa === a, 'ok')
  check('(6i) cerrar Salida o un id inexistente: nada', cerrar(base, ID_SALIDA).estado === base && cerrar(base, 'r999').estado === base, 'misma ref')
  check('(6j) cerrar una FIJADA también se puede (y cierra su lector)', j(cerrar(f, a).lectoresPorCerrar) === j(['la']), 'ok')

  const otras = cerrarOtrasNoFijadas(activar(f, d), b)
  check(
    '(6k) cerrar las demás sin fijar: quedan las fijadas y la elegida; la activa cerrada pasa a la elegida',
    j(titulos(otras.estado)) === j(['C', 'A', 'B']) && otras.estado.activa === b && j(otras.lectoresPorCerrar) === j(['ld']),
    `${j(titulos(otras.estado))} activa=${otras.estado.activa}`
  )
  const todas = cerrarTodas(f)
  check(
    '(6l) cerrar todas: fijadas incluidas, sólo queda Salida y salen los 4 lectores',
    todas.estado.pestanas.length === 0 && todas.estado.activa === ID_SALIDA && todas.lectoresPorCerrar.length === 4,
    j(todas.lectoresPorCerrar)
  )

  // -------------------------------------------------------------------------
  hr('(7) resultados y lectores')
  // -------------------------------------------------------------------------
  const upd = actualizarResultado(base, a, { lector: null, filas: 1000 })
  check('(7a) actualizarResultado cambia sólo ése', upd.resultados[a].filas === 1000 && base.resultados[a].filas === 1, 'ok')
  check('(7b) actualizar un id inexistente no hace nada', actualizarResultado(base, 'r999', { lector: null, filas: 0 }) === base, 'misma ref')
  check('(7c) lectoresAbiertos: los no nulos, en orden', j(lectoresAbiertos(upd)) === j(['lb', 'lc', 'ld']), j(lectoresAbiertos(upd)))
  const trasCerrarLector = aplicarLote(upd, [nuevo('Z')])
  check('(7d) un resultado cuyo lector ya se cerró no se vuelve a cerrar', !trasCerrarLector.lectoresPorCerrar.includes('la') && trasCerrarLector.lectoresPorCerrar.length === 3, j(trasCerrarLector.lectoresPorCerrar))

  // ---------------------------------------------------------------------------
  // Reporte final
  // ---------------------------------------------------------------------------
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
