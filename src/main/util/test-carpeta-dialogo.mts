#!/usr/bin/env node
// =============================================================================
// Prueba de la memoria de carpetas de los diálogos (`util/carpetaDialogo.ts`) y de que todos los
// diálogos nativos pasen por `util/adaptadores/dialogosNativos.ts` (npm run test:carpeta-dialogo).
// Cubre `carpetaInicial` (orden de candidatas, nulas e inexistentes, el home, consultas en
// paralelo), `carpetaARecordar` en las dos plataformas, `esCarpetaEnDisco` (un permiso no
// descarta, un `stat` colgado se corta), `MemoriaCarpetas` contra un temporal (respaldos, `.bak`,
// sin poder escribir) y que nadie en `src/main` llama a `show(Open|Save)Dialog` fuera del envoltorio.
// =============================================================================

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  carpetaARecordar,
  carpetaInicial,
  esCarpetaEnDisco,
  MemoriaCarpetas,
  permisoSinAcceso
} from './carpetaDialogo.ts'

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
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  hr('1. carpetaInicial')
  const existen = new Set(['/a', '/b'])
  const inmediata = async (r: string): Promise<boolean> => existen.has(r)
  const r1a = await carpetaInicial(['/a', '/b'], '/home', inmediata)
  check('(1a) gana la primera que vale', r1a === '/a', r1a)
  const r1b = await carpetaInicial([null, '', undefined, '/nada', '/b'], '/home', inmediata)
  check('(1b) se saltan null, vacías e inexistentes', r1b === '/b', r1b)
  const r1c = await carpetaInicial(['/nada', null], '/home', inmediata)
  check('(1c) sin ninguna válida, el home', r1c === '/home', r1c)
  const preferidaLenta = async (r: string): Promise<boolean> => {
    await esperar(r === '/a' ? 60 : 0)
    return existen.has(r)
  }
  const r1d = await carpetaInicial(['/a', '/b'], '/home', preferidaLenta)
  check('(1d) manda el ORDEN, no la velocidad: la preferida gana aunque tarde más', r1d === '/a', r1d)
  const t0 = Date.now()
  await carpetaInicial(['/w', '/x', '/y', '/a'], '/home', async (r) => {
    await esperar(150)
    return r === '/a'
  })
  const ms1e = Date.now() - t0
  check('(1e) en paralelo: cuatro consultas de 150 ms no suman 600', ms1e < 450, `${ms1e} ms`)

  hr('2. carpetaARecordar, en las dos plataformas')
  const casos: Array<[string, path.PlatformPath, string, string]> = [
    ['win32 carpeta -> la que la contiene', path.win32, 'C:\\Proyectos\\tessera', 'C:\\Proyectos'],
    [
      'win32 archivo -> su carpeta',
      path.win32,
      'C:\\Program Files\\Java\\bin\\java.exe',
      'C:\\Program Files\\Java\\bin'
    ],
    ['win32 raíz de unidad -> ella misma', path.win32, 'D:\\', 'D:\\'],
    ['posix carpeta -> la que la contiene', path.posix, '/Users/ana/Proyectos/tessera', '/Users/ana/Proyectos'],
    ['posix archivo -> su carpeta', path.posix, '/usr/bin/java', '/usr/bin'],
    ['posix raíz -> ella misma', path.posix, '/', '/']
  ]
  for (const [nombre, rutas, elegido, esperado] of casos) {
    const r = carpetaARecordar(elegido, rutas)
    check(`(2) ${nombre}`, r === esperado, `${elegido} -> ${r}`)
  }

  hr('3. esCarpetaEnDisco')
  const b3 = mkdtempSync(path.join(tmpdir(), 'tessera-escarpeta-'))
  try {
    const suelto = path.join(b3, 'archivo.txt')
    writeFileSync(suelto, 'x')
    check('(3a) una carpeta real vale', await esCarpetaEnDisco(b3), b3)
    check('(3b) un archivo no', !(await esCarpetaEnDisco(suelto)), suelto)
    check('(3c) lo que no existe no', !(await esCarpetaEnDisco(path.join(b3, 'no-existe'))), 'no-existe')
    const codigos: Array<[string | undefined, boolean]> = [
      ['EPERM', true],
      ['EACCES', true],
      ['ENOENT', false],
      ['ENOTDIR', false],
      ['EIO', false],
      [undefined, false]
    ]
    check(
      '(3d) sólo los errores de PERMISO dejan la carpeta como candidata',
      codigos.every(([c, esperado]) => permisoSinAcceso(c) === esperado),
      codigos.map(([c]) => `${c}:${permisoSinAcceso(c)}`).join(' ')
    )
    const fallaCon = (code: string) => async (): Promise<never> => {
      throw Object.assign(new Error(code), { code })
    }
    check(
      '(3e) un EPERM (TCC de macOS) NO descarta: el panel de abrir sí puede enseñarla',
      await esCarpetaEnDisco('/Users/x/Documents', { stat: fallaCon('EPERM') }),
      'EPERM -> true'
    )
    check('(3f) un error de E/S sí descarta', !(await esCarpetaEnDisco('/x', { stat: fallaCon('EIO') })), 'EIO -> false')
    const t3 = Date.now()
    const colgada = await esCarpetaEnDisco('\\\\servidor\\caido', {
      stat: () => new Promise(() => {}),
      esperaMs: 80
    })
    const ms3g = Date.now() - t3
    check(
      '(3g) un stat colgado (unidad de red caída) se corta en el tope y no vale',
      colgada === false && ms3g < 1000,
      `${colgada} en ${ms3g} ms`
    )
  } finally {
    rmSync(b3, { recursive: true, force: true })
  }

  hr('4. MemoriaCarpetas contra un temporal')
  const base = mkdtempSync(path.join(tmpdir(), 'tessera-carpetas-'))
  try {
    const proyectos = path.join(base, 'Proyectos')
    const tessera = path.join(proyectos, 'tessera')
    const jdk = path.join(base, 'jdk', 'bin')
    const drivers = path.join(base, 'drivers')
    const home = path.join(base, 'home')
    mkdirSync(tessera, { recursive: true })
    mkdirSync(jdk, { recursive: true })
    mkdirSync(drivers)
    mkdirSync(home)
    const javaExe = path.join(jdk, 'java.exe')
    const archivo = path.join(base, 'userData', 'carpetas-dialogos.json')

    const m = new MemoriaCarpetas(archivo, undefined, home)
    const r4a = await m.inicial('abrir-proyecto', { despues: [proyectos] })
    check('(4a) sin archivo, el respaldo', r4a === proyectos, r4a)
    const r4b = await m.inicial('abrir-proyecto')
    check('(4b) sin archivo ni respaldo, el home', r4b === home, r4b)

    await m.recordar('abrir-proyecto', tessera)
    const r4c = await m.inicial('abrir-proyecto', { despues: [home] })
    check('(4c) lo recordado gana a lo de DESPUÉS, y es la carpeta PADRE', r4c === proyectos, r4c)
    const r4d = await m.inicial('abrir-proyecto', { antes: [jdk] })
    check('(4d) lo de ANTES gana a lo recordado (el proyecto activo al guardar)', r4d === jdk, r4d)
    const r4e = await m.inicial('java')
    check('(4e) cada diálogo recuerda lo suyo (java no hereda)', r4e === home, r4e)

    await m.recordar('java', javaExe)
    const otra = new MemoriaCarpetas(archivo, undefined, home)
    const r4f = [await otra.inicial('java'), await otra.inicial('abrir-proyecto')]
    check('(4f) persiste entre instancias', r4f[0] === jdk && r4f[1] === proyectos, r4f.join(' | '))
    const doc = JSON.parse(readFileSync(archivo, 'utf8')) as { version?: number; carpetas?: object }
    check(
      '(4g) el archivo es JSON versionado con una clave por diálogo',
      doc.version === 1 && Object.keys(doc.carpetas ?? {}).sort().join(',') === 'abrir-proyecto,java',
      JSON.stringify(doc)
    )

    // Una escritura más deja en el `.bak` el estado anterior (abrir-proyecto + java), y
    // luego se rompe el principal a mano: la lectura tiene que recuperar del `.bak`.
    await m.recordar('carpeta-driver', path.join(drivers, 'instantclient'))
    writeFileSync(archivo, '{ esto no es json')
    const m4h = new MemoriaCarpetas(archivo, undefined, home)
    const r4h = [await m4h.inicial('java'), await m4h.inicial('carpeta-driver')]
    check(
      '(4h) principal roto: se recupera del .bak (que no conoce lo último)',
      r4h[0] === jdk && r4h[1] === home,
      r4h.join(' | ')
    )

    rmSync(proyectos, { recursive: true, force: true })
    const r4i = await new MemoriaCarpetas(archivo, undefined, home).inicial('abrir-proyecto', {
      despues: [jdk]
    })
    check('(4i) lo recordado ya no existe -> el respaldo', r4i === jdk, r4i)

    writeFileSync(`${archivo}.bak`, 'tampoco')
    let lanzo = false
    let r4j = ''
    try {
      r4j = await new MemoriaCarpetas(archivo, undefined, home).inicial('java', { despues: [home] })
    } catch {
      lanzo = true
    }
    check('(4j) principal y .bak rotos: no lanza y usa el respaldo', !lanzo && r4j === home, lanzo ? 'lanzó' : r4j)

    writeFileSync(archivo, JSON.stringify({ version: 1, carpetas: { java: 42, 'abrir-proyecto': jdk } }))
    const m4k = new MemoriaCarpetas(archivo, undefined, home)
    const r4k = [await m4k.inicial('java'), await m4k.inicial('abrir-proyecto')]
    check('(4k) un valor que no es cadena se ignora; los buenos se leen', r4k[0] === home && r4k[1] === jdk, r4k.join(' | '))

    // Un "directorio" de userData que en realidad es un ARCHIVO: la escritura falla.
    const bloqueo = path.join(base, 'soy-un-archivo')
    writeFileSync(bloqueo, 'x')
    const m4l = new MemoriaCarpetas(path.join(bloqueo, 'carpetas-dialogos.json'), undefined, home)
    let lanzoL = false
    try {
      await m4l.recordar('java', javaExe)
    } catch {
      lanzoL = true
    }
    const r4l = await m4l.inicial('java')
    check('(4l) sin poder escribir: no lanza y la sesión lo recuerda', !lanzoL && r4l === jdk, lanzoL ? 'lanzó' : r4l)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }

  hr('5. Ningún diálogo nativo fuera del envoltorio')
  const raizMain = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const patron = /\bshow(Open|Save)Dialog(Sync)?\s*\(/
  const conDialogo: string[] = []
  const recorrer = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = path.join(dir, e.name)
      if (e.isDirectory()) recorrer(ruta)
      else if (/\.tsx?$/.test(e.name) && patron.test(readFileSync(ruta, 'utf8'))) {
        conDialogo.push(path.relative(raizMain, ruta).split(path.sep).join('/'))
      }
    }
  }
  recorrer(raizMain)
  check(
    '(5a) control positivo: el envoltorio sí los abre (la búsqueda funciona)',
    conDialogo.includes('util/adaptadores/dialogosNativos.ts'),
    conDialogo.join(', ') || 'ninguno'
  )
  const fuera = conDialogo.filter((r) => r !== 'util/adaptadores/dialogosNativos.ts')
  check(
    '(5b) nadie más abre un diálogo nativo: todos pasan por util/adaptadores/dialogosNativos.ts',
    fuera.length === 0,
    fuera.length > 0 ? fuera.join(', ') : 'ninguno fuera'
  )

  hr('RESUMEN')
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

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
