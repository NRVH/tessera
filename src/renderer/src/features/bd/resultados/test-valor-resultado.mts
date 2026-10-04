#!/usr/bin/env node
// =============================================================================
// Prueba del valor completo y la tabla del INSERT de un resultado de la consola
// (npm run test:db-resultados-valor), con la tabla única del clasificador REAL: cuándo se
// ofrece y por qué no, la clave en su orden, la tabla citada y la petición con su consola.
// =============================================================================

import type { DbColumnaInfo } from '../../../../../shared/db-explorador-ipc.ts'
import { dividirSentencias } from '../../../../../shared/sql/divisorSql.ts'
import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import {
  RAZON_CARGANDO,
  RAZON_DBLINK,
  RAZON_SIN_ESQUEMA,
  RAZON_SIN_PK,
  RAZON_VARIAS_TABLAS,
  claveDeFila,
  decidirValorCompleto,
  peticionValor,
  razonFaltanClave,
  tablaInsertDe,
  type TablaResultado
} from './valorResultado.ts'

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

/** La tabla única que el clasificador ve en `sql`. */
function tablaDe(sql: string, d: DialectoSql): TablaResultado | null {
  const s = dividirSentencias(sql, d)[0]
  return s ? s.tablaUnica : null
}

const col = (nombre: string, pk: number | null, posicion = 1): DbColumnaInfo => ({
  nombre,
  posicion,
  tipo: 'x',
  nullable: pk === null,
  pk
})
// PK compuesta (B, A) declarada en ese orden: pk 1 = B, pk 2 = A.
const CATALOGO: DbColumnaInfo[] = [col('A', 2, 1), col('B', 1, 2), col('NOTA', null, 3)]
const cols = (...n: string[]): { nombre: string }[] => n.map((nombre) => ({ nombre }))

