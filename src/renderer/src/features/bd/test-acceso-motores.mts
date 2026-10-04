#!/usr/bin/env node
// =============================================================================
// Prueba del ACCESO A LOS REGISTROS POR MOTOR desde el renderer (npm run
// test:db-acceso-motores): cada función que lee un registro por motor o dialecto,
// con un motor fuera del registro («mysql», «constructor») o de otra familia, dice
// «Motor desconocido» o «no es un motor SQL» en vez de un TypeError; y una GUARDIA
// sobre el código del renderer: ningún índice directo a un registro salvo por el
// acceso que valida, tras un `esMotor(…)` o con el `d.id` de un descriptor.
// Decisiones: docs/decisiones/bd/motores-codigo-por-motor.md
// =============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DbConnection, DbMotor } from '../../../../shared/db-ipc.ts'
import type { DbEsquemasRespuesta } from '../../../../shared/db-explorador-ipc.ts'
import { IDS_MOTORES, esMotorSql, etiquetaMotor } from '../../../../shared/motores/index.ts'
import type { DialectoSql } from '../../../../shared/sql/dialectosSql.ts'
import { tokenizar } from '../../../../shared/sql/lexicoSql.ts'
import { aplanarArbolBd, claveBd } from './arbolBd.ts'
import { descriptorDe, faltantes, limpiarParaGuardar } from './camposConexion.ts'
import { lenguajeFuente, sinOrdenEstable } from './panesBd.ts'
import { CatalogoAutocompletado } from './autocompletado/catalogoAutocompletado.ts'
import { referencias } from './autocompletado/contextoSql.ts'
import { aliasLibre, esquemasLocales, type FuenteCatalogo } from './autocompletado/sugerenciasSql.ts'
import type { CacheMetaBd } from './cacheMetaBd.ts'
import { explicarPideValores } from './consola/estadoConsola.ts'
import { cargarFormateador } from './consola/formateoSql.ts'
import { lenguajeConsola } from './consola/lenguajeConsola.ts'
import { etiquetaDeClave, pieDialogoParametros } from './consola/parametrosConsola.ts'
import { commitEnBloques, pendientesQueConfirmaDdl } from './consola/produccionConsola.ts'
import { textoEcoPlan } from './consola/salidaConsola.ts'

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

/** Lo que lanza `f`, como «Tipo: mensaje», o '' si no lanza. */
function errorDe(f: () => unknown): string {
  try {
    f()
    return ''
  } catch (e) {
    return e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  }
}

// --- Fixtures -------------------------------------------------------------------------

/** Una conexión de ese motor con un esquema desplegado y conteos: lo que pinta carpetas. */
function entradaArbol(motor: string): Parameters<typeof aplanarArbolBd>[0] {
  const c = { id: 'c', profileId: 'p', alias: 'X', motor, host: 'h', port: 1, user: 'u', tieneSecreto: false, readonly: true } as unknown as DbConnection
  const esquemas: DbEsquemasRespuesta = {
    esquemas: [{ nombre: 'E', sistema: false, visible: true, porDefecto: true }],
    porDefecto: 'E',
    config: { modo: 'todos', porDefecto: true, esquemas: [] },
    nVisibles: 1
  } as unknown as DbEsquemasRespuesta
  return {
    conexiones: [c],
    consolas: [],
    esquemas: new Map([[claveBd.conexion('c'), esquemas]]),
    conteos: new Map([[claveBd.esquema('c', 'E'), { tabla: 1 }]]),
    objetos: new Map(),
    detalles: new Map(),
    errores: new Map(),
    expandidos: new Set([claveBd.conexion('c'), claveBd.esquema('c', 'E')])
  }
}

const fuente = { esquemaActual: () => 'E' } as unknown as FuenteCatalogo
const cache = {} as unknown as CacheMetaBd
const formatear = await cargarFormateador()
const TOKENS = tokenizar('select * from emp e', 'oracle')

/**
 * Los sitios COMUNES a todas las familias (el formulario, el árbol): con cualquier motor del
 * registro, no lanzan.
 */
const SITIOS_COMUNES: ReadonlyArray<readonly [string, (m: string) => unknown]> = [
  ['camposConexion.descriptorDe', (m) => descriptorDe(m as DbMotor)],
  ['camposConexion.faltantes', (m) => faltantes({ motor: m as DbMotor, alias: 'a', host: 'h', port: 1, database: 'd', sid: '', user: 'u' })],
  ['camposConexion.limpiarParaGuardar', (m) => limpiarParaGuardar({ motor: m as DbMotor, alias: 'a', host: 'h', port: 1, database: 'd', sid: 's', user: 'u' })],
  ['arbolBd.aplanarArbolBd (carpetas del esquema)', (m) => aplanarArbolBd(entradaArbol(m))]
]

/**
 * Los sitios de los caminos SOLO SQL (consola, rejilla, fuente, autocompletado):
 * leen con `descriptorSql`, así que con un motor de otra familia LANZAN con «X no es un motor
 * SQL.» en vez de seguir con valores que no son suyos (ver (1b)).
 */
