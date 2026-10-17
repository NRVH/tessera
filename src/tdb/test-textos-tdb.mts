#!/usr/bin/env node
// =============================================================================
// Prueba de los textos de `tdb` (npm run test:textos-tdb): español e inglés con las mismas claves y
// la misma forma, el selector por `TESSERA_IDIOMA`, el español byte a byte como era y, de punta a
// punta, la ayuda y el error sin contexto de `tdb` y del cliente del contenedor en los dos idiomas.
// Corre bajo `node` llano: sin Docker ni servidores.
// =============================================================================

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const aqui = path.dirname(fileURLToPath(import.meta.url))
const { textosTdb, es, en } = require('./textosTdb.cjs') as {
  textosTdb: () => Record<string, unknown>
  es: Record<string, unknown>
  en: Record<string, unknown>
}

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

/** Las diferencias de forma entre dos árboles de textos: claves, tipos, aridad y largo de las listas. */
function diferencias(a: unknown, b: unknown, ruta: string): string[] {
  if (typeof a !== typeof b) return [`${ruta}: ${typeof a} frente a ${typeof b}`]
  if (typeof a === 'function') {
    const fa = a as (...x: unknown[]) => unknown
    const fb = b as (...x: unknown[]) => unknown
    return fa.length === fb.length ? [] : [`${ruta}: aridad ${fa.length} frente a ${fb.length}`]
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return [`${ruta}: lista frente a otra cosa`]
    return a.length === b.length ? [] : [`${ruta}: ${a.length} elementos frente a ${b.length}`]
  }
  if (a !== null && typeof a === 'object') {
    const oa = a as Record<string, unknown>
    const ob = b as Record<string, unknown>
    const claves = new Set([...Object.keys(oa), ...Object.keys(ob)])
    return [...claves].flatMap((k) =>
      !(k in oa) ? [`${ruta}.${k}: solo en inglés`] : !(k in ob) ? [`${ruta}.${k}: solo en español`] : diferencias(oa[k], ob[k], `${ruta}.${k}`)
    )
  }
  return []
}

type F = (...x: unknown[]) => string

/** Corre un guion con `node` y el idioma dado (`null` = sin la variable), sin contexto de Tessera. */
function correr(guion: string, args: string[], idioma: string | null): { salida: string; errores: string; codigo: number | null } {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const k of ['TESSERA_IDIOMA', 'TESSERA_DB_REGISTRY', 'TESSERA_DB_SESSION', 'TESSERA_DB_PIPE']) delete env[k]
  if (idioma !== null) env.TESSERA_IDIOMA = idioma
  const r = spawnSync(process.execPath, [path.join(aqui, guion), ...args], { env, encoding: 'utf8', timeout: 30_000 })
  return { salida: r.stdout ?? '', errores: r.stderr ?? '', codigo: r.status }
}

