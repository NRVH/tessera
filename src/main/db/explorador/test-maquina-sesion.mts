#!/usr/bin/env node
// =============================================================================
// Prueba de la máquina de estados de una sesión del explorador (`maquinaSesion.ts`). Pura:
// sin electron, sin drivers, sin reloj real. Recorre cada evento y sus rechazos, las dos fases
// de las transacciones, las pérdidas con una confirmación en camino, la resolución en bloque y
// las invariantes, también con un paseo aleatorio. (npm run test:db-sesion)
// =============================================================================

import {
  accionEnBloque,
  aEstadoSesion,
  confirmaEnVuelo,
  estadoInicial,
  invariantesRotas,
  MENSAJES,
  tieneTxPendiente,
  transicion,
  type ClaseSentencia,
  type EstadoMaquinaSesion,
  type EventoSesion,
  type Transicion
} from './maquinaSesion.ts'
import type { DbEstadoTx } from '../../../shared/db-explorador-ipc.ts'
import { MOTORES } from '../../../shared/motores/index.ts'

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
// Ayudas
// ---------------------------------------------------------------------------
let reloj = 1_000_000
function t(): number {
  reloj += 1000
  return reloj
}

function tipos(r: Transicion): string {
  return r.efectos.map((e) => (e.tipo === 'rechazar' ? `rechazar:${e.motivo}` : e.tipo)).join(',')
}

/** Sesión abierta y lista. */
function abierta(opciones: { soloLectura?: boolean; txModo?: 'auto' | 'manual' } = {}): EstadoMaquinaSesion {
  let e = estadoInicial({ soloLectura: opciones.soloLectura === true, ahora: t(), txModo: opciones.txModo })
  e = transicion(e, { tipo: 'abrir', ahora: t(), soloLectura: opciones.soloLectura === true }).estado
  e = transicion(e, { tipo: 'abierta', ahora: t(), esquema: 'APP' }).estado
  return e
}

/** ejecutar + terminada. */
function sentencia(e: EstadoMaquinaSesion, clase: ClaseSentencia, ok: boolean, tx?: DbEstadoTx): Transicion {
  const r1 = transicion(e, { tipo: 'ejecutar', ahora: t() })
  return transicion(r1.estado, { tipo: 'terminada', ahora: t(), clase, ok, tx })
}

