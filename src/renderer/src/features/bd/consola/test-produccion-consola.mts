#!/usr/bin/env node
// =============================================================================
// Prueba de la consola en una conexión de producción (npm run test:db-consola-produccion),
// cada regla con su mitad negativa y sentencias del divisor REAL: el prevuelo, los textos,
// decidirLote, el Commit, el modo al nacer, la barra sin sesión, los rechazos del main, el
// COMMIT implícito de un DDL de Oracle, DialogoTxPendiente y el COMMIT dentro de un bloque.
// =============================================================================

import { dividirSentencias, type Sentencia } from '../../../../../shared/sql/divisorSql.ts'
import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import type { DbEntorno } from '../../../../../shared/db-ipc.ts'
import type { DbEstadoSesion, DbResultadoError } from '../../../../../shared/db-explorador-ipc.ts'
import {
  ETIQUETA_COMMIT_PRODUCCION,
  ETIQUETA_EJECUTAR_PRODUCCION,
  commitPideConfirmacion,
  confirmacionCommitProduccion,
  confirmacionLoteProduccion,
  esProduccion,
  modoTxPorDefecto,
  prevueloProduccion,
  resumenVerbos,
  textoCommitRechazado,
  textoRechazoProduccion
} from './produccionConsola.ts'
// El módulo entero, para que (10) FALLE (y no reviente la carga) si falta la función.
import * as produccion from './produccionConsola.ts'
import { decidirLote, estadoBarraTx, estadoInicialConsola, nuevoLoteId, reducirConsola, type EstadoConsola } from './estadoConsola.ts'
import { crearLote } from './lote.ts'
import { textoEntrada } from './salidaConsola.ts'

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

const partir = (texto: string, d: DialectoSql): Sentencia[] => dividirSentencias(texto, d)
/** ¿Pide confirmación en producción este texto (una o varias sentencias)? */
const pide = (texto: string, d: DialectoSql): boolean => prevueloProduccion(partir(texto, d), 'produccion').confirmar

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

// ---------------------------------------------------------------------------------
hr('(1) prevueloProduccion: qué pide confirmación')
{
  const escribe = 'UPDATE t SET a = 1 WHERE id = 1;\nDELETE FROM t;'
  for (const e of [undefined, null, 'desarrollo', 'pruebas'] as const) {
    check(`${e ?? String(e)}: nunca pregunta, aunque escriba`, !prevueloProduccion(partir(escribe, 'postgres'), e).confirmar, String(e))
  }
  const basura = 'PRODUCCION' as unknown as DbEntorno
  check('un entorno que no es exactamente «produccion»: no pregunta', !prevueloProduccion(partir(escribe, 'postgres'), basura).confirmar, 'PRODUCCION')
  check('esProduccion solo con «produccion»', esProduccion('produccion') && !esProduccion('pruebas') && !esProduccion(null) && !esProduccion(undefined), 'ok')

  // Lo que SÍ pide, en los dos dialectos.
  const siPG: Array<[string, string]> = [
    ['UPDATE', 'UPDATE t SET a = 1 WHERE id = 1'],
    ['INSERT', 'INSERT INTO t VALUES (1)'],
    ['DELETE', 'DELETE FROM t WHERE id = 1'],
    ['CREATE TABLE', 'CREATE TABLE x (id int)'],
    ['DROP', 'DROP TABLE x'],
    ['TRUNCATE', 'TRUNCATE t'],
    ['COMMIT', 'COMMIT'],
    ['END (el COMMIT de PG)', 'END'],
    ['CALL', 'CALL p()'],
    ['SELECT … FOR UPDATE (bloqueo)', 'SELECT * FROM t FOR UPDATE'],
    ['DO (bloque de PG)', "DO $$ BEGIN PERFORM 1; END $$"]
  ]
  for (const [n, sql] of siPG) check(`PG: ${n} pide`, pide(sql, 'postgres'), j(partir(sql, 'postgres').map((s) => [s.clase, s.verbo])))
  const siOra: Array<[string, string]> = [
    ['UPDATE', 'UPDATE t SET a = 1 WHERE id = 1'],
    ['bloque anónimo', 'BEGIN\n  UPDATE t SET a = 1;\nEND;\n/'],
    ['CREATE OR REPLACE PROCEDURE', 'CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;\n/'],
    ['EXEC', 'EXEC p'],
    ['COMMIT', 'COMMIT'],
    ['MERGE', 'MERGE INTO t USING s ON (t.id = s.id) WHEN MATCHED THEN UPDATE SET t.a = s.a']
  ]
  for (const [n, sql] of siOra) check(`Oracle: ${n} pide`, pide(sql, 'oracle'), j(partir(sql, 'oracle').map((s) => [s.clase, s.verbo])))

  // Lo que NO pide (mitad negativa).
  const noPG: Array<[string, string]> = [
    ['SELECT', 'SELECT * FROM t'],
    ['WITH … SELECT', 'WITH a AS (SELECT 1) SELECT * FROM a'],
    ['ROLLBACK', 'ROLLBACK'],
    ['SAVEPOINT', 'SAVEPOINT s1'],
    ['BEGIN (de PG)', 'BEGIN'],
    ['SET search_path (sesión)', 'SET search_path TO ventas'],
    ['SHOW', 'SHOW search_path'],
    ['metacomando de psql (cliente)', '\\d t']
  ]
  for (const [n, sql] of noPG) check(`PG: ${n} NO pide`, !pide(sql, 'postgres'), j(partir(sql, 'postgres').map((s) => [s.clase, s.verbo])))
  const noOra: Array<[string, string]> = [
    ['SELECT', 'SELECT * FROM dual'],
    ['ROLLBACK', 'ROLLBACK'],
    ['ALTER SESSION', "ALTER SESSION SET CURRENT_SCHEMA = HR"],
    ['SET SERVEROUTPUT (cliente)', 'SET SERVEROUTPUT ON']
  ]
  for (const [n, sql] of noOra) check(`Oracle: ${n} NO pide`, !pide(sql, 'oracle'), j(partir(sql, 'oracle').map((s) => [s.clase, s.verbo])))

  // TODO O NADA: basta una, y se devuelven todas las que escriben con su posición.
  const mezcla = partir('SELECT 1;\nUPDATE t SET a = 1 WHERE id = 1;\nSELECT 2;\nDELETE FROM t WHERE id = 2;\nCOMMIT;', 'postgres')
  const p = prevueloProduccion(mezcla, 'produccion')
  check(
    'lote mixto: pregunta y lista las que escriben, en orden y con su índice',
    p.confirmar && j(p.escrituras) === j([{ indice: 1, verbo: 'UPDATE' }, { indice: 3, verbo: 'DELETE' }, { indice: 4, verbo: 'COMMIT' }]),
    j(p)
  )
  check('lote de solo consultas: no pregunta', !prevueloProduccion(partir('SELECT 1;\nSELECT 2;', 'postgres'), 'produccion').confirmar, 'libre')
  check('lote vacío: no pregunta', !prevueloProduccion([], 'produccion').confirmar, 'libre')
}

