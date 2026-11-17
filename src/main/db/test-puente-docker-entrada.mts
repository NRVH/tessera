#!/usr/bin/env node
// =============================================================================
// Prueba de la entrada de `tdb` por el puente de Docker (`--stdin` y `--file`): el cliente del contenedor
// se lanza con `node` sobre una carpeta temporal, el puente es el real (`PuenteDocker`) y ejecuta el `tdb`
// real por `ejecutarTdb`. Fija que `--stdin` ya no se cuelga, que `--file` viaja como `entrada` y nunca como
// ruta del host, y que una petición cruda con `--file` se rechaza. Corre sin Docker.
// (node src/main/db/test-puente-docker-entrada.mts)
// Decisiones: docs/decisiones/bd/puente-buzon-de-docker.md
// =============================================================================

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir, userInfo } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'
import { PuenteDocker, ejecutarTdb, entornoTdbParaContenedor, motivoRechazoArgv } from './puenteDocker.ts'

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

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------
const aqui = path.dirname(fileURLToPath(import.meta.url))
const TDB = path.join(aqui, '..', '..', 'tdb', 'tdb.cjs')
const CLIENTE = path.join(aqui, '..', '..', 'tdb', 'tdb-container.cjs')
/** Tope de cada comando. Un cuelgue de antes se vería como llegar aquí. */
const TOPE_MS = 15_000
/** Lo que se da por «en el acto». Holgado para una máquina cargada; el cuelgue eran 90 s. */
const RAPIDO_MS = 10_000

const raiz = mkdtempSync(path.join(tmpdir(), 'tessera-dbentrada-'))
const registro = path.join(raiz, 'db-connections.json')
writeFileSync(registro, JSON.stringify({ version: 1, connections: [] }))

/** El entorno del `tdb` del host, sin nada de la terminal de Tessera en la que corra esto. */
function entornoTdb(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('TESSERA_')) env[k] = v
  return { ...env, TESSERA_PROFILE: 'p1', TESSERA_DB_REGISTRY: registro, TESSERA_DB_MODE: 'env' }
}

interface Recibida {
  token: string
  argv: string[]
  entrada: string | undefined
}
const recibidas: Recibida[] = []

/** El entorno con que el host lanza el `tdb` de cada petición; la sección (9) pone el de un contenedor. */
let entornoDelHost: (token: string) => NodeJS.ProcessEnv = () => entornoTdb()

const puente = new PuenteDocker({
  raiz: path.join(raiz, 'buzon'),
  clienteOrigen: CLIENTE,
  ejecutar: (token, argv, entrada) => {
    recibidas.push({ token, argv, entrada })
    return ejecutarTdb({ ejecutable: process.execPath, argv: [TDB, ...argv], env: entornoDelHost(token), entrada, plazoMs: TOPE_MS, maxBuffer: 1 << 20 })
  },
  log: () => {}
})
const buzon = puente.prepararPerfil('p1')
const carpetaAgente = path.join(raiz, 'agente')
mkdirSync(path.join(carpetaAgente, 'sql'), { recursive: true })
writeFileSync(path.join(carpetaAgente, 'sql', 'consulta.sql'), "SELECT 'desde el archivo' AS x")
writeFileSync(path.join(carpetaAgente, 'vacio.sql'), '  \n ')

interface Salida {
  ms: number
  codigo: number | null
  salida: string
  err: string
}
/** El `tdb` del contenedor: el cliente del buzón, con la carpeta del agente de cwd. */
function cliente(args: string[], entrada: string | null): Promise<Salida> {
  return new Promise((resolver) => {
    const t0 = Date.now()
    const p = spawn(process.execPath, [path.join(buzon, 'tdb-cliente.cjs'), ...args], {
      cwd: carpetaAgente,
      env: { ...entornoTdb(), TESSERA_DB_BRIDGE: buzon, TESSERA_DB_SESSION: 'tok' }
    })
    let salida = ''
    let err = ''
    p.stdout.on('data', (d) => (salida += d))
    p.stderr.on('data', (d) => (err += d))
    const vigia = setTimeout(() => p.kill(), TOPE_MS + 5000)
    p.stdin.end(entrada ?? '')
    p.on('close', (codigo) => {
      clearTimeout(vigia)
      resolver({ ms: Date.now() - t0, codigo, salida, err })
    })
  })
}