function main(): void {
  hr('(1) Estado inicial')
  {
    const e = estadoInicial({ soloLectura: false, ahora: 5 })
    check('cerrada, Auto, sin tx, sin esquema', e.fase === 'cerrada' && e.txModo === 'auto' && e.tx === 'ninguna' && e.esquema === null && e.sentenciasEnTx === 0, JSON.stringify(e))
    const ro = estadoInicial({ soloLectura: true, ahora: 5, txModo: 'manual' })
    check('solo lectura fuerza Auto aunque se pida Manual', ro.txModo === 'auto', ro.txModo)
    check('sin invariantes rotas', invariantesRotas(e).length === 0 && invariantesRotas(ro).length === 0, 'ok')
  }

  hr('(2) Apertura')
  {
    const e0 = estadoInicial({ soloLectura: false, ahora: t() })
    const r1 = transicion(e0, { tipo: 'abrir', ahora: t(), soloLectura: false })
    check('abrir: cerrada -> abriendo + abrirSesion', r1.estado.fase === 'abriendo' && tipos(r1) === 'abrirSesion', tipos(r1))
    const r2 = transicion(r1.estado, { tipo: 'abierta', ahora: t(), esquema: 'VENTAS' })
    check('abierta: abriendo -> lista con su esquema', r2.estado.fase === 'lista' && r2.estado.esquema === 'VENTAS', `${r2.estado.fase} ${r2.estado.esquema}`)
    const r3 = transicion(r1.estado, { tipo: 'errorAbrir', ahora: t() })
    check('errorAbrir: abriendo -> cerrada', r3.estado.fase === 'cerrada' && r3.efectos.length === 0, r3.estado.fase)
    const rAbrirOtraVez = transicion(r2.estado, { tipo: 'abrir', ahora: t(), soloLectura: false })
    check('abrir sobre una lista no hace nada', rAbrirOtraVez.estado === r2.estado && rAbrirOtraVez.efectos.length === 0, tipos(rAbrirOtraVez))
    // Se cierra mientras abre; luego llega la respuesta: esa sesión es huérfana.
    const rCierre = transicion(r1.estado, { tipo: 'cierre', ahora: t(), motivo: 'usuario' })
    check('cierre mientras abre: cerrada sin efectos (aún no hay sesión)', rCierre.estado.fase === 'cerrada' && rCierre.efectos.length === 0, tipos(rCierre))
    const rHuerfana = transicion(rCierre.estado, { tipo: 'abierta', ahora: t(), esquema: 'X' })
    check('abierta tras el cierre: cerrarSesion (huérfana) y estado intacto', rHuerfana.estado === rCierre.estado && tipos(rHuerfana) === 'cerrarSesion', tipos(rHuerfana))
  }

  hr('(3) Una ejecución por sesión')
  {
    const e = abierta()
    const r1 = transicion(e, { tipo: 'ejecutar', ahora: 42 })
    check('ejecutar: lista -> ocupada con ocupadaDesde', r1.estado.fase === 'ocupada' && r1.estado.ocupadaDesde === 42 && r1.estado.ultimoUso === 42, `${r1.estado.fase} ${r1.estado.ocupadaDesde}`)
    const r2 = transicion(r1.estado, { tipo: 'ejecutar', ahora: t() })
    check("segunda ejecución: rechazo 'ocupada' y estado intacto", r2.estado === r1.estado && tipos(r2) === 'rechazar:ocupada', tipos(r2))
    const cerrada = estadoInicial({ soloLectura: false, ahora: t() })
    const r3 = transicion(cerrada, { tipo: 'ejecutar', ahora: t() })
    check("ejecutar sin sesión: rechazo 'cerrada' (el gestor abre antes)", tipos(r3) === 'rechazar:cerrada', tipos(r3))
    const abriendo = transicion(cerrada, { tipo: 'abrir', ahora: t(), soloLectura: false }).estado
    const r4 = transicion(abriendo, { tipo: 'ejecutar', ahora: t() })
    check("ejecutar mientras abre: rechazo 'ocupada'", tipos(r4) === 'rechazar:ocupada', tipos(r4))
    const r5 = transicion(r1.estado, { tipo: 'terminada', ahora: t(), clase: 'consulta', ok: true, tx: 'ninguna' })
    check('terminada: ocupada -> lista sin ocupadaDesde', r5.estado.fase === 'lista' && r5.estado.ocupadaDesde === undefined && !('ocupadaDesde' in r5.estado), r5.estado.fase)
  }

  hr('(4) sentenciasEnTx')
  {
    let e = abierta({ txModo: 'manual' })
    e = sentencia(e, 'consulta', true, 'ninguna').estado
    check('una consulta sin tx: 0', e.sentenciasEnTx === 0 && e.tx === 'ninguna', `${e.sentenciasEnTx}`)
    e = sentencia(e, 'dml', true, 'pendiente').estado
    check('UPDATE que abre la tx: cuenta 1', e.sentenciasEnTx === 1 && e.tx === 'pendiente', `${e.sentenciasEnTx} ${e.tx}`)
    e = sentencia(e, 'consulta', true, 'pendiente').estado
    check('una consulta dentro de la tx no cuenta', e.sentenciasEnTx === 1, `${e.sentenciasEnTx}`)
    e = sentencia(e, 'dml', false, 'pendiente').estado
    check('un DML que falla no cuenta', e.sentenciasEnTx === 1, `${e.sentenciasEnTx}`)
    for (const clase of ['plsql', 'rutina', 'bloqueo', 'otra', 'dml'] as ClaseSentencia[]) {
      e = sentencia(e, clase, true, 'pendiente').estado
    }
    check('plsql, rutina, bloqueo, otra y dml cuentan', e.sentenciasEnTx === 6, `${e.sentenciasEnTx}`)
    for (const clase of ['ddl', 'tx', 'sesion', 'cliente', 'consulta'] as ClaseSentencia[]) {
      e = sentencia(e, clase, true, 'pendiente').estado
    }
    check('ddl, tx, sesion, cliente y consulta no cuentan', e.sentenciasEnTx === 6, `${e.sentenciasEnTx}`)
    e = sentencia(e, 'tx', true, 'ninguna').estado
    check("un COMMIT escrito a mano (tx -> 'ninguna') vuelve a 0", e.sentenciasEnTx === 0 && e.tx === 'ninguna', `${e.sentenciasEnTx}`)
    const auto = sentencia(abierta(), 'dml', true, 'ninguna').estado
    check('en Auto (Oracle confirma cada execute): 0', auto.sentenciasEnTx === 0 && auto.tx === 'ninguna', `${auto.sentenciasEnTx}`)
  }

  hr('(5) PG: BEGIN del usuario en Auto, y heurística')
  {
    let e = abierta()
    e = sentencia(e, 'tx', true, 'abierta').estado
    check("BEGIN en Auto: tx 'abierta' con 0 sentencias", e.tx === 'abierta' && e.sentenciasEnTx === 0 && e.txModo === 'auto', `${e.tx} ${e.sentenciasEnTx}`)
    e = sentencia(e, 'dml', true, 'pendiente').estado
    check('INSERT dentro: pendiente, 1', e.tx === 'pendiente' && e.sentenciasEnTx === 1, `${e.tx} ${e.sentenciasEnTx}`)
    // Sobre la tx PENDIENTE: una fallida solo se revierte (ver (11)).
    const rCommit = transicion(e, { tipo: 'commit', ahora: t() })
    check('Commit habilitado en Auto si hay tx (tx !== ninguna)', tipos(rCommit) === 'tx' && rCommit.estado.fase === 'ocupada', tipos(rCommit))
    e = sentencia(e, 'dml', false, 'fallida').estado
    check("un error deja la tx 'fallida' y no cuenta", e.tx === 'fallida' && e.sentenciasEnTx === 1, `${e.tx} ${e.sentenciasEnTx}`)
    // Sonda de tx fallida: heurística.
    const m = abierta({ txModo: 'manual' })
    const h = sentencia(m, 'dml', true, undefined).estado
    check("sin sonda, un DML en Manual deja 'pendiente'", h.tx === 'pendiente' && h.sentenciasEnTx === 1, `${h.tx} ${h.sentenciasEnTx}`)
    const h2 = sentencia(abierta(), 'dml', true, undefined).estado
    check('sin sonda en Auto conserva lo que había', h2.tx === 'ninguna', h2.tx)
  }

  hr('(6) COMMIT implícito por DDL')
  {
    let e = abierta({ txModo: 'manual' })
    e = sentencia(e, 'dml', true, 'pendiente').estado
    const r = sentencia(e, 'ddl', true, 'ninguna')
    const aviso = r.efectos.find((x) => x.tipo === 'aviso')
    check('DDL con cambios pendientes que acaba en ninguna: aviso', aviso !== undefined && aviso.tipo === 'aviso' && aviso.mensaje === MENSAJES.commitImplicito, tipos(r))
    const sinTx = sentencia(abierta({ txModo: 'manual' }), 'ddl', true, 'ninguna')
    check('DDL sin nada pendiente: sin aviso', sinTx.efectos.length === 0, tipos(sinTx))
    const pgDdl = sentencia(e, 'ddl', true, 'pendiente')
    check('DDL transaccional (PG) que deja la tx viva: sin aviso', pgDdl.efectos.length === 0, tipos(pgDdl))
  }

  hr('(7) Pérdida y caída')
  {
    let e = abierta({ txModo: 'manual' })
    e = sentencia(e, 'dml', true, 'pendiente').estado
    e = transicion(e, { tipo: 'ejecutar', ahora: t() }).estado
    const r = transicion(e, { tipo: 'perdida', ahora: 777 })
    const p = r.estado
    check("perdida: fase 'perdida', tx ninguna, 0 sentencias", p.fase === 'perdida' && p.tx === 'ninguna' && p.sentenciasEnTx === 0, `${p.fase} ${p.tx}`)
    check('aviso con txPerdida y el texto del plan', p.aviso?.tipo === 'perdida' && p.aviso.txPerdida === true && p.aviso.mensaje === 'Sesión perdida; el servidor revirtió la transacción' && p.aviso.en === 777, JSON.stringify(p.aviso))
    check('txModo Manual SOBREVIVE a la pérdida', p.txModo === 'manual', p.txModo)
    check('efecto olvidarLectores', tipos(r) === 'olvidarLectores', tipos(r))
    const tarde = transicion(p, { tipo: 'terminada', ahora: t(), clase: 'dml', ok: false })
    check('la respuesta que llega después de la pérdida se ignora', tarde.estado === p, tarde.estado.fase)
    const otra = transicion(p, { tipo: 'perdida', ahora: t() })
    check('una segunda pérdida no cambia nada', otra.estado === p, 'identidad')
    const c = transicion(abierta(), { tipo: 'perdida', ahora: t(), caida: true })
    check("caída sin tx: aviso 'caida' sin txPerdida", c.estado.aviso?.tipo === 'caida' && c.estado.aviso.txPerdida === false, JSON.stringify(c.estado.aviso))
    let f = abierta()
    f = sentencia(f, 'tx', true, 'abierta').estado
    f = sentencia(f, 'dml', false, 'fallida').estado
    const pf = transicion(f, { tipo: 'perdida', ahora: t() }).estado
    check("perder una tx 'fallida' también cuenta como txPerdida", pf.aviso?.txPerdida === true, JSON.stringify(pf.aviso))
  }

  hr('(7b) una pérdida con el COMMIT en camino NO es una reversión')
  {
    // El COMMIT sale con cambios pendientes y la sesión se pierde antes de la respuesta:
    // el servidor pudo confirmarlo. Decir «revirtió» invitaba a repetir los cambios.
    let e = abierta({ txModo: 'manual' })
    e = sentencia(e, 'dml', true, 'pendiente').estado
    const enVuelo = transicion(e, { tipo: 'commit', ahora: t() }).estado
    const p = transicion(enVuelo, { tipo: 'perdida', ahora: t(), commitEnCamino: true }).estado
    check(
      'perdida con el COMMIT en camino: SIN txPerdida (el renderer no pinta «revertida») y el aviso dice que no se sabe',
      p.fase === 'perdida' && p.tx === 'ninguna' && p.aviso?.txPerdida === false && p.aviso.mensaje === MENSAJES.perdidaEnCommit && /no se sabe/.test(p.aviso.mensaje) && /Comprueba/.test(p.aviso.mensaje),
      JSON.stringify(p.aviso)
    )
    const c = transicion(enVuelo, { tipo: 'perdida', ahora: t(), caida: true, commitEnCamino: true }).estado
    check('caída del proceso con el COMMIT en camino: su propio texto, tampoco «revirtió»', c.aviso?.tipo === 'caida' && c.aviso.txPerdida === false && c.aviso.mensaje === MENSAJES.caidaEnCommit, JSON.stringify(c.aviso))
    const sinCommit = transicion(enVuelo, { tipo: 'perdida', ahora: t() }).estado
    check(
      'NEGATIVO: la MISMA pérdida sin commit en camino sigue siendo «revertida» (txPerdida)',
      sinCommit.aviso?.txPerdida === true && sinCommit.aviso.mensaje === MENSAJES.perdidaConTx,
      JSON.stringify(sinCommit.aviso)
    )
    const sinCambios = transicion(abierta(), { tipo: 'perdida', ahora: t(), commitEnCamino: true }).estado
    check(
      'NEGATIVO: sin cambios pendientes (p. ej. una escritura en Auto) no hay tx que dudar: el aviso de siempre',
      sinCambios.aviso?.txPerdida === false && sinCambios.aviso.mensaje === MENSAJES.perdidaSinTx,
      JSON.stringify(sinCambios.aviso)
    )
    let f = abierta({ txModo: 'manual' })
    f = sentencia(f, 'dml', false, 'fallida').estado
    const pf = transicion(f, { tipo: 'perdida', ahora: t(), commitEnCamino: true }).estado
    check("NEGATIVO: una tx 'fallida' no se confirma nunca: sigue contando como perdida", pf.aviso?.txPerdida === true && pf.aviso.mensaje === MENSAJES.perdidaConTx, JSON.stringify(pf.aviso))
    check(
      'ningún texto «en duda» dice «revirtió»',
      [MENSAJES.perdidaEnCommit, MENSAJES.caidaEnCommit, MENSAJES.perdidaEnAuto, MENSAJES.caidaEnAuto, MENSAJES.perdidaPorDentro, MENSAJES.caidaPorDentro].every(
        (m) => !/revirti/.test(m) && /no se sabe/.test(m)
      ),
      'ok'
    )
    // la confirmación que un bloque o una rutina de Oracle
    // pueden hacer POR DENTRO tiene su texto (no hay un COMMIT a la vista que nombrar).
    const pd = transicion(enVuelo, { tipo: 'perdida', ahora: t(), commitEnCamino: true, porDentro: true }).estado
    const cd = transicion(enVuelo, { tipo: 'perdida', ahora: t(), caida: true, commitEnCamino: true, porDentro: true }).estado
    check(
      'perdida (y caída) con un bloque o una rutina que pueden confirmar por dentro: SIN txPerdida y con su texto, que no habla de un COMMIT',
      pd.aviso?.txPerdida === false && pd.aviso.mensaje === MENSAJES.perdidaPorDentro && cd.aviso?.tipo === 'caida' && cd.aviso.txPerdida === false && cd.aviso.mensaje === MENSAJES.caidaPorDentro &&
        !/COMMIT/.test(MENSAJES.perdidaPorDentro),
      JSON.stringify([pd.aviso, cd.aviso])
    )
    const pdSin = transicion(abierta({ txModo: 'manual' }), { tipo: 'perdida', ahora: t(), commitEnCamino: true, porDentro: true }).estado
    const pdSolo = transicion(enVuelo, { tipo: 'perdida', ahora: t(), porDentro: true }).estado
    check(
      'NEGATIVO: sin nada pendiente, el aviso de siempre (el error de la sentencia ya lo dice); y `porDentro` sin confirmación en camino no cambia nada',
      pdSin.aviso?.txPerdida === false && pdSin.aviso.mensaje === MENSAJES.perdidaSinTx && pdSolo.aviso?.txPerdida === true && pdSolo.aviso.mensaje === MENSAJES.perdidaConTx,
      JSON.stringify([pdSin.aviso, pdSolo.aviso])
    )

    // Qué sentencia de consola lleva una confirmación en camino. El tercer argumento son las
    // capacidades de la sesión del motor (antes un booleano `oracle`).
    const O = MOTORES.oracle.sesion
    const P = MOTORES.postgres.sesion
    const st = (clase: ClaseSentencia, verbo = 'X'): { clase: ClaseSentencia; verbo: string } => ({ clase, verbo })
    check(
      "COMMIT (y el END de PG) escrito con cambios pendientes: 'commit', en Manual y en Auto",
      confirmaEnVuelo(st('tx', 'COMMIT'), true, O, 'pendiente') === 'commit' && confirmaEnVuelo(st('tx', 'END'), false, P, 'pendiente') === 'commit',
      'commit'
    )
    check(
      'NEGATIVO: un COMMIT sin cambios, o sobre una fallida (es un ROLLBACK), o un ROLLBACK/BEGIN: nada en camino',
      confirmaEnVuelo(st('tx', 'COMMIT'), true, O, 'ninguna') === null &&
        confirmaEnVuelo(st('tx', 'COMMIT'), true, P, 'fallida') === null &&
        confirmaEnVuelo(st('tx', 'COMMIT'), false, P, 'abierta') === null &&
        confirmaEnVuelo(st('tx', 'ROLLBACK'), true, O, 'pendiente') === null &&
        confirmaEnVuelo(st('tx', 'BEGIN'), false, P, 'ninguna') === null,
      'null'
    )
    const escrituras: ClaseSentencia[] = ['dml', 'plsql', 'rutina', 'ddl', 'otra']
    check(
      "en Auto sin transacción, lo que escribe se confirma solo: 'implicito' (Oracle y PG)",
      escrituras.every((c) => confirmaEnVuelo(st(c), false, O, 'ninguna') === 'implicito' && confirmaEnVuelo(st(c), false, P, 'ninguna') === 'implicito'),
      'implicito'
    )
    check(
      'NEGATIVO en Auto: lo que no escribe (consulta, bloqueo, sesión), y un DML dentro de un BEGIN escrito a mano (PG)',
      (['consulta', 'bloqueo', 'sesion'] as ClaseSentencia[]).every((c) => confirmaEnVuelo(st(c), false, O, 'ninguna') === null) &&
        confirmaEnVuelo(st('dml'), false, P, 'abierta') === null &&
        confirmaEnVuelo(st('dml'), false, P, 'pendiente') === null,
      'null'
    )
    check(
      "en Manual: el DDL de Oracle (confirma lo pendiente de forma implícita); NEGATIVO: el de PG y un DML",
      confirmaEnVuelo(st('ddl'), true, O, 'pendiente') === 'implicito' && confirmaEnVuelo(st('ddl'), true, P, 'pendiente') === null && confirmaEnVuelo(st('dml'), true, O, 'pendiente') === null,
      'ok'
    )
    check(
      'NEGATIVO, Oracle en Manual: lo que no puede confirmar la transacción (DML, consulta, bloqueo, ALTER SESSION) no lleva nada en camino',
      (['dml', 'consulta', 'bloqueo', 'sesion'] as ClaseSentencia[]).every((c) => confirmaEnVuelo(st(c), true, O, 'pendiente') === null && confirmaEnVuelo(st(c), true, O, 'ninguna') === null),
      'null'
    )
    // un bloque PL/SQL de Oracle con un COMMIT escrito, en Manual,
    // lleva una confirmación en camino (el gestor lo sabe por `plsqlConCommitEscrito`).
    const bloque = (commitEscrito: boolean): { clase: ClaseSentencia; verbo: string; commitEscrito: boolean } => ({ clase: 'plsql', verbo: 'BEGIN', commitEscrito })
    check(
      "Oracle, Manual: un bloque con un COMMIT escrito es 'commit', con cambios pendientes y sin ellos (confirma lo que escribió él)",
      confirmaEnVuelo(bloque(true), true, O, 'pendiente') === 'commit' && confirmaEnVuelo(bloque(true), true, O, 'ninguna') === 'commit',
      String(confirmaEnVuelo(bloque(true), true, O, 'pendiente'))
    )
    // sin COMMIT escrito, el bloque (o una rutina) puede confirmar
    // POR DENTRO (un procedimiento con COMMIT; MEDIDO en la 11.2 y la 21c, ver la cabecera del módulo).
    const rutina = (commitEscrito: boolean): { clase: ClaseSentencia; verbo: string; commitEscrito: boolean } => ({ clase: 'rutina', verbo: 'CALL', commitEscrito })
    check(
      "Oracle, Manual: un bloque SIN COMMIT escrito, y una rutina (CALL, EXEC), son 'porDentro', con cambios pendientes y sin ellos",
      confirmaEnVuelo(bloque(false), true, O, 'pendiente') === 'porDentro' &&
        confirmaEnVuelo(bloque(false), true, O, 'ninguna') === 'porDentro' &&
        confirmaEnVuelo(rutina(false), true, O, 'pendiente') === 'porDentro' &&
        confirmaEnVuelo(rutina(true), true, O, 'ninguna') === 'porDentro',
      String(confirmaEnVuelo(bloque(false), true, O, 'pendiente'))
    )
    check(
      'NEGATIVO: los mismos en PG (allí un COMMIT dentro de la transacción de Manual falla)',
      confirmaEnVuelo(bloque(true), true, P, 'pendiente') === null &&
        confirmaEnVuelo(bloque(false), true, P, 'pendiente') === null &&
        confirmaEnVuelo(rutina(false), true, P, 'pendiente') === null,
      'null'
    )
    check(
      "NEGATIVO: en Auto la marca no cambia nada: sin tx el bloque ya era 'implicito', y con una tx viva, nada",
      confirmaEnVuelo(bloque(true), false, O, 'ninguna') === 'implicito' && confirmaEnVuelo(bloque(true), false, O, 'pendiente') === null,
      'ok'
    )
    // cada capacidad gobierna SU línea. Con una sola de las dos (ningún
    // motor de hoy es así; un motor nuevo podría), el DDL depende solo de
    // `ddlConfirmaImplicito` y los bloques y rutinas solo de `rutinasConfirmanPorDentro`.
    const soloDdl = { ddlConfirmaImplicito: true, rutinasConfirmanPorDentro: false }
    const soloRutinas = { ddlConfirmaImplicito: false, rutinasConfirmanPorDentro: true }
    check(
      'capacidades sueltas: solo el DDL confirma con `ddlConfirmaImplicito`; solo bloques y rutinas con `rutinasConfirmanPorDentro`',
      confirmaEnVuelo(st('ddl'), true, soloDdl, 'pendiente') === 'implicito' &&
        confirmaEnVuelo(bloque(true), true, soloDdl, 'pendiente') === null &&
        confirmaEnVuelo(rutina(false), true, soloDdl, 'pendiente') === null &&
        confirmaEnVuelo(st('ddl'), true, soloRutinas, 'pendiente') === null &&
        confirmaEnVuelo(bloque(true), true, soloRutinas, 'pendiente') === 'commit' &&
        confirmaEnVuelo(bloque(false), true, soloRutinas, 'ninguna') === 'porDentro' &&
        confirmaEnVuelo(rutina(false), true, soloRutinas, 'pendiente') === 'porDentro',
      'ok'
    )
    check(
      'los valores del descriptor son los del booleano de antes: Oracle las dos, PG ninguna',
      O.ddlConfirmaImplicito && O.rutinasConfirmanPorDentro && !P.ddlConfirmaImplicito && !P.rutinasConfirmanPorDentro,
      JSON.stringify([O.ddlConfirmaImplicito, O.rutinasConfirmanPorDentro, P.ddlConfirmaImplicito, P.rutinasConfirmanPorDentro])
    )
  }

  hr('(8) Inactividad: nunca con tx pendiente o fallida')
  {
    const umbral = 30 * 60 * 1000
    let e = abierta({ txModo: 'manual' })
    e = sentencia(e, 'dml', true, 'pendiente').estado
    const lejos = e.ultimoUso + umbral * 10
    const r1 = transicion(e, { tipo: 'inactividad', ahora: lejos, umbralMs: umbral })
    check('con tx pendiente: NO cierra (mismo objeto, sin efectos)', r1.estado === e && r1.efectos.length === 0, r1.estado.fase)
    let f = abierta()
    f = sentencia(f, 'tx', true, 'abierta').estado
    f = sentencia(f, 'dml', false, 'fallida').estado
    const r2 = transicion(f, { tipo: 'inactividad', ahora: f.ultimoUso + umbral * 10, umbralMs: umbral })
    check('con tx fallida: NO cierra', r2.estado === f, r2.estado.fase)
    const ocupada = transicion(abierta(), { tipo: 'ejecutar', ahora: t() }).estado
    const r3 = transicion(ocupada, { tipo: 'inactividad', ahora: ocupada.ultimoUso + umbral * 10, umbralMs: umbral })
    check('ocupada: NO cierra', r3.estado === ocupada, r3.estado.fase)
    const lista = abierta({ txModo: 'manual' })
    const r4 = transicion(lista, { tipo: 'inactividad', ahora: lista.ultimoUso + umbral - 1, umbralMs: umbral })
    check('antes del umbral: no cierra', r4.estado === lista, r4.estado.fase)
    const r5 = transicion(lista, { tipo: 'inactividad', ahora: lista.ultimoUso + umbral, umbralMs: umbral })
    check('al llegar al umbral sin tx: cerrada + olvidarLectores + cerrarSesion', r5.estado.fase === 'cerrada' && tipos(r5) === 'olvidarLectores,cerrarSesion', tipos(r5))
    check("aviso 'inactividad' sin txPerdida", r5.estado.aviso?.tipo === 'inactividad' && r5.estado.aviso.txPerdida === false, JSON.stringify(r5.estado.aviso))
    check('txModo Manual SOBREVIVE a la inactividad', r5.estado.txModo === 'manual', r5.estado.txModo)
    let a = abierta()
    a = sentencia(a, 'tx', true, 'abierta').estado
    const r6 = transicion(a, { tipo: 'inactividad', ahora: a.ultimoUso + umbral, umbralMs: umbral })
    check("tx 'abierta' (BEGIN sin cambios): sí cierra (se revierte sin pérdida)", r6.estado.fase === 'cerrada' && r6.estado.tx === 'ninguna', r6.estado.fase)
    const cerrada = r5.estado
    const r7 = transicion(cerrada, { tipo: 'inactividad', ahora: cerrada.ultimoUso + umbral * 2, umbralMs: umbral })
    check('ya cerrada: nada', r7.estado === cerrada, 'identidad')
  }

  hr('(9) Reapertura con aviso')
  {
    const lista = abierta()
    const cerrada = transicion(lista, { tipo: 'inactividad', ahora: lista.ultimoUso + 1, umbralMs: 1 }).estado
    const r1 = transicion(cerrada, { tipo: 'abrir', ahora: t(), soloLectura: false })
    const avisoReap = r1.efectos.find((x) => x.tipo === 'avisoReapertura')
    check('reabrir tras inactividad: abrirSesion + avisoReapertura', tipos(r1) === 'abrirSesion,avisoReapertura' && avisoReap?.tipo === 'avisoReapertura' && avisoReap.aviso.tipo === 'inactividad', tipos(r1))
    const r2 = transicion(r1.estado, { tipo: 'abierta', ahora: t(), esquema: 'APP' })
    check('al quedar lista, el aviso se retira', r2.estado.aviso === undefined && !('aviso' in r2.estado), JSON.stringify(r2.estado))
    const primera = transicion(estadoInicial({ soloLectura: false, ahora: t() }), { tipo: 'abrir', ahora: t(), soloLectura: false })
    check('la primera apertura no avisa', tipos(primera) === 'abrirSesion', tipos(primera))
  }

  hr('(10) Cambio de modo')
  {
    const ro = abierta({ soloLectura: true })
    const r1 = transicion(ro, { tipo: 'cambioModo', ahora: t(), modo: 'manual' })
    check("solo lectura rechaza Manual con 'soloLectura'", r1.estado === ro && tipos(r1) === 'rechazar:soloLectura', tipos(r1))
    const rw = abierta()
    const r2 = transicion(rw, { tipo: 'cambioModo', ahora: t(), modo: 'manual' })
    check('Auto -> Manual: inmediato', r2.estado.txModo === 'manual' && r2.efectos.length === 0, r2.estado.txModo)
    const r3 = transicion(r2.estado, { tipo: 'cambioModo', ahora: t(), modo: 'auto' })
    check('Manual -> Auto sin tx: inmediato', r3.estado.txModo === 'auto' && r3.efectos.length === 0, r3.estado.txModo)

    let conAbierta = abierta({ txModo: 'manual' })
    conAbierta = sentencia(conAbierta, 'consulta', true, 'abierta').estado
    const r4 = transicion(conAbierta, { tipo: 'cambioModo', ahora: t(), modo: 'auto' })
    const ef4 = r4.efectos[0]
    check('Manual -> Auto con tx abierta: COMMIT silencioso pedido, aún Manual y ocupada', ef4?.tipo === 'tx' && ef4.accion === 'commit' && ef4.silencioso === true && ef4.tras?.modo === 'auto' && r4.estado.txModo === 'manual' && r4.estado.fase === 'ocupada', tipos(r4))
    const r5 = transicion(r4.estado, { tipo: 'txResuelta', ahora: t(), tx: 'ninguna', tras: ef4?.tipo === 'tx' ? ef4.tras : undefined })
    check('txResuelta ninguna: ahora sí Auto y lista', r5.estado.txModo === 'auto' && r5.estado.fase === 'lista' && r5.estado.tx === 'ninguna', `${r5.estado.txModo} ${r5.estado.fase}`)

    let pend = abierta({ txModo: 'manual' })
    pend = sentencia(pend, 'dml', true, 'pendiente').estado
    const r6 = transicion(pend, { tipo: 'cambioModo', ahora: t(), modo: 'auto' })
    check("Manual -> Auto con tx pendiente y sin resolver: rechazo 'txPendiente'", r6.estado === pend && tipos(r6) === 'rechazar:txPendiente', tipos(r6))
    const r7 = transicion(pend, { tipo: 'cambioModo', ahora: t(), modo: 'auto', resolver: 'rollback' })
    const ef7 = r7.efectos[0]
    check('con resolver rollback: se pide ROLLBACK (no silencioso)', ef7?.tipo === 'tx' && ef7.accion === 'rollback' && ef7.silencioso === false, tipos(r7))
    const r8 = transicion(r7.estado, { tipo: 'txResuelta', ahora: t(), tx: 'pendiente', tras: { modo: 'auto' } })
    check('si la tx NO quedó en ninguna, el modo no cambia (sigue Manual con su tx)', r8.estado.txModo === 'manual' && r8.estado.tx === 'pendiente' && r8.estado.fase === 'lista', `${r8.estado.txModo} ${r8.estado.tx}`)
    const ocupada = transicion(pend, { tipo: 'ejecutar', ahora: t() }).estado
    const r9 = transicion(ocupada, { tipo: 'cambioModo', ahora: t(), modo: 'auto', resolver: 'commit' })
    check("mientras ejecuta: rechazo 'ocupada'", tipos(r9) === 'rechazar:ocupada', tipos(r9))
    const cerrada = estadoInicial({ soloLectura: false, ahora: t() })
    const r10 = transicion(cerrada, { tipo: 'cambioModo', ahora: t(), modo: 'manual' })
    check('con la sesión cerrada el modo se guarda igual', r10.estado.txModo === 'manual' && r10.estado.fase === 'cerrada', r10.estado.txModo)
    let fallida = abierta({ txModo: 'manual' })
    fallida = sentencia(fallida, 'dml', false, 'fallida').estado
    const r11 = transicion(fallida, { tipo: 'cambioModo', ahora: t(), modo: 'auto', resolver: 'commit' })
    check("Manual -> Auto con tx fallida y resolver commit: rechazo 'txFallida'", r11.estado === fallida && tipos(r11) === 'rechazar:txFallida', tipos(r11))
    const r12 = transicion(fallida, { tipo: 'cambioModo', ahora: t(), modo: 'auto', resolver: 'rollback' })
    const ef12 = r12.efectos[0]
    check('…y con resolver rollback: se pide el ROLLBACK', ef12?.tipo === 'tx' && ef12.accion === 'rollback' && ef12.tras?.modo === 'auto', tipos(r12))
  }

  hr('(11) Commit y rollback')
  {
    const ro = abierta({ soloLectura: true })
    const r1 = transicion(ro, { tipo: 'commit', ahora: t() })
    check("solo lectura: rechazo 'soloLectura'", tipos(r1) === 'rechazar:soloLectura', tipos(r1))
    const sinTx = abierta({ txModo: 'manual' })
    const r2 = transicion(sinTx, { tipo: 'rollback', ahora: t() })
    check('sin tx: no hace nada (mismo objeto)', r2.estado === sinTx && r2.efectos.length === 0, tipos(r2))
    let pend = abierta({ txModo: 'manual' })
    pend = sentencia(pend, 'dml', true, 'pendiente').estado
    pend = sentencia(pend, 'dml', true, 'pendiente').estado
    const r3 = transicion(pend, { tipo: 'commit', ahora: t() })
    const ef3 = r3.efectos[0]
    check('commit: efecto tx commit no silencioso, fase ocupada', ef3?.tipo === 'tx' && ef3.accion === 'commit' && !ef3.silencioso && r3.estado.fase === 'ocupada', tipos(r3))
    const r4 = transicion(r3.estado, { tipo: 'commit', ahora: t() })
    check("un segundo commit mientras tanto: 'ocupada'", tipos(r4) === 'rechazar:ocupada', tipos(r4))
    const r5 = transicion(r3.estado, { tipo: 'txResuelta', ahora: t(), tx: 'ninguna' })
    check('txResuelta: lista, tx ninguna, contador a 0, sigue Manual', r5.estado.fase === 'lista' && r5.estado.tx === 'ninguna' && r5.estado.sentenciasEnTx === 0 && r5.estado.txModo === 'manual', JSON.stringify(r5.estado))
    // PG convierte el COMMIT de una tx abortada en ROLLBACK y lo da por bueno.
    let fallida = abierta({ txModo: 'manual' })
    fallida = sentencia(fallida, 'dml', false, 'fallida').estado
    const r6 = transicion(fallida, { tipo: 'commit', ahora: t() })
    check("commit con tx fallida: rechazo 'txFallida' y estado intacto", r6.estado === fallida && tipos(r6) === 'rechazar:txFallida', tipos(r6))
    const ef6 = r6.efectos[0]
    check('con su mensaje propio (solo se puede revertir)', ef6?.tipo === 'rechazar' && ef6.mensaje === MENSAJES.txFallida, JSON.stringify(ef6))
    const r7 = transicion(fallida, { tipo: 'rollback', ahora: t() })
    const ef7 = r7.efectos[0]
    check('rollback con tx fallida: sí se pide', ef7?.tipo === 'tx' && ef7.accion === 'rollback', tipos(r7))
  }

  hr('(12) Cierre')
  {
    let pend = abierta({ txModo: 'manual' })
    pend = sentencia(pend, 'dml', true, 'pendiente').estado
    const r1 = transicion(pend, { tipo: 'cierre', ahora: t(), motivo: 'usuario' })
    check("con tx pendiente y sin resolver: rechazo 'txPendiente' (no cierra)", r1.estado === pend && tipos(r1) === 'rechazar:txPendiente', tipos(r1))
    check('tieneTxPendiente', tieneTxPendiente(pend) && !tieneTxPendiente(abierta()), 'ok')
    const r2 = transicion(pend, { tipo: 'cierre', ahora: t(), motivo: 'usuario', resolver: 'rollback' })
    check('resolver rollback: cierra (el cierre revierte)', r2.estado.fase === 'cerrada' && tipos(r2) === 'olvidarLectores,cerrarSesion', tipos(r2))
    check('cierre del usuario: sin aviso, txModo conservado', r2.estado.aviso === undefined && r2.estado.txModo === 'manual', JSON.stringify(r2.estado))
    const r3 = transicion(pend, { tipo: 'cierre', ahora: t(), motivo: 'usuario', resolver: 'commit' })
    const ef3 = r3.efectos[0]
    check('resolver commit: primero COMMIT, con cerrar detrás', ef3?.tipo === 'tx' && ef3.accion === 'commit' && ef3.tras?.cerrar === 'usuario' && r3.estado.fase === 'ocupada', tipos(r3))
    const r4 = transicion(r3.estado, { tipo: 'txResuelta', ahora: t(), tx: 'ninguna', tras: { cerrar: 'usuario' } })
    check('COMMIT bien: se cierra', r4.estado.fase === 'cerrada' && tipos(r4) === 'olvidarLectores,cerrarSesion', tipos(r4))
    const r5 = transicion(r3.estado, { tipo: 'txResuelta', ahora: t(), tx: 'pendiente', tras: { cerrar: 'usuario' } })
    check('COMMIT mal (tx sigue viva): NO se cierra', r5.estado.fase === 'lista' && r5.estado.tx === 'pendiente' && r5.efectos.length === 0, r5.estado.fase)
    const r6 = transicion(abierta(), { tipo: 'cierre', ahora: 99, motivo: 'editada' })
    check("motivo editada: aviso 'editada'", r6.estado.aviso?.tipo === 'editada' && r6.estado.aviso.en === 99, JSON.stringify(r6.estado.aviso))
    const r7 = transicion(abierta(), { tipo: 'cierre', ahora: t(), motivo: 'expulsada' })
    check("motivo expulsada: aviso 'expulsada'", r7.estado.aviso?.tipo === 'expulsada', JSON.stringify(r7.estado.aviso))
    const ocupada = transicion(abierta(), { tipo: 'ejecutar', ahora: t() }).estado
    const r8 = transicion(ocupada, { tipo: 'cierre', ahora: t(), motivo: 'usuario', resolver: 'rollback' })
    check("ejecutando: rechazo 'ocupada' (la UI pregunta «¿Detener y cerrar?»)", tipos(r8) === 'rechazar:ocupada', tipos(r8))
    const cerrada = estadoInicial({ soloLectura: false, ahora: t() })
    const r9 = transicion(cerrada, { tipo: 'cierre', ahora: t(), motivo: 'usuario' })
    check('cerrar lo ya cerrado sin aviso: nada', r9.estado === cerrada && r9.efectos.length === 0, 'identidad')
    const perdida = transicion(abierta(), { tipo: 'perdida', ahora: t() }).estado
    const r10 = transicion(perdida, { tipo: 'cierre', ahora: t(), motivo: 'usuario' })
    check('cerrar una perdida: cerrada, sin cerrarSesion (no hay sesión viva)', r10.estado.fase === 'cerrada' && r10.efectos.length === 0, tipos(r10))
    let fallida = abierta({ txModo: 'manual' })
    fallida = sentencia(fallida, 'dml', false, 'fallida').estado
    const r11 = transicion(fallida, { tipo: 'cierre', ahora: t(), motivo: 'usuario', resolver: 'commit' })
    check("tx fallida y resolver commit: rechazo 'txFallida' (no cierra ni pide COMMIT)", r11.estado === fallida && tipos(r11) === 'rechazar:txFallida', tipos(r11))
    const r12 = transicion(fallida, { tipo: 'cierre', ahora: t(), motivo: 'usuario', resolver: 'rollback' })
    check('tx fallida y resolver rollback: cierra (el cierre revierte)', r12.estado.fase === 'cerrada' && tipos(r12) === 'olvidarLectores,cerrarSesion', tipos(r12))
  }

  hr('(13) Solo lectura')
  {
    let manual = abierta({ txModo: 'manual' })
    manual = transicion(manual, { tipo: 'cierre', ahora: t(), motivo: 'editada' }).estado
    const r1 = transicion(manual, { tipo: 'abrir', ahora: t(), soloLectura: true })
    check('reabrir tras pasar la conexión a solo lectura fuerza Auto', r1.estado.soloLectura && r1.estado.txModo === 'auto', `${r1.estado.soloLectura} ${r1.estado.txModo}`)
    const ro = abierta({ soloLectura: true })
    const r2 = sentencia(ro, 'bloqueo', true, 'pendiente')
    check("el servidor dice 'pendiente' en solo lectura: rollbackSilencioso y ninguna", r2.estado.tx === 'ninguna' && tipos(r2).indexOf('rollbackSilencioso') >= 0, tipos(r2))
    const r3 = sentencia(ro, 'dml', true, undefined)
    check('sin sonda en solo lectura: ninguna', r3.estado.tx === 'ninguna', r3.estado.tx)
  }

  hr('(14) Identidad')
  {
    const e = abierta()
    const casos: EventoSesion[] = [
      { tipo: 'abrir', ahora: t(), soloLectura: false },
      { tipo: 'abierta', ahora: t(), esquema: 'OTRO' },
      { tipo: 'errorAbrir', ahora: t() },
      { tipo: 'terminada', ahora: t(), clase: 'consulta', ok: true },
      { tipo: 'txResuelta', ahora: t(), tx: 'ninguna' },
      { tipo: 'cambioModo', ahora: t(), modo: 'auto' },
      { tipo: 'commit', ahora: t() },
      { tipo: 'inactividad', ahora: t(), umbralMs: 60 * 60 * 1000 }
    ]
    const cambiaron = casos.filter((ev) => transicion(e, ev).estado !== e).map((ev) => ev.tipo)
    check('eventos sin efecto en una sesión lista devuelven el mismo objeto', cambiaron.length === 0, cambiaron.join(',') || 'ninguno')
  }

  hr('(14b) el Stop que MATA el proceso (detenida) no es una pérdida')
  {
    // Sin transacción: se cierra en silencio y se reabre al usarla (sin aviso de pérdida).
    const ocupada = transicion(abierta(), { tipo: 'ejecutar', ahora: t() }).estado
    const r = transicion(ocupada, { tipo: 'detenida', ahora: 900 })
    check("detenida sin tx: fase 'cerrada', tx ninguna, sin aviso", r.estado.fase === 'cerrada' && r.estado.tx === 'ninguna' && r.estado.aviso === undefined, JSON.stringify(r.estado))
    check('detenida: efecto olvidarLectores y nada más', tipos(r) === 'olvidarLectores', tipos(r))
    const tarde = transicion(r.estado, { tipo: 'terminada', ahora: t(), clase: 'consulta', ok: false })
    check('la respuesta (cancelada) que llega después se ignora', tarde.estado === r.estado, tarde.estado.fase)
    const reabrir = transicion(r.estado, { tipo: 'abrir', ahora: t(), soloLectura: false })
    check('se reabre sin aviso de reapertura', tipos(reabrir) === 'abrirSesion', tipos(reabrir))
    // Una transacción 'abierta' (un BEGIN que solo leyó) no pierde nada: sin aviso.
    let a = abierta({ txModo: 'manual' })
    a = sentencia(a, 'consulta', true, 'abierta').estado
    a = transicion(a, { tipo: 'ejecutar', ahora: t() }).estado
    const sinCambios = transicion(a, { tipo: 'detenida', ahora: t() }).estado
    check('detenida con tx abierta (sin cambios): cerrada y sin aviso', sinCambios.fase === 'cerrada' && sinCambios.aviso === undefined, JSON.stringify(sinCambios.aviso))
    // Con cambios pendientes (el gestor no mata así, pero la máquina no se fía): el aviso lo dice.
    let m = abierta({ txModo: 'manual' })
    m = sentencia(m, 'dml', true, 'pendiente').estado
    m = transicion(m, { tipo: 'ejecutar', ahora: t() }).estado
    const conTx = transicion(m, { tipo: 'detenida', ahora: 901 }).estado
    check('detenida con tx: aviso con txPerdida y el texto', conTx.aviso?.txPerdida === true && conTx.aviso.mensaje === MENSAJES.detenidaConTx && conTx.txModo === 'manual', JSON.stringify(conTx.aviso))
    check('detenida sobre una sesión cerrada o perdida: nada', transicion(r.estado, { tipo: 'detenida', ahora: t() }).estado === r.estado, 'identidad')
    const inv = invariantesRotas(conTx)
    check('detenida respeta las invariantes', inv.length === 0, inv.join('; ') || 'ok')
  }

  hr('(15) Paseo aleatorio: invariantes en 20 000 eventos')
  {
    // PRNG determinista (mulberry32): el paseo es reproducible.
    let semilla = 0x5eed1234
    const azar = (): number => {
      semilla = (semilla + 0x6d2b79f5) | 0
      let x = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla)
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
    const uno = <T,>(xs: readonly T[]): T => xs[Math.floor(azar() * xs.length)]
    const clases: ClaseSentencia[] = ['consulta', 'bloqueo', 'dml', 'ddl', 'plsql', 'rutina', 'tx', 'sesion', 'cliente', 'otra']
    const txs: Array<DbEstadoTx | undefined> = ['ninguna', 'abierta', 'pendiente', 'fallida', undefined]
    let e = estadoInicial({ soloLectura: false, ahora: 0 })
    let ahora = 0
    const fallos: string[] = []
    let cierresConTx = 0
    let modosPerdidos = 0
    let rechazosOcupada = 0
    const vistas = new Set<string>()
    for (let i = 0; i < 20000 && fallos.length < 5; i++) {
      ahora += Math.floor(azar() * 120000)
      const n = azar()
      let ev: EventoSesion
      if (n < 0.08) ev = { tipo: 'abrir', ahora, soloLectura: azar() < 0.15 }
      else if (n < 0.16) ev = { tipo: 'abierta', ahora, esquema: uno(['A', 'B', null]) }
      else if (n < 0.19) ev = { tipo: 'errorAbrir', ahora }
      else if (n < 0.35) ev = { tipo: 'ejecutar', ahora }
      else if (n < 0.55) ev = { tipo: 'terminada', ahora, clase: uno(clases), ok: azar() < 0.8, tx: uno(txs) }
      else if (n < 0.59) ev = { tipo: 'perdida', ahora, caida: azar() < 0.3 }
      else if (n < 0.66) ev = { tipo: 'inactividad', ahora, umbralMs: uno([60000, 600000, 1800000]) }
      else if (n < 0.76) ev = { tipo: 'cambioModo', ahora, modo: uno(['auto', 'manual'] as const), resolver: uno(['commit', 'rollback', undefined] as const) }
      else if (n < 0.81) ev = { tipo: uno(['commit', 'rollback'] as const), ahora }
      else if (n < 0.87) ev = { tipo: 'txResuelta', ahora, tx: uno(['ninguna', 'pendiente', 'abierta'] as const), tras: uno([undefined, { modo: 'auto' as const }, { cerrar: 'usuario' as const }]), esquema: uno(['A', null, undefined]) }
      else if (n < 0.9) ev = { tipo: 'esquema', ahora, esquema: uno(['A', 'B', null]) }
      else if (n < 0.92) ev = { tipo: 'detenida', ahora }
      else ev = { tipo: 'cierre', ahora, motivo: uno(['usuario', 'editada', 'expulsada', 'conexionBorrada'] as const), resolver: uno(['commit', 'rollback', undefined] as const) }

      const antes = e
      const r = transicion(e, ev)
      vistas.add(r.estado.fase + '/' + r.estado.tx + '/' + r.estado.txModo)
      const rotas = invariantesRotas(r.estado)
      if (rotas.length > 0) fallos.push(`paso ${i} ${ev.tipo}: ${rotas.join('; ')}`)
      if (ev.tipo === 'inactividad' && tieneTxPendiente(antes) && r.estado !== antes) {
        cierresConTx++
        fallos.push(`paso ${i}: la inactividad tocó una sesión con tx ${antes.tx}`)
      }
      if (ev.tipo === 'perdida' && r.estado.txModo !== antes.txModo) {
        modosPerdidos++
        fallos.push(`paso ${i}: la pérdida cambió txModo`)
      }
      if (ev.tipo === 'ejecutar' && antes.fase === 'ocupada') {
        rechazosOcupada++
        if (r.estado !== antes) fallos.push(`paso ${i}: una segunda ejecución cambió el estado`)
      }
      // Un cierre (o inactividad) jamás deja atrás una tx viva sin resolverla.
      if (r.estado.fase === 'cerrada' && antes.fase === 'lista' && tieneTxPendiente(antes) && ev.tipo === 'cierre' && ev.resolver !== 'rollback') {
        fallos.push(`paso ${i}: cerró con tx ${antes.tx} sin rollback`)
      }
      e = r.estado
    }
    check('ninguna invariante rota en el paseo', fallos.length === 0, fallos.length === 0 ? `${vistas.size} combinaciones fase/tx/modo recorridas` : fallos.join(' | '))
    check('la inactividad nunca cerró con tx pendiente/fallida', cierresConTx === 0, `${cierresConTx}`)
    check('la pérdida nunca cambió txModo', modosPerdidos === 0, `${modosPerdidos}`)
    check('el paseo ejercitó ejecuciones concurrentes (rechazadas)', rechazosOcupada > 0, `${rechazosOcupada} intentos`)
    check('el paseo recorrió estados variados', vistas.size >= 12, `${vistas.size}`)
  }

  hr('(16) aEstadoSesion')
  {
    let e = abierta({ txModo: 'manual' })
    e = sentencia(e, 'dml', true, 'pendiente').estado
    const dto = aEstadoSesion(e, { rol: 'consola', perfilId: 'p1', consolaId: 'c1' }, 'con1', { modo: 'thin', driverId: null, version: '19.3' })
    check('DTO con ref, conexión, tx y contador', dto.conexionId === 'con1' && dto.ref.rol === 'consola' && dto.tx === 'pendiente' && dto.sentenciasEnTx === 1 && dto.txModo === 'manual' && dto.esquema === 'APP' && dto.driver?.modo === 'thin', JSON.stringify(dto))
    check('sin claves opcionales vacías', !('ocupadaDesde' in dto) && !('aviso' in dto), Object.keys(dto).join(','))
  }

  hr('(17) Resolución en bloque: «Confirmar» revierte las fallidas')
  {
    let pend = abierta({ txModo: 'manual' })
    pend = sentencia(pend, 'dml', true, 'pendiente').estado
    let fallida = abierta({ txModo: 'manual' })
    fallida = sentencia(fallida, 'dml', false, 'fallida').estado
    const a1 = accionEnBloque(fallida, 'commit')
    check('commit en bloque sobre una fallida: se revierte, y se marca', a1.accion === 'rollback' && a1.revertidaPorFallida, JSON.stringify(a1))
    const a2 = accionEnBloque(pend, 'commit')
    check('commit en bloque sobre una pendiente: commit, sin marca', a2.accion === 'commit' && !a2.revertidaPorFallida, JSON.stringify(a2))
    // Revertir es lo que se pidió: no hay nada que avisar.
    const a3 = accionEnBloque(fallida, 'rollback')
    const a4 = accionEnBloque(pend, 'rollback')
    check('rollback en bloque: rollback y sin marca, fallida o no', a3.accion === 'rollback' && !a3.revertidaPorFallida && a4.accion === 'rollback' && !a4.revertidaPorFallida, `${JSON.stringify(a3)} ${JSON.stringify(a4)}`)
    // Lo que el gestor hace con la decisión: el evento resultante sobre la fallida es
    // un ROLLBACK que sí se pide al servidor, no un rechazo.
    const r1 = transicion(fallida, { tipo: a1.accion, ahora: t() })
    const ef1 = r1.efectos[0]
    check('el evento resultante pide el ROLLBACK (no rechaza)', ef1?.tipo === 'tx' && ef1.accion === 'rollback', tipos(r1))
    // Y la máquina NO cambió: fuera del bloque, el Commit de UNA consola fallida sigue
    // rechazándose (su diálogo solo ofrece Revertir).
    const r2 = transicion(fallida, { tipo: 'commit', ahora: t() })
    check("fuera del bloque, commit sobre una fallida sigue siendo 'txFallida'", r2.estado === fallida && tipos(r2) === 'rechazar:txFallida', tipos(r2))
  }

  hr('(18) Esquema de la consola fuera de una sentencia')
  {
    const cerrada = estadoInicial({ soloLectura: false, ahora: t() })
    const r1 = transicion(cerrada, { tipo: 'esquema', ahora: t(), esquema: 'VENTAS' })
    check('cerrada: el esquema elegido se ve ya (se aplicará al reabrir), sin efectos ni uso', r1.estado.esquema === 'VENTAS' && r1.estado.fase === 'cerrada' && r1.efectos.length === 0 && r1.estado.ultimoUso === cerrada.ultimoUso, JSON.stringify(r1.estado))
    const r2 = transicion(r1.estado, { tipo: 'esquema', ahora: t(), esquema: 'VENTAS' })
    check('el mismo esquema: identidad (no se emite nada)', r2.estado === r1.estado, 'misma referencia')
    let lista = abierta({ txModo: 'manual' })
    lista = sentencia(lista, 'dml', true, 'pendiente').estado
    const r3 = transicion(lista, { tipo: 'esquema', ahora: t(), esquema: null })
    check('lista: cambia el esquema y NO toca la tx ni el contador', r3.estado.esquema === null && r3.estado.tx === 'pendiente' && r3.estado.sentenciasEnTx === 1, JSON.stringify(r3.estado))
    const ocupada = transicion(abierta(), { tipo: 'ejecutar', ahora: t() }).estado
    check('ocupada: se ignora (el esquema lo trae el final de la operación)', transicion(ocupada, { tipo: 'esquema', ahora: t(), esquema: 'X' }).estado === ocupada, 'identidad')
    // PG: el ROLLBACK deshizo el SET y el gestor lo volvió a aplicar: txResuelta lo trae.
    const pedida = transicion(lista, { tipo: 'rollback', ahora: t() }).estado
    const r4 = transicion(pedida, { tipo: 'txResuelta', ahora: t(), tx: 'ninguna', esquema: 'VENTAS' })
    check('txResuelta con esquema: lo aplica junto a la tx', r4.estado.esquema === 'VENTAS' && r4.estado.tx === 'ninguna' && r4.estado.fase === 'lista', JSON.stringify(r4.estado))
    const r5 = transicion(pedida, { tipo: 'txResuelta', ahora: t(), tx: 'ninguna' })
    check('txResuelta sin esquema: lo deja como estaba', r5.estado.esquema === pedida.esquema, `${r5.estado.esquema}`)
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
