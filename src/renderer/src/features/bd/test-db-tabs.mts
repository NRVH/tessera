#!/usr/bin/env node
// =============================================================================
// Prueba del modelo de pestañas del área de BD (npm run test:db-tabs): ids JSON sin
// ambigüedad (datos, fuente, DDL, consola, colección, clave, con y sin base), abrir,
// activar, cerrar (vecina, varias, otras, a cada lado, todas), mover y la raya del
// arrastre, indicador por prioridad, recorte por el centro, títulos desambiguados
// con el entorno en el tooltip, `paneKeyDb` e inmutabilidad.
// Decisiones: docs/decisiones/bd/ui-area-modelo-de-pestanas.md
// =============================================================================

import {
  ESTADO_PESTANAS_INICIAL,
  SUFIJO_DDL,
  abrirPestana,
  activarPestana,
  cerrarDerecha,
  cerrarIzquierda,
  cerrarOtras,
  cerrarPestana,
  cerrarTodas,
  cerrarVarias,
  destinoArrastre,
  filtrarPestanas,
  idDbPane,
  idsDerecha,
  idsIzquierda,
  indicadorVisible,
  moverPestana,
  paneKeyDb,
  pestanaActiva,
  recortarCentro,
  titulosPestanas,
  type DbPane,
  type DbTabsState,
  type IndicadorPestana
} from './dbTabsModel.ts'

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

const datos = (conexionId: string, esquema: string, objeto: string): DbPane => ({
  kind: 'datos',
  conexionId,
  esquema,
  objeto,
  tipo: 'tabla'
})
const consola = (conexionId: string, consolaId: string): DbPane => ({ kind: 'consola', conexionId, consolaId })
const ids = (s: DbTabsState): string => s.tabs.map((t) => (JSON.parse(t.id) as string[]).slice(-2).join('.')).join(',')

function conTres(): DbTabsState {
  let s = ESTADO_PESTANAS_INICIAL
  s = abrirPestana(s, datos('c1', 'E', 'A'))
  s = abrirPestana(s, datos('c1', 'E', 'B'))
  s = abrirPestana(s, datos('c1', 'E', 'C'))
  return s
}
const idDe = (objeto: string): string => idDbPane(datos('c1', 'E', objeto))

