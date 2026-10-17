#!/usr/bin/env node
// =============================================================================
// Prueba de los textos de `tssh` (npm run test:textos-tssh): español e inglés con las mismas claves
// y la misma forma, el selector por `TESSERA_IDIOMA`, el español byte a byte como era y, de punta a
// punta, la ayuda y los errores de `tssh` y del cliente del contenedor en los dos idiomas.
// Corre bajo `node` llano: sin Docker ni servidores SSH.
// =============================================================================

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const aqui = path.dirname(fileURLToPath(import.meta.url))
const { textosTssh, es, en } = require('./textosTssh.cjs') as {
  textosTssh: () => Record<string, unknown>
  es: Record<string, unknown>
  en: Record<string, unknown>
}
const { CODIGOS } = require('./tsshSalida.cjs') as { CODIGOS: Record<string, number> }

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

/** Corre un guion con `node` y el idioma dado (`null` = sin la variable), sin puente ni buzón. */
function correr(guion: string, args: string[], idioma: string | null): { salida: string; errores: string; codigo: number | null } {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const k of ['TESSERA_IDIOMA', 'TESSERA_DB_SESSION', 'TESSERA_DB_PIPE', 'TESSERA_TSSH_BUZON']) delete env[k]
  if (idioma !== null) env.TESSERA_IDIOMA = idioma
  const r = spawnSync(process.execPath, [path.join(aqui, guion), ...args], { env, encoding: 'utf8', timeout: 30_000 })
  return { salida: r.stdout ?? '', errores: r.stderr ?? '', codigo: r.status }
}

function main(): void {
  hr('A. Español e inglés tienen la misma forma')
  const dif = diferencias(es, en, 'textos')
  check('mismas claves, tipos, aridad y largo de listas', dif.length === 0, dif.length === 0 ? `${Object.keys(es).length} claves` : dif.join('; '))
  const largas = Object.values(en.etiquetas as Record<string, string>).filter((e) => e.length > 15)
  check('las etiquetas de doctor caben en su columna (15)', largas.length === 0, largas.join(', ') || 'todas')

  hr('B. El selector lee TESSERA_IDIOMA')
  const antes = process.env.TESSERA_IDIOMA
  const casos: [string | undefined, unknown][] = [
    [undefined, es],
    ['en', en],
    ['es', es],
    ['de', es]
  ]
  for (const [valor, esperado] of casos) {
    if (valor === undefined) delete process.env.TESSERA_IDIOMA
    else process.env.TESSERA_IDIOMA = valor
    check(`TESSERA_IDIOMA=${valor ?? '(sin definir)'}`, textosTssh() === esperado, esperado === en ? 'inglés' : 'español')
  }
  if (antes === undefined) delete process.env.TESSERA_IDIOMA
  else process.env.TESSERA_IDIOMA = antes

  hr('C. El español es el de antes, byte a byte')
  const exactos: [string, string, string][] = [
    ['conPistaDeAyuda', (es.conPistaDeAyuda as F)('Falta la orden.'), 'Falta la orden. La ayuda: tssh help.'],
    ['timeoutInvalido', (es.timeoutInvalido as F)(86400), '--timeout necesita un número de segundos mayor que 0 y de 86400 como mucho.'],
    ['excluidas 1', (es.excluidas as F)(1), '(1 conexión más de este perfil no está disponible para los agentes)'],
    ['excluidas 3', (es.excluidas as F)(3), '(3 conexiones más de este perfil no están disponibles para los agentes)'],
    ['excluidas 0', (es.excluidas as F)(0), ''],
    ['columnasLs', (es.columnasLs as string[]).join(','), 'ALIAS,GRUPO,DESTINO,MÉTODO,ESTADO'],
    [
      'rutaMsysDesconocida',
      (es.rutaMsysDesconocida as F)('/tmp'),
      'No sé a qué carpeta de Windows corresponde «/tmp»: usa una ruta de Windows (C:\\...) o una relativa a la carpeta actual.'
    ],
    ['conexionesDisponibles', (es.conexionesDisponibles as F)(2, 1), '2 disponibles para los agentes, 1 más que no lo están'],
    ['todoBienRun', (es.todoBienRun as F)('"nas casa"'), 'Todo en orden. Prueba:  tssh run "nas casa" -- uptime']
  ]
  for (const [nombre, real, esperado] of exactos) check(nombre, real === esperado, JSON.stringify(real))
  const ayuda = (es.ayuda as F)(CODIGOS)
  check(
    'ayuda: cabecera, códigos y cierre de siempre',
    ayuda.startsWith('\n  tssh — las conexiones SSH del perfil de Tessera, para ti y para los agentes\n') &&
      ayuda.includes('    2    uso incorrecto (argumentos, subcomando) o desde WSL\n') &&
      ayuda.includes('    124  se agotó --timeout\n') &&
      ayuda.includes('una letra de unidad (C:\\…) es siempre local') &&
      ayuda.endsWith('  %variables% de tu línea se expanden antes de llegar a tssh.\n'),
    `${ayuda.length} caracteres`
  )

  hr('D. De punta a punta: tssh y el cliente del contenedor')
  const ayudaEs = correr('tssh.cjs', ['help'], null)
  const ayudaEn = correr('tssh.cjs', ['help'], 'en')
  check('tssh help sin la variable, en español', ayudaEs.codigo === 0 && ayudaEs.salida === ayuda, ayudaEs.salida.split('\n')[1] ?? '')
  check('tssh help con en, en inglés', ayudaEn.codigo === 0 && ayudaEn.salida.includes('tssh — the SSH connections of the Tessera profile'), ayudaEn.salida.split('\n')[1] ?? '')
  const usoEs = correr('tssh.cjs', ['run'], null)
  const usoEn = correr('tssh.cjs', ['run'], 'en')
  check(
    'error de uso en español, con su código',
    usoEs.codigo === CODIGOS.uso && usoEs.errores === 'tssh: Falta el alias de la conexión: tssh run <alias> -- <orden>. La ayuda: tssh help.\n',
    usoEs.errores.trim()
  )
  check(
    'error de uso en inglés, con el mismo código',
    usoEn.codigo === CODIGOS.uso && usoEn.errores === 'tssh: Missing the connection alias: tssh run <alias> -- <command>. Help: tssh help.\n',
    usoEn.errores.trim()
  )
  const sinPuenteEn = correr('tssh.cjs', ['ls'], 'en')
  check('sin puente, en inglés y con el código del puente', sinPuenteEn.codigo === CODIGOS.puente && sinPuenteEn.errores.startsWith('tssh: This terminal was not opened by Tessera'), sinPuenteEn.errores.trim())
  const contEs = correr('tssh-container.cjs', ['ls'], null)
  const contEn = correr('tssh-container.cjs', ['ls'], 'en')
  check('cliente del contenedor, en español', contEs.codigo === CODIGOS.puente && contEs.errores.startsWith('tssh: Esta terminal no lleva el contexto de Tessera'), contEs.errores.trim())
  check('cliente del contenedor, en inglés', contEn.codigo === CODIGOS.puente && contEn.errores.startsWith('tssh: This terminal does not carry the Tessera context'), contEn.errores.trim())

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
