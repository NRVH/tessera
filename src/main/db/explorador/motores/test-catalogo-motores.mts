#!/usr/bin/env node
// =============================================================================
// Prueba del catálogo por motor del explorador y de su cruce con el descriptor compartido:
// lo que tiene que cumplir CUALQUIER motor del registro (banderas coherentes con lo que el
// catálogo hace, `tieneDdl`, SQL por carpeta, binds sin nombres en el texto, contrato del
// lector `construir`, motor desconocido y `soloMotoresCon`). El SQL de Oracle y PostgreSQL uno
// a uno lo fija `test-catalogo-sql.mts`. (npm run test:db-catalogo-motores)
// Decisiones: docs/decisiones/bd/catalogo-motores-oracle.md
// =============================================================================

import type { DbMotor, DbMotorSql } from '../../../../shared/db-ipc.ts'
import type { DbRefObjeto, DbTipoObjeto } from '../../../../shared/db-explorador-ipc.ts'
import { porMotorSql } from '../../../../shared/motores/index.ts'
import type { FormaPaginado } from '../../../../shared/motores/tipos.ts'
import { mapearColumnas, mapearConteos, mapearNombres, sqlEsquemas, sqlFks, sqlObjetos } from '../catalogoSql.ts'
import { FalloTrabajador } from '../protocoloTrabajador.ts'
import type { LectorCatalogo, LectorDdl } from './catalogo.ts'
import { enEsqueleto, soloMotoresCon } from './filasCatalogo.ts'
import { MOTORES_EXPLORADOR, type ConsultaCatalogo, type DialectoCatalogo, type FilaCatalogo } from './index.ts'

// El catálogo del main es SOLO de los motores SQL: el registro que este test
// recorre es el suyo (`porMotorSql`), con el descriptor SQL de cada uno. MongoDB y Redis no
// tienen catálogo de esquemas (lo fija `test-motores-explorador`).
const MOTORES = porMotorSql((d) => d)

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

