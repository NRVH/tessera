#!/usr/bin/env node
// =============================================================================
// Prueba de la salida del servidor y la compilación en la consola (npm run
// test:db-consola-salida): líneas del servidor, textos y marcas de compilación, «ir a la
// posición» y el orden de las líneas bajo su sentencia en el reducer, con mitades negativas,
// y el autodesplazamiento de la lista (limpiar la salida lo reengancha).
// =============================================================================

import type {
  DbErrorCompilacion,
  DbLineaSalida,
  DbResultadoError,
  DbResultadoHecho,
  DbTiempos
} from '../../../../../shared/db-explorador-ipc.ts'
import { dividirSentencias } from '../../../../../shared/sql/divisorSql.ts'
import { descriptorMarca, marcasCompilacion } from './marcasConsola.ts'
import { crearLote, iniciar, marcaDe, objetoDe, registrar } from './lote.ts'
import {
  MAX_LINEAS_SERVIDOR,
  contarCompilacion,
  entradasCompilacion,
  entradasServidor,
  pegadoAlFondo,
  primeraPosicionCompilacion,
  sigueAlFondo,
  textoCompilacionInvalida,
  textoCompletado,
  textoEntrada,
  textoError,
  textoErrorResultado,
  textoLineaCompilacion
} from './salidaConsola.ts'
import { estadoInicialConsola, nuevoLoteId, reducirConsola, type AccionConsola, type EstadoConsola } from './estadoConsola.ts'
import { ID_SALIDA } from '../resultados/pestanasResultado.ts'

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const T0 = new Date(2026, 8, 26, 10, 0, 0).getTime()

function tiempos(total: number): DbTiempos {
  return { totalMs: total, ejecucionMs: total, lecturaMs: 0 }
}

const ERRORES: DbErrorCompilacion[] = [
  { linea: 3, columna: 5, mensaje: "PLS-00201: identifier 'X' must be declared", esAviso: false, posicion: 40 },
  { linea: 3, columna: 5, mensaje: 'PL/SQL: Statement ignored', esAviso: false, posicion: 40 },
  { linea: 1, columna: 1, mensaje: 'PLW-05018: unit P omitted optional AUTHID clause', esAviso: true, posicion: 0 },
  { linea: 9, columna: 2, mensaje: 'PLS-00103: Encountered the symbol "END"', esAviso: false }
]

function hecho(p: { compilacion?: DbErrorCompilacion[]; salida?: DbLineaSalida[]; avisos?: string[] } = {}): DbResultadoHecho {
  const r: DbResultadoHecho = { tipo: 'hecho', comando: 'CREATE PROCEDURE', tiempos: tiempos(45) }
  if (p.compilacion) r.compilacion = p.compilacion
  if (p.salida) r.salida = p.salida
  if (p.avisos) r.avisos = p.avisos
  return r
}

function invalida(compilacion?: DbErrorCompilacion[], salida?: DbLineaSalida[]): DbResultadoError {
  const r: DbResultadoError = {
    tipo: 'error',
    error: {
      motivo: 'servidor',
      codigo: 'ORA-24344',
      mensaje: 'Creado con errores de compilación: ORA-24344: success with compilation error'
    },
    tiempos: tiempos(60)
  }
  if (compilacion) r.compilacion = compilacion
  if (salida) r.salida = salida
  return r
}

const CREATE_P = 'create or replace procedure hr.p is\nbegin\n  x := 1;\nend;\n/'

function d(e: EstadoConsola, ...acciones: AccionConsola[]): EstadoConsola {
  let x = e
  for (const a of acciones) x = reducirConsola(x, a)
  return x
}