function main(): void {
  hr('A. Español e inglés tienen la misma forma')
  const dif = diferencias(es, en, 'textos')
  check('mismas claves, tipos, aridad y largo de listas', dif.length === 0, dif.length === 0 ? `${Object.keys(es).length} claves` : dif.join('; '))
  const vacios = Object.entries(en).filter(([, v]) => v === '').map(([k]) => k)
  check('ningún texto inglés vacío', vacios.length === 0, vacios.join(', ') || 'ninguno')
  const largas = Object.values(en.etiquetas as Record<string, string>).filter((e) => e.length > 15)
  check('las etiquetas de doctor caben en su columna (15)', largas.length === 0, largas.join(', ') || 'todas')

  hr('B. El selector lee TESSERA_IDIOMA')
  const antes = process.env.TESSERA_IDIOMA
  const casos: [string | undefined, unknown][] = [
    [undefined, es],
    ['en', en],
    ['es', es],
    ['fr', es],
    ['EN', es]
  ]
  for (const [valor, esperado] of casos) {
    if (valor === undefined) delete process.env.TESSERA_IDIOMA
    else process.env.TESSERA_IDIOMA = valor
    check(`TESSERA_IDIOMA=${valor ?? '(sin definir)'}`, textosTdb() === esperado, esperado === en ? 'inglés' : 'español')
  }
  if (antes === undefined) delete process.env.TESSERA_IDIOMA
  else process.env.TESSERA_IDIOMA = antes

  hr('C. El español es el de antes, byte a byte')
  const exactos: [string, string, string][] = [
    ['faltaArgumento', (es.faltaArgumento as F)('alias'), "Falta el argumento <alias>. Usa 'tdb help'."],
    [
      'noHayConexion',
      (es.noHayConexion as F)('x', '"a"', 2),
      'No hay ninguna conexión llamada "x" en este perfil.\n    Disponibles: "a"\n    (y 2 que este tdb no sabe usar: tdb ls)'
    ],
    ['noHayConexion sin otras', (es.noHayConexion as F)('x', '(ninguna)', 0), 'No hay ninguna conexión llamada "x" en este perfil.\n    Disponibles: (ninguna)'],
    ['filas', (es.filas as F)(3, false), '\n  3 fila(s)\n'],
    ['filas con tope', (es.filas as F)(50, true), '\n  50 filas (TOPE alcanzado; usa --limit N para más)\n'],
    ['documentos con tope', (es.documentos as F)(2, true), '  2 documento(s) (TOPE alcanzado: hay más; usa --limit N para más)\n'],
    [
      'sinContrasena',
      (es.sinContrasena as F)('mibase'),
      'No hay contraseña para "mibase" en esta sesión.\n' +
        '    Guárdala con "Editar conexión…" en la vista Bases de datos de Tessera y reabre la terminal.'
    ],
    ['doctorTodoBien', es.doctorTodoBien as string, '  ✓ Todo en orden. Prueba:  tdb ls'],
    ['columnasLs', (es.columnasLs as string[]).join(','), 'ALIAS,MOTOR,DESTINO,USUARIO,MODO,ENTORNO'],
    ['clavesDe', (es.clavesDe as F)('r', 0, ', patrón u:*', 3, true), '\n  Claves de r (base 0, patrón u:*) — 3 (hay más)\n'],
    ['binario', (es.binario as F)(4), '<binario 4 bytes>'],
    [
      'doctorRespaldo',
      (es.doctorRespaldo as F)(false),
      'El registro (db-connections.json) no existe: se usa su copia de respaldo (db-connections.json.bak), y Tessera lo recreará en su próxima escritura.'
    ]
  ]
  for (const [nombre, real, esperado] of exactos) check(nombre, real === esperado, JSON.stringify(real))
  const ayuda = (es.ayuda as F)(50, 'SQL Server', '', '')
  check(
    'ayuda: cabecera, tope y cierre de siempre',
    ayuda.startsWith('\n  tdb — consulta las bases de datos configuradas en Tessera (perfil activo)\n') &&
      ayuda.includes('Ejecuta una consulta (tope 50 filas)') &&
      ayuda.endsWith('  En SQL Server, GO en su propia línea separa lotes, como en sqlcmd.\n'),
    `${ayuda.length} caracteres`
  )

  hr('D. El inglés hace el plural de verdad')
  check('1 row', (en.filas as F)(1, false) === '\n  1 row\n', JSON.stringify((en.filas as F)(1, false)))
  check('2 rows', (en.filas as F)(2, false) === '\n  2 rows\n', JSON.stringify((en.filas as F)(2, false)))
  check('1 document', (en.documentos as F)(1, false) === '  1 document\n', JSON.stringify((en.documentos as F)(1, false)))
  check('1 table', (en.esquemaDe as F)('a', 1).includes('— 1 table\n'), JSON.stringify((en.esquemaDe as F)('a', 1)))
  check('el estado del puente se traduce', (en.estadoPuente as F)('no responde') === 'not responding', (en.estadoPuente as F)('no responde'))
  check('en español, el estado queda tal cual', (es.estadoPuente as F)('no responde') === 'no responde', (es.estadoPuente as F)('no responde'))

  hr('E. De punta a punta: tdb y el cliente del contenedor')
  const ayudaEs = correr('tdb.cjs', ['help'], null)
  const ayudaEn = correr('tdb.cjs', ['help'], 'en')
  check('tdb help sin la variable, en español', ayudaEs.salida.includes('tdb — consulta las bases de datos'), ayudaEs.salida.split('\n')[1] ?? '')
  check('tdb help con en, en inglés', ayudaEn.salida.includes('tdb — query the databases configured in Tessera'), ayudaEn.salida.split('\n')[1] ?? '')
  const sinCtxEs = correr('tdb.cjs', ['ls'], null)
  const sinCtxEn = correr('tdb.cjs', ['ls', '--json'], 'en')
  check('tdb ls sin contexto: el error en español', sinCtxEs.codigo === 1 && sinCtxEs.errores.includes('Esta terminal no lleva el contexto'), sinCtxEs.errores.trim().split('\n')[0])
  let jsonEn: { ok?: boolean; error?: string } = {}
  try {
    jsonEn = JSON.parse(sinCtxEn.salida.trim())
  } catch {
    // Queda vacío y el check lo dice.
  }
  check(
    'tdb ls --json sin contexto: misma forma, el mensaje en inglés',
    sinCtxEn.codigo === 1 && jsonEn.ok === false && String(jsonEn.error).startsWith('This terminal does not carry'),
    sinCtxEn.salida.trim().slice(0, 80)
  )
  const contEs = correr('tdb-container.cjs', ['ls'], null)
  const contEn = correr('tdb-container.cjs', ['ls'], 'en')
  check('cliente del contenedor, en español', contEs.codigo === 2 && contEs.errores.includes('Esta terminal no lleva el contexto de bases de datos'), contEs.errores.trim().split('\n')[0])
  check('cliente del contenedor, en inglés', contEn.codigo === 2 && contEn.errores.includes('This terminal does not carry the Tessera database context'), contEn.errores.trim().split('\n')[0])

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