const SITIOS_SQL: ReadonlyArray<readonly [string, (m: string) => unknown]> = [
  ['panesBd.sinOrdenEstable', (m) => sinOrdenEstable(m as DbMotor, [], [])],
  ['panesBd.lenguajeFuente', (m) => lenguajeFuente(m as DbMotor)],
  ['lenguajeConsola.lenguajeConsola', (m) => lenguajeConsola(m as DbMotor)],
  ['estadoConsola.explicarPideValores', (m) => explicarPideValores(m as DialectoSql)],
  ['formateoSql (el formateador)', (m) => formatear('select 1 from dual', m as DialectoSql)],
  ['parametrosConsola.etiquetaDeClave', (m) => etiquetaDeClave('1', m as DialectoSql)],
  ['parametrosConsola.pieDialogoParametros', (m) => pieDialogoParametros(m as DialectoSql)],
  ['produccionConsola.pendientesQueConfirmaDdl', (m) => pendientesQueConfirmaDdl([{ clase: 'ddl' }], m as DialectoSql, { tx: 'pendiente', sentenciasEnTx: 1 })],
  ['produccionConsola.commitEnBloques', (m) => commitEnBloques([], m as DialectoSql, null)],
  ['salidaConsola.textoEcoPlan', (m) => textoEcoPlan(null, 'select 1', m as DialectoSql)],
  ['sugerenciasSql.esquemasLocales', (m) => esquemasLocales(fuente, m as DialectoSql)],
  ['sugerenciasSql.aliasLibre', (m) => aliasLibre('orden', [], m as DialectoSql)],
  ['contextoSql.referencias', (m) => referencias(TOKENS, m as DialectoSql)],
  ['catalogoAutocompletado (constructor)', (m) => new CatalogoAutocompletado(cache, { conexionId: 'c', dialecto: m as DialectoSql, esquema: () => null })]
]

/** Todos: con un motor FUERA del registro, todos dan «Motor desconocido». */
const SITIOS: ReadonlyArray<readonly [string, (m: string) => unknown]> = [...SITIOS_COMUNES, ...SITIOS_SQL]

hr('(1) Un motor fuera del registro: «Motor desconocido», no un TypeError')
// ('mysql' hace de motor fuera del registro.)
for (const ajeno of ['mysql', 'constructor']) {
  const malos: string[] = []
  for (const [nombre, f] of SITIOS) {
    const e = errorDe(() => f(ajeno))
    if (e !== `Error: Motor desconocido: "${ajeno}".`) malos.push(`${nombre} -> ${e || 'no lanza'}`)
  }
  check(`«${ajeno}»: los ${SITIOS.length} sitios dan «Motor desconocido»`, malos.length === 0, malos.length ? malos.join(' | ') : `${SITIOS.length} de ${SITIOS.length}`)
}
{
  // Mitad negativa: con cada motor del registro, ninguno lanza (los SQL, con los SQL).
  const malos: string[] = []
  let casos = 0
  for (const m of IDS_MOTORES) {
    for (const [nombre, f] of esMotorSql(m) ? SITIOS : SITIOS_COMUNES) {
      casos++
      const e = errorDe(() => f(m))
      if (e !== '') malos.push(`${m}: ${nombre} -> ${e}`)
    }
  }
  check('NEGATIVO: con los motores del registro, ninguno lanza', malos.length === 0, malos.length ? malos.join(' | ') : `${casos} casos`)
}

hr('(1b) un motor de OTRA familia en un camino SQL lo dice, no sigue con otro')
{
  const noSql = IDS_MOTORES.filter((m) => !esMotorSql(m))
  const malos: string[] = []
  for (const m of noSql) {
    for (const [nombre, f] of SITIOS_SQL) {
      const e = errorDe(() => f(m))
      if (e !== `Error: ${etiquetaMotor(m)} no es un motor SQL.`) malos.push(`${m}: ${nombre} -> ${e || 'no lanza'}`)
    }
  }
  check(
    `MongoDB y Redis: los ${SITIOS_SQL.length} sitios SQL dan «X no es un motor SQL.»`,
    noSql.length >= 2 && malos.length === 0,
    malos.length ? malos.join(' | ') : `${noSql.join(', ')} x ${SITIOS_SQL.length}`
  )
}

// --- (2) Guardia ------------------------------------------------------------------------

hr('(2) Guardia: ningún índice directo a un registro por motor o dialecto en el renderer')

/**
 * Los registros indexados por motor o por dialecto que el renderer puede ver. Un índice a
 * cualquiera de ellos con un valor que no pasó por el acceso que valida es la forma del
 * fallo de (1).
 */