/** Un lote de UNA sentencia (el texto entero), iniciado y terminado con `r`. */
function unaSentencia(motor: 'oracle' | 'postgres', sql: string, r: DbResultadoError | DbResultadoHecho): EstadoConsola {
  const ss = dividirSentencias(sql, motor === 'oracle' ? 'oracle' : 'postgres')
  const e0 = estadoInicialConsola(motor)
  const id = nuevoLoteId(e0)
  return d(
    e0,
    { tipo: 'loteCreado', lote: crearLote(id, ss) },
    { tipo: 'sentenciaIniciada', loteId: id, indice: 0, ahora: T0, esquema: 'HR' },
    { tipo: 'sentenciaTerminada', loteId: id, indice: 0, resultado: r, sentencia: ss[0], esquema: 'HR', ahora: T0 + 100 }
  )
}

function lineas(e: EstadoConsola): string[] {
  return e.salida.entradas.map((x) => `${x.tipo}${x.anidada ? '>' : ''}:${textoEntrada(x)}`)
}

function main(): void {
  hr('(1) entradasServidor')
  check('sin salida: nada', entradasServidor(undefined).length === 0 && entradasServidor([]).length === 0, '[]')
  const srv = entradasServidor([{ texto: 'hola' }, { texto: 'cuidado', aviso: true }, { texto: '' }, { texto: 'fin\n' }])
  check(
    'una entrada anidada por línea; WARNING -> servidorAviso',
    j(srv.map((x) => [x.tipo, x.texto, x.anidada])) ===
      j([
        ['servidor', 'hola', true],
        ['servidorAviso', 'cuidado', true],
        ['servidor', '', true],
        ['servidor', 'fin', true]
      ]),
    j(srv)
  )
  const muchas: DbLineaSalida[] = []
  for (let i = 0; i < MAX_LINEAS_SERVIDOR + 3; i++) muchas.push({ texto: `l${i}` })
  const topadas = entradasServidor(muchas)
  check(
    `tope de ${MAX_LINEAS_SERVIDOR} y una línea que cuenta las que faltan`,
    topadas.length === MAX_LINEAS_SERVIDOR + 1 &&
      topadas[topadas.length - 1].tipo === 'info' &&
      topadas[topadas.length - 1].texto.includes('3 líneas más'),
    `${topadas.length} · ${topadas[topadas.length - 1].texto}`
  )
  const una = entradasServidor(muchas.slice(0, MAX_LINEAS_SERVIDOR + 1))
  check('singular: «1 línea más»', una[una.length - 1].texto.includes('1 línea más'), una[una.length - 1].texto)

  hr('(2) textos de compilación')
  check(
    'línea y columna DEL SERVIDOR delante del mensaje',
    textoLineaCompilacion(ERRORES[0]) === "línea 3, columna 5: PLS-00201: identifier 'X' must be declared",
    textoLineaCompilacion(ERRORES[0])
  )
  check('contarCompilacion', j(contarCompilacion(ERRORES)) === j({ errores: 3, avisos: 1 }), j(contarCompilacion(ERRORES)))
  const obj = { tipo: 'PROCEDURE', esquema: 'HR', nombre: 'P' }
  check(
    'resumen con objeto, plural y avisos',
    textoCompilacionInvalida(obj, 3, 1) === 'PROCEDURE HR.P creado con 3 errores de compilación y 1 aviso',
    textoCompilacionInvalida(obj, 3, 1)
  )
  check(
    'singular y sin esquema',
    textoCompilacionInvalida({ tipo: 'PACKAGE BODY', esquema: null, nombre: 'PKG' }, 1, 0) ===
      'PACKAGE BODY PKG creado con 1 error de compilación',
    textoCompilacionInvalida({ tipo: 'PACKAGE BODY', esquema: null, nombre: 'PKG' }, 1, 0)
  )
  check('sin objeto conocido: «Creado con…»', textoCompilacionInvalida(null, 2, 2) === 'Creado con 2 errores de compilación y 2 avisos', textoCompilacionInvalida(null, 2, 2))
  check(
    '✗ con lista: el resumen CONSERVA el código y sustituye el mensaje del main',
    textoErrorResultado(invalida(ERRORES), obj) === '[ORA-24344] PROCEDURE HR.P creado con 3 errores de compilación y 1 aviso',
    textoErrorResultado(invalida(ERRORES), obj)
  )
  check(
    'NO: ✗ sin lista (o vacía): el mensaje del servidor tal cual',
    textoErrorResultado(invalida(), obj) === '[ORA-24344] Creado con errores de compilación: ORA-24344: success with compilation error' &&
      textoErrorResultado(invalida([]), obj) === textoErrorResultado(invalida(), obj),
    textoErrorResultado(invalida(), obj)
  )
  // SQL Server: un error DENTRO de un procedimiento lleva el
  // procedimiento en `objeto` (sin posición en la consola), y el texto lo dice.
  check(
    'SQL Server: un error con `objeto` dice dónde: «… (en p_err)»',
    textoError({ codigo: '8134', mensaje: 'Error de división entre cero.', objeto: 'p_err' }) === '[8134] Error de división entre cero. (en p_err)',
    textoError({ codigo: '8134', mensaje: 'Error de división entre cero.', objeto: 'p_err' })
  )
  check(
    'NEGATIVO: sin `objeto` (Oracle, PG, SQLite, o el error del propio texto) el texto no cambia',
    textoError({ codigo: 'ORA-00942', mensaje: 'ORA-00942: table or view does not exist' }) === '[ORA-00942] table or view does not exist' &&
      textoError({ mensaje: 'sin código' }) === 'sin código',
    textoError({ codigo: 'ORA-00942', mensaje: 'ORA-00942: table or view does not exist' })
  )
  check('completado con avisos', textoCompletado(45, 1) === 'completado en 45 ms, con 1 aviso de compilación', textoCompletado(45, 1))
  check('NO: sin avisos, el completado de siempre', textoCompletado(45) === 'completado en 45 ms' && textoCompletado(45, 0) === 'completado en 45 ms', textoCompletado(45))

  hr('(3) entradasCompilacion y primeraPosicionCompilacion')
  const ec = entradasCompilacion(ERRORES, 7, 2)
  check(
    'una por entrada, en el orden del servidor; error/aviso; anidadas',
    j(ec.map((x) => [x.tipo, x.anidada])) === j([['error', true], ['error', true], ['aviso', true], ['error', true]]),
    j(ec.map((x) => x.tipo))
  )
  check(
    'situada: «ir a la posición» EXACTA, sin coordenadas del editor en la etiqueta',
    ec[0].ir?.exacta === true && ec[0].ir.desplazamiento === 40 && ec[0].ir.etiqueta === 'ir a la posición' && ec[0].ir.loteId === 7 && ec[0].ir.sentencia === 2,
    j(ec[0].ir)
  )
  check(
    'sin posición: a la sentencia (1-based en la etiqueta), no exacta',
    ec[3].ir?.exacta === undefined && ec[3].ir?.etiqueta === 'ir a la sentencia 3' && ec[3].ir.desplazamiento === 0,
    j(ec[3].ir)
  )
  check('NO: sin lista, nada', entradasCompilacion(undefined, 1, 0).length === 0 && entradasCompilacion([], 1, 0).length === 0, '[]')
  check('primera posición: el primer ERROR situado (no el aviso de antes)', primeraPosicionCompilacion(ERRORES) === 40, String(primeraPosicionCompilacion(ERRORES)))
  check(
    'solo avisos situados: el primero de ellos; nada situado: null',
    primeraPosicionCompilacion([ERRORES[2]]) === 0 && primeraPosicionCompilacion([ERRORES[3]]) === null && primeraPosicionCompilacion(undefined) === null,
    'ok'
  )

  hr('(4) marcasCompilacion')
  const mc = marcasCompilacion(ERRORES)
  check('solo las situadas (3 de 4)', mc.length === 3, j(mc))
  check(
    'ordenadas por posición; a igual posición, errores antes',
    j(mc.map((m) => [m.desplazamiento, m.severidad])) === j([[0, 'aviso'], [40, 'error'], [40, 'error']]),
    j(mc.map((m) => [m.desplazamiento, m.severidad]))
  )
  const vacias = marcasCompilacion([
    { linea: 1, columna: 1, mensaje: '  ', esAviso: false, posicion: 3 },
    { linea: 1, columna: 1, mensaje: '', esAviso: true, posicion: 4 },
    { linea: 1, columna: 1, mensaje: 'x', esAviso: false, posicion: -1 },
    { linea: 1, columna: 1, mensaje: 'x', esAviso: false, posicion: Number.NaN }
  ])
  check(
    'mensaje vacío -> la severidad; posiciones negativas o NaN no marcan',
    j(vacias.map((m) => m.mensaje)) === j(['Error de compilación', 'Aviso de compilación']),
    j(vacias)
  )

  hr('(5) glifo y lote')
  const amb = descriptorMarca('ok', 45, '', null, 2)
  check(
    '✓ con avisos: glifo y barra ámbar, tooltip que lo dice, el tiempo detrás',
    amb.claseGlifo === 'db-glifo-avisos' && amb.claseBarra === 'db-barra-avisos' && amb.hover === 'Compilado con 2 avisos · 45 ms' && amb.despues === '45 ms',
    j(amb)
  )
  check('NO: sin avisos, la ✓ de siempre', descriptorMarca('ok', 45).claseGlifo === 'db-glifo-ok', descriptorMarca('ok', 45).claseGlifo)
  check('NO: avisos en un ✗ no lo cambian', descriptorMarca('error', 45, 'x', 'ORA-1', 3).claseGlifo === 'db-glifo-error', 'db-glifo-error')
  const ssP = dividirSentencias(CREATE_P, 'oracle')
  check('el clasificador sabe qué crea la sentencia', j(objetoDe(ssP[0])) === j({ tipo: 'PROCEDURE', esquema: 'HR', nombre: 'P' }), j(objetoDe(ssP[0])))
  const lOk = registrar(iniciar(crearLote(1, ssP), 0, T0), 0, hecho({ compilacion: [ERRORES[2]] }))
  check(
    'lote: hecho con avisos -> ok con `avisos` y la ✓ ámbar en su marca',
    lOk.sentencias[0].estado === 'ok' && lOk.sentencias[0].avisos === 1 && marcaDe(lOk.sentencias[0], T0).claseGlifo === 'db-glifo-avisos',
    j({ estado: lOk.sentencias[0].estado, avisos: lOk.sentencias[0].avisos, detalle: lOk.sentencias[0].detalle })
  )
  const lMal = registrar(iniciar(crearLote(1, ssP), 0, T0), 0, invalida(ERRORES))
  check(
    'lote: unidad inválida -> ✗ con el resumen en el tooltip y el código detrás',
    lMal.sentencias[0].estado === 'error' &&
      lMal.sentencias[0].detalle === '[ORA-24344] PROCEDURE HR.P creado con 3 errores de compilación y 1 aviso' &&
      marcaDe(lMal.sentencias[0], T0).despues === 'ORA-24344' &&
      lMal.sentencias[0].avisos === 0,
    j(lMal.sentencias[0].detalle)
  )

  hr('(6) el reducer')
  const eMal = unaSentencia('oracle', CREATE_P, invalida(ERRORES, [{ texto: 'antes del fallo' }]))
  const lm = lineas(eMal)
  check(
    '✗: eco, resumen (con enlace al primer error situado), la lista anidada y la salida del servidor, en ese orden',
    lm.length === 7 &&
      lm[0].startsWith('eco:HR> create or replace procedure hr.p') &&
      lm[1] === 'error:[ORA-24344] PROCEDURE HR.P creado con 3 errores de compilación y 1 aviso · ir a la posición' &&
      lm[2] === "error>:línea 3, columna 5: PLS-00201: identifier 'X' must be declared · ir a la posición" &&
      lm[4] === 'aviso>:línea 1, columna 1: PLW-05018: unit P omitted optional AUTHID clause · ir a la posición' &&
      lm[5] === 'error>:línea 9, columna 2: PLS-00103: Encountered the symbol "END" · ir a la sentencia 1' &&
      lm[6] === 'servidor>:antes del fallo',
    j(lm)
  )
  const irResumen = eMal.salida.entradas[1].ir
  check('el enlace del resumen es exacto (la sentencia no guarda posición)', irResumen?.exacta === true && irResumen.desplazamiento === 40, j(irResumen))
  check('un ✗ activa Salida', eMal.resultados.activa === ID_SALIDA, eMal.resultados.activa)

  const eAvisos = unaSentencia('oracle', CREATE_P, hecho({ compilacion: [ERRORES[2]], avisos: ['aviso del main'] }))
  check(
    '✓ ámbar: «completado … con 1 aviso», el aviso anidado y DESPUÉS los avisos del main',
    j(lineas(eAvisos).slice(1)) ===
      j([
        'completado:completado en 45 ms, con 1 aviso de compilación',
        'aviso>:línea 1, columna 1: PLW-05018: unit P omitted optional AUTHID clause · ir a la posición',
        'aviso:aviso del main'
      ]),
    j(lineas(eAvisos))
  )

  const eNotice = unaSentencia(
    'postgres',
    "DO $$ BEGIN RAISE NOTICE 'hola'; RAISE WARNING 'ojo'; END $$",
    hecho({ salida: [{ texto: 'hola' }, { texto: 'ojo', aviso: true }] })
  )
  check(
    'PG: el NOTICE y el WARNING van bajo el «completado» de SU sentencia, anidados',
    j(lineas(eNotice).slice(1)) === j(['completado:completado en 45 ms', 'servidor>:hola', 'servidorAviso>:ojo']),
    j(lineas(eNotice))
  )

  const eCancel = unaSentencia('postgres', "DO $$ BEGIN RAISE NOTICE 'uno'; PERFORM pg_sleep(30); END $$", {
    tipo: 'error',
    error: { motivo: 'cancelada', mensaje: 'canceling statement due to user request', codigo: '57014' },
    tiempos: tiempos(3120),
    salida: [{ texto: 'uno' }]
  })
  check(
    'cancelada: «Cancelada tras X» y lo que el servidor ya había dicho',
    j(lineas(eCancel).slice(1)) === j(['aviso:Cancelada tras 3 s 120 ms', 'servidor>:uno']),
    j(lineas(eCancel))
  )

  const eSin = unaSentencia('postgres', 'create table t (a int)', hecho())
  check(
    'NO: sin `salida` ni `compilacion`, la Salida de la primera entrega (eco + completado)',
    j(lineas(eSin).slice(1)) === j(['completado:completado en 45 ms']) && eSin.salida.entradas.every((x) => !x.anidada),
    j(lineas(eSin))
  )
  const eSinLista = unaSentencia('oracle', CREATE_P, invalida())
  check(
    'NO: un ORA-24344 sin lista conserva el mensaje del main y enlaza a la sentencia',
    lineas(eSinLista)[1] === 'error:[ORA-24344] Creado con errores de compilación: ORA-24344: success with compilation error · ir a la sentencia 1',
    lineas(eSinLista)[1]
  )

  hr('(7) autodesplazamiento: limpiar la salida lo reengancha')
  {
    // El usuario sube a leer: la lista deja de seguir el final.
    let pegado = pegadoAlFondo({ scrollTop: 0, clientHeight: 100, scrollHeight: 500 })
    check('(7a) subir a leer despega', !pegado, String(pegado))
    pegado = sigueAlFondo(pegado, 12)
    check('(7b) llegan más entradas: sigue despegada (no le roba la lectura)', !pegado, String(pegado))
    pegado = sigueAlFondo(pegado, 0)
    check('(7c) limpiar la salida lo reengancha', pegado, String(pegado))
    pegado = sigueAlFondo(pegado, 1)
    check('(7d) la salida nueva se sigue hasta el final', pegado, String(pegado))
    check(
      '(7e) a 8 px del fondo cuenta como pegada; a 9, no',
      pegadoAlFondo({ scrollTop: 392, clientHeight: 100, scrollHeight: 500 }) &&
        !pegadoAlFondo({ scrollTop: 391, clientHeight: 100, scrollHeight: 500 }),
      'holgura 8'
    )
  }

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