function main(): void {
  hr('(1) decidirValorCompleto')
  const t = tablaDe('select * from hr.pedidos', 'oracle')
  check('el clasificador ve la tabla única (plegada)', j(t) === j({ esquema: 'HR', nombre: 'PEDIDOS', citado: false }), j(t))
  const ok = decidirValorCompleto({ tabla: t, esquemaSesion: 'OTRO', columnasResultado: cols('NOTA', 'A', 'B'), columnasCatalogo: CATALOGO })
  check(
    'PK completa: se puede; la PK en SU orden (B, A) y sus índices en el resultado',
    ok.ok && j(ok.clavePrimaria) === j(['B', 'A']) && j(ok.indicesClave) === j([2, 1]) && j(ok.objeto) === j({ esquema: 'HR', nombre: 'PEDIDOS', tipo: 'tabla' }),
    j(ok)
  )
  const sinEsq = decidirValorCompleto({
    tabla: tablaDe('select a, b, nota from pedidos', 'oracle'),
    esquemaSesion: 'VENTAS',
    columnasResultado: cols('A', 'B', 'NOTA'),
    columnasCatalogo: CATALOGO
  })
  check('sin esquema escrito: el de la sesión', sinEsq.ok && sinEsq.objeto.esquema === 'VENTAS', j(sinEsq))
  check(
    'NO: un JOIN no tiene tabla única',
    j(decidirValorCompleto({ tabla: tablaDe('select * from a join b on a.x = b.x', 'postgres'), esquemaSesion: 'public', columnasResultado: cols('x'), columnasCatalogo: [] })) ===
      j({ ok: false, razon: RAZON_VARIAS_TABLAS }),
    RAZON_VARIAS_TABLAS
  )
  check(
    'NO: DUAL tampoco',
    decidirValorCompleto({ tabla: tablaDe('select 1 from dual', 'oracle'), esquemaSesion: 'HR', columnasResultado: cols('1'), columnasCatalogo: [] }).ok === false,
    'dual'
  )
  const remota = tablaDe('select * from pedidos@central', 'oracle')
  check(
    'NO: al otro lado de un @dblink',
    j(decidirValorCompleto({ tabla: remota, esquemaSesion: 'HR', columnasResultado: cols('A'), columnasCatalogo: CATALOGO })) === j({ ok: false, razon: RAZON_DBLINK }),
    j(remota)
  )
  check(
    'NO: sin esquema escrito ni de sesión',
    j(decidirValorCompleto({ tabla: { esquema: null, nombre: 'T' }, esquemaSesion: null, columnasResultado: cols('A'), columnasCatalogo: CATALOGO })) ===
      j({ ok: false, razon: RAZON_SIN_ESQUEMA }),
    RAZON_SIN_ESQUEMA
  )
  const cargar = decidirValorCompleto({ tabla: t, esquemaSesion: null, columnasResultado: cols('A', 'B'), columnasCatalogo: null })
  check(
    'columnas del catálogo aún sin cargar: lo dice y pide cargarlas',
    !cargar.ok && cargar.razon === RAZON_CARGANDO && j(cargar.cargar) === j({ esquema: 'HR', nombre: 'PEDIDOS' }),
    j(cargar)
  )
  check(
    'NO: tabla sin clave primaria',
    j(decidirValorCompleto({ tabla: t, esquemaSesion: null, columnasResultado: cols('A'), columnasCatalogo: [col('A', null)] })) === j({ ok: false, razon: RAZON_SIN_PK }),
    RAZON_SIN_PK
  )
  const falta1 = decidirValorCompleto({ tabla: t, esquemaSesion: null, columnasResultado: cols('A', 'NOTA'), columnasCatalogo: CATALOGO })
  check('NO: falta una columna de la PK, y se nombra', !falta1.ok && falta1.razon === 'El resultado no trae la columna B de la clave primaria', j(falta1))
  const falta2 = decidirValorCompleto({ tabla: t, esquemaSesion: null, columnasResultado: cols('NOTA'), columnasCatalogo: CATALOGO })
  check('NO: faltan varias, en plural', !falta2.ok && falta2.razon === 'El resultado no trae las columnas B y A de la clave primaria', j(falta2))
  check('razonFaltanClave con tres', razonFaltanClave(['A', 'B', 'C']) === 'El resultado no trae las columnas A, B y C de la clave primaria', razonFaltanClave(['A', 'B', 'C']))
  const pg = decidirValorCompleto({
    tabla: tablaDe('select * from ventas.cliente', 'postgres'),
    esquemaSesion: 'public',
    columnasResultado: cols('id', 'nombre'),
    columnasCatalogo: [col('id', 1), col('nombre', null, 2)]
  })
  check('PG: nombres en minúscula, sin sorpresa', pg.ok && pg.objeto.esquema === 'ventas' && j(pg.indicesClave) === j([0]), j(pg))
  check(
    'NO: la comparación es EXACTA (una columna «Id» no es la PK «id»)',
    decidirValorCompleto({ tabla: { esquema: 'x', nombre: 't' }, esquemaSesion: null, columnasResultado: cols('Id'), columnasCatalogo: [col('id', 1)] }).ok === false,
    'Id ≠ id'
  )

  hr('(2) claveDeFila')
  check('valores en el orden de la PK', j(claveDeFila(['nota', '1', '2'], [2, 1])) === j(['2', '1']), j(claveDeFila(['nota', '1', '2'], [2, 1])))
  check('un índice fuera de la fila da null (no revienta)', j(claveDeFila(['a'], [0, 5])) === j(['a', null]), 'ok')

  hr('(3) tablaInsertDe')
  check('Oracle, esquema y nombre plegados: sin comillas', tablaInsertDe(tablaDe('select * from hr.pedidos', 'oracle'), 'oracle') === 'HR.PEDIDOS', String(tablaInsertDe(t, 'oracle')))
  check(
    'Oracle, nombre citado con minúsculas: se cita',
    tablaInsertDe(tablaDe('select * from "MiTabla"', 'oracle'), 'oracle') === '"MiTabla"',
    String(tablaInsertDe(tablaDe('select * from "MiTabla"', 'oracle'), 'oracle'))
  )
  check('PG: en minúscula, sin comillas', tablaInsertDe(tablaDe('select * from Ventas.Cliente', 'postgres'), 'postgres') === 'ventas.cliente', String(tablaInsertDe(tablaDe('select * from Ventas.Cliente', 'postgres'), 'postgres')))
  check('con @dblink', tablaInsertDe(remota, 'oracle') === 'PEDIDOS@CENTRAL', String(tablaInsertDe(remota, 'oracle')))
  check('NO: sin tabla única, ninguna', tablaInsertDe(null, 'oracle') === undefined, 'undefined')

  hr('(4) peticionValor')
  const pv = peticionValor({
    conexionId: 'c1',
    perfilId: 'p1',
    consolaId: 'k1',
    txInicial: 'manual',
    objeto: { esquema: 'HR', nombre: 'PEDIDOS', tipo: 'tabla' },
    fila: ['nota', '1', '2'],
    indicesClave: [2, 1],
    columna: 'NOTA'
  })
  check(
    'lleva SU consola: el main relee en esa sesión (ve la tx sin confirmar), no en `datos`',
    pv.consola?.perfilId === 'p1' && pv.consola.consolaId === 'k1',
    j(pv.consola)
  )
  check(
    'y con ella la «Transacción al abrir» de la barra, por si la lectura crea la sesión',
    j(pv.consola) === j({ perfilId: 'p1', consolaId: 'k1', txInicial: 'manual' }),
    j(pv.consola)
  )
  check(
    'y lo demás, tal cual: conexión, objeto, columna y la PK en SU orden',
    pv.conexionId === 'c1' && j(pv.objeto) === j({ esquema: 'HR', nombre: 'PEDIDOS', tipo: 'tabla' }) && pv.columna === 'NOTA' && j(pv.clave) === j(['2', '1']),
    j(pv)
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
