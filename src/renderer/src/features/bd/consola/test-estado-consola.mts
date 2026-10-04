#!/usr/bin/env node
// =============================================================================
// Prueba de la lógica pura de la consola SQL (npm run test:db-consola-estado): duraciones,
// marcas, textos de la Salida, el reducer (pestañas, errores, cancelación, prevuelo,
// cliente, transacción, páginas y lectores, respuestas viejas, conjuntos extra) y la barra
// de tx. Las sentencias salen del divisor REAL, así que también fija lo que el divisor
// clasifica (tabla única, clase, peligro).
// =============================================================================

import type {
  DbConjuntoSiguiente,
  DbEstadoSesion,
  DbResultadoError,
  DbResultadoFilas,
  DbResultadoSentencia,
  DbTiempos
} from '../../../../../shared/db-explorador-ipc.ts'
import { dividirSentencias, type Sentencia } from '../../../../../shared/sql/divisorSql.ts'
import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import { ID_SALIDA } from '../resultados/pestanasResultado.ts'
import { SEPARADOR_MILES } from '../rejilla/celdasRejilla.ts'
import { descriptorMarca, formatoDuracion, HOVER_CLIENTE, HOVER_OMITIDA } from './marcasConsola.ts'
import {
  crearLote,
  detener,
  enCurso,
  filasDePagina,
  finalizado,
  iniciar,
  marcaDe,
  marcarLocal,
  registrar,
  restantes,
  resumenLote,
  siguiente,
  type Lote
} from './lote.ts'
import {
  ETIQUETA_FORZAR,
  MAX_ECO,
  MAX_ENTRADAS_SALIDA,
  TEXTO_CLIENTE,
  TEXTO_SESION_PERDIDA,
  TEXTO_SIN_RESPUESTA_STOP,
  agregarSalida,
  cantidad,
  etiquetaPosicion,
  etiquetaRestantes,
  horaDe,
  limpiarSalida,
  salidaVacia,
  textoAfectadas,
  textoAvisoSesion,
  textoCancelada,
  textoCompletado,
  textoEco,
  textoEntrada,
  textoError,
  textoFilas,
  textoLoteDetenido,
  textoNadaEjecutado,
  textoTx
} from './salidaConsola.ts'
import {
  MOTIVO_LIBERADA,
  PISTA_SIN_SENTENCIA,
  TITULO_SOLO_LECTURA,
  TITULO_TX_ARCHIVO,
  ejecutando,
  estadoBarraTx,
  estadoInicialConsola,
  indicadoresConsola,
  nuevoLoteId,
  pasoAAutoRequiereResolver,
  peligros,
  prevueloLote,
  reducirConsola,
  resultadoDeRespuesta,
  usuarioEligioPestana,
  type AccionConsola,
  type EstadoConsola
} from './estadoConsola.ts'

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
const T0 = new Date(2026, 8, 25, 9, 5, 7).getTime()

function tiempos(total: number, ejecucion = total, lectura = 0): DbTiempos {
  return { totalMs: total, ejecucionMs: ejecucion, lecturaMs: lectura }
}

function filas(
  n: number,
  opciones: { hayMas?: boolean; lector?: string | null; total?: number; afectadas?: number; desde?: number } = {}
): DbResultadoFilas {
  const rows: (string | null)[][] = []
  for (let i = 0; i < n; i++) rows.push([String((opciones.desde ?? 0) + i + 1), i % 2 === 0 ? 'a' : null])
  const r: DbResultadoFilas = {
    tipo: 'filas',
    columnas: [
      { nombre: 'ID', tipoLogico: 'numero', tipoMotor: 'int4' },
      { nombre: 'NOMBRE', tipoLogico: 'texto', tipoMotor: 'text' }
    ],
    pagina: { filasJson: JSON.stringify(rows), desde: opciones.desde ?? 0, hayMas: opciones.hayMas === true },
    lector: opciones.lector ?? null,
    tiempos: tiempos(opciones.total ?? 671, 600, 71)
  }
  if (opciones.afectadas !== undefined) r.afectadas = opciones.afectadas
  return r
}

function errorServidor(codigo: string, mensaje: string, posicion?: number): DbResultadoError {
  const r: DbResultadoError = { tipo: 'error', error: { motivo: 'servidor', codigo, mensaje }, tiempos: tiempos(15) }
  if (posicion !== undefined) r.error.posicion = posicion
  return r
}

function cancelada(ms: number): DbResultadoError {
  return { tipo: 'error', error: { motivo: 'cancelada', mensaje: 'canceling statement due to user request', codigo: '57014' }, tiempos: tiempos(ms) }
}

function sesion(p: Partial<DbEstadoSesion> = {}): DbEstadoSesion {
  return {
    ref: { rol: 'consola', perfilId: 'p1', consolaId: 'c1' },
    conexionId: 'x1',
    fase: 'lista',
    txModo: 'auto',
    tx: 'ninguna',
    sentenciasEnTx: 0,
    esquema: 'public',
    soloLectura: false,
    ...p
  }
}

function partir(texto: string, d: DialectoSql): Sentencia[] {
  return dividirSentencias(texto, d)
}

function d(e: EstadoConsola, ...acciones: AccionConsola[]): EstadoConsola {
  let x = e
  for (const a of acciones) x = reducirConsola(x, a)
  return x
}

/**
 * Corre un lote entero como lo haría `useConsola`: pide la siguiente, la inicia y
 * le da la respuesta que devuelve `responder(i)`; las de clase `cliente` van por
 * `sentenciaLocal`. Devuelve el estado final y las posiciones que se "enviaron".
 */
function correrLote(
  e0: EstadoConsola,
  ss: Sentencia[],
  responder: (i: number) => DbResultadoSentencia,
  opciones: { esquema?: string | null; alIniciar?: (e: EstadoConsola, i: number) => EstadoConsola } = {}
): { e: EstadoConsola; enviadas: number[] } {
  const id = nuevoLoteId(e0)
  let e = d(e0, { tipo: 'loteCreado', lote: crearLote(id, ss) })
  const enviadas: number[] = []
  let reloj = T0
  for (let vueltas = 0; vueltas < 100; vueltas++) {
    const i = e.lote ? siguiente(e.lote) : null
    if (i === null) break
    const s = e.lote!.sentencias[i].s
    if (s.clase === 'cliente') {
      e = d(e, { tipo: 'sentenciaLocal', loteId: id, indice: i, estado: 'cliente', motivo: '', ahora: reloj })
      continue
    }
    e = d(e, { tipo: 'sentenciaIniciada', loteId: id, indice: i, ahora: reloj })
    if (opciones.alIniciar) e = opciones.alIniciar(e, i)
    enviadas.push(i)
    reloj += 1000
    e = d(e, {
      tipo: 'sentenciaTerminada',
      loteId: id,
      indice: i,
      resultado: responder(i),
      sentencia: s,
      esquema: opciones.esquema !== undefined ? opciones.esquema : 'public',
      ahora: reloj
    })
  }
  return { e, enviadas }
}

function textos(e: EstadoConsola): string[] {
  return e.salida.entradas.map((x) => textoEntrada(x))
}

function estados(l: Lote | null): string {
  return l ? l.sentencias.map((x) => x.estado).join(',') : 'null'
}