// ---------------------------------------------------------------------------------
hr('(2) resumenVerbos')
{
  check('agrupa y cuenta en orden de aparición', resumenVerbos([
    { indice: 0, verbo: 'UPDATE' },
    { indice: 1, verbo: 'DELETE' },
    { indice: 2, verbo: 'UPDATE' }
  ]) === 'UPDATE (2), DELETE', 'UPDATE (2), DELETE')
  check('uno solo, sin cuenta', resumenVerbos([{ indice: 0, verbo: 'COMMIT' }]) === 'COMMIT', 'COMMIT')
  check('vacío', resumenVerbos([]) === '', "''")
}

// ---------------------------------------------------------------------------------
hr('(3) textos de la confirmación del lote')
{
  const una = confirmacionLoteProduccion({ alias: 'PROD-VENTAS', total: 1, escrituras: [{ indice: 0, verbo: 'UPDATE' }] })
  check('título con el alias', una.titulo === 'Producción: ¿ejecutar en PROD-VENTAS?', una.titulo)
  check('mensaje: el alias y que es producción', una.mensaje.startsWith('«PROD-VENTAS» es una conexión de producción.'), j(una.mensaje))
  check('una de una', una.mensaje.indexOf('La sentencia escribe: UPDATE.') !== -1, j(una.mensaje))
  check('botón', una.confirmar === ETIQUETA_EJECUTAR_PRODUCCION && una.confirmar === 'Ejecutar en producción', una.confirmar)
  const todas = confirmacionLoteProduccion({ alias: 'P', total: 3, escrituras: [0, 1, 2].map((i) => ({ indice: i, verbo: 'INSERT' })) })
  check('todas: «Las 3 sentencias escriben»', todas.mensaje.indexOf('Las 3 sentencias escriben: INSERT (3).') !== -1, j(todas.mensaje))
  const unaDeVarias = confirmacionLoteProduccion({ alias: 'P', total: 4, escrituras: [{ indice: 2, verbo: 'DELETE' }] })
  check('una de varias', unaDeVarias.mensaje.indexOf('Escribe 1 de las 4 sentencias: DELETE.') !== -1, j(unaDeVarias.mensaje))
  const dosDeVarias = confirmacionLoteProduccion({
    alias: 'P',
    total: 5,
    escrituras: [
      { indice: 1, verbo: 'UPDATE' },
      { indice: 3, verbo: 'COMMIT' }
    ]
  })
  check('dos de varias', dosDeVarias.mensaje.indexOf('Escriben 2 de las 5 sentencias: UPDATE, COMMIT.') !== -1, j(dosDeVarias.mensaje))
  check('sin peligros no hay viñetas', una.mensaje.indexOf('·') === -1, j(una.mensaje))
  const conPeligro = confirmacionLoteProduccion({
    alias: 'P',
    total: 1,
    escrituras: [{ indice: 0, verbo: 'DELETE' }],
    peligros: [{ motivo: 'DELETE sin WHERE: afecta a todas las filas de la tabla', extracto: 'DELETE FROM t' }]
  })
  check('los peligros van DENTRO', conPeligro.mensaje.endsWith('· DELETE sin WHERE: afecta a todas las filas de la tabla\n   DELETE FROM t'), j(conPeligro.mensaje))
  const largo = 'A'.repeat(60) + 'FIN'
  const conLargo = confirmacionLoteProduccion({ alias: largo, total: 1, escrituras: [{ indice: 0, verbo: 'UPDATE' }] })
  check('alias largo: recortado en el título', conLargo.titulo.indexOf('…') !== -1 && conLargo.titulo.endsWith('FIN?'), conLargo.titulo)
  check('y ENTERO en el mensaje', conLargo.mensaje.indexOf(`«${largo}»`) !== -1, 'entero')
}