function main(): void {
  hr('(1) Ids')
  const a = idDbPane(datos('c1', 'A:B', 'C'))
  const b = idDbPane(datos('c1', 'A', 'B:C'))
  check('`:` en los nombres no colisiona', a !== b, `${a} vs ${b}`)
  const c = idDbPane(datos('c1', 'A.B', 'C'))
  const d = idDbPane(datos('c1', 'A', 'B.C'))
  check('`.` en los nombres no colisiona', c !== d, `${c} vs ${d}`)
  const e = idDbPane(datos('c1/x', 'A', 'B'))
  const f = idDbPane(datos('c1', 'x/A', 'B'))
  check('`/` en los nombres no colisiona', e !== f, `${e} vs ${f}`)
  const g = idDbPane(datos('c1', 'A","B', 'C'))
  check('comillas en el nombre: el id se puede volver a leer', j(JSON.parse(g)) === j(['datos', 'c1', 'A","B', 'C']), g)
  check(
    'datos: el tipo NO entra en el id (mismo objeto = misma pestaña)',
    idDbPane({ kind: 'datos', conexionId: 'c1', esquema: 'E', objeto: 'T', tipo: 'tabla' }) ===
      idDbPane({ kind: 'datos', conexionId: 'c1', esquema: 'E', objeto: 'T', tipo: 'vista' }),
    'tabla == vista'
  )
  const vistaDatos = idDbPane({ kind: 'datos', conexionId: 'c1', esquema: 'E', objeto: 'V', tipo: 'vista' })
  const vistaFuente = idDbPane({ kind: 'fuente', conexionId: 'c1', esquema: 'E', objeto: 'V', tipo: 'vista' })
  check('datos y definición de una vista son pestañas distintas', vistaDatos !== vistaFuente, `${vistaDatos} vs ${vistaFuente}`)
  const f1 = idDbPane({ kind: 'fuente', conexionId: 'c1', esquema: 'public', objeto: 'f', tipo: 'rutina', firma: 'integer' })
  const f2 = idDbPane({ kind: 'fuente', conexionId: 'c1', esquema: 'public', objeto: 'f', tipo: 'rutina', firma: 'text' })
  const f0 = idDbPane({ kind: 'fuente', conexionId: 'c1', esquema: 'public', objeto: 'f', tipo: 'rutina', firma: '' })
  const fx = idDbPane({ kind: 'fuente', conexionId: 'c1', esquema: 'public', objeto: 'f', tipo: 'rutina' })
  check('sobrecargas de PG: una pestaña de fuente por firma', f1 !== f2 && f0 !== fx && f0 !== f1, `${f1} / ${f2} / ${f0} / ${fx}`)
  check(
    'consola: el id es el de la consola',
    idDbPane(consola('c1', 'k1')) === j(['consola', 'k1']),
    idDbPane(consola('c1', 'k1'))
  )

  hr('(2) abrir')
  const s1 = abrirPestana(ESTADO_PESTANAS_INICIAL, datos('c1', 'E', 'A'))
  check('abrir la primera: 1 pestaña y activa', s1.tabs.length === 1 && s1.activeId === idDe('A'), ids(s1))
  const s3 = conTres()
  check('abrir tres: en orden y la última activa', ids(s3) === 'E.A,E.B,E.C' && s3.activeId === idDe('C'), ids(s3))
  const reabrir = abrirPestana(s3, datos('c1', 'E', 'A'))
  check(
    'reabrir una existente: no duplica, no reordena, la activa',
    ids(reabrir) === 'E.A,E.B,E.C' && reabrir.activeId === idDe('A') && reabrir.tabs === s3.tabs,
    `${ids(reabrir)} activa=${reabrir.activeId}`
  )
  check('reabrir la activa: MISMO objeto', abrirPestana(s3, datos('c1', 'E', 'C')) === s3, 'identidad')

  hr('(3) activar')
  check('activar existente', activarPestana(s3, idDe('B')).activeId === idDe('B'), 'B')
  check('activar inexistente: mismo objeto', activarPestana(s3, 'nada') === s3, 'identidad')
  check('activar la activa: mismo objeto', activarPestana(s3, idDe('C')) === s3, 'identidad')
  check('pestanaActiva', pestanaActiva(s3)?.id === idDe('C') && pestanaActiva(ESTADO_PESTANAS_INICIAL) === null, 'C / null')

  hr('(4) cerrar')
  const enB = activarPestana(s3, idDe('B'))
  const sinB = cerrarPestana(enB, idDe('B'))
  check('cerrar la activa del medio: pasa a la de la DERECHA', ids(sinB) === 'E.A,E.C' && sinB.activeId === idDe('C'), `${ids(sinB)} activa=${sinB.activeId}`)
  const sinC = cerrarPestana(s3, idDe('C'))
  check('cerrar la activa del final: pasa a la de la IZQUIERDA', sinC.activeId === idDe('B'), `activa=${sinC.activeId}`)
  const sinA = cerrarPestana(s3, idDe('A'))
  check('cerrar una no activa: la activa no cambia', sinA.activeId === idDe('C') && ids(sinA) === 'E.B,E.C', ids(sinA))
  const vacio = cerrarPestana(s1, idDe('A'))
  check('cerrar la última: activa null', vacio.tabs.length === 0 && vacio.activeId === null, j(vacio))
  check('cerrar inexistente: mismo objeto', cerrarPestana(s3, 'nada') === s3, 'identidad')

  hr('(5) cerrar varias / otras / todas / filtrar')
  let cinco = conTres()
  cinco = abrirPestana(cinco, datos('c1', 'E', 'D'))
  cinco = abrirPestana(cinco, datos('c1', 'E', 'F'))
  cinco = activarPestana(cinco, idDe('B'))
  const varias = cerrarVarias(cinco, [idDe('B'), idDe('C')])
  check(
    'cerrarVarias con la activa dentro: primera superviviente a su derecha',
    ids(varias) === 'E.A,E.D,E.F' && varias.activeId === idDe('D'),
    `${ids(varias)} activa=${varias.activeId}`
  )
  const hastaElFinal = cerrarVarias(activarPestana(cinco, idDe('D')), [idDe('D'), idDe('F')])
  check(
    'cerrarVarias sin supervivientes a la derecha: la última a la izquierda',
    hastaElFinal.activeId === idDe('C'),
    `activa=${hastaElFinal.activeId}`
  )
  check('cerrarVarias([]) y de ids desconocidos: mismo objeto', cerrarVarias(cinco, []) === cinco && cerrarVarias(cinco, ['x']) === cinco, 'identidad')
  const otras = cerrarOtras(cinco, idDe('D'))
  check('cerrarOtras: queda sola y activa', ids(otras) === 'E.D' && otras.activeId === idDe('D'), ids(otras))
  check('cerrarOtras de la única ya activa: mismo objeto', cerrarOtras(otras, idDe('D')) === otras, 'identidad')
  check('cerrarOtras de un id desconocido: mismo objeto', cerrarOtras(cinco, 'x') === cinco, 'identidad')
  check('cerrarTodas', j(cerrarTodas(cinco)) === j(ESTADO_PESTANAS_INICIAL), j(cerrarTodas(cinco)))
  check('cerrarTodas sin pestañas: mismo objeto', cerrarTodas(ESTADO_PESTANAS_INICIAL) === ESTADO_PESTANAS_INICIAL, 'identidad')
  let mezcla = abrirPestana(ESTADO_PESTANAS_INICIAL, datos('c1', 'E', 'A'))
  mezcla = abrirPestana(mezcla, consola('c2', 'k1'))
  mezcla = abrirPestana(mezcla, datos('c2', 'E', 'B'))
  mezcla = abrirPestana(mezcla, consola('c1', 'k2'))
  const sinC2 = filtrarPestanas(mezcla, (p) => p.conexionId !== 'c2')
  check(
    'filtrarPestanas: poda por conexión (datos y consolas)',
    sinC2.tabs.length === 2 && sinC2.tabs.every((t) => t.pane.conexionId === 'c1') && sinC2.activeId === idDbPane(consola('c1', 'k2')),
    ids(sinC2)
  )
  check('filtrarPestanas que conserva todo: mismo objeto', filtrarPestanas(mezcla, () => true) === mezcla, 'identidad')

  hr('(6) indicadorVisible')
  const conj = (...xs: IndicadorPestana[]): ReadonlySet<IndicadorPestana> => new Set(xs)
  check('vacío -> null', indicadorVisible(conj()) === null, 'null')
  check('ejecutando gana a todo', indicadorVisible(conj('error', 'sesionPerdida', 'txPendiente', 'cargando', 'ejecutando')) === 'ejecutando', 'ejecutando')
  check('cargando > txPendiente', indicadorVisible(conj('txPendiente', 'cargando')) === 'cargando', 'cargando')
  check('txPendiente > sesionPerdida', indicadorVisible(conj('sesionPerdida', 'txPendiente')) === 'txPendiente', 'txPendiente')
  check('sesionPerdida > error', indicadorVisible(conj('error', 'sesionPerdida')) === 'sesionPerdida', 'sesionPerdida')
  check('txPendiente > sinEnviar', indicadorVisible(conj('sinEnviar', 'txPendiente')) === 'txPendiente', 'txPendiente')
  check(
    'sinEnviar > sesionPerdida y > error (lo que se pierde al cerrar manda)',
    indicadorVisible(conj('error', 'sesionPerdida', 'sinEnviar')) === 'sinEnviar',
    'sinEnviar'
  )
  check('cargando > sinEnviar (lo que está en marcha manda)', indicadorVisible(conj('sinEnviar', 'cargando')) === 'cargando', 'cargando')
  check('solo error', indicadorVisible(conj('error')) === 'error', 'error')

  hr('(7) recortarCentro')
  check('corto: tal cual', recortarCentro('USERS', 10) === 'USERS', recortarCentro('USERS', 10))
  check('exacto: tal cual', recortarCentro('ABCDEFGHIJ', 10) === 'ABCDEFGHIJ', recortarCentro('ABCDEFGHIJ', 10))
  const r = recortarCentro('ES_CONFIG_SERVICIOS_APIS_TBL', 20)
  check('recorta por el centro y cuenta el «…»', r === 'ES_CONFIG_…_APIS_TBL' && Array.from(r).length === 20, r)
  const par = recortarCentro('😀😀😀😀😀😀', 4)
  check('no parte pares sustitutos', Array.from(par).length === 4 && par === '😀😀…😀', par)
  check('max 1 y 0', recortarCentro('ABC', 1) === '…' && recortarCentro('ABC', 0) === '', `${recortarCentro('ABC', 1)} / ${recortarCentro('ABC', 0)}`)

  hr('(8) titulosPestanas')
  const alias = (id: string): string | undefined => ({ c1: 'QA-DEMO', c2: 'PROD' } as Record<string, string>)[id]
  const nombres = (id: string): string | undefined => ({ k1: 'consola_1' } as Record<string, string>)[id]
  const tabs = [
    datos('c1', 'ADMDEMO', 'PROFILE'),
    datos('c1', 'HR', 'PROFILE'),
    datos('c2', 'X', 'PROFILE'),
    datos('c1', 'ADMDEMO', 'MODULE'),
    consola('c1', 'k1'),
    consola('c1', 'k9'),
    datos('borrada', 'E', 'T'),
    { kind: 'fuente', conexionId: 'c1', esquema: 'public', objeto: 'f', tipo: 'rutina', firma: 'integer' },
    { kind: 'fuente', conexionId: 'c1', esquema: 'public', objeto: 'f', tipo: 'rutina', firma: 'text' },
    { kind: 'fuente', conexionId: 'c1', esquema: 'ADMDEMO', objeto: 'V_ACTIVOS', tipo: 'vista' }
  ].map((pane) => ({ id: idDbPane(pane as DbPane), pane: pane as DbPane }))
  const t = titulosPestanas(tabs, alias, nombres)
  const tt = (i: number): string => j(t.get(tabs[i].id))
  check(
    'mismo objeto en dos esquemas de la MISMA conexión: ESQUEMA. en las dos',
    t.get(tabs[0].id)?.nombre === 'ADMDEMO.PROFILE' && t.get(tabs[1].id)?.nombre === 'HR.PROFILE',
    `${tt(0)} ${tt(1)}`
  )
  check(
    'el mismo nombre en OTRA conexión no obliga a prefijar',
    t.get(tabs[2].id)?.nombre === 'PROFILE' && t.get(tabs[2].id)?.conexion === 'PROD',
    tt(2)
  )
  check('sin choque: el nombre a secas', t.get(tabs[3].id)?.nombre === 'MODULE' && t.get(tabs[3].id)?.conexion === 'QA-DEMO', tt(3))
  check(
    'tooltip completo con tipo, esquema y alias',
    t.get(tabs[3].id)?.tooltip === 'Tabla ADMDEMO.MODULE · QA-DEMO',
    `${t.get(tabs[3].id)?.tooltip}`
  )
  check('consola: su nombre', t.get(tabs[4].id)?.nombre === 'consola_1' && t.get(tabs[4].id)?.tooltip === 'Consola consola_1 · QA-DEMO', tt(4))
  check('consola sin nombre conocido: «Consola»', t.get(tabs[5].id)?.nombre === 'Consola', tt(5))
  check(
    'conexión borrada: alias vacío y tooltip sin «·»',
    t.get(tabs[6].id)?.conexion === '' && t.get(tabs[6].id)?.tooltip === 'Tabla E.T',
    tt(6)
  )
  check(
    'sobrecargas abiertas a la vez: se distinguen por la firma',
    t.get(tabs[7].id)?.nombre === 'f(integer)' && t.get(tabs[8].id)?.nombre === 'f(text)',
    `${tt(7)} ${tt(8)}`
  )
  const solaSobrecarga = titulosPestanas([tabs[7]], alias, nombres)
  check(
    'una sola sobrecarga abierta: nombre a secas, firma en el tooltip',
    solaSobrecarga.get(tabs[7].id)?.nombre === 'f' && solaSobrecarga.get(tabs[7].id)?.tooltip === 'Rutina public.f(integer) · QA-DEMO',
    j(solaSobrecarga.get(tabs[7].id))
  )
  check(
    'definición de una vista: el tooltip lo dice',
    t.get(tabs[9].id)?.tooltip === 'Vista ADMDEMO.V_ACTIVOS (definición) · QA-DEMO',
    `${t.get(tabs[9].id)?.tooltip}`
  )

  hr('(9) paneKeyDb')
  const pk = paneKeyDb('perfil-1', idDe('A'))
  check(
    'perfil + NUL + id, y se puede partir sin ambigüedad',
    pk.split('\u0000').length === 2 && pk.startsWith('perfil-1\u0000') && pk.endsWith(idDe('A')),
    JSON.stringify(pk)
  )

  hr('(10) inmutabilidad')
  const antes = j(s3)
  abrirPestana(s3, datos('c1', 'E', 'Z'))
  cerrarPestana(s3, idDe('A'))
  cerrarVarias(s3, [idDe('A'), idDe('C')])
  cerrarOtras(s3, idDe('B'))
  filtrarPestanas(s3, () => false)
  moverPestana(s3, idDe('A'), null)
  cerrarIzquierda(s3, idDe('C'))
  cerrarDerecha(s3, idDe('A'))
  check('ninguna operación muta el estado de entrada', j(s3) === antes, antes)

  hr('(11) moverPestana')
  // s3 = A, B, C con C activa.
  const aFinal = moverPestana(s3, idDe('A'), null)
  check('A al final: B, C, A y la activa no cambia', ids(aFinal) === 'E.B,E.C,E.A' && aFinal.activeId === idDe('C'), `${ids(aFinal)} activa=${aFinal.activeId}`)
  const cDelante = moverPestana(s3, idDe('C'), idDe('A'))
  check('C antes de A: C, A, B', ids(cDelante) === 'E.C,E.A,E.B', ids(cDelante))
  // El desfase de uno: mover A (que está a la IZQUIERDA del hueco) antes de C la deja
  // entre B y C, no detrás de C.
  const aAntesDeC = moverPestana(s3, idDe('A'), idDe('C'))
  check('A antes de C (se mueve hacia la derecha): B, A, C', ids(aAntesDeC) === 'E.B,E.A,E.C', ids(aAntesDeC))
  const bAntesDeA = moverPestana(s3, idDe('B'), idDe('A'))
  check('B antes de A (hacia la izquierda): B, A, C', ids(bAntesDeA) === 'E.B,E.A,E.C', ids(bAntesDeA))
  // Mitades negativas: nada cambia y se devuelve el MISMO objeto.
  check('NO: soltar en su propio sitio (A antes de B) es no-op', moverPestana(s3, idDe('A'), idDe('B')) === s3, 'identidad')
  check('NO: C al final cuando ya es la última es no-op', moverPestana(s3, idDe('C'), null) === s3, 'identidad')
  check('NO: antes de sí misma es no-op', moverPestana(s3, idDe('B'), idDe('B')) === s3, 'identidad')
  check(
    'NO: ids desconocidos (la que se mueve o el destino) son no-op',
    moverPestana(s3, 'x', idDe('A')) === s3 && moverPestana(s3, idDe('A'), 'x') === s3,
    'identidad'
  )
  // destinoArrastre: la raya del arrastre. A, B, C.
  const t3 = s3.tabs
  check('arrastrar A sobre la mitad derecha de B: antes de C', destinoArrastre(t3, idDe('A'), idDe('B'), 'derecha') === idDe('C'), 'C')
  check('arrastrar C sobre la mitad izquierda de A: antes de A', destinoArrastre(t3, idDe('C'), idDe('A'), 'izquierda') === idDe('A'), 'A')
  check('arrastrar A sobre la mitad derecha de C: al final (null)', destinoArrastre(t3, idDe('A'), idDe('C'), 'derecha') === null, 'null')
  check('arrastrar A al hueco tras la última: al final (null)', destinoArrastre(t3, idDe('A'), null, 'derecha') === null, 'null')
  check(
    'lo que devuelve, aplicado, mueve de verdad (A tras B)',
    ids(moverPestana(s3, idDe('A'), destinoArrastre(t3, idDe('A'), idDe('B'), 'derecha') as string | null)) === 'E.B,E.A,E.C',
    'B,A,C'
  )
  check(
    'NO: sobre sí misma, o en el hueco pegado a ella, no hay raya (undefined)',
    destinoArrastre(t3, idDe('B'), idDe('B'), 'izquierda') === undefined &&
      destinoArrastre(t3, idDe('B'), idDe('B'), 'derecha') === undefined &&
      destinoArrastre(t3, idDe('B'), idDe('A'), 'derecha') === undefined &&
      destinoArrastre(t3, idDe('B'), idDe('C'), 'izquierda') === undefined,
    'undefined ×4'
  )
  check(
    'NO: la última al hueco final, o ids desconocidos, no hay raya',
    destinoArrastre(t3, idDe('C'), null, 'derecha') === undefined &&
      destinoArrastre(t3, 'x', idDe('A'), 'izquierda') === undefined &&
      destinoArrastre(t3, idDe('A'), 'x', 'izquierda') === undefined,
    'undefined ×3'
  )

  hr('(12) cerrar a la izquierda / a la derecha')
  let cuatro = conTres()
  cuatro = abrirPestana(cuatro, datos('c1', 'E', 'D'))
  // A, B, C, D con D activa.
  check('idsIzquierda(C) = A, B', idsIzquierda(cuatro, idDe('C')).join(',') === [idDe('A'), idDe('B')].join(','), 'A,B')
  check('idsDerecha(B) = C, D', idsDerecha(cuatro, idDe('B')).join(',') === [idDe('C'), idDe('D')].join(','), 'C,D')
  check(
    'NO: la primera no tiene izquierda, la última no tiene derecha, un id desconocido no tiene nada',
    idsIzquierda(cuatro, idDe('A')).length === 0 && idsDerecha(cuatro, idDe('D')).length === 0 &&
      idsIzquierda(cuatro, 'x').length === 0 && idsDerecha(cuatro, 'x').length === 0,
    '[] [] [] []'
  )
  const derB = cerrarDerecha(cuatro, idDe('B'))
  check('cerrar a la derecha de B con D activa: quedan A, B y la activa pasa a B', ids(derB) === 'E.A,E.B' && derB.activeId === idDe('B'), `${ids(derB)} activa=${derB.activeId}`)
  const izqC = cerrarIzquierda(activarPestana(cuatro, idDe('A')), idDe('C'))
  check('cerrar a la izquierda de C con A activa: quedan C, D y la activa pasa a C', ids(izqC) === 'E.C,E.D' && izqC.activeId === idDe('C'), `${ids(izqC)} activa=${izqC.activeId}`)
  const izqSinActiva = cerrarIzquierda(cuatro, idDe('C'))
  check('cerrar a la izquierda sin la activa dentro: la activa no cambia', izqSinActiva.activeId === idDe('D'), `activa=${izqSinActiva.activeId}`)
  check('NO: a la derecha de la última es no-op (mismo objeto)', cerrarDerecha(cuatro, idDe('D')) === cuatro, 'identidad')
  check('NO: a la izquierda de la primera es no-op (mismo objeto)', cerrarIzquierda(cuatro, idDe('A')) === cuatro, 'identidad')

  hr('(13) «Ver DDL»')
  const ddl = (tipo: 'tabla' | 'vista' | 'rutina', firma?: string): DbPane => ({
    kind: 'fuente',
    conexionId: 'c1',
    esquema: 'public',
    objeto: 'T',
    tipo,
    modo: 'ddl',
    ...(firma !== undefined ? { firma } : {})
  })
  const idDdl = idDbPane(ddl('tabla'))
  const idDatosT = idDbPane({ kind: 'datos', conexionId: 'c1', esquema: 'public', objeto: 'T', tipo: 'tabla' })
  const idDefV = idDbPane({ kind: 'fuente', conexionId: 'c1', esquema: 'public', objeto: 'T', tipo: 'vista' })
  check('el DDL tiene su propio prefijo', (JSON.parse(idDdl) as string[])[0] === 'ddl', idDdl)
  check(
    'DDL ≠ datos ≠ definición del mismo objeto',
    idDdl !== idDatosT && idDbPane(ddl('vista')) !== idDefV && idDbPane(ddl('vista')) !== idDdl,
    `${idDdl} / ${idDatosT} / ${idDefV}`
  )
  check(
    'el DDL de dos sobrecargas son dos pestañas',
    idDbPane(ddl('rutina', 'integer')) !== idDbPane(ddl('rutina', 'text')),
    idDbPane(ddl('rutina', 'integer'))
  )
  const tabsDdl = [
    { kind: 'datos', conexionId: 'c1', esquema: 'public', objeto: 'T', tipo: 'tabla' },
    ddl('tabla'),
    { kind: 'fuente', conexionId: 'c1', esquema: 'public', objeto: 'V', tipo: 'vista' },
    { kind: 'fuente', conexionId: 'c1', esquema: 'public', objeto: 'V', tipo: 'vista', modo: 'ddl' }
  ].map((pane) => ({ id: idDbPane(pane as DbPane), pane: pane as DbPane }))
  const tDdl = titulosPestanas(tabsDdl, alias, nombres)
  check(
    'título «NOMBRE (DDL)»; la de datos sigue siendo NOMBRE',
    tDdl.get(tabsDdl[1].id)?.nombre === `T${SUFIJO_DDL}` && tDdl.get(tabsDdl[0].id)?.nombre === 'T',
    `${j(tDdl.get(tabsDdl[1].id))}`
  )
  check(
    'tooltip del DDL lo dice y NO se llama «definición»',
    tDdl.get(tabsDdl[3].id)?.tooltip === 'Vista public.V (DDL) · QA-DEMO' &&
      tDdl.get(tabsDdl[2].id)?.tooltip === 'Vista public.V (definición) · QA-DEMO',
    `${tDdl.get(tabsDdl[3].id)?.tooltip} | ${tDdl.get(tabsDdl[2].id)?.tooltip}`
  )
  const dosEsquemas = [ddl('tabla'), { ...ddl('tabla'), esquema: 'otro' } as DbPane].map((pane) => ({ id: idDbPane(pane), pane }))
  check(
    'el DDL también se desambigua con ESQUEMA.',
    titulosPestanas(dosEsquemas, alias, nombres).get(dosEsquemas[1].id)?.nombre === `otro.T${SUFIJO_DDL}`,
    j(titulosPestanas(dosEsquemas, alias, nombres).get(dosEsquemas[1].id))
  )

  hr('(14) entorno de la conexión')
  {
    const ent = (id: string): 'desarrollo' | 'pruebas' | 'produccion' | undefined =>
      ({ c1: 'desarrollo', c2: 'produccion' } as Record<string, 'desarrollo' | 'produccion'>)[id]
    const conE = titulosPestanas(tabs, alias, nombres, ent)
    const te = (i: number): string => j(conE.get(tabs[i].id))
    check('producción: el título lleva el entorno', conE.get(tabs[2].id)?.entorno === 'produccion', te(2))
    check(
      'y el tooltip lo dice con palabras, al final',
      conE.get(tabs[2].id)?.tooltip === 'Tabla X.PROFILE · PROD · Producción',
      `${conE.get(tabs[2].id)?.tooltip}`
    )
    check(
      'consola: también',
      conE.get(tabs[4].id)?.entorno === 'desarrollo' && conE.get(tabs[4].id)?.tooltip === 'Consola consola_1 · QA-DEMO · Desarrollo',
      te(4)
    )
    check(
      'el nombre y el [ALIAS] no cambian con el entorno',
      conE.get(tabs[2].id)?.nombre === t.get(tabs[2].id)?.nombre && conE.get(tabs[2].id)?.conexion === 'PROD',
      te(2)
    )
    // Mitades negativas.
    check('sin `entornoDe`: sin entorno y el tooltip de siempre', !('entorno' in (t.get(tabs[2].id) ?? {})) && t.get(tabs[2].id)?.tooltip === 'Tabla X.PROFILE · PROD', tt(2))
    const sinEntorno = titulosPestanas(tabs, alias, nombres, () => undefined)
    check('conexión sin entorno: ni campo ni sufijo', !('entorno' in (sinEntorno.get(tabs[3].id) ?? {})) && sinEntorno.get(tabs[3].id)?.tooltip === 'Tabla ADMDEMO.MODULE · QA-DEMO', j(sinEntorno.get(tabs[3].id)))
    const siempreProd = titulosPestanas(tabs, alias, nombres, () => 'produccion')
    check(
      'conexión borrada: ninguna marca aunque `entornoDe` diga algo',
      !('entorno' in (siempreProd.get(tabs[6].id) ?? {})) && siempreProd.get(tabs[6].id)?.tooltip === 'Tabla E.T',
      j(siempreProd.get(tabs[6].id))
    )
    const basura = titulosPestanas(tabs, alias, nombres, () => 'PROD' as unknown as 'produccion')
    check('un valor que no es entorno se ignora', !('entorno' in (basura.get(tabs[2].id) ?? {})) && basura.get(tabs[2].id)?.tooltip === 'Tabla X.PROFILE · PROD', j(basura.get(tabs[2].id)))
  }

  hr('la BASE en la pestaña (SQL Server sin base fija)')
  {
    const sinBase = datos('s1', 'dbo', 't')
    const conBase: DbPane = { ...sinBase, base: 'ventas' } as DbPane
    const otraBase: DbPane = { ...sinBase, base: 'compras' } as DbPane
    check('sin base: el id de siempre, al byte', idDbPane(sinBase) === JSON.stringify(['datos', 's1', 'dbo', 't']), idDbPane(sinBase))
    check('con base: la base detrás', idDbPane(conBase) === JSON.stringify(['datos', 's1', 'dbo', 't', 'ventas']), idDbPane(conBase))
    check('dbo.t de dos bases: dos pestañas', idDbPane(conBase) !== idDbPane(otraBase), 'distintas')
    const ddl: DbPane = { kind: 'fuente', conexionId: 's1', esquema: 'dbo', objeto: 'v', tipo: 'vista', modo: 'ddl', base: 'ventas' }
    check('fuente/DDL: la base detrás de la firma', idDbPane(ddl) === JSON.stringify(['ddl', 's1', 'dbo', 'vista', 'v', null, 'ventas']), idDbPane(ddl))
    let s = ESTADO_PESTANAS_INICIAL
    s = abrirPestana(s, conBase)
    s = abrirPestana(s, otraBase)
    const t = titulosPestanas(s.tabs, () => 'SQLS', () => undefined)
    const nombres = s.tabs.map((x) => t.get(x.id)?.nombre)
    check('títulos desambiguados con base.esquema', j(nombres) === j(['ventas.dbo.t', 'compras.dbo.t']), j(nombres))
    check('tooltip con base.esquema', t.get(s.tabs[0].id)?.tooltip === 'Tabla ventas.dbo.t · SQLS', String(t.get(s.tabs[0].id)?.tooltip))
  }

  hr('pestaña de colección de MongoDB')
  {
    const col = (base: string, c: string): DbPane => ({ kind: 'coleccion', conexionId: 'm1', base, coleccion: c })
    const a = col('pruebas', 'pedidos')
    check('id con prefijo propio y la base', idDbPane(a) === JSON.stringify(['coleccion', 'm1', 'pruebas', 'pedidos']), idDbPane(a))
    check('la misma colección de dos bases: dos pestañas', idDbPane(a) !== idDbPane(col('otra', 'pedidos')), 'distintas')
    check(
      'no choca con una tabla del mismo nombre',
      idDbPane(a) !== idDbPane(datos('m1', 'pruebas', 'pedidos')),
      'distintas'
    )
    check('los ids viejos no cambian (consola)', idDbPane(consola('m1', 'k1')) === JSON.stringify(['consola', 'k1']), idDbPane(consola('m1', 'k1')))
    let s = ESTADO_PESTANAS_INICIAL
    s = abrirPestana(s, a)
    s = abrirPestana(s, col('pruebas', 'pedidos'))
    check('abrir dos veces la misma: una pestaña', s.tabs.length === 1, String(s.tabs.length))
    const t1 = titulosPestanas(s.tabs, () => 'MONGO', () => undefined, () => 'produccion')
    const x = t1.get(s.tabs[0].id)
    check('título: la colección a secas', x?.nombre === 'pedidos', j(x))
    check('tooltip: Colección base.colección · alias · entorno', x?.tooltip === 'Colección pruebas.pedidos · MONGO · Producción', String(x?.tooltip))
    s = abrirPestana(s, col('otra', 'pedidos'))
    const t2 = titulosPestanas(s.tabs, () => 'MONGO', () => undefined)
    const nombres = s.tabs.map((y) => t2.get(y.id)?.nombre)
    check('dos bases: base.colección', j(nombres) === j(['pruebas.pedidos', 'otra.pedidos']), j(nombres))
    const podada = filtrarPestanas(s, (p) => p.conexionId !== 'm1')
    check('la poda por conexión la cierra', podada.tabs.length === 0 && podada.activeId === null, j(podada))
  }

  hr('pestaña de clave de Redis (el visor)')
  {
    const cl = (base: number, b64: string, nombre: string): DbPane => ({ kind: 'clave', conexionId: 'r1', base, clave: b64, nombre })
    const a = cl(0, 'dXN1YXJpbzox', 'usuario:1')
    check('id con prefijo propio, la base y el base64 (sin el nombre pintado)', idDbPane(a) === JSON.stringify(['clave', 'r1', 0, 'dXN1YXJpbzox']), idDbPane(a))
    check('el nombre pintado NO es identidad: mismo base64, misma pestaña', idDbPane(a) === idDbPane(cl(0, 'dXN1YXJpbzox', 'otro')), 'iguales')
    check('la misma clave en dos bases: dos pestañas', idDbPane(a) !== idDbPane(cl(1, 'dXN1YXJpbzox', 'usuario:1')), 'distintas')
    check('dos claves que se pintan igual: dos pestañas', idDbPane(cl(0, '/w==', '\\xff')) !== idDbPane(cl(0, 'XHhmZg==', '\\xff')), 'distintas')
    check(
      'no choca con una colección ni con una tabla del mismo nombre',
      idDbPane(a) !== idDbPane({ kind: 'coleccion', conexionId: 'r1', base: '0', coleccion: 'usuario:1' }) && idDbPane(a) !== idDbPane(datos('r1', '0', 'usuario:1')),
      'distintas'
    )
    let s = ESTADO_PESTANAS_INICIAL
    s = abrirPestana(s, a)
    s = abrirPestana(s, cl(0, 'dXN1YXJpbzox', 'usuario:1'))
    check('abrir dos veces la misma: una pestaña', s.tabs.length === 1, String(s.tabs.length))
    const t1 = titulosPestanas(s.tabs, () => 'REDIS', () => undefined, () => 'produccion')
    const x = t1.get(s.tabs[0].id)
    check('título: el nombre de la clave a secas', x?.nombre === 'usuario:1', j(x))
    check('tooltip: Clave dbN › nombre · alias · entorno', x?.tooltip === 'Clave db0 › usuario:1 · REDIS · Producción', String(x?.tooltip))
    s = abrirPestana(s, cl(1, 'dXN1YXJpbzox', 'usuario:1'))
    const t2 = titulosPestanas(s.tabs, () => 'REDIS', () => undefined)
    const nombres = s.tabs.map((y) => t2.get(y.id)?.nombre)
    check('dos bases: dbN › nombre', j(nombres) === j(['db0 › usuario:1', 'db1 › usuario:1']), j(nombres))
    const podada = filtrarPestanas(s, (p) => p.conexionId !== 'r1')
    check('la poda por conexión la cierra', podada.tabs.length === 0 && podada.activeId === null, j(podada))
  }

  hr('RESULTADO (PASS/FAIL)')
  for (const res of results) {
    console.log(`${res.pass ? 'PASS' : 'FAIL'}  ${res.name}`)
    console.log(`      -> ${res.evidence}`)
  }
  const passed = results.filter((x) => x.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