/** El mensaje si `f` lanza, o null si no lanza. */
function lanza(f: () => unknown): string | null {
  try {
    f()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/** Un lector que solo pregunta (`construir` tal cual): el de los casos que miran QUÉ se pregunta. */
function lectorSimple(d: DialectoCatalogo, consultar: (c: ConsultaCatalogo) => Promise<readonly FilaCatalogo[]>): LectorCatalogo {
  return { dialecto: d, consultar, construir: (fn) => fn() }
}

/** Generador con semilla (mulberry32): las mismas filas inventadas en cada corrida. */
function azar(semilla: number): () => number {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Valores con los que se inventan filas: los que leen los mapeadores de los dos motores. */
const VALORES_FILA: readonly unknown[] = [
  'A', 'B', 'APP', 'T', 'P', 'U', 'R', 'C', 'p', 'u', 'f', 'c', 'r', 'v', 'm', 'S', 'e', 'd', 's', 't',
  'YES', 'NO', 'Y', 'N', 'VALID', 'NUMBER', 'VARCHAR2', 'integer', 'text', 'TABLE', 'VIEW', 'PACKAGE',
  'CREATE TABLE x (a int)', '{a,b}', ['a', 'b'], 1, 2, 0, 10, null, true, false, ''
]

/** De 0 a 3 filas de 14 columnas con valores de `VALORES_FILA`. */
function filasInventadas(r: () => number): FilaCatalogo[] {
  const n = Math.floor(r() * 4)
  const filas: FilaCatalogo[] = []
  for (let i = 0; i < n; i++) {
    const f: unknown[] = []
    for (let k = 0; k < 14; k++) f.push(VALORES_FILA[Math.floor(r() * VALORES_FILA.length)])
    filas.push(f)
  }
  return filas
}

/** Cómo responde el bloque del DDL en un escenario del contrato (7). */
type Bloque = 'texto' | 'nulo' | 'vacio' | 'ORA-31603' | 'ORA-39212' | 'ORA-01031' | 'ORA-01403' | 'ORA-00942'

interface Espia {
  lector: LectorDdl
  /** Lo que se mandó (consultas y bloques), en orden. */
  mandado: string[]
  /** Lo que se mandó SIN haber salido de `construir`. */
  sinConstruir: string[]
}

/** Un lector que apunta lo que construye y lo que manda, y responde según el escenario. */
function espia(d: DialectoCatalogo, filas: (c: ConsultaCatalogo) => FilaCatalogo[], bloque: Bloque): Espia {
  const construido = new Set<unknown>()
  const mandado: string[] = []
  const sinConstruir: string[] = []
  const apuntar = (x: unknown): void => {
    construido.add(x)
    if (Array.isArray(x)) for (const y of x) construido.add(y)
  }
  const lector: LectorDdl = {
    dialecto: d,
    construir: (fn) => {
      const x = fn()
      apuntar(x)
      return x
    },
    consultar: async (c) => {
      mandado.push(c.sql)
      if (!construido.has(c)) sinConstruir.push(c.sql.slice(0, 70))
      return filas(c)
    },
    fallo: (mensaje) => new Error(mensaje),
    bloqueTexto: async (sql, binds) => {
      mandado.push(sql)
      const deConstruir = Array.from(construido).some(
        (x) => typeof x === 'object' && x !== null && (x as ConsultaCatalogo).sql === sql && (x as ConsultaCatalogo).binds === binds
      )
      if (!deConstruir) sinConstruir.push('(bloque) ' + sql.slice(0, 60))
      switch (bloque) {
        case 'texto':
          return { texto: 'CREATE TABLE "E"."O" (\n  "A" NUMBER\n);\n', longitud: 40, recortado: false }
        case 'nulo':
          return null
        case 'vacio':
          return { texto: '   ', longitud: 3, recortado: false }
        default:
          throw new FalloTrabajador({ clase: 'servidor', codigo: bloque, mensaje: `${bloque}: fallo inventado` }, 'ejecutar')
      }
    }
  }
  return { lector, mandado, sinConstruir }
}

const TODOS_LOS_TIPOS: readonly DbTipoObjeto[] = [
  'tabla',
  'vista',
  'vistaMaterializada',
  'tablaForanea',
  'rutina',
  'paquete',
  'secuencia',
  'sinonimo',
  'tipoObjeto',
  'tipoColeccion',
  'tipo',
  'disparador'
]

const MALICIOSO = "X' OR '1'='1"

/** Lo que el descriptor NO podía cambiar, escrito a mano (un motor nuevo no compila sin su fila). */
const VALORES_DE_ANTES: Readonly<
  Record<
    DbMotorSql,
    {
      pkEnColumnas: boolean
      leeTiposDeclarados: boolean
      tieneSinonimos: boolean
      pseudoEsquemaPublico: string | null
      rejilla: FormaPaginado
    }
  >
> = {
  oracle: { pkEnColumnas: false, leeTiposDeclarados: true, tieneSinonimos: true, pseudoEsquemaPublico: 'PUBLIC', rejilla: 'cursor' },
  postgres: { pkEnColumnas: true, leeTiposDeclarados: false, tieneSinonimos: false, pseudoEsquemaPublico: null, rejilla: 'limitOffset' },
  // SQLite (no es «de antes»: es lo que SQLite declara; ver `catalogoSqlite.ts` y su descriptor).
  sqlite: { pkEnColumnas: true, leeTiposDeclarados: true, tieneSinonimos: false, pseudoEsquemaPublico: null, rejilla: 'keyset' },
  // lo que SQL Server declara (su catálogo del main aún es un esqueleto: ver abajo).
  sqlserver: { pkEnColumnas: true, leeTiposDeclarados: false, tieneSinonimos: true, pseudoEsquemaPublico: null, rejilla: 'offsetFetch' }
}

async function main(): Promise<void> {
  // Un motor cuyo catálogo del main todavía es un ESQUELETO queda fuera
  // mientras lo sea, y se dice; en cuanto se rellene, entra solo (ver `enEsqueleto`).
  const esqueletos = (Object.keys(MOTORES_EXPLORADOR) as DbMotorSql[]).filter((m) =>
    enEsqueleto(() => MOTORES_EXPLORADOR[m].catalogo.sqlEsquemas({ motor: m, versionMayor: MOTORES[m].sesion.versionMinima }))
  )
  if (esqueletos.length) console.log(`(motores con el catálogo en esqueleto, fuera de estas pruebas: ${esqueletos.join(', ')})`)
  const motores = (Object.keys(MOTORES_EXPLORADOR) as DbMotorSql[]).filter((m) => !esqueletos.includes(m))

  hr('(1) Las banderas dicen lo que el catálogo hace')
  for (const m of motores) {
    const cat = MOTORES_EXPLORADOR[m].catalogo
    const des = MOTORES[m]
    const d: DialectoCatalogo = { motor: m, versionMayor: des.sesion.versionMinima }
    const sinonimo = [
      lanza(() => cat.sqlResolverSinonimo(d, 'E', 'S')),
      lanza(() => cat.sqlTipoDeObjeto(d, 'E', 'S')),
      lanza(() => cat.mapearTipoDeObjeto([]))
    ]
    check(
      `${m}: tieneSinonimos (${des.catalogo.tieneSinonimos}) ⇔ resolver un sinónimo y su tipo no lanza`,
      sinonimo.every((x) => (x === null) === des.catalogo.tieneSinonimos),
      j(sinonimo)
    )
    check(
      `${m}: tieneSinonimos ⇔ 'sinonimo' es una carpeta`,
      des.catalogo.tieneSinonimos === des.catalogo.carpetas.indexOf('sinonimo') >= 0,
      j(des.catalogo.carpetas)
    )
    check(
      `${m}: pseudoEsquemaPublico (${j(des.catalogo.pseudoEsquemaPublico)}) ⇔ hay consulta de sinónimos públicos`,
      (des.catalogo.pseudoEsquemaPublico !== null) === (cat.sqlNombresPublicos(d) !== null),
      j(cat.sqlNombresPublicos(d))
    )
    const tipos = [lanza(() => cat.sqlTiposColumnas(d, 'E', 'T')), lanza(() => cat.mapearTiposColumnas([]))]
    check(
      `${m}: leeTiposDeclarados (${cat.leeTiposDeclarados}) ⇔ sus dos métodos no lanzan`,
      tipos.every((x) => (x === null) === cat.leeTiposDeclarados),
      j(tipos)
    )
    if (!cat.pkEnColumnas) {
      // Filas de cualquier forma, con números donde otro motor pondría la posición en la PK.
      const filas: FilaCatalogo[] = [
        ['A', 'NUMBER', 22, 0, null, 10, 0, 'N', null, 1, null, 1],
        ['b', 'integer', false, null, 2, null, '', '', 1, 1, 1, 1]
      ]
      const conPk = cat.mapearColumnas(filas).filter((c) => c.pk !== null)
      check(`${m}: pkEnColumnas falso ⇒ mapearColumnas no pone la PK (va aparte)`, conPk.length === 0, j(conPk))
    }
  }

  hr('(2) «Ver DDL»: tieneDdl ⇔ carpeta del motor')
  for (const m of motores) {
    const cat = MOTORES_EXPLORADOR[m].catalogo
    const carpetas = MOTORES[m].catalogo.carpetas
    const distintos = TODOS_LOS_TIPOS.filter((t) => cat.tieneDdl(t) !== carpetas.indexOf(t) >= 0)
    check(`${m}: los ${TODOS_LOS_TIPOS.length} tipos, tieneDdl = es carpeta`, distintos.length === 0, j(distintos))
  }

  hr('(3) sqlObjetos: cada carpeta tiene SQL; lo demás lanza con la etiqueta del motor')
  for (const m of motores) {
    const d: DialectoCatalogo = { motor: m, versionMayor: MOTORES[m].sesion.versionMinima }
    const carpetas = MOTORES[m].catalogo.carpetas
    const sinSql = carpetas.filter((t) => lanza(() => sqlObjetos(d, 'E', t)) !== null)
    check(`${m}: las ${carpetas.length} carpetas tienen su consulta`, sinSql.length === 0, j(sinSql))
    for (const t of TODOS_LOS_TIPOS.filter((x) => carpetas.indexOf(x) < 0)) {
      const msg = lanza(() => sqlObjetos(d, 'E', t))
      check(
        `${m}: «${t}» no es carpeta: lanza «… no existe en ${MOTORES[m].etiqueta}»`,
        msg === `Catálogo: «${t}» no existe en ${MOTORES[m].etiqueta}`,
        String(msg)
      )
    }
  }

  hr('(4) Las reglas de siempre en todo el SQL de catálogo')
  for (const m of motores) {
    const cat = MOTORES_EXPLORADOR[m].catalogo
    const minima = MOTORES[m].sesion.versionMinima
    const consultas: Array<[string, ConsultaCatalogo]> = []
    const juntar = (nombre: string, f: () => ConsultaCatalogo | ConsultaCatalogo[] | null): void => {
      try {
        const r = f()
        if (r === null) return
        for (const c of Array.isArray(r) ? r : [r]) consultas.push([nombre, c])
      } catch {
        // Lo que el motor no tiene lanza (lo cubren (1) y (3)).
      }
    }
    for (const versionMayor of [minima, minima + 1, 21, 99]) {
      const d: DialectoCatalogo = { motor: m, versionMayor }
      juntar('sqlEsquemas', () => cat.sqlEsquemas(d))
      juntar('sqlEsquemaPorDefecto', () => cat.sqlEsquemaPorDefecto(d))
      juntar('sqlConteos', () => cat.sqlConteos(d, MALICIOSO))
      for (const t of MOTORES[m].catalogo.carpetas) juntar(`sqlObjetos ${t}`, () => cat.sqlObjetos(d, MALICIOSO, t))
      juntar('sqlColumnas', () => cat.sqlColumnas(d, MALICIOSO, MALICIOSO))
      juntar('sqlClavePrimaria', () => cat.sqlClavePrimaria(d, MALICIOSO, MALICIOSO))
      juntar('sqlRestricciones', () => cat.sqlRestricciones(d, MALICIOSO, MALICIOSO))
      juntar('sqlIndices', () => cat.sqlIndices(d, MALICIOSO, MALICIOSO))
      juntar('sqlTiposColumnas', () => cat.sqlTiposColumnas(d, MALICIOSO, MALICIOSO))
      juntar('sqlFks', () => cat.sqlFks(d, MALICIOSO, MALICIOSO))
      juntar('sqlResolverSinonimo', () => cat.sqlResolverSinonimo(d, MALICIOSO, MALICIOSO))
      juntar('sqlTipoDeObjeto', () => cat.sqlTipoDeObjeto(d, MALICIOSO, MALICIOSO))
      juntar('sqlNombres', () => cat.sqlNombres(d, [MALICIOSO, 'OTRO']))
      juntar('sqlNombresPublicos', () => cat.sqlNombresPublicos(d))
      for (const tipo of TODOS_LOS_TIPOS) {
        const ref: DbRefObjeto = { esquema: MALICIOSO, nombre: MALICIOSO, tipo, firma: MALICIOSO }
        juntar(`sqlFuente ${tipo}`, () => cat.sqlFuente(d, ref))
      }
    }
    const conNombre = consultas.filter(([, c]) => c.sql.indexOf(MALICIOSO) >= 0).map(([n]) => n)
    check(`${m}: ${consultas.length} consultas, el nombre malicioso nunca en el texto`, conNombre.length === 0, j(conNombre))
    const conBind = consultas.filter(([n]) => n !== 'sqlEsquemas' && n !== 'sqlEsquemaPorDefecto' && n !== 'sqlNombresPublicos')
    const sinBinds = conBind.filter(([, c]) => (Array.isArray(c.binds) ? c.binds.length : Object.keys(c.binds).length) === 0).map(([n]) => n)
    check(`${m}: las que llevan un nombre lo llevan en los binds`, sinBinds.length === 0, j(sinBinds))
    if (MOTORES[m].sql.dialecto === 'oracle') {
      const prohibidas = consultas.filter(([, c]) => /\b(FETCH|OFFSET|LIMIT)\b/i.test(c.sql)).map(([n]) => n)
      check(`${m}: ninguna consulta usa FETCH, OFFSET ni LIMIT (la 11.2 no los tiene)`, prohibidas.length === 0, j(prohibidas))
    }
    // `leerFks` empieza por la consulta que el motor documenta como la primera.
    const d: DialectoCatalogo = { motor: m, versionMayor: minima }
    const preguntas: ConsultaCatalogo[] = []
    await cat.leerFks(
      lectorSimple(d, async (c) => {
        preguntas.push(c)
        return []
      }),
      'E',
      'T'
    )
    check(`${m}: leerFks empieza por sqlFks`, preguntas.length > 0 && j(preguntas[0]) === j(sqlFks(d, 'E', 'T')), j(preguntas[0]))
  }

  hr('(5) Los valores de antes del descriptor')
  for (const m of motores) {
    const cat = MOTORES_EXPLORADOR[m].catalogo
    const des = MOTORES[m]
    const antes = VALORES_DE_ANTES[m]
    const ahora = {
      pkEnColumnas: cat.pkEnColumnas,
      leeTiposDeclarados: cat.leeTiposDeclarados,
      tieneSinonimos: des.catalogo.tieneSinonimos,
      pseudoEsquemaPublico: des.catalogo.pseudoEsquemaPublico,
      rejilla: des.sesion.paginado.rejilla
    }
    check(`${m}: PK aparte, tipos declarados, sinónimos, PUBLIC y forma de la rejilla, los de antes`, j(ahora) === j(antes), j(ahora))
  }

  hr('(6) Un motor desconocido lanza (antes caía en el SQL de PostgreSQL)')
  const desconocido = 'mysql' as DbMotor // (antes, 'sqlite')
  const intentos: Array<[string, string | null]> = [
    ['sqlEsquemas', lanza(() => sqlEsquemas({ motor: desconocido, versionMayor: 3 }))],
    ['sqlFks', lanza(() => sqlFks({ motor: desconocido, versionMayor: 3 }, 'E', 'T'))],
    ['mapearColumnas', lanza(() => mapearColumnas(desconocido, []))],
    ['mapearNombres', lanza(() => mapearNombres(desconocido, [], 'E'))],
    // Estas dos indexaban `CARPETAS_POR_MOTOR[motor]` a pelo: «Cannot read properties of undefined».
    ['sqlObjetos', lanza(() => sqlObjetos({ motor: desconocido, versionMayor: 3 }, 'E', 'tabla'))],
    ['mapearConteos', lanza(() => mapearConteos(desconocido, [['tabla', 1]]))]
  ]
  for (const [nombre, msg] of intentos) {
    check(`${nombre}('mysql') lanza «Motor desconocido»`, msg !== null && msg.indexOf('Motor desconocido') >= 0 && msg.indexOf('mysql') >= 0, String(msg))
  }

  hr('(7) El contrato del lector: toda consulta de leerFks y leerDdl sale de construir')
  {
    const BLOQUES: readonly Bloque[] = ['texto', 'nulo', 'vacio', 'ORA-31603', 'ORA-39212', 'ORA-01031', 'ORA-01403', 'ORA-00942']
    for (const m of motores) {
      const cat = MOTORES_EXPLORADOR[m].catalogo
      const minima = MOTORES[m].sesion.versionMinima
      const saltos: string[] = []
      let mandadas = 0
      let casos = 0
      for (const versionMayor of [minima, 21]) {
        const d: DialectoCatalogo = { motor: m, versionMayor }
        for (let semilla = 0; semilla < 60; semilla++) {
          const r = azar(semilla * 7919 + versionMayor)
          // Semilla 0: todo vacío; las demás, filas inventadas en cada consulta.
          const filas = (): FilaCatalogo[] => (semilla === 0 ? [] : filasInventadas(r))
          const fk = espia(d, filas, 'nulo')
          try {
            await cat.leerFks(fk.lector, 'E', 'T')
          } catch {
            // Filas absurdas pueden romper un mapeador: aquí solo cuenta qué se mandó antes.
          }
          casos++
          mandadas += fk.mandado.length
          for (const s of fk.sinConstruir) saltos.push(`v${versionMayor} leerFks: ${s}`)
          for (const t of TODOS_LOS_TIPOS.filter((x) => cat.tieneDdl(x))) {
            for (const b of BLOQUES) {
              const ddl = espia(d, filas, b)
              try {
                await cat.leerDdl(ddl.lector, { esquema: 'E', nombre: 'O', tipo: t, firma: '' })
              } catch {
                // Un error del servidor que no es de repliegue se relanza (lo fija test-ddl-catalogo).
              }
              casos++
              mandadas += ddl.mandado.length
              for (const s of ddl.sinConstruir) saltos.push(`v${versionMayor} leerDdl ${t}/${b}: ${s}`)
            }
          }
        }
      }
      check(
        `${m}: ${casos} lecturas y ${mandadas} consultas, ninguna sin pasar por construir`,
        // `>=` con SQLite: SQLite lee las FK y el DDL con UNA consulta cada uno.
        saltos.length === 0 && mandadas >= casos,
        j(Array.from(new Set(saltos)).slice(0, 8))
      )
      // Un tipo sin DDL lanza sin preguntar nada.
      const sinDdl = TODOS_LOS_TIPOS.filter((t) => !cat.tieneDdl(t))
      const malos: string[] = []
      for (const t of sinDdl) {
        const e = espia({ motor: m, versionMayor: minima }, () => [], 'texto')
        let lanzo = false
        try {
          await cat.leerDdl(e.lector, { esquema: 'E', nombre: 'O', tipo: t })
        } catch {
          lanzo = true
        }
        if (!lanzo || e.mandado.length > 0) malos.push(`${t}: lanzó=${lanzo}, mandó ${e.mandado.length}`)
      }
      check(`${m}: los ${sinDdl.length} tipos sin DDL lanzan sin preguntar nada`, malos.length === 0, malos.join(' | '))
    }
  }

  hr('(8) soloMotoresCon: el aviso nombra los motores que SÍ tienen la capacidad')
  {
    const hoy = soloMotoresCon('sinónimos', (d) => d.catalogo.tieneSinonimos)
    // SQL Server TIENE sinónimos, y el aviso lo dice sin que nadie toque el mensaje
    // (para eso se escribió con `etiquetasDonde`).
    check('con el registro de hoy: «Solo Oracle y SQL Server tienen sinónimos.» (el plural, solo)', hoy === 'Solo Oracle y SQL Server tienen sinónimos.', hoy)
    // El plural, con una capacidad que tienen todos los motores de hoy (la lista la
    // escribe `etiquetasDonde`, que tiene su propio test en shared).
    const todos = soloMotoresCon('x', () => true)
    const esperado = `Solo ${Object.values(MOTORES).map((d) => d.etiqueta).slice(0, -1).join(', ')} y ${Object.values(MOTORES).slice(-1)[0].etiqueta} tienen x.`
    check(`todos los motores, en plural: «${esperado}»`, todos === esperado, todos)
    const ninguno = soloMotoresCon('x', () => false)
    check('ninguno: «Ningún motor tiene x.»', ninguno === 'Ningún motor tiene x.', ninguno)
  }

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

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