// ---------------------------------------------------------------------------------
hr('(4) decidirLote: solo lectura, peligros y producción en una decisión')
{
  const base = { dialecto: 'postgres' as const, alias: 'PROD' }
  const sinWhere = partir('DELETE FROM t', 'postgres')
  const conWhere = partir('UPDATE t SET a = 1 WHERE id = 1', 'postgres')
  const select = partir('SELECT * FROM t', 'postgres')

  const ro = decidirLote(conWhere, { ...base, soloLectura: true, entorno: 'produccion' })
  check('solo lectura + producción: rechaza SIN preguntar', ro.tipo === 'rechazado' && ro.bloqueadas.length === 1, j(ro))
  const roSelect = decidirLote(select, { ...base, soloLectura: true, entorno: 'produccion' })
  check('solo lectura + producción + SELECT: libre', roSelect.tipo === 'libre', j(roSelect))

  const prod = decidirLote(sinWhere, { ...base, soloLectura: false, entorno: 'produccion' })
  check('producción + sin WHERE: UN diálogo de producción', prod.tipo === 'confirmar' && prod.produccion, j(prod))
  check(
    '…con el peligro dentro',
    prod.tipo === 'confirmar' && prod.textos.mensaje.indexOf('sin WHERE') !== -1 && prod.textos.confirmar === ETIQUETA_EJECUTAR_PRODUCCION,
    prod.tipo === 'confirmar' ? j(prod.textos) : ''
  )
  const prodWhere = decidirLote(conWhere, { ...base, soloLectura: false, entorno: 'produccion' })
  check('producción + UPDATE con WHERE: pregunta igual', prodWhere.tipo === 'confirmar' && prodWhere.produccion, j(prodWhere))
  const prodSelect = decidirLote(select, { ...base, soloLectura: false, entorno: 'produccion' })
  check('producción + SELECT: libre (no confirma)', prodSelect.tipo === 'libre', j(prodSelect))

  for (const e of [undefined, 'desarrollo', 'pruebas'] as const) {
    const fuera = decidirLote(sinWhere, { ...base, soloLectura: false, entorno: e })
    check(
      `${e ?? 'sin entorno'} + sin WHERE: el diálogo de siempre, SIN confirmado`,
      fuera.tipo === 'confirmar' && !fuera.produccion && fuera.textos.titulo === '¿Ejecutar DELETE sin WHERE?' && fuera.textos.confirmar === 'Ejecutar de todos modos' && fuera.textos.mensaje.startsWith('En PROD:'),
      j(fuera)
    )
    const libre = decidirLote(conWhere, { ...base, soloLectura: false, entorno: e })
    check(`${e ?? 'sin entorno'} + UPDATE con WHERE: libre`, libre.tipo === 'libre', j(libre))
  }
}

// ---------------------------------------------------------------------------------
hr('(5) Commit de la barra')
{
  check('producción: pregunta', commitPideConfirmacion('produccion'), 'true')
  for (const e of [undefined, null, 'desarrollo', 'pruebas'] as const) {
    check(`${e ?? String(e)}: no pregunta`, !commitPideConfirmacion(e), 'false')
  }
  const t = confirmacionCommitProduccion({ alias: 'PROD-VENTAS', sentenciasEnTx: 3 })
  check('título con el alias', t.titulo === 'Producción: ¿confirmar en PROD-VENTAS?', t.titulo)
  check('mensaje: producción y cuántas', t.mensaje.indexOf('«PROD-VENTAS» es una conexión de producción.') === 0 && t.mensaje.indexOf('(3 sentencias)') !== -1, j(t.mensaje))
  check('botón', t.confirmar === ETIQUETA_COMMIT_PRODUCCION, t.confirmar)
  const sinCuenta = confirmacionCommitProduccion({ alias: 'P', sentenciasEnTx: 0 })
  check('sin cuenta: sin paréntesis', sinCuenta.mensaje.indexOf('(') === -1, j(sinCuenta.mensaje))
  check('una: singular', confirmacionCommitProduccion({ alias: 'P', sentenciasEnTx: 1 }).mensaje.indexOf('(1 sentencia)') !== -1, 'singular')
}