/** Deja una petición CRUDA en el buzón y espera su respuesta. */
async function peticionCruda(cuerpo: unknown): Promise<{ exitCode?: number; stderr?: string } | null> {
  const id = `cruda-${Math.random().toString(36).slice(2)}`
  writeFileSync(path.join(buzon, `${id}.req.json`), JSON.stringify(cuerpo))
  const destino = path.join(buzon, `${id}.res.json`)
  const t0 = Date.now()
  while (Date.now() - t0 < TOPE_MS) {
    if (existsSync(destino)) {
      try {
        return JSON.parse(readFileSync(destino, 'utf-8'))
      } catch {
        // a medio escribir: siguiente vuelta
      }
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  return null
}

const ultima = (): Recibida | undefined => recibidas[recibidas.length - 1]
const una = (s: string): string => s.replace(/\s+/g, ' ').trim()

async function main(): Promise<void> {
  // --- (1) --------------------------------------------------------------------
  hr('(1) --stdin con SQL: viaja en la petición y el tdb del host lo lee')
  {
    const antes = recibidas.length
    const r = await cliente(['query', 'nobase', '--stdin'], "SELECT 'hola' AS x\n")
    const rec = ultima()
    check('termina en el acto (sin colgarse hasta el tope)', r.ms < RAPIDO_MS, `${r.ms} ms`)
    check('el host recibió UNA petición', recibidas.length === antes + 1, `${recibidas.length - antes}`)
    check('la argv conserva --stdin', JSON.stringify(rec?.argv) === JSON.stringify(['query', 'nobase', '--stdin']), JSON.stringify(rec?.argv))
    check('el SQL llega como entrada', rec?.entrada === "SELECT 'hola' AS x\n", JSON.stringify(rec?.entrada))
    check(
      'el tdb del host LEYÓ la entrada (falla por la base, no por «no llegó nada»)',
      r.codigo === 1 && !r.err.includes('No llegó nada') && r.err.includes('nobase'),
      una(r.err)
    )
  }

  // --- (2) --------------------------------------------------------------------
  hr('(2) --stdin vacío: el tdb del host lo dice en el acto')
  {
    const r = await cliente(['query', 'nobase', '--stdin'], '')
    check('termina en el acto', r.ms < RAPIDO_MS, `${r.ms} ms`)
    check('«no llegó nada por la entrada estándar»', r.codigo === 1 && r.err.includes('No llegó nada por la entrada estándar'), una(r.err))
    check('la entrada viajó vacía (no ausente)', ultima()?.entrada === '', JSON.stringify(ultima()?.entrada))
  }

  // --- (3) --------------------------------------------------------------------
  hr('(3) --file relativo a la carpeta del agente: viaja el SQL, no la ruta')
  {
    const r = await cliente(['query', 'nobase', '--file', 'sql/consulta.sql', '--json'], null)
    const rec = ultima()
    check('termina en el acto', r.ms < RAPIDO_MS, `${r.ms} ms`)
    check('el SQL es el del archivo del AGENTE', rec?.entrada === "SELECT 'desde el archivo' AS x", JSON.stringify(rec?.entrada))
    check(
      'la argv lleva --stdin y ni --file ni la ruta',
      JSON.stringify(rec?.argv) === JSON.stringify(['query', 'nobase', '--json', '--stdin']),
      JSON.stringify(rec?.argv)
    )
    check('el tdb del host lo leyó (falla por la base)', r.codigo === 1 && r.salida.includes('nobase') && !r.salida.includes('No existe el archivo'), una(r.salida + r.err))
  }

  // --- (4) --------------------------------------------------------------------
  hr('(4) --file que no existe, sin ruta o vacío: falla el cliente, sin petición')
  {
    const casos: Array<[string[], string]> = [
      [['query', 'nobase', '--file', 'no-existe.sql'], 'No existe el archivo "no-existe.sql".'],
      [['query', 'nobase', '--file'], 'Falta la ruta después de --file.'],
      [['query', 'nobase', '--file', 'vacio.sql'], 'El archivo "vacio.sql" está vacío.']
    ]
    for (const [args, texto] of casos) {
      const antes = recibidas.length
      const r = await cliente(args, null)
      check(`${args.slice(2).join(' ')}: «${texto}»`, r.codigo === 2 && r.err.includes(texto), una(r.err))
      check(`${args.slice(2).join(' ')}: no llega nada al host`, recibidas.length === antes, `${recibidas.length - antes}`)
    }
  }

  // --- (5) --------------------------------------------------------------------
  hr('(5) --stdin y --file juntos: manda --stdin')
  {
    await cliente(['query', 'nobase', '--file', 'sql/consulta.sql', '--stdin'], 'SELECT 2')
    const rec = ultima()
    check('la entrada es la del stdin', rec?.entrada === 'SELECT 2', JSON.stringify(rec?.entrada))
    check('sin --file ni su ruta', JSON.stringify(rec?.argv) === JSON.stringify(['query', 'nobase', '--stdin']), JSON.stringify(rec?.argv))
  }

  // --- (6) --------------------------------------------------------------------
  hr('(6) Sin --stdin ni --file: la argv tal cual y sin entrada')
  {
    const r = await cliente(['ls', '--json'], 'esto no se lee')
    const rec = ultima()
    check('sin entrada', rec !== undefined && rec.entrada === undefined, JSON.stringify(rec))
    check('la argv tal cual', JSON.stringify(rec?.argv) === JSON.stringify(['ls', '--json']), JSON.stringify(rec?.argv))
    check('y responde', r.codigo === 0 && r.salida.includes('"ok":true'), una(r.salida))
  }

  // --- (7) --------------------------------------------------------------------
  hr('(7) Peticiones CRUDAS: --file se rechaza sin ejecutar; entrada no textual, ilegible')
  {
    const antes = recibidas.length
    const r = await peticionCruda({ v: 1, token: 'tok', argv: ['query', 'nobase', '--file', 'C:\\Windows\\win.ini'] })
    check('--file por el buzón: código 2 y el porqué', r !== null && r.exitCode === 2 && String(r.stderr).includes('--file no llega por el puente'), JSON.stringify(r))
    check('--file por el buzón: no se ejecutó nada', recibidas.length === antes, `${recibidas.length - antes}`)
    const r2 = await peticionCruda({ v: 1, token: 'tok', argv: ['query', 'nobase', '--stdin'], entrada: 42 })
    check('entrada que no es texto: «petición ilegible», sin ejecutar', r2 !== null && r2.exitCode === 2 && String(r2.stderr).includes('petición ilegible') && recibidas.length === antes, JSON.stringify(r2))
  }

  // --- (8) --------------------------------------------------------------------
  hr('(8) motivoRechazoArgv y ejecutarTdb a pelo')
  {
    check('motivoRechazoArgv: --file -> motivo', motivoRechazoArgv(['query', 'b', '--file', 'x.sql']) !== null, '')
    check('motivoRechazoArgv: --stdin -> null', motivoRechazoArgv(['query', 'b', '--stdin']) === null, '')
    check('motivoRechazoArgv: sin banderas -> null', motivoRechazoArgv(['ls']) === null, '')

    const t0 = Date.now()
    const r = await ejecutarTdb({ ejecutable: process.execPath, argv: [TDB, 'query', 'nobase', '--stdin'], env: entornoTdb(), plazoMs: TOPE_MS, maxBuffer: 1 << 20 })
    const ms = Date.now() - t0
    check('sin entrada: la entrada se cierra y tdb contesta en el acto', ms < RAPIDO_MS && r.stderr.includes('No llegó nada'), `${ms} ms · ${una(r.stderr)}`)

    const r2 = await ejecutarTdb({ ejecutable: process.execPath, argv: ['-e', 'setTimeout(() => {}, 20000)'], env: entornoTdb(), plazoMs: 1000, maxBuffer: 1 << 20 })
    check('el tope de tiempo se dice en stderr', r2.exitCode !== 0 && r2.stderr.includes('no terminó en 1 s y se interrumpió'), una(r2.stderr))

    const r3 = await ejecutarTdb({ ejecutable: process.execPath, argv: ['-e', 'process.exit(0)'], env: entornoTdb(), entrada: 'x'.repeat(4 << 20), plazoMs: TOPE_MS, maxBuffer: 1 << 20 })
    check('un proceso que no lee su entrada no tumba a quien escribe (EPIPE)', r3.exitCode === 0, JSON.stringify(r3))

    const exeQueFalta = path.join(tmpdir(),'tessera-no-existe', 'usuario-ejemplo', 'Tessera.exe')
    const r4 = await ejecutarTdb({ ejecutable: exeQueFalta, argv: [TDB, 'ls'], env: entornoTdb(), plazoMs: TOPE_MS, maxBuffer: 1 << 20 })
    check('un tdb que no arranca: falla sin la ruta del ejecutable en lo que llega al contenedor', r4.exitCode !== 0 && !(r4.stdout + r4.stderr).includes('usuario-ejemplo'), JSON.stringify(r4))
  }

  // --- (9) --------------------------------------------------------------------
  hr('(9) Para un contenedor, tdb no enseña rutas del equipo; en nativo, todo igual')
  await rutasDelEquipo()
}

/** La ruta comparable: un solo separador y sin caja (en `--json` las barras de Windows llegan dobladas). */
const plano = (s: string): string => s.replace(/[\\/]+/g, '/').toLowerCase()
const sinRuta = (texto: string, ruta: string): boolean => !plano(texto).includes(plano(ruta))

async function rutasDelEquipo(): Promise<void> {
  const MARCA_JSON = '(ruta del equipo: no se muestra dentro del contenedor)'
  const casa = path.join(raiz, 'Users', 'usuario-ejemplo')
  const datos = path.join(casa, 'AppData', 'Tessera')
  const drivers = path.join(datos, 'drivers')
  const registroCasa = path.join(datos, 'db-connections.json')
  mkdirSync(path.join(drivers, 'oracle'), { recursive: true })
  writeFileSync(registroCasa, JSON.stringify({ version: 1, connections: [] }))
  const zip = zipSync({ 'centinela.txt': new TextEncoder().encode('x') })
  const url = `data:application/zip;base64,${Buffer.from(zip).toString('base64')}`
  const paqueteDriver = (id: string): Record<string, unknown> => ({ id, motor: 'oracle', nombre: `Pack ${id}`, sizeMB: 1, cubre: '-', url, centinela: 'centinela.txt' })
  writeFileSync(path.join(drivers, 'catalogo.json'), JSON.stringify({ packs: ['bien-a', 'bien-b', 'mal-a', 'mal-b'].map(paqueteDriver), externos: {} }))
  // Un archivo donde iría la carpeta del pack: la instalación falla con un error del sistema que lleva la ruta.
  writeFileSync(path.join(drivers, 'oracle', 'mal-a'), 'no es una carpeta')
  writeFileSync(path.join(drivers, 'oracle', 'mal-b'), 'no es una carpeta')
  const atajo = path.join(datos, 'bin', 's1', 'tdb.ps1')
  const exeTessera = path.join(casa, 'Programs', 'Tessera', 'Tessera.exe')
  const tdbTessera = path.join(casa, 'Programs', 'Tessera', 'tdb.cjs')
  // El entorno del main: su carpeta personal es la inventada y lleva lo que una terminal nativa le dejaría.
  const delMain: NodeJS.ProcessEnv = { ...entornoTdb(), HOME: casa, USERPROFILE: casa, TESSERA_SHIM: atajo, TESSERA_EXE: exeTessera, TESSERA_TDB: tdbTessera, TESSERA_IDIOMA: 'es' }
  const fijas = (token: string): Parameters<typeof entornoTdbParaContenedor>[1] => ({ perfil: 'p1', registro: registroCasa, drivers, pipe: 'sin-puente', token })
  const rutas = [casa, registroCasa, drivers, atajo, exeTessera, tdbTessera, process.execPath, TDB]
  const usuario = userInfo().username
  const conUsuario = (t: string): boolean => usuario.length > 0 && plano(t).includes(`/${usuario.toLowerCase()}/`)
  const limpio = (t: string): boolean => rutas.every((r) => sinRuta(t, r)) && !t.includes('usuario-ejemplo') && !conUsuario(t)

  {
    const env = entornoTdbParaContenedor({ ...delMain, tessera_tdb_buzon: '0', TESSERA_TDB_BUZON: '0' }, fijas('tok'))
    const grafias = Object.keys(env).filter((k) => k.toUpperCase() === 'TESSERA_TDB_BUZON')
    check('el host pone la marca encima de lo que trajera su entorno, y una sola vez', env.TESSERA_TDB_BUZON === '1' && grafias.length === 1, JSON.stringify(grafias))
    check('sin el atajo de una terminal nativa', !Object.keys(env).some((k) => k.toUpperCase() === 'TESSERA_SHIM'), '')
    check(
      'con lo que fija el host: perfil, registro, drivers, modo pipe, pipe y token',
      env.TESSERA_PROFILE === 'p1' && env.TESSERA_DB_REGISTRY === registroCasa && env.TESSERA_DB_DRIVERS === drivers && env.TESSERA_DB_MODE === 'pipe' && env.TESSERA_DB_PIPE === 'sin-puente' && env.TESSERA_DB_SESSION === 'tok' && env.ELECTRON_RUN_AS_NODE === '1',
      ''
    )
  }

  entornoDelHost = (token) => entornoTdbParaContenedor(delMain, fijas(token))
  const nativo = (args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> =>
    ejecutarTdb({ ejecutable: process.execPath, argv: [TDB, ...args], env: { ...delMain, TESSERA_DB_REGISTRY: registroCasa, TESSERA_DB_DRIVERS: drivers }, plazoMs: TOPE_MS, maxBuffer: 1 << 20 })
  try {
    const texto = await cliente(['doctor'], null)
    check('doctor por el buzón: ninguna ruta del equipo ni el nombre de su usuario', limpio(texto.salida + texto.err), una(texto.salida).slice(0, 400))
    check(
      'doctor por el buzón: la marca en su lugar y el resto del diagnóstico',
      (texto.salida.match(/\(ruta del equipo: no se muestra dentro del contenedor\)/g) ?? []).length >= 5 && texto.salida.includes('visibles de') && texto.salida.includes('puente'),
      una(texto.salida).slice(0, 400)
    )
    const json = await cliente(['doctor', '--json'], null)
    let j: Record<string, unknown> = {}
    try {
      j = JSON.parse(json.salida.trim()) as Record<string, unknown>
    } catch {
      // Se ve en el check.
    }
    check('doctor --json por el buzón: ninguna ruta del equipo ni el nombre de su usuario', json.salida !== '' && limpio(json.salida + json.err), una(json.salida).slice(0, 400))
    check(
      'doctor --json por el buzón: las mismas claves, con la marca, y los booleanos de siempre',
      ['registro', 'ejecutable', 'guion', 'driversDir', 'tesseraExe', 'tesseraTdb'].every((k) => j[k] === MARCA_JSON) && j.registroExiste === true && j.ok === true,
      JSON.stringify(j).slice(0, 400)
    )

    const nj = JSON.parse((await nativo(['doctor', '--json'])).stdout.trim()) as Record<string, unknown>
    check(
      'doctor --json nativo: las rutas de siempre',
      nj.registro === registroCasa && nj.ejecutable === process.execPath && nj.guion === TDB && nj.driversDir === drivers && nj.tesseraExe === exeTessera && nj.tesseraTdb === tdbTessera && nj.atajo === atajo,
      JSON.stringify(nj).slice(0, 400)
    )
    const nt = (await nativo(['doctor'])).stdout
    check('doctor nativo: el texto de siempre, con sus rutas y sin la marca', nt.includes(registroCasa) && nt.includes(drivers) && nt.includes(process.execPath) && nt.includes(atajo) && !nt.includes('no se muestra dentro del contenedor'), una(nt).slice(0, 400))

    const inst = await cliente(['driver', 'install', 'bien-a'], null)
    check(
      'driver install por el buzón: se instala y no dice dónde',
      inst.codigo === 0 && existsSync(path.join(drivers, 'oracle', 'bien-a', 'centinela.txt')) && limpio(inst.salida + inst.err) && inst.salida.includes('instalado en (ruta del equipo'),
      una(inst.salida + inst.err)
    )
    const instN = await nativo(['driver', 'install', 'bien-b'])
    check('driver install nativo: dice dónde, como siempre', instN.exitCode === 0 && instN.stdout.includes(path.join(drivers, 'oracle', 'bien-b')), una(instN.stdout + instN.stderr))

    const mal = await cliente(['driver', 'install', 'mal-a'], null)
    check('un error con ruta, por el buzón: sin la carpeta del usuario, con su marca', mal.codigo === 1 && limpio(mal.err) && mal.err.includes('[carpeta del equipo]'), una(mal.err))
    const malN = await nativo(['driver', 'install', 'mal-b'])
    check('el mismo error en nativo: con su ruta', malN.exitCode === 1 && malN.stderr.includes('usuario-ejemplo') && !malN.stderr.includes('[carpeta del equipo]'), una(malN.stderr))
  } finally {
    entornoDelHost = () => entornoTdb()
  }

  const { sinCarpetasDelEquipo } = createRequire(import.meta.url)(path.join(aqui, '..', '..', 'tdb', 'tdbSalida.cjs')) as {
    sinCarpetasDelEquipo: (texto: string, carpetas: string[], marca: string) => string
  }
  const ventana = (t: string): string => sinCarpetasDelEquipo(t, ['C:\\Users\\ejemplo'], '<M>')
  const posix = (t: string): string => sinCarpetasDelEquipo(t, ['/home/ejemplo/'], '<M>')
  check(
    'sinCarpetasDelEquipo: cualquier separador, caja y forma /c/ de la unidad',
    ventana("mkdir 'C:\\Users\\ejemplo\\AppData\\x'") === "mkdir '<M>\\AppData\\x'" && ventana('c:/users/EJEMPLO/a') === '<M>/a' && ventana('/c/Users/ejemplo/a') === '<M>/a',
    `${ventana('c:/users/EJEMPLO/a')} ${ventana('/c/Users/ejemplo/a')}`
  )
  check(
    'sinCarpetasDelEquipo: solo la carpeta entera, nunca otra que empiece igual ni la raíz',
    ventana('C:\\Users\\ejemplo2\\a') === 'C:\\Users\\ejemplo2\\a' && posix('/home/ejemplos/a /var/home/ejemplo/b') === '/home/ejemplos/a /var/home/ejemplo/b' && posix('/home/ejemplo') === '<M>' && sinCarpetasDelEquipo('/a', ['/', 'C:\\'], '<M>') === '/a',
    `${posix('/home/ejemplos/a /var/home/ejemplo/b')}`
  )
}

try {
  await main()
} finally {
  puente.detener()
  rmSync(raiz, { recursive: true, force: true })
}

hr('RESULTADO (PASS/FAIL)')
const total = results.length
const passed = results.filter((r) => r.pass).length
for (const r of results.filter((x) => !x.pass)) console.log(`  FAIL: ${r.name} -> ${r.evidence}`)
const allPass = passed === total
hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
