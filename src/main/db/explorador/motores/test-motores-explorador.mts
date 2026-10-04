#!/usr/bin/env node
// =============================================================================
// Prueba del código por motor del explorador y de su cruce con el descriptor compartido
// (`npm run test:motores-explorador`). Vive en el main porque importa módulos del main. Fija:
// las claves de `MOTORES_EXPLORADOR` frente a `MOTORES`, `motorExplorador` de un motor
// desconocido o de otra familia, la espera de bloqueos de cada motor como un valor con su SQL y
// sus códigos, el EXPLAIN de Oracle y PG contra un contexto de mentira, y que un valor nuevo de
// una unión del descriptor lanza «Caso sin contemplar» en vez de caer en la rama de otro.
// Decisiones: docs/decisiones/bd/motores-codigo-por-motor.md
// =============================================================================

const MOTORES = porMotorSql((d) => d)

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { DbEstadoTx } from '../../../../shared/db-explorador-ipc.ts'
import { descriptorSql, esMotorSql, IDS_MOTORES, IDS_MOTORES_SQL, MOTORES as REGISTRO, porMotorSql } from '../../../../shared/motores/index.ts'
import { ESQUEMAS_SISTEMA_ORACLE } from '../../../../shared/motores/oracle.ts'
import type { DbMotor, DbMotorSql } from '../../../../shared/db-ipc.ts'
import * as moduloBinds from '../bindsConsola.ts'
import { ESQUEMAS_SISTEMA_ORACLE as ESQUEMAS_DEL_CATALOGO, type ConsultaCatalogo as ConsultaDelCatalogo } from '../catalogoSql.ts'
import * as moduloEdicion from '../edicionRejilla.ts'
import {
  ESPERA_BLOQUEO_ENVIO_S,
  esEsquemaDelSistema,
  identidadAntesDeLeer,
  necesitaUnica,
  sqlEsperaBloqueoTransaccion
} from '../edicionRejilla.ts'
import {
  AVISO_BINDS_ORACLE,
  PREFIJO_EXPLICAR_PG,
  SQL_NODOS_ORACLE,
  SQL_PUNTO_PG,
  SQL_SOLTAR_PUNTO_PG,
  SQL_TEXTO_ORACLE
} from '../planSql.ts'
import type { OpcionesEjecucion, ResultadoTrabajador } from '../protocoloTrabajador.ts'
import { construirConsultaTabla } from '../sqlRejilla.ts'
import { MOTORES_EXPLORADOR, motorExplorador, type ConsultaCatalogo } from './index.ts'
import { enEsqueleto } from './filasCatalogo.ts'
import type { ContextoExplicar, EsperaBloqueoEnvio } from './sesion.ts'

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
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (!pass) console.log(`      -> ${evidence}`)
}
const j = (x: unknown): string => JSON.stringify(x)