// ---------------------------------------------------------------------------------
hr('(6) modoTxPorDefecto (espejo del main)')
{
  check('producción: Manual', modoTxPorDefecto('produccion', false) === 'manual', 'manual')
  check('producción en solo lectura: Auto', modoTxPorDefecto('produccion', true) === 'auto', 'auto')
  for (const e of [undefined, null, 'desarrollo', 'pruebas'] as const) {
    for (const ro of [false, true]) {
      check(`${e ?? String(e)}${ro ? ' (solo lectura)' : ''}: Auto`, modoTxPorDefecto(e, ro) === 'auto', modoTxPorDefecto(e, ro))
    }
  }
  // Con la preferencia «Transacción al abrir» de Configuración: la
  // barra pinta Manual fuera de producción, pero nunca en solo lectura, y en producción
  // Manual aunque la preferencia sea Automática.
  for (const e of [undefined, null, 'desarrollo', 'pruebas'] as const) {
    check(`${e ?? String(e)} con preferencia Manual: Manual`, modoTxPorDefecto(e, false, 'manual') === 'manual', modoTxPorDefecto(e, false, 'manual'))
    check(`NEGATIVO: ${e ?? String(e)} en solo lectura con preferencia Manual: Auto`, modoTxPorDefecto(e, true, 'manual') === 'auto', modoTxPorDefecto(e, true, 'manual'))
  }
  check('NEGATIVO: producción con preferencia Automática: Manual', modoTxPorDefecto('produccion', false, 'auto') === 'manual', 'manual')
  check('NEGATIVO: producción en solo lectura con preferencia Manual: Auto', modoTxPorDefecto('produccion', true, 'manual') === 'auto', 'auto')
}

// ---------------------------------------------------------------------------------
hr('(7) la barra de una consola sin sesión')
{
  const nueva = estadoBarraTx(null, { modoSinSesion: 'manual' })
  check('sin sesión y Manual por defecto: «Tx: Manual», pulsado', nueva.textoModo === 'Tx: Manual' && nueva.modoPulsado && nueva.modo === 'manual', j(nueva))
  check('…y se puede cambiar', nueva.puedeCambiarModo, String(nueva.puedeCambiarModo))
  const deSiempre = estadoBarraTx(null)
  check('sin `modoSinSesion`: Auto (lo de siempre)', deSiempre.textoModo === 'Tx: Auto' && !deSiempre.modoPulsado, j(deSiempre))
  const conSesion = estadoBarraTx(sesion({ txModo: 'auto' }), { modoSinSesion: 'manual' })
  check('con sesión manda el main, no el por defecto', conSesion.textoModo === 'Tx: Auto', j(conSesion))
  const manualMain = estadoBarraTx(sesion({ txModo: 'manual', tx: 'pendiente', sentenciasEnTx: 1 }), { modoSinSesion: 'auto' })
  check('…en las dos direcciones', manualMain.textoModo === 'Tx: Manual' && manualMain.textoTx === 'Tx pendiente (1)', j(manualMain))
}

