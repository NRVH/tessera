#!/usr/bin/env node
// =============================================================================
// Prueba de las decisiones vivas de la consola (npm run test:db-consola-vivo): marcas que
// una edición invalida, conflictos con el disco, la barra mientras corre, ■ y lo que
// cancela, Forzar y su alcance, cierres que el main rechaza y los avisos compartidos.
// =============================================================================

import type { DbEstadoSesion } from '../../../../../shared/db-explorador-ipc.ts'
import { avisosConSoloLectura } from '../../../../../shared/sql/avisosSql.ts'
import { dividirSentencias } from '../../../../../shared/sql/divisorSql.ts'
import { REGLAS, type DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import { analisisDe } from '../autocompletado/analisisModelo.ts'
import { crearLote, detener, iniciar, registrar } from './lote.ts'
import { ETIQUETA_FORZAR, ETIQUETA_FORZAR_CONSOLA, TEXTO_SIN_RESPUESTA_STOP, TEXTO_STOP_CON_CAMBIOS } from './salidaConsola.ts'
import {
  ESPERA_STOP_MATAR_MS,
  ESPERA_STOP_MS,
  alcanceForzar,
  avisoStopSinRespuesta,
  avisosVivos,
  cambioTocaRango,
  cancelacionesDetener,
  cierreFallidoRetiene,
  decidirTrasLeer,
  hayTxQueResolver,
  mensajeForzar,
  mismosIndicadores,
  modoDesdeEditor,
  puedeDetener,
  textoProgreso,
  textoTxPendiente,
  textoVacio,
  txEnRiesgo,
  type ModeloAvisos
} from './vivoConsola.ts'

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

function sesion(parcial: Partial<DbEstadoSesion> & Pick<DbEstadoSesion, 'ref' | 'conexionId'>): DbEstadoSesion {
  return {
    fase: 'lista',
    txModo: 'manual',
    tx: 'ninguna',
    sentenciasEnTx: 0,
    esquema: 'public',
    soloLectura: false,
    ...parcial
  }
}

const TIEMPOS = { totalMs: 10, ejecucionMs: 8, lecturaMs: 2 }

hr('(1) cambioTocaRango (sentencia en [10, 20))')
{
  check('sustituir dentro', cambioTocaRango(10, 20, { offset: 12, largo: 2 }), '12+2')
  check('sustituir que solapa el inicio', cambioTocaRango(10, 20, { offset: 8, largo: 3 }), '8+3')
  check('sustituir que solapa el final', cambioTocaRango(10, 20, { offset: 19, largo: 4 }), '19+4')
  check('insertar estrictamente dentro', cambioTocaRango(10, 20, { offset: 15, largo: 0 }), '15+0')
  check('NO: insertar en el borde de inicio', !cambioTocaRango(10, 20, { offset: 10, largo: 0 }), '10+0')
  check('NO: insertar en el borde final', !cambioTocaRango(10, 20, { offset: 20, largo: 0 }), '20+0')
  check('NO: sustituir justo detrás', !cambioTocaRango(10, 20, { offset: 20, largo: 5 }), '20+5')
  check('NO: sustituir justo delante', !cambioTocaRango(10, 20, { offset: 5, largo: 5 }), '5+5')
  check('NO: cambio lejos', !cambioTocaRango(10, 20, { offset: 100, largo: 1 }), '100+1')
}

hr('(2) decidirTrasLeer')
{
  check('primera lectura: recargar', decidirTrasLeer('', null, 'select 1') === 'recargar', 'guardado=null')
  check('disco igual al editor: igual', decidirTrasLeer('a', 'b', 'a') === 'igual', 'a/b/a')
  check('sin cambios míos y disco nuevo: recargar', decidirTrasLeer('a', 'a', 'b') === 'recargar', 'a/a/b')
  check('cambios míos y disco intacto: mio', decidirTrasLeer('a2', 'a', 'a') === 'mio', 'a2/a/a')
  check('cambios míos y disco cambiado: conflicto', decidirTrasLeer('a2', 'a', 'b') === 'conflicto', 'a2/a/b')
}

hr('(3) textoVacio')
{
  check('vacío', textoVacio(''), "''")
  check('solo blancos y saltos', textoVacio('  \r\n\t '), 'blancos')
  check('NO: con contenido', !textoVacio(' select 1 '), 'select 1')
}

hr('(4) modoDesdeEditor')
{
  const m1 = modoDesdeEditor({ desde: 3, hasta: 9 }, 9)
  check('selección no vacía', m1.tipo === 'seleccion' && m1.desde === 3 && m1.hasta === 9, JSON.stringify(m1))
  const m2 = modoDesdeEditor({ desde: 5, hasta: 5 }, 5)
  check('selección vacía = cursor', m2.tipo === 'cursor' && m2.cursor === 5, JSON.stringify(m2))
  const m3 = modoDesdeEditor(null, 7)
  check('sin selección = cursor', m3.tipo === 'cursor' && m3.cursor === 7, JSON.stringify(m3))
}

hr('(5) textoProgreso')
{
  const una = crearLote(1, dividirSentencias('select 1', 'postgres'))
  check('nada corriendo ni lote: null', textoProgreso(null, 0) === null, 'null')
  const unaCorre = iniciar(una, 0, 1000)
  check('una sentencia, primer segundo', textoProgreso(unaCorre, 1500) === 'Ejecutando', String(textoProgreso(unaCorre, 1500)))
  check('una sentencia, 3 s', textoProgreso(unaCorre, 4200) === 'Ejecutando · 3 s', String(textoProgreso(unaCorre, 4200)))
  const tres = crearLote(2, dividirSentencias('select 1; select 2; select 3', 'postgres'))
  const t1 = registrar(iniciar(tres, 0, 0), 0, {
    tipo: 'filas',
    columnas: [],
    pagina: { filasJson: '[]', desde: 0, hayMas: false },
    lector: null,
    tiempos: TIEMPOS
  })
  const t2 = iniciar(t1, 1, 10_000)
  check('varias: numera la que corre', textoProgreso(t2, 12_500) === 'Ejecutando 2 de 3 · 2 s', String(textoProgreso(t2, 12_500)))
  const parado = detener(t2)
  check('tras Stop con una en vuelo: Deteniendo…', textoProgreso(parado, 13_000) === 'Deteniendo…', String(textoProgreso(parado, 13_000)))
  const fin = registrar(parado, 1, { tipo: 'hecho', comando: 'SELECT', tiempos: TIEMPOS })
  check('lote terminado: null', textoProgreso(fin, 14_000) === null, String(textoProgreso(fin, 14_000)))
}

hr('(6) mismosIndicadores')
{
  check('null frente a vacío: distintos', !mismosIndicadores(null, new Set()), 'null/[]')
  check('mismos elementos', mismosIndicadores(new Set(['ejecutando', 'error']), new Set(['error', 'ejecutando'])), 'eq')
  check('NO: distinto tamaño', !mismosIndicadores(new Set(['ejecutando']), new Set(['ejecutando', 'error'])), 'neq')
  check('NO: distinto elemento', !mismosIndicadores(new Set(['ejecutando']), new Set(['error'])), 'neq')
}

hr('(7) hayTxQueResolver y textoTxPendiente')
{
  const ref = { rol: 'consola' as const, perfilId: 'p', consolaId: 'c1' }
  check('pendiente: sí', hayTxQueResolver(sesion({ ref, conexionId: 'x', tx: 'pendiente' })), 'pendiente')
  check('fallida: sí', hayTxQueResolver(sesion({ ref, conexionId: 'x', tx: 'fallida' })), 'fallida')
  check('NO: abierta (solo lecturas)', !hayTxQueResolver(sesion({ ref, conexionId: 'x', tx: 'abierta' })), 'abierta')
  check('NO: ninguna', !hayTxQueResolver(sesion({ ref, conexionId: 'x' })), 'ninguna')
  check('NO: sin sesión', !hayTxQueResolver(null), 'null')
  const t1 = textoTxPendiente('pendiente', 1)
  check('singular', t1 === 'La consola tiene una transacción sin confirmar (1 sentencia).', t1)
  const t3 = textoTxPendiente('pendiente', 3)
  check('plural', t3 === 'La consola tiene una transacción sin confirmar (3 sentencias).', t3)
  const t0 = textoTxPendiente('pendiente', 0)
  check('sin contador', t0 === 'La consola tiene una transacción sin confirmar.', t0)
  check('fallida', textoTxPendiente('fallida', 2).includes('solo se puede revertir'), textoTxPendiente('fallida', 2))
}

hr('(8) txEnRiesgo y mensajeForzar')
{
  const ss: DbEstadoSesion[] = [
    sesion({ ref: { rol: 'consola', perfilId: 'p', consolaId: 'c1' }, conexionId: 'x', tx: 'pendiente', sentenciasEnTx: 3 }),
    sesion({ ref: { rol: 'consola', perfilId: 'p', consolaId: 'c2' }, conexionId: 'x', tx: 'ninguna' }),
    sesion({ ref: { rol: 'consola', perfilId: 'p', consolaId: 'c3' }, conexionId: 'y', tx: 'pendiente', sentenciasEnTx: 1 }),
    sesion({ ref: { rol: 'consola', perfilId: 'otro', consolaId: 'c9' }, conexionId: 'x', tx: 'fallida' })
  ]
  const nombres = new Map([
    ['c1', 'consola_1'],
    ['c2', 'consola_2'],
    ['c3', 'consola_3']
  ])
  const r = txEnRiesgo(ss, 'x', nombres)
  check('solo las de la conexión y con tx', r.length === 2, JSON.stringify(r))
  check('nombra la consola propia', r[0].nombre === 'consola_1' && r[0].sentencias === 3, r[0].nombre)
  check('una de otro perfil sale genérica', r[1].nombre === 'una consola de otro perfil', r[1].nombre)
  const m = mensajeForzar('QA-DEMO', r)
  check('el mensaje nombra el alias', m.includes('QA-DEMO'), m.split('\n')[0])
  check('lista las pendientes con su número', m.includes('· consola_1: 3 sentencias sin confirmar'), m)
  check('lista la fallida', m.includes('transacción fallida'), m)
  const vacio = mensajeForzar('QA', [])
  check('sin transacciones lo dice', vacio.includes('No hay transacciones sin confirmar'), vacio)
  // Un proceso por consola (SQLite) → Forzar cierra solo la sesión de ESTA consola.
  check(
    'alcanceForzar: con proceso por consola, «consola»; sin él, «conexion»',
    alcanceForzar(true) === 'consola' && alcanceForzar(false) === 'conexion',
    `${alcanceForzar(true)} / ${alcanceForzar(false)}`
  )
  const soloC1 = txEnRiesgo(ss, 'x', nombres, { perfilId: 'p', consolaId: 'c1' })
  check('txEnRiesgo con la consola: solo la suya (ni la de otro perfil)', soloC1.length === 1 && soloC1[0].nombre === 'consola_1', JSON.stringify(soloC1))
  check(
    '…y la misma consolaId de OTRO perfil no cuenta',
    txEnRiesgo(ss, 'x', nombres, { perfilId: 'p', consolaId: 'c9' }).length === 0,
    'ok'
  )
  const mc = mensajeForzar('base.db', soloC1, 'consola')
  check(
    'el mensaje de alcance consola dice que solo se cierra esta sesión y que lo demás sigue',
    mc.startsWith('Se cerrará la sesión de esta consola con base.db') && mc.includes('siguen como están') && mc.includes('· consola_1: 3 sentencias sin confirmar') && !mc.includes('todas sus sesiones'),
    mc
  )
  check('…y sin transacción lo dice de la consola', mensajeForzar('base.db', [], 'consola').includes('Esta consola no tiene transacciones sin confirmar'), 'ok')
  check('el mensaje de siempre no cambia sin alcance', mensajeForzar('QA-DEMO', r) === mensajeForzar('QA-DEMO', r, 'conexion'), 'ok')
  const aC = avisoStopSinRespuesta('conexion')
  const aS = avisoStopSinRespuesta('consola')
  check(
    'avisoStopSinRespuesta: conexión = el texto, la etiqueta y los 10 s de siempre',
    aC.texto === TEXTO_SIN_RESPUESTA_STOP && aC.etiqueta === ETIQUETA_FORZAR && aC.esperaMs === ESPERA_STOP_MS && ESPERA_STOP_MS === 10_000,
    JSON.stringify(aC)
  )
  check(
    '…consola = el motivo verdadero (cambios sin confirmar), Forzar de la sesión y enseguida',
    aS.texto === TEXTO_STOP_CON_CAMBIOS && aS.etiqueta === ETIQUETA_FORZAR_CONSOLA && aS.esperaMs === ESPERA_STOP_MATAR_MS && aS.esperaMs < aC.esperaMs,
    JSON.stringify(aS)
  )
}

hr('(9) cierreFallidoRetiene: qué rechazo del main deja la pestaña abierta')
{
  // Caso: Manual, primer UPDATE lento (sin tx PREVIA, así que no se
  // pidió resolver nada), el Stop no llega a tiempo y el main dice `ocupada`. Si la
  // pestaña se cerrara, el UPDATE podría acabar dejando una tx con bloqueos que
  // nada enseña y que el barrido de inactividad no cierra.
  check('ocupada sin resolver: retiene', cierreFallidoRetiene('ocupada', false), 'ocupada/false')
  check('ocupada resolviendo: retiene', cierreFallidoRetiene('ocupada', true), 'ocupada/true')
  check('falló Commit/Rollback (servidor) resolviendo: retiene', cierreFallidoRetiene('servidor', true), 'servidor/true')
  // Mitades negativas: sin transacción que resolver y sin nada corriendo, no poder
  // cerrar la sesión no retiene nada (el main la cierra por inactividad).
  check('NO: servidor sin resolver', !cierreFallidoRetiene('servidor', false), 'servidor/false')
  check('NO: sesión perdida sin resolver', !cierreFallidoRetiene('sesionPerdida', false), 'sesionPerdida/false')
  check('NO: interno sin resolver', !cierreFallidoRetiene('interno', false), 'interno/false')
}

hr('(10) Detener: qué cancela ■ y cuándo está encendido')
{
  const base = { perfilId: 'p', consolaId: 'k1', conexionId: 'c1' }
  // Caso: un «cargar más» lento de una pestaña de resultados, sin
  // ningún lote corriendo. ■ tiene que estar encendido y mandar SU peticionId por
  // el rol `datos` (el main la busca en todas las sesiones de la conexión).
  check('■ encendido con una página de «más» en vuelo y sin lote', puedeDetener(false, 1), 'false/1')
  check('■ encendido con un lote', puedeDetener(true, 0), 'true/0')
  check('NO: ■ apagado sin nada', !puedeDetener(false, 0), 'false/0')
  const soloMas = cancelacionesDetener({ ...base, ejecucionId: null, masEnVuelo: ['m1'] })
  check(
    'solo «más»: un cancelar de rol datos con su id y la conexión',
    soloMas.length === 1 && soloMas[0].rol === 'datos' && soloMas[0].conexionId === 'c1' && soloMas[0].peticionId === 'm1',
    JSON.stringify(soloMas)
  )
  const ambas = cancelacionesDetener({ ...base, ejecucionId: 'e1', masEnVuelo: new Map([['r1', 'm1'], ['r2', 'm2']]).values() })
  check(
    'lote + dos «más»: la sentencia por su rol y cada página por el suyo',
    ambas.length === 3 &&
      ambas[0].rol === 'consola' && ambas[0].ejecucionId === 'e1' && ambas[0].consolaId === 'k1' && ambas[0].perfilId === 'p' &&
      ambas[1].rol === 'datos' && ambas[1].peticionId === 'm1' &&
      ambas[2].rol === 'datos' && ambas[2].peticionId === 'm2',
    JSON.stringify(ambas)
  )
  const soloLote = cancelacionesDetener({ ...base, ejecucionId: 'e1', masEnVuelo: [] })
  check('solo lote: solo la sentencia', soloLote.length === 1 && soloLote[0].rol === 'consola', JSON.stringify(soloLote))
  // Mitades negativas: entre dos sentencias (sin ejecucionId) no se manda nada por el
  // rol consola, y un id vacío o repetido no se manda.
  const nada = cancelacionesDetener({ ...base, ejecucionId: null, masEnVuelo: ['', 'm1', 'm1'] })
  check('NO: ni consola sin ejecucionId, ni ids vacíos o repetidos', nada.length === 1 && nada[0].rol === 'datos', JSON.stringify(nada))
}

hr('(11) Detener y «Contar»: el COUNT(*) de un resultado también se para')
{
  const base = { perfilId: 'p', consolaId: 'k1', conexionId: 'c1' }
  // Caso: «Contar» sobre un resultado grande, sin lote ni «más». El
  // COUNT(*) ocupa la sesión de la consola; ■ tiene que estar encendido y alcanzarlo.
  check('■ encendido con solo un «Contar» en vuelo', puedeDetener(false, 0, 1), 'false/0/1')
  check('NO: ■ apagado sin lote, sin «más» y sin conteos', !puedeDetener(false, 0, 0), 'false/0/0')
  check('sin el tercer argumento se comporta como antes', !puedeDetener(false, 0) && puedeDetener(false, 2), 'false/0 y false/2')
  const soloConteo = cancelacionesDetener({ ...base, ejecucionId: null, masEnVuelo: [], conteosEnVuelo: ['n1'] })
  check(
    'solo «Contar»: un cancelar de rol datos con SU id y la conexión',
    soloConteo.length === 1 && soloConteo[0].rol === 'datos' && soloConteo[0].conexionId === 'c1' && soloConteo[0].peticionId === 'n1',
    JSON.stringify(soloConteo)
  )
  const todo = cancelacionesDetener({
    ...base,
    ejecucionId: 'e1',
    masEnVuelo: new Map([['r1', 'm1']]).values(),
    conteosEnVuelo: new Map([['r1', 'n1'], ['r2', 'n2']]).values()
  })
  check(
    'lote + «más» + dos conteos: la sentencia, la página y cada conteo por su id',
    todo.length === 4 &&
      todo[0].rol === 'consola' &&
      todo.slice(1).every((c) => c.rol === 'datos') &&
      todo.map((c) => (c.rol === 'consola' ? c.ejecucionId : c.peticionId)).join(',') === 'e1,m1,n1,n2',
    JSON.stringify(todo)
  )
  // Mitades negativas: un id vacío no se manda, y uno que ya iba como «más» no se
  // repite como conteo.
  const repetido = cancelacionesDetener({ ...base, ejecucionId: null, masEnVuelo: ['m1'], conteosEnVuelo: ['', 'm1'] })
  check('NO: ni ids vacíos ni repetidos entre «más» y conteos', repetido.length === 1, JSON.stringify(repetido))
}

hr('(12) avisosVivos: los avisos reutilizan la división del autocompletado')
{
  /** Un modelo de mentira que cuenta cuántas veces se le pide el texto entero. */
  function modeloFalso(inicial: string): ModeloAvisos & { lecturas: number; escribir(t: string): void } {
    let texto = inicial
    let version = 1
    const m = {
      lecturas: 0,
      getVersionId: () => version,
      getValue: () => {
        m.lecturas++
        return texto
      },
      getValueLength: () => texto.length,
      escribir(t: string): void {
        texto = t
        version++
      }
    }
    return m
  }
  // EQUIVALENCIA: lo que se avisa es EXACTAMENTE lo de partir el texto por su cuenta,
  // en los dos dialectos, con y sin solo lectura, y con LF y CRLF. El corpus cubre cada
  // tipo de aviso y textos sin ninguno.
  const CORPUS = [
    'select * from t1\nselect * from t2',
    "update t set a = 'x' where id = 1\ndelete from u where id = 2",
    'insert into t values (1)\ninsert into t values (2)',
    'BEGIN\n  NULL;\nEND;\nSELECT 1 FROM dual',
    "select 'abc from t",
    'select 1 /* sin cerrar',
    'do $$ begin',
    'select (1 + 2 from t',
    'select 1) from t',
    'delete from t where a = 1',
    'BEGIN NULL; END;',
    "alter session set nls_date_format = 'DD/MM'",
    "set datestyle = 'SQL, DMY'",
    'select 1 a from dual\nunion all\nselect 2 a from dual',
    "select q'[it's]' from dual;\nselect 2 from dual",
    '',
    '   \n  ',
    'SET SERVEROUTPUT ON\nexec p\nselect 1 from dual;\n/',
    // SQL Server: `GO n` (aviso loteRepetido), un lote con GO y una unidad
    // de alcance de lote.
    'select 1\nGO 2 -- dos veces\nselect 3',
    'DECLARE @x int = 1; SELECT @x\nGO\nSELECT 2'
  ]
  let casos = 0
  const distintos: string[] = []
  for (const base of CORPUS) {
    for (const texto of [base, base.replace(/\n/g, '\r\n')]) {
      for (const d of Object.keys(REGLAS) as DialectoSql[]) {
        for (const soloLectura of [false, true]) {
          casos++
          const directo = avisosConSoloLectura(dividirSentencias(texto, d), d, soloLectura)
          const vivo = avisosVivos(modeloFalso(texto), d, soloLectura, 2 * 1024 * 1024)
          if (JSON.stringify(vivo) !== JSON.stringify(directo)) {
            distintos.push(`${d} ro=${soloLectura} ${JSON.stringify(texto)}: ${JSON.stringify(vivo)} != ${JSON.stringify(directo)}`)
          }
        }
      }
    }
  }
  const conAvisos = CORPUS.filter((t) => avisosConSoloLectura(dividirSentencias(t, 'oracle'), 'oracle', true).length > 0).length
  check(
    `(12a) EQUIVALENCIA: mismos avisos que partiendo por su cuenta (${casos} casos)`,
    distintos.length === 0 && conAvisos >= 10,
    distintos.length === 0 ? `${casos} iguales; ${conAvisos} textos del corpus con algún aviso` : distintos[0]
  )

  // El aviso `loteRepetido` LLEGA a la consola: la consola pinta
  // como marcador amarillo todo lo que devuelve `avisosVivos` (`ValidadorAvisos.ahora`), así
  // que basta con que salga de aquí, sobre «GO 2» y sin el comentario.
  {
    const texto = 'select 1\nGO 2 -- dos veces\nselect 3'
    const av = avisosVivos(modeloFalso(texto), 'sqlserver', false, 2 * 1024 * 1024) ?? []
    const rep = av.filter((a) => a.tipo === 'loteRepetido')
    check(
      '(12a2) SQL Server: `GO 2` da el aviso loteRepetido en la consola, sobre «GO 2»',
      rep.length === 1 && texto.slice(rep[0].desde, rep[0].hasta) === 'GO 2',
      JSON.stringify(av)
    )
    const ora = avisosVivos(modeloFalso(texto), 'oracle', false, 2 * 1024 * 1024) ?? []
    check('(12a3) NEGATIVO: en Oracle `GO 2` no es nada de lotes', !ora.some((a) => a.tipo === 'loteRepetido'), JSON.stringify(ora))
  }

  // UNA división por versión: si el completado ya partió esta versión, los avisos no
  // vuelven a pedir el texto (con el `dividirSentencias(getValue())` de antes, sí).
  const m = modeloFalso('select * from t1\nselect * from t2')
  analisisDe(m, 'oracle') // lo que hace el completado al preguntar tras una letra
  const trasCompletado = m.lecturas
  const av = avisosVivos(m, 'oracle', false, 2 * 1024 * 1024)
  check(
    '(12b) tras el completado, los avisos NO vuelven a partir la misma versión',
    trasCompletado === 1 && m.lecturas === 1 && av !== null && av.length === 1 && av[0].tipo === 'faltaPuntoYComa',
    `lecturas: ${trasCompletado} -> ${m.lecturas}; avisos=${JSON.stringify(av?.map((a) => a.tipo))}`
  )
  const antesInverso = m.lecturas
  m.escribir('select 1 from dual')
  avisosVivos(m, 'oracle', false, 2 * 1024 * 1024) // los avisos llegan primero (250 ms)
  analisisDe(m, 'oracle') // y luego pregunta el completado, o la precarga del segundo
  check(
    '(12c) y al revés: si los avisos parten primero, el completado reutiliza su división',
    m.lecturas === antesInverso + 1,
    `lecturas: ${antesInverso} -> ${m.lecturas}`
  )
  m.escribir('select 1 from dual\nselect 2 from dual')
  const nueva = avisosVivos(m, 'oracle', false, 2 * 1024 * 1024)
  check(
    '(12d) NO reutiliza una versión vieja: tras escribir, vuelve a partir y ve lo nuevo',
    nueva !== null && nueva.length === 1 && m.lecturas === antesInverso + 2,
    `avisos=${JSON.stringify(nueva?.map((a) => a.tipo))} lecturas=${m.lecturas}`
  )
  const pgMismaVersion = avisosVivos(m, 'postgres', false, 2 * 1024 * 1024)
  check(
    '(12e) NO reutiliza la división de OTRO dialecto (el `/` de Oracle, el `$$` de PG)',
    pgMismaVersion !== null && m.lecturas === antesInverso + 3,
    `lecturas=${m.lecturas}`
  )
  // Por encima del tope: null (se limpian los marcadores) y SIN copiar el texto.
  const grande = modeloFalso('x'.repeat(101))
  const r = avisosVivos(grande, 'oracle', false, 100)
  check(
    '(12f) por encima del tope: null, y sin pedir el texto entero',
    r === null && grande.lecturas === 0,
    `r=${JSON.stringify(r)} lecturas=${grande.lecturas}`
  )
  const justo = modeloFalso('x'.repeat(100))
  check('(12g) justo en el tope: se analiza', avisosVivos(justo, 'oracle', false, 100) !== null, 'ok')
}

const pasados = results.filter((r) => r.pass).length
const allPass = pasados === results.length
console.log(`\nVEREDICTO: ${pasados}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