/** El mensaje de lo que lance `f`, o null si no lanza. */
function lanza(f: () => unknown): string | null {
  try {
    f()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/**
 * Corre `f` con `obj[clave] = valor` y lo deja como estaba. Es como se prueba un valor de
 * una unión que el tipo no deja escribir: un motor futuro que lo declarara.
 */
function conValor<T>(obj: object, clave: string, valor: unknown, f: () => T): T {
  const o = obj as Record<string, unknown>
  const antes = o[clave]
  o[clave] = valor
  try {
    return f()
  } finally {
    o[clave] = antes
  }
}

/** Un contexto de EXPLAIN de mentira que apunta todo lo que el motor le pide. */
function contextoDeMentira(
  soloLectura: boolean,
  estadoTx: DbEstadoTx,
  responder: (sql: string) => ResultadoTrabajador,
  modo: 'thin' | 'thick' = 'thin'
): { ctx: ContextoExplicar; pasos: string[]; prefijos: Array<string | null>; tx: DbEstadoTx[] } {
  const pasos: string[] = []
  const prefijos: Array<string | null> = []
  const tx: DbEstadoTx[] = []
  let n = 0
  const ctx: ContextoExplicar = {
    texto: 'select * from t where id = :id',
    binds: { ID: '1' },
    conParametros: true,
    soloLectura,
    t0: 0,
    estadoTx: () => estadoTx,
    txManual: () => false,
    modoDriver: () => modo,
    ejecutar: async (sql: string, opciones: OpcionesEjecucion, binds?: unknown) => {
      pasos.push(`${sql.split('\n')[0]}|${opciones.proposito}|${j(binds ?? null)}`)
      return responder(sql)
    },
    accionTx: async (accion) => {
      pasos.push(`tx:${accion}`)
      return accion === 'rollback' ? 'ninguna' : estadoTx
    },
    prefijo: (p) => {
      prefijos.push(p)
    },
    fijarTx: (t) => {
      tx.push(t)
    },
    nuevoIdPlan: () => `TESSERA_${++n}_X`,
    error: (motivo, mensaje) => new Error(`${motivo}: ${mensaje}`)
  }
  return { ctx, pasos, prefijos, tx }
}

const filas = (filasJson: string, extra: Partial<Extract<ResultadoTrabajador, { tipo: 'filas' }>> = {}): ResultadoTrabajador => ({
  tipo: 'filas',
  columnas: [],
  filasJson,
  nFilas: 1,
  hayMas: false,
  lector: null,
  comando: 'SELECT',
  msEjecucion: 1,
  msLectura: 1,
  tx: 'ninguna',
  ...extra
})

async function main(): Promise<void> {
  const motores: DbMotorSql[] = IDS_MOTORES_SQL.slice()

  hr('(1) MOTORES_EXPLORADOR')
  check('mismas claves, en el mismo orden, que los motores SQL del registro', j(Object.keys(MOTORES_EXPLORADOR)) === j(motores), j(Object.keys(MOTORES_EXPLORADOR)))
  for (const m of motores) {
    const x = MOTORES_EXPLORADOR[m]
    check(`${m}: catalogo.motor y sesion.motor son su clave`, x.catalogo.motor === m && x.sesion.motor === m, `${x.catalogo.motor} / ${x.sesion.motor}`)
    check(`${m}: motorExplorador(m) es su entrada`, motorExplorador(m) === x, '')
  }

  hr('(2) Un motor desconocido')
  for (const x of ['mysql', 'constructor', '__proto__']) {
    const mensaje = lanza(() => motorExplorador(x as DbMotor))
    check(`motorExplorador(${j(x)}) lanza con el motor en el mensaje`, mensaje !== null && mensaje.indexOf(x) >= 0, String(mensaje))
  }

  hr('(11) los motores de otras familias no tienen código SQL en el main')
  {
    const otras = IDS_MOTORES.filter((m) => !esMotorSql(m))
    check('hay motores de otras familias en el registro (MongoDB y Redis)', otras.length === 2, j(otras))
    for (const m of otras) {
      const etiqueta = REGISTRO[m].etiqueta
      const esperado = `${etiqueta} no es un motor SQL.`
      check(`${m}: MOTORES_EXPLORADOR no lo tiene`, !Object.prototype.hasOwnProperty.call(MOTORES_EXPLORADOR, m), j(Object.keys(MOTORES_EXPLORADOR)))
      const deDescriptor = lanza(() => descriptorSql(m))
      check(`${m}: descriptorSql lanza «${esperado}»`, deDescriptor === esperado, String(deDescriptor))
      const deExplorador = lanza(() => motorExplorador(m))
      check(`${m}: motorExplorador lanza «${esperado}» (no «Motor desconocido»)`, deExplorador === esperado, String(deExplorador))
    }
    // Y el desconocido sigue siendo desconocido para los dos.
    check('descriptorSql("mysql") lanza «Motor desconocido»', String(lanza(() => descriptorSql('mysql' as DbMotor))).indexOf('Motor desconocido') >= 0, '')
  }

  hr('(3) La lista de esquemas del sistema de Oracle')
  check('descriptor y catalogoSql.ts: la MISMA lista', j(ESQUEMAS_SISTEMA_ORACLE) === j(ESQUEMAS_DEL_CATALOGO), `${ESQUEMAS_SISTEMA_ORACLE.length} / ${ESQUEMAS_DEL_CATALOGO.length}`)

  hr('(4) esquemaDelSistema = esEsquemaDelSistema de la rejilla')
  const nombres = [
    ...ESQUEMAS_SISTEMA_ORACLE,
    'APEX_040200',
    'FLOWS_030000',
    'APEX_X',
    'HR',
    'SCOTT',
    'SH',
    'pg_catalog',
    'information_schema',
    'pg_toast',
    'pg_temp_1',
    'public',
    'PUBLIC',
    'sys',
    ''
  ]
  for (const m of motores) {
    const distintos = nombres.filter((n) => MOTORES[m].catalogo.esquemaDelSistema(n) !== esEsquemaDelSistema(m, n))
    check(`${m}: ${nombres.length} nombres, la misma respuesta`, distintos.length === 0, j(distintos))
  }

  hr('(5) Los tipos del catálogo, mudados, siguen saliendo de catalogoSql.ts')
  const c: ConsultaCatalogo = { sql: 'SELECT 1 FROM dual', binds: {} }
  const d: ConsultaDelCatalogo = c
  const e: ConsultaCatalogo = d
  check('ConsultaCatalogo de motores/ y de catalogoSql.ts son intercambiables', e.sql === 'SELECT 1 FROM dual', e.sql)

  hr('(6) #10: la espera de bloqueos es UN valor que lleva su SQL y sus códigos')
  for (const m of motores) {
    const sesion = MOTORES_EXPLORADOR[m].sesion as unknown as Record<string, unknown>
    // `| undefined`: con el código de antes no había `esperaBloqueo` en la sesión, y el caso
    // tiene que FALLAR, no reventar.
    const espera = MOTORES_EXPLORADOR[m].sesion.esperaBloqueo as EsperaBloqueoEnvio | undefined
    // 'porArchivo' (SQLite) lleva, como 'porTransaccion', su tope y su código.
    const completa =
      espera?.forma === 'porTransaccion' || espera?.forma === 'porArchivo'
        ? typeof espera.sqlTope === 'function' && typeof espera.codigoVencida === 'string' && espera.codigoVencida !== ''
        : espera?.forma === 'porFila'
          ? typeof espera.sqlCandado === 'function' &&
            typeof espera.codigoVencida === 'string' &&
            typeof espera.codigoOcupada === 'string' &&
            espera.codigoVencida !== '' &&
            espera.codigoOcupada !== espera.codigoVencida
          : false
    check(
      `${m}: 'porTransaccion' lleva su tope y 'porFila' su candado, cada una con sus códigos; y ya no hay un método aparte que devuelva null`,
      completa && !('sqlTopeEsperaBloqueo' in sesion),
      `${String(espera?.forma)} ${j(Object.keys(espera ?? {}))} ${j(Object.keys(sesion))}`
    )
  }
  check(
    'los códigos de hoy, al byte: Oracle vence con ORA-30006 y su sonda da ORA-00054; PG vence con 55P03',
    j([MOTORES_EXPLORADOR.oracle.sesion.esperaBloqueo, MOTORES_EXPLORADOR.postgres.sesion.esperaBloqueo].map((x) => [x.forma, x.codigoVencida, x.forma === 'porFila' ? x.codigoOcupada : null])) ===
      j([
        ['porFila', 'ORA-30006', 'ORA-00054'],
        ['porTransaccion', '55P03', null]
      ]),
    j([MOTORES_EXPLORADOR.oracle.sesion.esperaBloqueo, MOTORES_EXPLORADOR.postgres.sesion.esperaBloqueo])
  )
  check(
    "lo que se manda sale de ahí, con el texto de siempre: PG `SET LOCAL lock_timeout = '10s'`, Oracle nada",
    sqlEsperaBloqueoTransaccion('postgres') === "SET LOCAL lock_timeout = '10s'" && sqlEsperaBloqueoTransaccion('oracle') === null && ESPERA_BLOQUEO_ENVIO_S === 10,
    j([sqlEsperaBloqueoTransaccion('postgres'), sqlEsperaBloqueoTransaccion('oracle')])
  )

  hr('(7) #3: el mensaje del esquema que no cuaja es del motor, el de siempre')
  // Un motor cuya sesión es aún un ESQUELETO queda fuera mientras lo sea.
  const conSesion = motores.filter((m) => !enEsqueleto(() => MOTORES_EXPLORADOR[m].sesion.sqlLeerEsquema()))
  const mensajes = conSesion.map((m) => {
    const f = (MOTORES_EXPLORADOR[m].sesion as { mensajeEsquemaNoAplicado?: (e: string) => string }).mensajeEsquemaNoAplicado
    return typeof f === 'function' ? f('VENTAS') : null
  })
  check(
    'Oracle (fijar valida: solo puede no existir) y PG (también el permiso USAGE), al byte; SQLite: solo main; SQL Server: la BASE, sin acceso o que no existe',
    j(mensajes) ===
      j(
        conSesion.map((m) =>
          m === 'oracle'
            ? 'El esquema VENTAS no existe en esta conexión.'
            : m === 'sqlite'
              ? 'SQLite no tiene el esquema VENTAS: cada archivo es una base con un único esquema, main.'
              : m === 'sqlserver'
                ? 'No se puede usar la base VENTAS en esta conexión: no existe o no tienes acceso a ella.'
                : 'No se puede usar el esquema VENTAS en esta conexión: no existe o no tienes permiso de uso (USAGE) sobre él.'
        )
      ),
    j(mensajes)
  )

  hr('(8) #11: el EXPLAIN de cada motor, contra un contexto de mentira')
  const sinExplicar = motores.filter((m) => {
    const s = MOTORES_EXPLORADOR[m].sesion as { explicar?: unknown; revertirTrasFalloDeExplicar?: unknown }
    return typeof s.explicar !== 'function' || typeof s.revertirTrasFalloDeExplicar !== 'function'
  })
  check('cada motor tiene su `explicar` y su `revertirTrasFalloDeExplicar`', sinExplicar.length === 0, j(sinExplicar))
  // Sin ellos (el código de antes), lo de abajo no tiene a quién preguntar: se salta, y el
  // check de arriba ya es el FAIL.
  if (sinExplicar.length === 0) {
    // Oracle en solo lectura (thin): ROLLBACK, EXPLAIN (con sus binds), las dos lecturas del
    // plan con su id, ROLLBACK; el prefijo solo mientras el EXPLAIN está en vuelo.
    const o = contextoDeMentira(true, 'ninguna', (sql) =>
      sql === SQL_NODOS_ORACLE
        ? filas(j([[0, null, 'SELECT STATEMENT', null, null, null, 2, 1, 2, null, null]]))
        : sql === SQL_TEXTO_ORACLE
          ? filas(j([['Plan hash value: 1']]))
          : { tipo: 'hecho', comando: null, ms: 1, tx: 'pendiente' }
    )
    const planO = await MOTORES_EXPLORADOR.oracle.sesion.explicar(o.ctx)
    check(
      'Oracle RO: rollback, EXPLAIN PLAN con los binds (thin), PLAN_TABLE y DBMS_XPLAN con su id, rollback',
      j(o.pasos) ===
        j([
          'tx:rollback',
          `EXPLAIN PLAN SET STATEMENT_ID = 'TESSERA_1_X' INTO PLAN_TABLE FOR|usuario|${j({ ID: '1' })}`,
          `${SQL_NODOS_ORACLE.split('\n')[0]}|catalogo|${j({ ID: 'TESSERA_1_X' })}`,
          `${SQL_TEXTO_ORACLE}|catalogo|${j({ ID: 'TESSERA_1_X' })}`,
          'tx:rollback'
        ]) &&
        o.prefijos.length === 2 &&
        typeof o.prefijos[0] === 'string' &&
        o.prefijos[1] === null &&
        j(o.tx) === j(['ninguna']) &&
        (planO.avisos ?? []).indexOf(AVISO_BINDS_ORACLE) >= 0,
      j({ pasos: o.pasos, prefijos: o.prefijos, tx: o.tx, avisos: planO.avisos })
    )
    const ot = contextoDeMentira(false, 'ninguna', (sql) => (sql === SQL_NODOS_ORACLE || sql === SQL_TEXTO_ORACLE ? filas('[]') : { tipo: 'hecho', comando: null, ms: 1, tx: 'ninguna' }), 'thick')
    await MOTORES_EXPLORADOR.oracle.sesion.explicar(ot.ctx)
    check(
      'Oracle en escritura y thick: lee el estado (nunca un rollback) y el EXPLAIN va SIN binds',
      ot.pasos[0] === 'tx:estado' && ot.pasos.indexOf('tx:rollback') < 0 && /FOR\|usuario\|null$/.test(ot.pasos[1] ?? ''),
      j(ot.pasos)
    )
    // PG con la transacción pendiente: SAVEPOINT, EXPLAIN con sus binds, RELEASE, y el
    // estado lo da el RELEASE.
    const p = contextoDeMentira(false, 'pendiente', (sql) =>
      sql.startsWith(PREFIJO_EXPLICAR_PG)
        ? filas(j([[j([{ Plan: { 'Node Type': 'Result', 'Startup Cost': 0, 'Total Cost': 0.01, 'Plan Rows': 1, 'Plan Width': 4 } }])]]))
        : { tipo: 'hecho', comando: null, ms: 1, tx: 'pendiente' }
    )
    const planP = await MOTORES_EXPLORADOR.postgres.sesion.explicar(p.ctx)
    check(
      'PG con tx pendiente: SAVEPOINT, EXPLAIN (FORMAT JSON) con sus binds, RELEASE; el estado, del RELEASE',
      j(p.pasos) === j([`${SQL_PUNTO_PG}|catalogo|null`, `${PREFIJO_EXPLICAR_PG.trim()}|usuario|${j({ ID: '1' })}`, `${SQL_SOLTAR_PUNTO_PG}|catalogo|null`]) &&
        j(p.prefijos) === j([PREFIJO_EXPLICAR_PG, null]) &&
        j(p.tx) === j(['pendiente']) &&
        planP.nodos[0]?.operacion === 'Result',
      j({ pasos: p.pasos, prefijos: p.prefijos, tx: p.tx })
    )
    check(
      'tras un EXPLAIN que falla: Oracle revierte solo en solo lectura; PG nunca (el envoltorio o el punto ya lo aislaron)',
      MOTORES_EXPLORADOR.oracle.sesion.revertirTrasFalloDeExplicar(true) &&
        !MOTORES_EXPLORADOR.oracle.sesion.revertirTrasFalloDeExplicar(false) &&
        !MOTORES_EXPLORADOR.postgres.sesion.revertirTrasFalloDeExplicar(true) &&
        !MOTORES_EXPLORADOR.postgres.sesion.revertirTrasFalloDeExplicar(false),
      'ok'
    )
  }

  hr('(9) #2: un valor nuevo de una unión no cae en la rama de otro: lanza')
  {
    const base = { soloLectura: false, remoto: false, sistema: false, tipo: 'tabla' as const, pk: [] as string[] }
    const sesionPg = MOTORES.postgres.sesion
    const [enUnica, enAntes, enRejilla] = conValor(sesionPg, 'identidadSinPk', 'direccionNueva', () => [
      lanza(() => necesitaUnica({ ...base, motor: 'postgres' })),
      lanza(() => identidadAntesDeLeer({ ...base, motor: 'postgres' })),
      lanza(() => construirConsultaTabla({ dialecto: 'postgres', objeto: { esquema: 'a', nombre: 'b' }, forma: 'limitOffset', n: 10, rowid: true }))
    ])
    check(
      'identidadSinPk nueva: necesitaUnica, identidadAntesDeLeer y el ROWID de la rejilla lanzan «Caso sin contemplar»',
      [enUnica, enAntes, enRejilla].every((x) => x !== null && /Caso sin contemplar/.test(x) && /direccionNueva/.test(x)),
      j([enUnica, enAntes, enRejilla])
    )
    const enEspera = conValor(MOTORES_EXPLORADOR.postgres.sesion, 'esperaBloqueo', { forma: 'porSesion' }, () => lanza(() => sqlEsperaBloqueoTransaccion('postgres')))
    check('una forma nueva de esperar un bloqueo: lanza en vez de no poner tope', enEspera !== null && /Caso sin contemplar/.test(enEspera), String(enEspera))
    check(
      'NEGATIVO: con los valores de verdad, nada lanza',
      lanza(() => necesitaUnica({ ...base, motor: 'postgres' })) === null && lanza(() => identidadAntesDeLeer({ ...base, motor: 'oracle' })) === null && lanza(() => sqlEsperaBloqueoTransaccion('postgres')) === null,
      'ok'
    )
  }

  hr('(10) #7 y #8: lo que solo leían los tests, fuera; una sola copia de `texto`')
  // `edicionRejilla.ts` es la fachada de sus submódulos `edicionRejilla*.ts`: se mira CADA uno
  // (leídos de la carpeta), no solo lo que la fachada reexporta.
  const nombresEdicion = readdirSync(fileURLToPath(new URL('../', import.meta.url)))
    .filter((n) => /^edicionRejilla\w*\.ts$/.test(n))
    .sort()
  const modulosEdicion: Array<[string, Record<string, unknown>]> = []
  for (const n of nombresEdicion) modulosEdicion.push([n, (await import(new URL(`../${n}`, import.meta.url).href)) as Record<string, unknown>])
  const conCopiaPg = modulosEdicion.filter(([, m]) => 'SQL_ESPERA_BLOQUEO_PG' in m).map(([n]) => n)
  check(
    `ninguno de los ${modulosEdicion.length} módulos edicionRejilla*.ts exporta la copia del SQL de PG, ni bindsConsola el tope que nadie leía`,
    modulosEdicion.length >= 7 && 'sqlEsperaBloqueoTransaccion' in moduloEdicion && conCopiaPg.length === 0 && !('MAX_POSICION_PG' in moduloBinds),
    j({ modulos: nombresEdicion, conCopiaPg, binds: Object.keys(moduloBinds) })
  )
  const aqui = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))
  // `texto` entre lo que se importa de la hoja, junto a lo que sea (la sesión importa
  // también `noDisponible`): la importación exacta de una
  // sola función era una forma, no la regla.
  const importaTextoDe = (ruta: string): RegExp =>
    new RegExp(`import \\{[^}]*\\btexto\\b[^}]*\\} from '${ruta.replace(/[.]/g, '[.]')}'`)
  const importaDeFilas = [
    ['./sesionOracle.ts', './filasCatalogo.ts'],
    ['./sesionPostgres.ts', './filasCatalogo.ts'],
    ['../edicionRejillaTablas.ts', './motores/filasCatalogo.ts']
  ].filter(([archivo, ruta]) => {
    const fuente = readFileSync(aqui(archivo), 'utf8')
    return !importaTextoDe(ruta).test(fuente) || /function texto\(/.test(fuente)
  })
  check(
    'la sesión lee las celdas con la `texto` de filasCatalogo.ts, y la copia de utilSesion.ts ya no existe',
    importaDeFilas.length === 0 && !existsSync(aqui('./utilSesion.ts')),
    j({ sinImportar: importaDeFilas.map((x) => x[0]), utilSesion: existsSync(aqui('./utilSesion.ts')) })
  )

  hr('RESULTADO (PASS/FAIL)')
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  for (const r of results.filter((x) => !x.pass)) {
    console.log(`FAIL  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