// ---------------------------------------------------------------------------------
hr('(8) Salida: rechazos de producción del main')
{
  const errProd: DbResultadoError = {
    tipo: 'error',
    error: { motivo: 'produccion', mensaje: 'PROD es una conexión de producción: confirma la escritura.' },
    tiempos: { totalMs: 0, ejecucionMs: 0, lecturaMs: 0 }
  }
  check('texto: «No se envió»', textoRechazoProduccion(errProd.error) === 'No se envió: PROD es una conexión de producción: confirma la escritura.', textoRechazoProduccion(errProd.error))
  check('texto del commit: «No se confirmó»', textoCommitRechazado(errProd.error).startsWith('No se confirmó: '), textoCommitRechazado(errProd.error))
  // El mensaje del main (`produccion.ts`) ya dice «No se envió nada»: no se repite.
  const delMain = { motivo: 'produccion' as const, mensaje: '«PROD» es una conexión de PRODUCCIÓN: confirma la escritura antes de enviarla. No se envió nada.' }
  check('si el main ya lo dice, no se repite (escritura)', textoRechazoProduccion(delMain) === delMain.mensaje, textoRechazoProduccion(delMain))
  check('si el main ya lo dice, no se repite (commit)', textoCommitRechazado(delMain) === delMain.mensaje, textoCommitRechazado(delMain))

  const ss = partir('UPDATE t SET a = 1 WHERE id = 1', 'postgres')
  const correr = (e0: EstadoConsola, r: DbResultadoError): EstadoConsola => {
    const id = nuevoLoteId(e0)
    let e = reducirConsola(e0, { tipo: 'loteCreado', lote: crearLote(id, ss) })
    e = reducirConsola(e, { tipo: 'sentenciaIniciada', loteId: id, indice: 0, ahora: 1 })
    return reducirConsola(e, { tipo: 'sentenciaTerminada', loteId: id, indice: 0, resultado: r, sentencia: ss[0], esquema: 'public', ahora: 2 })
  }
  const e = correr(estadoInicialConsola('postgres'), errProd)
  const lineas = e.salida.entradas.map((x) => textoEntrada(x))
  check('la Salida dice primero que no se envió', lineas.some((l) => l.startsWith('No se envió: ') && l.indexOf('producción') !== -1), j(lineas))
  check('y la sentencia queda ✗', e.lote?.sentencias[0].estado === 'error', String(e.lote?.sentencias[0].estado))
  const eMain = correr(estadoInicialConsola('postgres'), { ...errProd, error: delMain })
  const lineasMain = eMain.salida.entradas.map((x) => textoEntrada(x))
  check(
    'con el mensaje del main, la Salida no repite «No se envió»',
    lineasMain.some((l) => l.startsWith(delMain.mensaje)) && !lineasMain.some((l) => /No se envió.*No se envió/.test(l)),
    j(lineasMain)
  )
  const errServidor: DbResultadoError = {
    tipo: 'error',
    error: { motivo: 'servidor', codigo: '42P01', mensaje: 'relation "t" does not exist' },
    tiempos: { totalMs: 3, ejecucionMs: 3, lecturaMs: 0 }
  }
  const e2 = correr(estadoInicialConsola('postgres'), errServidor)
  const lineas2 = e2.salida.entradas.map((x) => textoEntrada(x))
  check('un error del servidor NO lleva «No se envió» (mitad negativa)', !lineas2.some((l) => l.startsWith('No se envió')), j(lineas2))

  const tx = reducirConsola(estadoInicialConsola('postgres', sesion({ txModo: 'manual', tx: 'pendiente', sentenciasEnTx: 1 })), {
    tipo: 'tx',
    op: 'commit',
    respuesta: { ok: false, error: errProd.error },
    ms: 1,
    ahora: 3
  })
  const lineasTx = tx.salida.entradas.map((x) => textoEntrada(x))
  check('COMMIT rechazado: «No se confirmó»', lineasTx.some((l) => l.startsWith('No se confirmó: ')), j(lineasTx))
  check('…y la sesión no cambia (sigue pendiente)', tx.sesion?.tx === 'pendiente', String(tx.sesion?.tx))
  const txOtro = reducirConsola(estadoInicialConsola('postgres', sesion({ txModo: 'manual', tx: 'pendiente', sentenciasEnTx: 1 })), {
    tipo: 'tx',
    op: 'commit',
    respuesta: { ok: false, error: { motivo: 'ocupada', mensaje: 'La consola está ejecutando.' } },
    ms: 1,
    ahora: 3
  })
  const lineasOtro = txOtro.salida.entradas.map((x) => textoEntrada(x))
  check('otro rechazo del COMMIT no lleva «No se confirmó»', !lineasOtro.some((l) => l.startsWith('No se confirmó')), j(lineasOtro))
}