const REGISTROS = [
  'MOTORES',
  'REGLAS',
  'RESERVADAS',
  'PALABRAS_CLAVE',
  'SEGURO',
  // Retirada de shared (sin lectores): se queda en la
  // lista para que, si vuelve con otro uso, vuelva vigilada.
  'CARPETAS_POR_MOTOR',
  'MOTORES_EXPLORADOR',
  'ESCRITURA_SQL',
  'MARCAS_MOTOR',
  'DESCRIPTORES',
  'PRESENTACION'
]
const INDICE = new RegExp(`\\b(${REGISTROS.join('|')})\\[([^\\]]*)`, 'g')

/**
 * ¿Es aceptable este índice? Las excepciones van por FORMA del índice y no por archivo: una
 * por archivo eximiría también la línea mala de mañana en ese archivo.
 */
function indiceValido(clave: string, linea: string): boolean {
  return /^(descriptor|dialectoDeMotor)\(/.test(clave) || /^d\.id$/.test(clave) || /\besMotor\(/.test(linea)
}

/**
 * Una línea sin sus comentarios (de línea, de bloque en la misma línea, y los que siguen
 * abiertos de una línea anterior: `enBloque`). No mira dentro de las cadenas: un `//` en
 * una (una URL) cortaría la línea ahí, y lo que se pierde es un posible positivo, nunca un
 * falso FAIL. Basta para esta guardia.
 */
function codigoDe(linea: string, enBloque: { v: boolean }): string {
  let s = linea
  let out = ''
  for (;;) {
    if (enBloque.v) {
      const fin = s.indexOf('*/')
      if (fin < 0) return out
      s = s.slice(fin + 2)
      enBloque.v = false
      continue
    }
    const bloque = s.indexOf('/*')
    const deLinea = s.indexOf('//')
    if (deLinea >= 0 && (bloque < 0 || deLinea < bloque)) return out + s.slice(0, deLinea)
    if (bloque < 0) return out + s
    out += s.slice(0, bloque)
    s = s.slice(bloque + 2)
    enBloque.v = true
  }
}

/** Los fuentes del renderer, sin tests ni declaraciones. */
function fuentes(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const ruta = join(dir, e)
    if (statSync(ruta).isDirectory()) out.push(...fuentes(ruta))
    else if (!e.startsWith('test-') && !e.endsWith('.d.ts') && /\.(ts|tsx)$/.test(e)) out.push(ruta)
  }
  return out
}

const RAIZ_RENDERER = join(fileURLToPath(new URL('.', import.meta.url)), '../..')
const archivos = fuentes(RAIZ_RENDERER)
const sueltos: string[] = []
let revisados = 0
for (const archivo of archivos) {
  const lineas = readFileSync(archivo, 'utf8').split('\n')
  const enBloque = { v: false }
  lineas.forEach((l, i) => {
    const codigo = codigoDe(l, enBloque)
    for (const m of codigo.matchAll(INDICE)) {
      revisados++
      if (!indiceValido(m[2].trim(), codigo)) {
        sueltos.push(`${relative(RAIZ_RENDERER, archivo).split(sep).join('/')}:${i + 1}: ${m[0]}]`)
      }
    }
  })
}
check('el escaneo recorre el renderer (más de 100 archivos)', archivos.length > 100, `${archivos.length} archivos`)
check('ningún índice directo a un registro por motor o dialecto', sueltos.length === 0, sueltos.length ? sueltos.join(' | ') : `${revisados} índices, todos por el acceso que valida`)
{
  // Que el detector se dispara: líneas inventadas, las malas y las buenas.
  const casos: Array<[string, boolean]> = [
    ['  const x = MOTORES[d].sql', false],
    ['  return REGLAS[dialecto].explain', false],
    ['  if (RESERVADAS[d].has(v)) return', false],
    ['  const t = CARPETAS_POR_MOTOR[c.motor]', false],
    ['  return DESCRIPTORES[motor]', false],
    ['  const x = descriptor(d).sql', true],
    ['  return RESERVADAS[dialectoDeMotor(d)].has(v)', true],
    ['  return DESCRIPTORES[descriptor(motor).id]', true],
    ['  const m = esMotor(x) ? MARCAS_MOTOR[x] : undefined', true],
    ['  const p = PRESENTACION[d.id]', true],
    ['  // MOTORES[d] en un comentario', true],
    ['  /** Nombre del motor: `MOTORES[d].etiqueta`. */', true],
    ['  const a = 1 /* REGLAS[d] */ + MOTORES[d].id', false]
  ]
  const fallan = casos.filter(([l, bueno]) => {
    const codigo = codigoDe(l, { v: false })
    const malos = [...codigo.matchAll(INDICE)].filter((m) => !indiceValido(m[2].trim(), codigo))
    return (malos.length === 0) !== bueno
  })
  check('el detector distingue los índices malos de los buenos', fallan.length === 0, fallan.length ? fallan.map(([l]) => l.trim()).join(' | ') : `${casos.length} casos`)
}

// ---------------------------------------------------------------------------------
const pasadas = results.filter((r) => r.pass).length
const allPass = pasadas === results.length
hr(`VEREDICTO: ${pasadas}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