function main(): void {
  // ---------------------------------------------------------------------------
  hr('(1) formatoDuracion')
  // ---------------------------------------------------------------------------
  const casosDur: Array<[number, boolean, string]> = [
    [671, false, '671 ms'],
    [2270, false, '2 s 270 ms'],
    [2000, false, '2 s'],
    [63270, false, '1 min 3 s'],
    [60000, false, '1 min'],
    [3_900_000, false, '1 h 5 min'],
    [0, false, '0 ms'],
    [-5, false, '0 ms'],
    [Number.NaN, false, '0 ms'],
    [999.6, false, '1 s'],
    [12.4, false, '12 ms'],
    [800, true, ''],
    [3400, true, '3 s'],
    [63999, true, '1 min 3 s'],
    [59999, true, '59 s']
  ]
  for (const [ms, vivo, esperado] of casosDur) {
    const r = formatoDuracion(ms, vivo)
    check(`formatoDuracion(${ms}${vivo ? ', vivo' : ''}) = '${esperado}'`, r === esperado, `'${r}'`)
  }

  // ---------------------------------------------------------------------------
  hr('(2) descriptorMarca')
  // ---------------------------------------------------------------------------
  {
    const ok = descriptorMarca('ok', 671, '40 filas')
    check(
      'ok: glifo, barra, tiempo detrás y tooltip',
      ok.claseGlifo === 'db-glifo-ok' && ok.claseBarra === 'db-barra-ok' && ok.despues === '671 ms' && ok.hover === '40 filas · 671 ms',
      JSON.stringify(ok)
    )
    const err = descriptorMarca('error', 15, '[ORA-00942] table or view does not exist', 'ORA-00942')
    check(
      'error: el código va detrás, el tiempo en el tooltip',
      err.claseGlifo === 'db-glifo-error' && err.claseBarra === 'db-barra-error' && err.despues === 'ORA-00942' &&
        err.hover === '[ORA-00942] table or view does not exist · 15 ms',
      JSON.stringify(err)
    )
    const errSinCodigo = descriptorMarca('error', 15, 'fallo')
    check('error sin código: el tiempo va detrás', errSinCodigo.despues === '15 ms', String(errSinCodigo.despues))
    const can = descriptorMarca('cancelada', 3120)
    check(
      'cancelada: ⊘ con «Cancelada tras X» y barra (sí llegó al servidor)',
      can.claseGlifo === 'db-glifo-cancelada' && can.hover === 'Cancelada tras 3 s 120 ms' && can.claseBarra === 'db-barra-cancelada',
      JSON.stringify(can)
    )
    const om = descriptorMarca('omitida', null)
    check(
      'omitida: sin barra ni tiempo',
      om.claseBarra === null && om.despues === null && om.hover === HOVER_OMITIDA && om.claseGlifo === 'db-glifo-omitida',
      JSON.stringify(om)
    )
    const cli = descriptorMarca('cliente', null)
    check('cliente: sin barra ni tiempo', cli.claseBarra === null && cli.despues === null && cli.hover === HOVER_CLIENTE, JSON.stringify(cli))
    const pend = descriptorMarca('pendiente', null)
    check('pendiente: sin barra', pend.claseBarra === null && pend.claseGlifo === 'db-glifo-pendiente', JSON.stringify(pend))
    const vivo1 = descriptorMarca('corriendo', 500)
    const vivo2 = descriptorMarca('corriendo', 3400)
    check(
      'corriendo: sin cronómetro el primer segundo, luego segundos enteros',
      vivo1.despues === null && vivo2.despues === '3 s' && vivo2.hover === 'Ejecutando · 3 s' && vivo1.claseBarra === 'db-barra-corriendo',
      `${JSON.stringify(vivo1)} / ${JSON.stringify(vivo2)}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(3) textos EXACTOS de la Salida')
  // ---------------------------------------------------------------------------
  {
    const t = tiempos(671, 600, 71)
    const casos: Array<[string, string, string]> = [
      ['1 fila (singular)', textoFilas(1, false, t), '1 fila en 671 ms (ejecución 600 ms, lectura 71 ms)'],
      ['40 filas', textoFilas(40, false, t), '40 filas en 671 ms (ejecución 600 ms, lectura 71 ms)'],
      ['0 filas', textoFilas(0, false, t), '0 filas en 671 ms (ejecución 600 ms, lectura 71 ms)'],
      ['500 filas (hay más)', textoFilas(500, true, t), '500 filas (hay más) en 671 ms (ejecución 600 ms, lectura 71 ms)'],
      [
        'miles con espacio duro, como la rejilla',
        textoFilas(12345, false, tiempos(2270, 2000, 270)),
        `12${SEPARADOR_MILES}345 filas en 2 s 270 ms (ejecución 2 s, lectura 270 ms)`
      ],
      ['1 fila afectada', textoAfectadas(1, 12), '1 fila afectada en 12 ms'],
      ['3 filas afectadas', textoAfectadas(3, 12), '3 filas afectadas en 12 ms'],
      ['RETURNING: ; N devueltas', textoAfectadas(3, 12, 3), '3 filas afectadas en 12 ms; 3 devueltas'],
      ['RETURNING: 1 devuelta', textoAfectadas(1, 12, 1), '1 fila afectada en 12 ms; 1 devuelta'],
      ['DDL: completado en X', textoCompletado(12), 'completado en 12 ms'],
      [
        'error Oracle: el código no se repite',
        textoError({ codigo: 'ORA-00933', mensaje: 'ORA-00933: SQL command not properly ended' }),
        '[ORA-00933] SQL command not properly ended'
      ],
      ['error PG', textoError({ codigo: '42601', mensaje: 'syntax error at or near "select"' }), '[42601] syntax error at or near "select"'],
      ['error sin código', textoError({ mensaje: 'Connection terminated' }), 'Connection terminated'],
      [
        'error con «ir a la posición»',
        textoEntrada({
          texto: textoError({ codigo: 'ORA-00933', mensaje: 'SQL command not properly ended' }),
          ir: { loteId: 1, sentencia: 0, desplazamiento: 5, etiqueta: etiquetaPosicion({ linea: 3, columna: 15 }) }
        }),
        '[ORA-00933] SQL command not properly ended · ir a la posición (línea 3, columna 15)'
      ],
      ['lote detenido', textoLoteDetenido(2, 5), 'Lote detenido: 2 de 5'],
      ['restantes (plural)', etiquetaRestantes(3), 'Ejecutar las 3 restantes'],
      ['restantes (singular)', etiquetaRestantes(1), 'Ejecutar la restante'],
      ['cancelada', textoCancelada(3120), 'Cancelada tras 3 s 120 ms'],
      ['sesión perdida', TEXTO_SESION_PERDIDA, 'Sesión perdida; el servidor revirtió la transacción'],
      ['commit', textoTx('commit', 12), 'Confirmado (Commit) en 12 ms'],
      ['rollback', textoTx('rollback', 8), 'Revertido (Rollback) en 8 ms'],
      ['eco una línea', textoEco('ADMDEMO', 'select * from ES_CONFIG'), 'ADMDEMO> select * from ES_CONFIG'],
      ['eco varias líneas', textoEco('ADMDEMO', 'select *\n  from ES_CONFIG\n where 1 = 1'), 'ADMDEMO> select * …'],
      ['eco CRLF', textoEco('public', 'select 1   \r\nfrom t'), 'public> select 1 …'],
      ['eco sin esquema', textoEco(null, 'select 1'), '> select 1'],
      [
        'prevuelo (una de varias)',
        textoNadaEjecutado([3], 5),
        'No se ejecutó nada: la sentencia 3 escribe y la conexión es de solo lectura'
      ],
      [
        'prevuelo (varias)',
        textoNadaEjecutado([2, 3, 5], 5),
        'No se ejecutó nada: las sentencias 2, 3 y 5 escriben y la conexión es de solo lectura'
      ],
      ['prevuelo (lote de una)', textoNadaEjecutado([1], 1), 'No se ejecutó nada: la sentencia escribe y la conexión es de solo lectura'],
      [
        'aviso de sesión con tx perdida',
        textoAvisoSesion({ tipo: 'caida', txPerdida: true, mensaje: 'el proceso se cerró' }),
        TEXTO_SESION_PERDIDA
      ],
      ['aviso de sesión sin tx: el del main', textoAvisoSesion({ tipo: 'inactividad', txPerdida: false, mensaje: 'Cerrada por inactividad' }), 'Cerrada por inactividad'],
      ['cantidad singular', cantidad(1, 'fila', 'filas'), '1 fila'],
      ['cantidad plural', cantidad(2, 'fila', 'filas'), '2 filas']
    ]
    for (const [nombre, real, esperado] of casos) check(`texto: ${nombre}`, real === esperado, `'${real}'`)

    const largo = textoEco('ESQ', 'select ' + 'x, '.repeat(80) + 'y from t')
    check(`eco largo recortado a ${MAX_ECO} con «…»`, largo.length === MAX_ECO && largo.endsWith('…'), `${largo.length} '${largo.slice(-5)}'`)
    check('hora hh:mm:ss local', horaDe(T0) === '09:05:07', horaDe(T0))

    let s = salidaVacia()
    const lote = []
    for (let i = 0; i < 1005; i++) lote.push({ tipo: 'info' as const, texto: `l${i}` })
    s = agregarSalida(s, lote, T0)
    check(
      `anillo de ${MAX_ENTRADAS_SALIDA}: se quedan las últimas y los ids no se reutilizan`,
      s.entradas.length === MAX_ENTRADAS_SALIDA && s.entradas[0].id === 6 && s.entradas[0].texto === 'l5' && s.siguienteId === 1006,
      `len=${s.entradas.length} primero=${s.entradas[0].id}/${s.entradas[0].texto} siguiente=${s.siguienteId}`
    )
    const limpia = limpiarSalida(s)
    check('limpiar: vacía y el contador sigue', limpia.entradas.length === 0 && limpia.siguienteId === 1006, `sig=${limpia.siguienteId}`)
    const s2 = agregarSalida(limpia, [{ tipo: 'info', texto: 'x' }], T0)
    check('tras limpiar, el id sigue contando', s2.entradas[0].id === 1006 && s2.entradas[0].hora === '09:05:07', JSON.stringify(s2.entradas[0]))
    check('agregar nada devuelve la misma salida', agregarSalida(s2, [], T0) === s2, 'identidad')
    check(
      'forzar: texto y etiqueta',
      textoEntrada({ texto: TEXTO_SIN_RESPUESTA_STOP, accion: { tipo: 'forzar', etiqueta: ETIQUETA_FORZAR } }) ===
        'El servidor no responde a la cancelación · Forzar (cierra la conexión y revierte sus transacciones)',
      ETIQUETA_FORZAR
    )
  }

  // ---------------------------------------------------------------------------
  hr('(4) 3 SELECT -> 3 pestañas y ✓×3; el siguiente lote sustituye las no fijadas')
  // ---------------------------------------------------------------------------
  const texto3 = 'select * from t1;\nselect * from t2;\nselect * from t3'
  const ss3 = partir(texto3, 'postgres')
  check('el divisor da 3 sentencias (la última sin ;)', ss3.length === 3, ss3.map((s) => s.texto).join(' | '))
  const e0 = estadoInicialConsola('postgres', sesion())
  const r4 = correrLote(e0, ss3, (i) => filas(i + 1, i === 1 ? { hayMas: true, lector: 'L2' } : {}))
  let e4 = r4.e
  check('se enviaron las 3, en orden', r4.enviadas.join(',') === '0,1,2', r4.enviadas.join(','))
  check('lote terminado y ✓×3', e4.lote?.estado === 'terminado' && estados(e4.lote) === 'ok,ok,ok', `${e4.lote?.estado} ${estados(e4.lote)}`)
  const glifos = e4.lote!.sentencias.map((x) => marcaDe(x, T0).claseGlifo)
  check('las 3 marcas son db-glifo-ok', glifos.every((g) => g === 'db-glifo-ok'), glifos.join(','))
  const titulos4 = e4.resultados.pestanas.map((p) => p.titulo)
  check('3 pestañas public.t1..t3', titulos4.join(',') === 'public.t1,public.t2,public.t3', titulos4.join(','))
  check(
    'la activa es la última (cada resultado se ve al llegar)',
    e4.resultados.activa === e4.resultados.pestanas[2].id,
    `activa=${e4.resultados.activa}`
  )
  const t4 = textos(e4)
  check(
    'Salida: eco + filas por sentencia',
    t4[0] === 'public> select * from t1' &&
      t4[1] === '1 fila en 671 ms (ejecución 600 ms, lectura 71 ms)' &&
      t4[3] === '2 filas (hay más) en 671 ms (ejecución 600 ms, lectura 71 ms)' &&
      t4[5] === '3 filas en 671 ms (ejecución 600 ms, lectura 71 ms)' &&
      t4.length === 6,
    JSON.stringify(t4)
  )
  const r2 = e4.resultados.resultados[e4.resultados.pestanas[1].id]
  check(
    'el resultado guarda filas parseadas, columnas y lector',
    r2.datos !== null && r2.datos.filas.length === 2 && r2.columnas.length === 2 && r2.lector === 'L2' && r2.sql === 'select * from t2',
    `filas=${r2.datos?.filas.length} lector=${r2.lector}`
  )
  check('la marca del ✓ resume las filas', e4.lote!.sentencias[1].detalle === '2 filas (hay más)', String(e4.lote!.sentencias[1].detalle))
  check('Salida guarda la hora', e4.salida.entradas[0].hora === '09:05:07', e4.salida.entradas[0].hora)

  // Fija t1 y ejecuta otro lote con t1 otra vez.
  const idT1 = e4.resultados.pestanas[0].id
  e4 = d(e4, { tipo: 'pestana', accion: 'fijar', id: idT1 })
  const r4b = correrLote(e4, partir('select * from t1', 'postgres'), () => filas(1))
  const e4b = r4b.e
  check(
    'las no fijadas se sustituyen; la fijada se queda; el repetido lleva (2)',
    e4b.resultados.pestanas.map((p) => `${p.titulo}${p.fijada ? '*' : ''}`).join(',') === 'public.t1*,public.t1 (2)',
    e4b.resultados.pestanas.map((p) => `${p.titulo}${p.fijada ? '*' : ''}`).join(',')
  )
  check('el lector de la sustituida sale a cerrar', e4b.lectoresPorCerrar.join(',') === 'L2', e4b.lectoresPorCerrar.join(','))
  const e4c = d(e4b, { tipo: 'drenarLectores' })
  check('drenarLectores los vacía', e4c.lectoresPorCerrar.length === 0, String(e4c.lectoresPorCerrar.length))
  check('drenar sin nada: mismo estado', d(e4c, { tipo: 'drenarLectores' }) === e4c, 'identidad')

  // ---------------------------------------------------------------------------
  hr('(5) error en la 2.ª: 3.ª omitida, Salida activa, «Lote detenido»')
  // ---------------------------------------------------------------------------
  const ss5 = partir('select * from t1;\nselect * from t9;\nselect * from t3;', 'postgres')
  let e5 = d(estadoInicialConsola('postgres', sesion()), { tipo: 'loteCreado', lote: crearLote(1, ss5) })
  e5 = d(e5, { tipo: 'sentenciaIniciada', loteId: 1, indice: 0, ahora: T0 })
  e5 = d(e5, { tipo: 'sentenciaTerminada', loteId: 1, indice: 0, resultado: filas(1), esquema: 'public', ahora: T0 })
  e5 = d(e5, { tipo: 'sentenciaIniciada', loteId: 1, indice: 1, ahora: T0 })
  e5 = d(e5, {
    tipo: 'sentenciaTerminada',
    loteId: 1,
    indice: 1,
    resultado: errorServidor('42P01', 'relation "t9" does not exist', 14),
    esquema: 'public',
    ahora: T0,
    posicionModelo: { linea: 2, columna: 15 }
  })
  check('estados ok,error,omitida', estados(e5.lote) === 'ok,error,omitida', estados(e5.lote))
  check('lote detenido y no hay siguiente', e5.lote?.estado === 'detenido' && siguiente(e5.lote!) === null, String(e5.lote?.estado))
  check('se activa Salida', e5.resultados.activa === ID_SALIDA, e5.resultados.activa)
  check('la pestaña de la 1.ª sigue ahí', e5.resultados.pestanas.length === 1, String(e5.resultados.pestanas.length))
  const t5 = textos(e5)
  const err5 = e5.salida.entradas.find((x) => x.tipo === 'error')
  check(
    'error con enlace a la posición exacta',
    t5.indexOf('[42P01] relation "t9" does not exist · ir a la posición (línea 2, columna 15)') >= 0 &&
      err5?.ir?.desplazamiento === 14 &&
      err5?.ir?.sentencia === 1 &&
      err5?.ir?.loteId === 1,
    JSON.stringify(err5)
  )
  const ult5 = e5.salida.entradas[e5.salida.entradas.length - 1]
  check(
    '«Lote detenido: 1 de 3 · Ejecutar la restante» (desde la 3.ª)',
    textoEntrada(ult5) === 'Lote detenido: 1 de 3 · Ejecutar la restante' &&
      ult5.accion?.tipo === 'ejecutarRestantes' &&
      ult5.accion.desde === 2,
    textoEntrada(ult5)
  )
  check('la marca del ✗ lleva el código detrás', marcaDe(e5.lote!.sentencias[1], T0).despues === '42P01', String(marcaDe(e5.lote!.sentencias[1], T0).despues))
  check('la omitida no tiene barra', marcaDe(e5.lote!.sentencias[2], T0).claseBarra === null, 'null')
  check('restantes() = [2]', restantes(e5.lote!).join(',') === '2', restantes(e5.lote!).join(','))
  check('indicador de error en la pestaña', indicadoresConsola(e5).has('error') && !indicadoresConsola(e5).has('ejecutando'), [...indicadoresConsola(e5)].join(','))
  {
    const sinPos = d(
      d(estadoInicialConsola('oracle', sesion({ esquema: 'ADMDEMO' })), { tipo: 'loteCreado', lote: crearLote(1, partir('select 1 from dual', 'oracle')) }),
      { tipo: 'sentenciaTerminada', loteId: 1, indice: 0, resultado: errorServidor('ORA-01017', 'ORA-01017: invalid username/password'), esquema: 'ADMDEMO', ahora: T0 }
    )
    const tt = textos(sinPos)
    check(
      'error sin posición: enlace a la sentencia y sin «Lote detenido» en un lote de una',
      tt.length === 1 && tt[0] === '[ORA-01017] invalid username/password · ir a la sentencia 1',
      JSON.stringify(tt)
    )
    const conPosSinModelo = d(
      d(estadoInicialConsola('postgres', sesion()), { tipo: 'loteCreado', lote: crearLote(1, partir('selec 1', 'postgres')) }),
      { tipo: 'sentenciaTerminada', loteId: 1, indice: 0, resultado: errorServidor('42601', 'syntax error at or near "selec"', 0), esquema: 'public', ahora: T0 }
    )
    check(
      'con posición pero sin línea/columna: «ir a la posición» a secas',
      textos(conPosSinModelo)[0] === '[42601] syntax error at or near "selec" · ir a la posición',
      textos(conPosSinModelo)[0]
    )
  }

  // ---------------------------------------------------------------------------
  hr('(6) cancelación -> ⊘')
  // ---------------------------------------------------------------------------
  {
    const ss = partir('select pg_sleep(30);\nselect 1;', 'postgres')
    let e = d(estadoInicialConsola('postgres', sesion()), { tipo: 'loteCreado', lote: crearLote(1, ss) })
    e = d(e, { tipo: 'sentenciaIniciada', loteId: 1, indice: 0, ahora: T0 })
    check('ejecutando mientras corre', ejecutando(e) && indicadoresConsola(e).has('ejecutando'), String(ejecutando(e)))
    const vivo = marcaDe(e.lote!.sentencias[0], T0 + 3400)
    check('cronómetro vivo de la que corre', vivo.despues === '3 s' && vivo.claseGlifo === 'db-glifo-corriendo', JSON.stringify(vivo))
    e = d(e, { tipo: 'detener', loteId: 1, ahora: T0 + 3500 })
    check(
      'Stop: la de detrás pasa a omitida, la que corre sigue y aún no hay «Lote detenido»',
      estados(e.lote) === 'corriendo,omitida' && e.lote?.estado === 'cancelado' && textos(e).every((t) => t.indexOf('Lote detenido') < 0),
      `${estados(e.lote)} ${e.lote?.estado}`
    )
    check('tras Stop no se manda la siguiente', siguiente(e.lote!) === null, 'null')
    e = d(e, { tipo: 'sentenciaTerminada', loteId: 1, indice: 0, resultado: cancelada(3120), esquema: 'public', ahora: T0 + 3600 })
    check('la cancelada queda ⊘', e.lote!.sentencias[0].estado === 'cancelada' && marcaDe(e.lote!.sentencias[0], T0).claseGlifo === 'db-glifo-cancelada', estados(e.lote))
    const tt = textos(e)
    check(
      'Salida: «Cancelada tras 3 s 120 ms» y «Lote detenido: 0 de 2 · Ejecutar la restante»',
      tt.indexOf('Cancelada tras 3 s 120 ms') >= 0 && tt[tt.length - 1] === 'Lote detenido: 0 de 2 · Ejecutar la restante',
      JSON.stringify(tt)
    )
    check('ya no ejecuta', !ejecutando(e) && finalizado(e.lote!), String(ejecutando(e)))
    check('un lote cancelado sin resultados muestra la Salida', e.resultados.activa === ID_SALIDA, e.resultados.activa)

    // Cancelación directa (sin Stop previo): el lote queda cancelado y el resto omitido.
    let l = crearLote(7, ss)
    l = iniciar(l, 0, T0)
    l = registrar(l, 0, cancelada(10))
    check('registrar una cancelación: cancelado + resto omitido', l.estado === 'cancelado' && estados(l) === 'cancelada,omitida', `${l.estado} ${estados(l)}`)

    // Respuesta tardía ok después de Stop: se da por buena.
    let e2 = d(estadoInicialConsola('postgres', sesion()), { tipo: 'loteCreado', lote: crearLote(1, ss) })
    e2 = d(e2, { tipo: 'sentenciaIniciada', loteId: 1, indice: 0, ahora: T0 })
    e2 = d(e2, { tipo: 'detener', loteId: 1, ahora: T0 })
    e2 = d(e2, { tipo: 'sentenciaTerminada', loteId: 1, indice: 0, resultado: filas(1), esquema: 'public', ahora: T0 })
    check(
      'ok tardío tras Stop: ✓, pestaña creada y el lote sigue cancelado',
      estados(e2.lote) === 'ok,omitida' && e2.lote?.estado === 'cancelado' && e2.resultados.pestanas.length === 1,
      `${estados(e2.lote)} ${e2.lote?.estado} pestañas=${e2.resultados.pestanas.length}`
    )
    // Stop entre sentencias (no corre ninguna): el lote termina en el acto.
    let e3 = d(estadoInicialConsola('postgres', sesion()), { tipo: 'loteCreado', lote: crearLote(1, partir('select 1;select 2;select 3', 'postgres')) })
    e3 = d(e3, { tipo: 'sentenciaIniciada', loteId: 1, indice: 0, ahora: T0 })
    e3 = d(e3, { tipo: 'sentenciaTerminada', loteId: 1, indice: 0, resultado: filas(1), esquema: 'public', ahora: T0 })
    e3 = d(e3, { tipo: 'detener', loteId: 1, ahora: T0 })
    check(
      'Stop entre sentencias: «Lote detenido: 1 de 3 · Ejecutar las 2 restantes»',
      textos(e3)[textos(e3).length - 1] === 'Lote detenido: 1 de 3 · Ejecutar las 2 restantes' && !ejecutando(e3),
      textos(e3)[textos(e3).length - 1]
    )
    const terminadoYa = crearLote(1, [])
    check('detener un lote ya terminado no cambia nada', detener(terminadoYa) === terminadoYa && detener(e3.lote!) === e3.lote, 'identidad')
  }

  // ---------------------------------------------------------------------------
  hr('(7) prevuelo de solo lectura (todo o nada) y peligros')
  // ---------------------------------------------------------------------------
  {
    const ss = partir('select 1 from dual;\nupdate t set a = 1 where id = 2;\ndelete from t', 'oracle')
    const p = prevueloLote(ss, true, 'oracle')
    check(
      'RO: bloquea el UPDATE y el DELETE (posiciones 1 y 2)',
      !p.ok && p.bloqueadas.map((b) => b.indice).join(',') === '1,2' && p.bloqueadas[0].motivo.indexOf('solo lectura') >= 0,
      JSON.stringify(p)
    )
    check('sin solo lectura: todo pasa', prevueloLote(ss, false, 'oracle').ok, 'ok')
    check('RO con solo consultas: pasa', prevueloLote(partir('select 1 from dual;\nselect 2 from dual', 'oracle'), true, 'oracle').ok, 'ok')
    check(
      'RO: un comando del cliente no bloquea el lote',
      prevueloLote(partir('SET SERVEROUTPUT ON\nselect 1 from dual', 'oracle'), true, 'oracle').ok,
      'ok'
    )
    check(
      'RO en PG: SET search_path pasa, SET datestyle no',
      prevueloLote(partir('set search_path to ventas;\nselect 1', 'postgres'), true, 'postgres').ok &&
        !prevueloLote(partir("set datestyle = 'SQL, DMY'", 'postgres'), true, 'postgres').ok,
      'ok'
    )

    const id = 1
    let e = d(estadoInicialConsola('oracle', sesion({ soloLectura: true, esquema: 'ADMDEMO' })), { tipo: 'loteCreado', lote: crearLote(id, ss) })
    if (!p.ok) e = d(e, { tipo: 'prevueloRechazado', loteId: id, bloqueadas: p.bloqueadas, ahora: T0 })
    check('nada que enviar: siguiente() = null', siguiente(e.lote!) === null, String(siguiente(e.lote!)))
    check(
      'marcas: omitida, ✗, ✗ y lote detenido',
      estados(e.lote) === 'omitida,error,error' && e.lote?.estado === 'detenido',
      `${estados(e.lote)} ${e.lote?.estado}`
    )
    const tt = textos(e)
    check(
      'Salida: resumen + un enlace por bloqueada, sin eco (no se envió nada)',
      tt[0] === 'No se ejecutó nada: las sentencias 2 y 3 escriben y la conexión es de solo lectura' &&
        tt.length === 3 &&
        tt[1].indexOf('ir a la sentencia 2') > 0 &&
        e.salida.entradas.every((x) => x.tipo !== 'eco'),
      JSON.stringify(tt)
    )
    check('se activa Salida', e.resultados.activa === ID_SALIDA, e.resultados.activa)
    check('el tooltip del ✗ es el motivo', (e.lote!.sentencias[1].detalle ?? '').indexOf('solo lectura') >= 0, String(e.lote!.sentencias[1].detalle))

    const pel = peligros(partir('delete from t;\nupdate t set a = 1 where id = 2;\nupdate t set a = 2;\ntruncate table t', 'postgres'))
    check(
      'peligros: los DML sin WHERE (por defecto, sin TRUNCATE)',
      pel.map((x) => `${x.indice}:${x.tipo}`).join(',') === '0:dmlSinWhere,2:dmlSinWhere',
      pel.map((x) => `${x.indice}:${x.tipo}`).join(',')
    )
    check(
      'peligros: motivo y extracto',
      pel[0].motivo === 'DELETE sin WHERE: afecta a todas las filas de la tabla' && pel[0].extracto === 'delete from t',
      `${pel[0].motivo} | ${pel[0].extracto}`
    )
    const pel2 = peligros(partir('truncate table t', 'postgres'), ['dmlSinWhere', 'truncate'])
    check('peligros: TRUNCATE si se pide', pel2.length === 1 && pel2[0].tipo === 'truncate', JSON.stringify(pel2))
    check('sin peligros: lista vacía', peligros(partir('select 1', 'postgres')).length === 0, '[]')
  }

  // ---------------------------------------------------------------------------
  hr('(8) comandos del cliente: ⊘ y el lote sigue')
  // ---------------------------------------------------------------------------
  {
    const ss = partir('SET SERVEROUTPUT ON\nselect 1 from dual', 'oracle')
    check('el divisor ve un comando del cliente y una consulta', ss.length === 2 && ss[0].clase === 'cliente', ss.map((s) => s.clase).join(','))
    const r = correrLote(estadoInicialConsola('oracle', sesion({ esquema: 'ADMDEMO' })), ss, () => filas(1), { esquema: 'ADMDEMO' })
    check('solo se envía la consulta', r.enviadas.join(',') === '1', r.enviadas.join(','))
    check('estados cliente,ok y lote terminado', estados(r.e.lote) === 'cliente,ok' && r.e.lote?.estado === 'terminado', `${estados(r.e.lote)} ${r.e.lote?.estado}`)
    check('la marca del cliente es ⊘ sin barra', marcaDe(r.e.lote!.sentencias[0], T0).claseGlifo === 'db-glifo-cliente', 'ok')
    const tt = textos(r.e)
    check('Salida: eco + «no se envía»', tt[0] === 'ADMDEMO> SET SERVEROUTPUT ON' && tt[1] === TEXTO_CLIENTE, JSON.stringify(tt.slice(0, 2)))
    check('con DUAL no hay tabla única: «Resultado 2» (su posición en el lote)',r.e.resultados.pestanas[0]?.titulo === 'Resultado 2', String(r.e.resultados.pestanas[0]?.titulo))
    const l = marcarLocal(crearLote(1, ss), 1, 'cliente', 'x')
    check('marcarLocal cliente solo desde pendiente', l.sentencias[1].estado === 'cliente' && marcarLocal(l, 1, 'cliente', 'y') === l, estados(l))
  }

  // ---------------------------------------------------------------------------
  hr('(9) transacción: barra, Commit/Rollback, avisos de sesión, DDL de Oracle')
  // ---------------------------------------------------------------------------
  {
    const pend = estadoBarraTx(sesion({ txModo: 'manual', tx: 'pendiente', sentenciasEnTx: 3 }))
    check(
      'Manual + pendiente(3): «Tx pendiente (3)», Commit y Rollback habilitados, ⇄ pulsado',
      pend.textoTx === 'Tx pendiente (3)' && pend.puedeCommit && pend.puedeRollback && pend.modoPulsado && pend.textoModo === 'Tx: Manual' &&
        pend.tituloCommit === 'Confirmar (Commit)' && pend.tituloRollback === 'Revertir (Rollback)',
      JSON.stringify(pend)
    )
    const nada = estadoBarraTx(sesion())
    check(
      'Auto sin tx: sin contador, ✓ y ↶ deshabilitados con title',
      nada.textoTx === null && !nada.puedeCommit && !nada.puedeRollback && nada.tituloCommit === 'No hay transacción que confirmar' &&
        nada.tituloModo === 'Transacción: Auto. Pulsa para Manual' && !nada.modoPulsado && nada.puedeCambiarModo,
      JSON.stringify(nada)
    )
    const abierta = estadoBarraTx(sesion({ tx: 'abierta' }))
    check('Auto con BEGIN del usuario (PG, abierta): se puede resolver desde la UI', abierta.puedeCommit && abierta.puedeRollback && abierta.textoTx === 'Tx abierta', JSON.stringify(abierta))
    const fallida = estadoBarraTx(sesion({ txModo: 'manual', tx: 'fallida', sentenciasEnTx: 1 }))
    check(
      'fallida: solo Rollback',
      !fallida.puedeCommit && fallida.puedeRollback && fallida.textoTx === 'Tx fallida: haz Rollback' &&
        fallida.tituloCommit === 'La transacción falló: solo se puede revertir',
      JSON.stringify(fallida)
    )
    const ro = estadoBarraTx(sesion({ soloLectura: true }))
    check(
      'solo lectura: todo deshabilitado con «La conexión es de solo lectura»',
      !ro.puedeCommit && !ro.puedeRollback && !ro.puedeCambiarModo && ro.tituloCommit === TITULO_SOLO_LECTURA &&
        ro.tituloModo === TITULO_SOLO_LECTURA && ro.soloLectura,
      JSON.stringify(ro)
    )
    // En una base de archivo, el texto de la tx explica el bloqueo del archivo entero.
    const archPend = estadoBarraTx(sesion({ txModo: 'manual', tx: 'pendiente', sentenciasEnTx: 2 }), { deArchivo: true })
    const archAb = estadoBarraTx(sesion({ tx: 'abierta' }), { deArchivo: true })
    const archNada = estadoBarraTx(sesion(), { deArchivo: true })
    check(
      'base de archivo con tx (pendiente o abierta): el title del texto avisa del bloqueo; sin tx, ni en red, no',
      archPend.tituloTx === TITULO_TX_ARCHIVO && archAb.tituloTx === TITULO_TX_ARCHIVO && archNada.tituloTx === null && pend.tituloTx === null && abierta.tituloTx === null &&
        estadoBarraTx(sesion({ soloLectura: true, tx: 'abierta' }), { deArchivo: true }).tituloTx === null,
      JSON.stringify([archPend.tituloTx, archAb.tituloTx, archNada.tituloTx, pend.tituloTx])
    )
    const sinSesionRo = estadoBarraTx(null, { soloLectura: true })
    check('sin sesión: la solo lectura de la conexión manda; modo Auto', sinSesionRo.soloLectura && sinSesionRo.modo === 'auto', JSON.stringify(sinSesionRo))
    const corriendo = estadoBarraTx(sesion({ txModo: 'manual', tx: 'pendiente', sentenciasEnTx: 1 }), { ejecutando: true })
    check(
      'mientras ejecuta: Commit/Rollback/⇄ esperan',
      !corriendo.puedeCommit && !corriendo.puedeRollback && !corriendo.puedeCambiarModo && corriendo.tituloCommit === 'Espera a que termine la ejecución',
      JSON.stringify(corriendo)
    )
    check(
      'pendiente sin contador: «Tx pendiente» a secas',
      estadoBarraTx(sesion({ txModo: 'manual', tx: 'pendiente', sentenciasEnTx: 0 })).textoTx === 'Tx pendiente',
      'ok'
    )
    check(
      'Manual→Auto pide resolver con pendiente/fallida, no con abierta',
      pasoAAutoRequiereResolver(sesion({ txModo: 'manual', tx: 'pendiente' })) &&
        pasoAAutoRequiereResolver(sesion({ txModo: 'manual', tx: 'fallida' })) &&
        !pasoAAutoRequiereResolver(sesion({ txModo: 'manual', tx: 'abierta' })) &&
        !pasoAAutoRequiereResolver(null),
      'ok'
    )

    // Contador que llega del main y Commit.
    let e = estadoInicialConsola('postgres', sesion())
    e = d(e, { tipo: 'sesion', sesion: sesion({ txModo: 'manual', tx: 'pendiente', sentenciasEnTx: 2 }), ahora: T0 })
    check('el contador sale del main', estadoBarraTx(e.sesion).textoTx === 'Tx pendiente (2)' && indicadoresConsola(e).has('txPendiente'), String(estadoBarraTx(e.sesion).textoTx))
    const r = correrLote(e, partir('update t set a = 1 where id = 1', 'postgres'), () => ({
      tipo: 'afectadas',
      filas: 1,
      comando: 'UPDATE',
      tiempos: tiempos(12)
    }))
    e = r.e
    check('el renderer NO suma por su cuenta (espera al evento)', e.sesion?.sentenciasEnTx === 2, String(e.sesion?.sentenciasEnTx))
    check('UPDATE -> «1 fila afectada en 12 ms»', textos(e).indexOf('1 fila afectada en 12 ms') >= 0, JSON.stringify(textos(e)))
    e = d(e, { tipo: 'sesion', sesion: sesion({ txModo: 'manual', tx: 'pendiente', sentenciasEnTx: 3 }), ahora: T0 })
    check('evento del main: 3', estadoBarraTx(e.sesion).textoTx === 'Tx pendiente (3)', String(estadoBarraTx(e.sesion).textoTx))
    e = d(e, { tipo: 'tx', op: 'commit', respuesta: { ok: true, valor: sesion({ txModo: 'manual' }) }, ms: 12, ahora: T0 })
    check(
      'Commit: «Confirmado (Commit) en 12 ms» y el contador vuelve a 0',
      textos(e)[textos(e).length - 1] === 'Confirmado (Commit) en 12 ms' && estadoBarraTx(e.sesion).textoTx === null && !indicadoresConsola(e).has('txPendiente'),
      textos(e)[textos(e).length - 1]
    )
    e = d(e, { tipo: 'tx', op: 'rollback', respuesta: { ok: true, valor: sesion({ txModo: 'manual' }) }, ms: 8, ahora: T0 })
    check('Rollback: «Revertido (Rollback) en 8 ms»', textos(e)[textos(e).length - 1] === 'Revertido (Rollback) en 8 ms', textos(e)[textos(e).length - 1])
    e = d(e, { tipo: 'tx', op: 'commit', respuesta: { ok: false, error: { motivo: 'ocupada', mensaje: 'La consola está ejecutando' } }, ms: 1, ahora: T0 })
    check('Commit que no llega: error en la Salida', textos(e)[textos(e).length - 1] === 'La consola está ejecutando', textos(e)[textos(e).length - 1])

    // Avisos de sesión, una sola vez.
    const perdida = sesion({ fase: 'perdida', aviso: { tipo: 'perdida', txPerdida: true, mensaje: 'ORA-03113', en: 5000 } })
    let e2 = d(estadoInicialConsola('oracle', sesion()), { tipo: 'sesion', sesion: perdida, ahora: T0 })
    e2 = d(e2, { tipo: 'sesion', sesion: { ...perdida }, ahora: T0 })
    const avisos = textos(e2).filter((t) => t === TEXTO_SESION_PERDIDA)
    check('sesión perdida con tx: el aviso fijo, una sola vez', avisos.length === 1 && textos(e2).length === 1, JSON.stringify(textos(e2)))
    check('indicador de sesión perdida', indicadoresConsola(e2).has('sesionPerdida'), [...indicadoresConsola(e2)].join(','))
    const montada = estadoInicialConsola('oracle', perdida)
    check('un aviso que ya estaba al montar no se repite', d(montada, { tipo: 'sesion', sesion: perdida, ahora: T0 }).salida.entradas.length === 0, 'ok')

    // DDL de Oracle con tx pendiente: el evento (tx ninguna) llega ANTES que la
    // respuesta, y la respuesta trae en `avisos` el commit implícito que detectó el
    // main (maquinaSesion: `pendiente → ninguna` tras un DDL que fue bien), como hace
    // GestorSesiones. Ese es el ÚNICO aviso: el renderer tenía uno propio con las
    // mismas condiciones y el hecho salía dos veces en la Salida.
    const AVISO_COMMIT_IMPLICITO = 'El DDL confirmó de forma implícita los cambios pendientes'
    const confirmaciones = (e: EstadoConsola): string[] => textos(e).filter((t) => /confirm/i.test(t))
    const ddl = partir('create table x (a number)', 'oracle')
    const conPend = estadoInicialConsola('oracle', sesion({ txModo: 'manual', tx: 'pendiente', sentenciasEnTx: 1, esquema: 'ADMDEMO' }))
    const rDdl = correrLote(
      conPend,
      ddl,
      () => ({ tipo: 'hecho', comando: 'CREATE TABLE', tiempos: tiempos(40), avisos: [AVISO_COMMIT_IMPLICITO] }),
      {
        esquema: 'ADMDEMO',
        alIniciar: (x) => d(x, { tipo: 'sesion', sesion: sesion({ txModo: 'manual', esquema: 'ADMDEMO' }), ahora: T0 })
      }
    )
    const tDdl = textos(rDdl.e)
    const cDdl = confirmaciones(rDdl.e)
    check(
      'Oracle: «completado en 40 ms» + el aviso del main, UNA sola vez',
      tDdl.indexOf('completado en 40 ms') >= 0 && cDdl.length === 1 && cDdl[0] === AVISO_COMMIT_IMPLICITO,
      JSON.stringify(tDdl)
    )
    check(
      'el commit implícito se pinta como aviso',
      rDdl.e.salida.entradas.some((x) => x.texto === AVISO_COMMIT_IMPLICITO && x.tipo === 'aviso'),
      JSON.stringify(rDdl.e.salida.entradas.map((x) => x.tipo))
    )
    check('un DDL sin pestañas activa Salida', rDdl.e.resultados.activa === ID_SALIDA, rDdl.e.resultados.activa)
    // Sin aviso del main (no hubo commit implícito, o la sonda de la tx falló y no
    // puede afirmarlo), el renderer no se lo inventa con la tx de ANTES.
    const sinAviso = correrLote(conPend, ddl, () => ({ tipo: 'hecho', comando: 'CREATE TABLE', tiempos: tiempos(40) }), {
      esquema: 'ADMDEMO'
    })
    check('sin aviso del main, el renderer no añade ninguno', confirmaciones(sinAviso.e).length === 0, JSON.stringify(textos(sinAviso.e)))
  }

  // ---------------------------------------------------------------------------
  hr('(10) auto-activación de pestañas y respeto del clic del usuario')
  // ---------------------------------------------------------------------------
  {
    const ss = partir('select * from a;\nselect * from b;\nselect * from c', 'postgres')
    let e = d(estadoInicialConsola('postgres', sesion()), { tipo: 'loteCreado', lote: crearLote(1, ss) })
    e = d(e, { tipo: 'sentenciaTerminada', loteId: 1, indice: 0, resultado: filas(1), esquema: 'public', ahora: T0 })
    const primera = e.resultados.pestanas[0].id
    check('el primer resultado se activa solo', e.resultados.activa === primera && !usuarioEligioPestana(e), e.resultados.activa)
    e = d(e, { tipo: 'pestana', accion: 'activar', id: ID_SALIDA })
    check('el clic del usuario cuenta como elección', usuarioEligioPestana(e) && e.resultados.activa === ID_SALIDA, String(usuarioEligioPestana(e)))
    e = d(e, { tipo: 'sentenciaTerminada', loteId: 1, indice: 1, resultado: filas(1), esquema: 'public', ahora: T0 })
    e = d(e, { tipo: 'sentenciaTerminada', loteId: 1, indice: 2, resultado: filas(1), esquema: 'public', ahora: T0 })
    check('con elección, los siguientes NO le quitan la vista', e.resultados.activa === ID_SALIDA && e.resultados.pestanas.length === 3, e.resultados.activa)
    const e2 = correrLote(e, partir('select * from z', 'postgres'), () => filas(1)).e
    check(
      'un lote nuevo olvida la elección y activa su resultado',
      !usuarioEligioPestana(e2) && e2.resultados.activa === e2.resultados.pestanas[e2.resultados.pestanas.length - 1].id,
      e2.resultados.activa
    )

    // Lote de solo UPDATE: se ve la Salida (no hay pestaña que mirar).
    const upd = correrLote(e2, partir('update z set a = 1 where id = 1', 'postgres'), () => ({ tipo: 'afectadas', filas: 1, comando: 'UPDATE', tiempos: tiempos(5) })).e
    check('lote de solo UPDATE: Salida activa, las pestañas viejas siguen', upd.resultados.activa === ID_SALIDA && upd.resultados.pestanas.length === e2.resultados.pestanas.length, `${upd.resultados.activa} ${upd.resultados.pestanas.length}`)
    // SELECT y luego UPDATE en el mismo lote: se queda en la pestaña del SELECT.
    const mixto = correrLote(
      e2,
      partir('select * from z;\nupdate z set a = 1 where id = 1', 'postgres'),
      (i) => (i === 0 ? filas(1) : { tipo: 'afectadas', filas: 1, comando: 'UPDATE', tiempos: tiempos(5) })
    ).e
    const ultimaMixto = mixto.resultados.pestanas[mixto.resultados.pestanas.length - 1]
    check('SELECT + UPDATE: sigue la pestaña del SELECT', mixto.resultados.activa === ultimaMixto.id && ultimaMixto.titulo === 'public.z', `${mixto.resultados.activa} ${ultimaMixto.titulo}`)

    // Un error fuerza Salida aunque el usuario hubiera elegido.
    let e3 = d(estadoInicialConsola('postgres', sesion()), { tipo: 'loteCreado', lote: crearLote(1, ss) })
    e3 = d(e3, { tipo: 'sentenciaTerminada', loteId: 1, indice: 0, resultado: filas(1), esquema: 'public', ahora: T0 })
    e3 = d(e3, { tipo: 'pestana', accion: 'activar', id: e3.resultados.pestanas[0].id })
    e3 = d(e3, { tipo: 'sentenciaTerminada', loteId: 1, indice: 1, resultado: errorServidor('42601', 'syntax error'), esquema: 'public', ahora: T0 })
    check('un error activa Salida aunque hubiera elección', e3.resultados.activa === ID_SALIDA, e3.resultados.activa)

    // Título: el esquema escrito, citado y en la caja del motor.
    const ora = correrLote(
      estadoInicialConsola('oracle', sesion({ esquema: 'ADMDEMO' })),
      partir('select * from profile;\nselect * from "MiTabla";\nselect * from otro.user_resp', 'oracle'),
      () => filas(1),
      { esquema: 'ADMDEMO' }
    ).e
    check(
      'títulos Oracle: ADMDEMO.PROFILE, ADMDEMO.MiTabla (citado, sin replegar), OTRO.USER_RESP',
      ora.resultados.pestanas.map((p) => p.titulo).join(',') === 'ADMDEMO.PROFILE,ADMDEMO.MiTabla,OTRO.USER_RESP',
      ora.resultados.pestanas.map((p) => p.titulo).join(',')
    )
    const join = correrLote(estadoInicialConsola('postgres', sesion()), partir('select * from a join b on a.id = b.id', 'postgres'), () => filas(1)).e
    check('con JOIN: «Resultado 1»', join.resultados.pestanas[0]?.titulo === 'Resultado 1', String(join.resultados.pestanas[0]?.titulo))
  }

  // ---------------------------------------------------------------------------
  hr('(11) páginas, lector cerrado, liberar memoria, cerrar con lector')
  // ---------------------------------------------------------------------------
  {
    let e = correrLote(estadoInicialConsola('postgres', sesion()), partir('select * from t', 'postgres'), () => filas(2, { hayMas: true, lector: 'L1' })).e
    const id = e.resultados.pestanas[0].id
    e = d(e, { tipo: 'pagina', id, pagina: { filasJson: JSON.stringify([['3', 'c'], ['4', null]]), desde: 2, hayMas: true } })
    let r = e.resultados.resultados[id]
    check('pagina: se anexa y el lector sigue (hay más)', r.datos?.filas.length === 4 && r.lector === 'L1' && r.filasPrimeraPagina === 2, `filas=${r.datos?.filas.length} lector=${r.lector}`)
    const liberado = d(e, { tipo: 'liberar', id })
    const rl = liberado.resultados.resultados[id]
    check(
      'liberar: vuelve a la primera página, suelta el lector y pide «Volver a ejecutar»',
      rl.datos?.filas.length === 2 && rl.lector === null && rl.sinLector === MOTIVO_LIBERADA && liberado.lectoresPorCerrar.join(',') === 'L1' && rl.datos.hayMas,
      `filas=${rl.datos?.filas.length} lectores=${liberado.lectoresPorCerrar.join(',')}`
    )
    check('liberar lo que ya está en su primera página: nada', d(liberado, { tipo: 'liberar', id }) === liberado, 'identidad')
    e = d(e, { tipo: 'pagina', id, pagina: { filasJson: JSON.stringify([['5', 'e']]), desde: 4, hayMas: false, reejecutada: true } })
    r = e.resultados.resultados[id]
    check('última página: sin lector y marcada re-ejecutada', r.datos?.filas.length === 5 && r.lector === null && r.reejecutada && r.datos.hayMas === false, `lector=${r.lector}`)
    const mala = d(e, { tipo: 'pagina', id, pagina: { filasJson: JSON.stringify([['9', 'x']]), desde: 99, hayMas: false } })
    check('página que no encaja: error en el resultado, filas intactas', mala.resultados.resultados[id].errorDatos !== null && mala.resultados.resultados[id].datos?.filas.length === 5, String(mala.resultados.resultados[id].errorDatos))
    const cerrado = d(e, { tipo: 'lectorCerrado', id, motivo: 'La sesión se cerró por inactividad' })
    check('lectorCerrado: sin lector, con motivo', cerrado.resultados.resultados[id].sinLector === 'La sesión se cerró por inactividad', 'ok')
    check('lectorCerrado repetido: mismo estado', d(cerrado, { tipo: 'lectorCerrado', id, motivo: 'La sesión se cerró por inactividad' }) === cerrado, 'identidad')
    check('página de una pestaña que no existe: nada', d(e, { tipo: 'pagina', id: 'nada', pagina: { filasJson: '[]', desde: 0, hayMas: false } }) === e, 'identidad')

    const conLector = correrLote(estadoInicialConsola('postgres', sesion()), partir('select * from t', 'postgres'), () => filas(2, { hayMas: true, lector: 'L7' })).e
    const trasCerrar = d(conLector, { tipo: 'pestana', accion: 'cerrar', id: conLector.resultados.pestanas[0].id })
    check('cerrar una pestaña con lector: sale a cerrar', trasCerrar.lectoresPorCerrar.join(',') === 'L7' && trasCerrar.resultados.activa === ID_SALIDA, trasCerrar.lectoresPorCerrar.join(','))
    const todas = d(conLector, { tipo: 'pestana', accion: 'cerrarTodas', id: '' })
    check('cerrar todas: también', todas.lectoresPorCerrar.join(',') === 'L7' && todas.resultados.pestanas.length === 0, todas.lectoresPorCerrar.join(','))
    check('activar una pestaña que no existe: mismo estado', d(conLector, { tipo: 'pestana', accion: 'activar', id: 'no' }) === conLector, 'identidad')
    const fijada = d(conLector, { tipo: 'pestana', accion: 'fijar', id: conLector.resultados.pestanas[0].id })
    const desfijada = d(fijada, { tipo: 'pestana', accion: 'desfijar', id: conLector.resultados.pestanas[0].id })
    check('fijar/desfijar', fijada.resultados.pestanas[0].fijada && !desfijada.resultados.pestanas[0].fijada, 'ok')
  }

  // ---------------------------------------------------------------------------
  hr('(12) respuestas viejas, ok:false, sin columnas, pista, inmutabilidad')
  // ---------------------------------------------------------------------------
  {
    const ss = partir('select 1;select 2', 'postgres')
    let e = d(estadoInicialConsola('postgres', sesion()), { tipo: 'loteCreado', lote: crearLote(5, ss) })
    const viejo = d(e, { tipo: 'sentenciaTerminada', loteId: 4, indice: 0, resultado: filas(1), esquema: 'public', ahora: T0 })
    check('respuesta de un lote viejo: se ignora', viejo === e, 'identidad')
    e = d(e, { tipo: 'sentenciaIniciada', loteId: 5, indice: 0, ahora: T0 })
    e = d(e, { tipo: 'sentenciaTerminada', loteId: 5, indice: 0, resultado: filas(1), esquema: 'public', ahora: T0 })
    const dup = d(e, { tipo: 'sentenciaTerminada', loteId: 5, indice: 0, resultado: errorServidor('X', 'y'), esquema: 'public', ahora: T0 })
    check('respuesta repetida de una ya terminada: se ignora', dup === e, 'identidad')
    check('iniciar dos veces la misma: no', d(e, { tipo: 'sentenciaIniciada', loteId: 5, indice: 0, ahora: T0 }) === e, 'identidad')
    check('nuevoLoteId crece', nuevoLoteId(e) === 6, String(nuevoLoteId(e)))

    const ocupada = resultadoDeRespuesta({ ok: false, error: { motivo: 'ocupada', mensaje: 'La consola ya está ejecutando' } })
    check('ok:false -> resultado de error con tiempos 0', ocupada.tipo === 'error' && ocupada.tiempos.totalMs === 0, JSON.stringify(ocupada))
    const okR = filas(1)
    check('ok:true -> el valor tal cual', resultadoDeRespuesta({ ok: true, valor: okR }) === okR, 'identidad')
    e = d(e, { tipo: 'sentenciaIniciada', loteId: 5, indice: 1, ahora: T0 })
    e = d(e, { tipo: 'sentenciaTerminada', loteId: 5, indice: 1, resultado: ocupada, esquema: 'public', ahora: T0 })
    check('ok:false para el lote como un error', estados(e.lote) === 'ok,error' && e.lote?.estado === 'detenido', estados(e.lote))

    const sinCols = correrLote(estadoInicialConsola('postgres', sesion()), partir('select', 'postgres'), () => ({
      ...filas(0),
      columnas: [],
      pagina: { filasJson: '[]', desde: 0, hayMas: false }
    })).e
    check('filas sin columnas: sin pestaña', sinCols.resultados.pestanas.length === 0 && textos(sinCols)[1].indexOf('0 filas en') === 0, JSON.stringify(textos(sinCols)))

    const conAvisos = correrLote(estadoInicialConsola('postgres', sesion()), partir('vacuum t', 'postgres'), () => ({
      tipo: 'hecho',
      comando: 'VACUUM',
      tiempos: tiempos(30),
      avisos: ['Se ejecutó fuera de la transacción (VACUUM no admite transacción)']
    })).e
    check('avisos del resultado a la Salida', textos(conAvisos).indexOf('Se ejecutó fuera de la transacción (VACUUM no admite transacción)') >= 0, JSON.stringify(textos(conAvisos)))

    const conPista = d(estadoInicialConsola('postgres'), { tipo: 'pista', texto: PISTA_SIN_SENTENCIA })
    check('pista', conPista.pista === 'Coloca el cursor en una sentencia o selecciona texto', String(conPista.pista))
    check('pista igual: mismo estado', d(conPista, { tipo: 'pista', texto: PISTA_SIN_SENTENCIA }) === conPista, 'identidad')
    const trasLote = d(conPista, { tipo: 'loteCreado', lote: crearLote(1, ss) })
    check('un lote nuevo borra la pista', trasLote.pista === null, String(trasLote.pista))
    const limpio = d(conAvisos, { tipo: 'limpiarSalida' })
    check('limpiarSalida', limpio.salida.entradas.length === 0, String(limpio.salida.entradas.length))
    const suelta = d(estadoInicialConsola('postgres'), {
      tipo: 'salida',
      entrada: { tipo: 'aviso', texto: TEXTO_SIN_RESPUESTA_STOP, accion: { tipo: 'forzar', etiqueta: ETIQUETA_FORZAR } },
      ahora: T0
    })
    check('línea suelta con acción «Forzar»', suelta.salida.entradas[0].accion?.tipo === 'forzar', 'ok')

    // Inmutabilidad: el lote y el estado de entrada no se tocan.
    const base = d(estadoInicialConsola('postgres', sesion()), { tipo: 'loteCreado', lote: crearLote(1, ss) })
    const foto = JSON.stringify({ lote: base.lote, resultados: base.resultados, salida: base.salida })
    correrLote(base, ss, () => filas(1))
    d(base, { tipo: 'sentenciaTerminada', loteId: 1, indice: 0, resultado: errorServidor('X', 'y'), esquema: 'public', ahora: T0 })
    check('inmutabilidad del estado de entrada', JSON.stringify({ lote: base.lote, resultados: base.resultados, salida: base.salida }) === foto, 'igual')

    // Lote suelto: resumen, vacío, filasDePagina.
    const vacio = crearLote(1, [])
    check('lote vacío nace terminado y sin siguiente', vacio.estado === 'terminado' && siguiente(vacio) === null && !enCurso(vacio), vacio.estado)
    const res = resumenLote(registrar(iniciar(crearLote(1, ss), 0, T0), 0, filas(1)))
    check('resumenLote', res.total === 2 && res.ok === 1 && res.pendiente === 1, JSON.stringify(res))
    check(
      'filasDePagina cuenta filas sin parsear (con [ y comillas dentro de cadenas)',
      filasDePagina(JSON.stringify([['a[b', '"]"'], [null, '\\'], ['x', 'y']])) === 3 && filasDePagina('[]') === 0,
      String(filasDePagina(JSON.stringify([['a[b', '"]"'], [null, '\\'], ['x', 'y']])))
    )
    check('bloqueada sobre una omitida también se marca ✗', estados(marcarLocal(marcarLocal(crearLote(1, ss), 0, 'bloqueada', 'a'), 1, 'bloqueada', 'b')) === 'error,error', 'ok')
  }

  // ---------------------------------------------------------------------------
  hr('(13) SQL Server: varios conjuntos por sentencia y el título sin la base')
  // ---------------------------------------------------------------------------
  {
    const j = (v: unknown): string => JSON.stringify(v)
    // El reducer no pregunta el motor para esto: se parte con PG (la sentencia es lo de
    // menos) y se le dan los conjuntos que devolvería un lote de T-SQL.
    const ss = partir('select * from t1', 'postgres')
    const conj = (n: number): DbConjuntoSiguiente => ({ ...filas(n), lector: null })
    const afect = (n: number): DbConjuntoSiguiente => ({ tipo: 'afectadas', filas: n, comando: 'UPDATE', tiempos: tiempos(3) })
    const conSiguientes: DbResultadoFilas = { ...filas(1), siguientes: [conj(2), afect(4), conj(3)] }
    const { e } = correrLote(estadoInicialConsola('postgres', sesion()), ss, () => conSiguientes)
    const titulos = e.resultados.pestanas.map((p) => p.titulo)
    check('el primero y dos subpestañas «Resultado 1.2», «Resultado 1.3» (sin hueco por el de «afectadas»)', j(titulos) === j(['public.t1', 'Resultado 1.2', 'Resultado 1.3']), j(titulos))
    check('todas del mismo lote (la próxima ejecución las sustituye juntas)', new Set(e.resultados.pestanas.map((p) => p.lote)).size === 1, 'un lote')
    const extra = e.resultados.pestanas.slice(1).map((p) => e.resultados.resultados[p.id])
    check('las extra sin lector y no releíbles («Más» leería el primero)', extra.every((r) => r.lector === null && r.noReleible && r.tabla === null), j(extra.map((r) => [r.lector, r.noReleible])))
    check('sus filas se leen', extra[0].filasPrimeraPagina === 2 && extra[1].filasPrimeraPagina === 3, j(extra.map((r) => r.filasPrimeraPagina)))
    const t = textos(e)
    const iPrimera = t.findIndex((x) => x.includes('1 fila'))
    const i4 = t.findIndex((x) => x.includes('4 filas afectadas'))
    check('la Salida dice cada conjunto, en orden (el de «afectadas» también)', iPrimera >= 0 && i4 > iPrimera && t.some((x) => x.includes('2 filas')) && t.some((x) => x.includes('3 filas')), j(t))
    check('se activa la última subpestaña', e.resultados.activa === e.resultados.pestanas[2].id, e.resultados.activa)

    // Un lote que falló a medias: los conjuntos de ANTES, «k.1, k.2…», y la Salida activa.
    const fallo: DbResultadoError = { ...errorServidor('8134', 'Error de división entre cero.'), anteriores: [conj(1), conj(2)] }
    const r2 = correrLote(estadoInicialConsola('postgres', sesion()), ss, () => fallo).e
    check('los de antes del error: «Resultado 1.1», «Resultado 1.2»', j(r2.resultados.pestanas.map((p) => p.titulo)) === j(['Resultado 1.1', 'Resultado 1.2']), j(r2.resultados.pestanas.map((p) => p.titulo)))
    check('y la Salida activa (el error manda)', r2.resultados.activa === ID_SALIDA, r2.resultados.activa)
    const t2 = textos(r2)
    const iErr = t2.findIndex((x) => x.includes('8134'))
    const iAntes = t2.findIndex((x) => x.includes('2 filas'))
    check('sus líneas van ANTES del error', iAntes >= 0 && iErr > iAntes, j(t2))

    // Sin `siguientes` (Oracle, PG, SQLite): exactamente lo de siempre.
    const normal = correrLote(estadoInicialConsola('postgres', sesion()), ss, () => filas(1)).e
    check('sin conjuntos extra: una pestaña, como siempre', normal.resultados.pestanas.length === 1, String(normal.resultados.pestanas.length))

    // El título en SQL Server: el «esquema» de la sesión es la BASE, no califica la tabla.
    const sqls = correrLote(estadoInicialConsola('sqlserver', sesion({ esquema: 'pruebas' })), ss, () => filas(1), { esquema: 'pruebas' }).e
    check('SQL Server: `select * from t1` se titula t1 (no pruebas.t1)', sqls.resultados.pestanas[0]?.titulo === 't1', j(sqls.resultados.pestanas.map((p) => p.titulo)))
    const pg = correrLote(estadoInicialConsola('postgres', sesion()), ss, () => filas(1), { esquema: 'ventas' }).e
    check('PG: sigue calificando con el esquema de la sesión', pg.resultados.pestanas[0]?.titulo === 'ventas.t1', j(pg.resultados.pestanas.map((p) => p.titulo)))
  }

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