// ---------------------------------------------------------------------------------
hr('(9) Oracle: el DDL confirma lo pendiente, y la confirmación lo dice')
{
  const pendiente = sesion({ txModo: 'manual', tx: 'pendiente', sentenciasEnTx: 2 })
  const ddlOra = partir('CREATE TABLE x (id NUMBER)', 'oracle')
  const opts = (dialecto: DialectoSql, s: DbEstadoSesion | null) => ({
    soloLectura: false,
    dialecto,
    entorno: 'produccion' as const,
    alias: 'ORA-PROD',
    sesion: s
  })
  const AVISO = 'hace COMMIT de lo pendiente'

  const d = decidirLote(ddlOra, opts('oracle', pendiente))
  check(
    'Oracle + DDL + 2 pendientes: la confirmación avisa del COMMIT implícito, con la cuenta',
    d.tipo === 'confirmar' && d.produccion && d.textos.mensaje.indexOf(AVISO) !== -1 && d.textos.mensaje.indexOf('(2 sentencias)') !== -1,
    d.tipo === 'confirmar' ? j(d.textos.mensaje) : j(d)
  )
  // El nombre del motor sale de su descriptor; la frase, al byte.
  check(
    'la frase de siempre, con el motor por su etiqueta: «En Oracle, un DDL hace COMMIT de lo pendiente»',
    d.tipo === 'confirmar' && d.textos.mensaje.indexOf('En Oracle, un DDL hace COMMIT de lo pendiente: los cambios sin confirmar de esta consola (2 sentencias) quedarán confirmados y ya no se podrán revertir.') !== -1,
    d.tipo === 'confirmar' ? j(d.textos.mensaje) : j(d)
  )
  const trunc = decidirLote(partir('UPDATE t SET a = 1 WHERE id = 1;\nTRUNCATE TABLE u;', 'oracle'), opts('oracle', pendiente))
  check(
    'también con el DDL detrás de otras escrituras del lote (TRUNCATE)',
    trunc.tipo === 'confirmar' && trunc.textos.mensaje.indexOf(AVISO) !== -1,
    trunc.tipo === 'confirmar' ? j(trunc.textos.mensaje) : j(trunc)
  )
  const sinCuenta = decidirLote(ddlOra, opts('oracle', sesion({ txModo: 'manual', tx: 'pendiente', sentenciasEnTx: 0 })))
  check(
    'pendiente sin cuenta conocida: avisa igual, sin inventar un número',
    sinCuenta.tipo === 'confirmar' && sinCuenta.textos.mensaje.indexOf(AVISO) !== -1 && !/\(\d+ sentencias?\)/.test(sinCuenta.textos.mensaje),
    sinCuenta.tipo === 'confirmar' ? j(sinCuenta.textos.mensaje) : j(sinCuenta)
  )

  // Mitades negativas.
  const pg = decidirLote(partir('CREATE TABLE x (id int)', 'postgres'), opts('postgres', pendiente))
  check(
    'NEGATIVO: PostgreSQL (su DDL es transaccional): pregunta, pero sin ese aviso',
    pg.tipo === 'confirmar' && pg.textos.mensaje.indexOf(AVISO) === -1,
    pg.tipo === 'confirmar' ? j(pg.textos.mensaje) : j(pg)
  )
  const nada = decidirLote(ddlOra, opts('oracle', sesion({ txModo: 'manual', tx: 'ninguna' })))
  check(
    'NEGATIVO: Oracle sin nada pendiente: sin aviso',
    nada.tipo === 'confirmar' && nada.textos.mensaje.indexOf(AVISO) === -1,
    nada.tipo === 'confirmar' ? j(nada.textos.mensaje) : j(nada)
  )
  const sinSesion = decidirLote(ddlOra, opts('oracle', null))
  check(
    'NEGATIVO: Oracle sin sesión todavía: sin aviso',
    sinSesion.tipo === 'confirmar' && sinSesion.textos.mensaje.indexOf(AVISO) === -1,
    sinSesion.tipo === 'confirmar' ? j(sinSesion.textos.mensaje) : j(sinSesion)
  )
  const dml = decidirLote(partir('UPDATE t SET a = 1 WHERE id = 1', 'oracle'), opts('oracle', pendiente))
  check(
    'NEGATIVO: Oracle con pendientes pero SIN DDL: sin aviso',
    dml.tipo === 'confirmar' && dml.textos.mensaje.indexOf(AVISO) === -1,
    dml.tipo === 'confirmar' ? j(dml.textos.mensaje) : j(dml)
  )
  const abierta = decidirLote(ddlOra, opts('oracle', sesion({ txModo: 'manual', tx: 'abierta' })))
  check(
    'NEGATIVO: tx `abierta` (solo lecturas): nada que confirmar de rebote',
    abierta.tipo === 'confirmar' && abierta.textos.mensaje.indexOf(AVISO) === -1,
    abierta.tipo === 'confirmar' ? j(abierta.textos.mensaje) : j(abierta)
  )
  const fuera = decidirLote(ddlOra, { ...opts('oracle', pendiente), entorno: 'desarrollo' })
  check('NEGATIVO: fuera de producción no hay diálogo (el aviso posterior del main sigue)', fuera.tipo === 'libre', j(fuera))
}

// ---------------------------------------------------------------------------------
hr('(10) DialogoTxPendiente en producción: el contexto nombra la conexión')
{
  const ctx = 'Para cerrar la consola hay que confirmarla o revertirla antes.'
  const f = (produccion as { contextoTxPendiente?: unknown }).contextoTxPendiente
  check('existe `contextoTxPendiente`', typeof f === 'function', typeof f)
  if (typeof f === 'function') {
    const contexto = f as (c: string, o: { alias: string; entorno: DbEntorno | null | undefined; tx: DbEstadoSesion['tx'] }) => string
    const prod = contexto(ctx, { alias: 'PG-PROD', entorno: 'produccion', tx: 'pendiente' })
    check('producción: empieza por el contexto de siempre', prod.startsWith(ctx), j(prod))
    check(
      '…y dice la conexión y que «Confirmar (Commit)» es un COMMIT en producción',
      prod.indexOf('«PG-PROD» es una conexión de producción') !== -1 && prod.indexOf('Confirmar (Commit)') !== -1,
      j(prod)
    )
    check('también con la tx `abierta`', contexto(ctx, { alias: 'P', entorno: 'produccion', tx: 'abierta' }) !== ctx, 'distinto')
    // Mitades negativas.
    check('NEGATIVO: tx fallida (no se ofrece Commit): el de siempre', contexto(ctx, { alias: 'P', entorno: 'produccion', tx: 'fallida' }) === ctx, 'igual')
    for (const e of [undefined, null, 'desarrollo', 'pruebas'] as const) {
      check(`NEGATIVO: ${e ?? String(e)}: el de siempre`, contexto(ctx, { alias: 'P', entorno: e, tx: 'pendiente' }) === ctx, 'igual')
    }
  }
}

// ---------------------------------------------------------------------------------
hr('(11) Oracle: un bloque con un COMMIT escrito lo dice en la confirmación')
{
  const pendiente = sesion({ txModo: 'manual', tx: 'pendiente', sentenciasEnTx: 3 })
  const opts = (dialecto: DialectoSql, s: DbEstadoSesion | null) => ({
    soloLectura: false,
    dialecto,
    entorno: 'produccion' as const,
    alias: 'ORA-PROD',
    sesion: s
  })
  const AVISO = 'contiene un COMMIT'
  const f = (produccion as { commitEnBloques?: unknown }).commitEnBloques
  check('existe `commitEnBloques`', typeof f === 'function', typeof f)

  const bloque = partir('BEGIN\n  UPDATE t SET a = 1 WHERE id = 1;\n  COMMIT;\nEND;', 'oracle')
  const d = decidirLote(bloque, opts('oracle', pendiente))
  check(
    'un bloque con COMMIT + 3 pendientes: «Este bloque contiene un COMMIT» y que confirma lo pendiente, con la cuenta',
    d.tipo === 'confirmar' &&
      d.produccion &&
      d.textos.mensaje.indexOf('Este bloque contiene un COMMIT') !== -1 &&
      d.textos.mensaje.indexOf('confirma también los cambios sin confirmar de esta consola (3 sentencias)') !== -1,
    d.tipo === 'confirmar' ? j(d.textos.mensaje) : j(d)
  )
  const sinPend = decidirLote(bloque, opts('oracle', sesion({ txModo: 'manual', tx: 'ninguna' })))
  check(
    'sin nada pendiente: lo dice igual, sin hablar de pendientes',
    sinPend.tipo === 'confirmar' && sinPend.textos.mensaje.indexOf(AVISO) !== -1 && sinPend.textos.mensaje.indexOf('sin confirmar de esta consola') === -1,
    sinPend.tipo === 'confirmar' ? j(sinPend.textos.mensaje) : j(sinPend)
  )
  const variasFormas = partir(
    'DECLARE n NUMBER;\nBEGIN\n  IF n > 0 THEN COMMIT WORK; ELSE NULL; END IF;\n  <<fin>> NULL;\nEND;\n/\nBEGIN\n  FOR r IN (SELECT 1 FROM dual) LOOP COMMIT; END LOOP;\nEXCEPTION WHEN OTHERS THEN COMMIT WRITE BATCH;\nEND;\n/\nSELECT 1 FROM dual',
    'oracle'
  )
  const dv = decidirLote(variasFormas, opts('oracle', pendiente))
  check(
    'varios bloques en el lote (tras THEN, LOOP, WORK, WRITE): «2 bloques del lote contienen un COMMIT»',
    dv.tipo === 'confirmar' && dv.textos.mensaje.indexOf('2 bloques del lote contienen un COMMIT') !== -1,
    dv.tipo === 'confirmar' ? j(dv.textos.mensaje) : j(dv)
  )
  const uno = decidirLote(partir('UPDATE t SET a = 1 WHERE id = 1;\nBEGIN <<x>> COMMIT; END;\n/', 'oracle'), opts('oracle', null))
  check(
    'uno entre otras sentencias (tras una etiqueta): «Un bloque del lote contiene un COMMIT»',
    uno.tipo === 'confirmar' && uno.textos.mensaje.indexOf('Un bloque del lote contiene un COMMIT') !== -1,
    uno.tipo === 'confirmar' ? j(uno.textos.mensaje) : j(uno)
  )
  const conDdl = decidirLote(partir('CREATE TABLE x (id NUMBER);\nBEGIN COMMIT; END;\n/', 'oracle'), opts('oracle', pendiente))
  check(
    'con un DDL además: los dos avisos, en el MISMO diálogo',
    conDdl.tipo === 'confirmar' && conDdl.textos.mensaje.indexOf('hace COMMIT de lo pendiente') !== -1 && conDdl.textos.mensaje.indexOf(AVISO) !== -1,
    conDdl.tipo === 'confirmar' ? j(conDdl.textos.mensaje) : j(conDdl)
  )

  // Mitades negativas: lo que no es un COMMIT escrito como sentencia de un bloque.
  const negativos: Array<[string, string]> = [
    ['en una cadena (EXECUTE IMMEDIATE)', "BEGIN EXECUTE IMMEDIATE 'COMMIT'; END;"],
    ['en un comentario', 'BEGIN NULL; -- COMMIT;\n/* COMMIT; */ END;'],
    ['una columna llamada commit', 'BEGIN UPDATE t SET commit = 1 WHERE id = 1; END;'],
    ['una variable commit_flag', 'DECLARE commit_flag NUMBER; BEGIN commit_flag := 1; END;'],
    ['un ROLLBACK', 'BEGIN UPDATE t SET a = 1 WHERE id = 1; ROLLBACK; END;'],
    ['el bloque sin COMMIT', 'BEGIN UPDATE t SET a = 1 WHERE id = 1; END;']
  ]
  for (const [nombre, texto] of negativos) {
    const n = decidirLote(partir(texto, 'oracle'), opts('oracle', pendiente))
    check(`NEGATIVO: ${nombre}: sin el aviso`, n.tipo === 'confirmar' && n.textos.mensaje.indexOf(AVISO) === -1, n.tipo === 'confirmar' ? j(n.textos.mensaje) : j(n))
  }
  const call = decidirLote(partir('CALL p_que_confirma()', 'oracle'), opts('oracle', pendiente))
  check(
    'NEGATIVO: CALL (el COMMIT, si lo hay, está en el servidor): pregunta, pero no adivina',
    call.tipo === 'confirmar' && call.textos.mensaje.indexOf(AVISO) === -1,
    call.tipo === 'confirmar' ? j(call.textos.mensaje) : j(call)
  )
  const creaProc = decidirLote(partir('CREATE OR REPLACE PROCEDURE p AS BEGIN COMMIT; END;\n/', 'oracle'), opts('oracle', pendiente))
  check(
    'NEGATIVO: CREATE PROCEDURE con COMMIT (crearlo no lo ejecuta; el DDL tiene su propio aviso)',
    creaProc.tipo === 'confirmar' && creaProc.textos.mensaje.indexOf(AVISO) === -1 && creaProc.textos.mensaje.indexOf('hace COMMIT de lo pendiente') !== -1,
    creaProc.tipo === 'confirmar' ? j(creaProc.textos.mensaje) : j(creaProc)
  )
  const pg = decidirLote(partir('DO $$ BEGIN UPDATE t SET a = 1 WHERE id = 1; COMMIT; END $$', 'postgres'), opts('postgres', pendiente))
  check(
    'NEGATIVO: PostgreSQL (un COMMIT dentro de una transacción falla, no confirma nada)',
    pg.tipo === 'confirmar' && pg.textos.mensaje.indexOf(AVISO) === -1,
    pg.tipo === 'confirmar' ? j(pg.textos.mensaje) : j(pg)
  )
  const fuera = decidirLote(bloque, { ...opts('oracle', pendiente), entorno: 'desarrollo' })
  check('NEGATIVO: fuera de producción no hay diálogo', fuera.tipo === 'libre', j(fuera))
  // Del revisor (R1): en Auto no hay «confirmación del COMMIT» que saltarse ni nada
  // pendiente que arrastrar (el trabajador confirma cada sentencia), así que la frase
  // sería falsa y, peor, ruido en cada bloque. La confirmación de producción sigue.
  const auto = decidirLote(bloque, opts('oracle', sesion({ txModo: 'auto', tx: 'ninguna' })))
  check(
    'NEGATIVO: en Auto pregunta igual, pero sin el aviso del COMMIT (no hay confirmación del COMMIT que saltarse)',
    auto.tipo === 'confirmar' && auto.produccion && auto.textos.mensaje.indexOf(AVISO) === -1,
    auto.tipo === 'confirmar' ? j(auto.textos.mensaje) : j(auto)
  )
  check(
    '… y sin sesión todavía cuenta como Manual (el modo con el que el main abre la de producción)',
    uno.tipo === 'confirmar' && uno.textos.mensaje.indexOf(AVISO) !== -1,
    uno.tipo === 'confirmar' ? j(uno.textos.mensaje) : j(uno)
  )
}

// ---------------------------------------------------------------------------------
const pasadas = results.filter((r) => r.pass).length
const allPass = pasadas === results.length
hr(`VEREDICTO: ${pasadas}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
