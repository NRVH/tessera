#!/usr/bin/env node
// =============================================================================
// Prueba de la entrada de `tdb` por el puente de Docker (`--stdin` y `--file`): el cliente del contenedor
// se lanza con `node` sobre una carpeta temporal, el puente es el real (`DockerBridge`) y ejecuta el `tdb`
// real por `ejecutarTdb`. Fija que `--stdin` ya no se cuelga, que `--file` viaja como `entrada` y nunca como
// ruta del host, y que una petición cruda con `--file` se rechaza. Corre sin Docker.
// (node src/main/db/test-db-docker-entrada.mts)
// Decisiones: docs/decisiones/bd/puente-buzon-de-docker.md
// =============================================================================

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DockerBridge, ejecutarTdb, motivoRechazoArgv } from './dockerBridge.ts'

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

const puente = new DockerBridge({
  raiz: path.join(raiz, 'buzon'),
  clienteOrigen: CLIENTE,
  ejecutar: (token, argv, entrada) => {
    recibidas.push({ token, argv, entrada })
    return ejecutarTdb({ ejecutable: process.execPath, argv: [TDB, ...argv], env: entornoTdb(), entrada, timeoutMs: TOPE_MS, maxBuffer: 1 << 20 })
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
  code: number | null
  out: string
  err: string
}
/** El `tdb` del contenedor: el cliente del buzón, con la carpeta del agente de cwd. */
function cliente(args: string[], entrada: string | null): Promise<Salida> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const p = spawn(process.execPath, [path.join(buzon, 'tdb-cliente.cjs'), ...args], {
      cwd: carpetaAgente,
      env: { ...entornoTdb(), TESSERA_DB_BRIDGE: buzon, TESSERA_DB_SESSION: 'tok' }
    })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    const vigia = setTimeout(() => p.kill(), TOPE_MS + 5000)
    p.stdin.end(entrada ?? '')
    p.on('close', (code) => {
      clearTimeout(vigia)
      resolve({ ms: Date.now() - t0, code, out, err })
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
    check('termina en el acto (antes: colgado hasta el tope)', r.ms < RAPIDO_MS, `${r.ms} ms`)
    check('el host recibió UNA petición', recibidas.length === antes + 1, `${recibidas.length - antes}`)
    check('la argv conserva --stdin', JSON.stringify(rec?.argv) === JSON.stringify(['query', 'nobase', '--stdin']), JSON.stringify(rec?.argv))
    check('el SQL llega como entrada', rec?.entrada === "SELECT 'hola' AS x\n", JSON.stringify(rec?.entrada))
    check(
      'el tdb del host LEYÓ la entrada (falla por la base, no por «no llegó nada»)',
      r.code === 1 && !r.err.includes('No llegó nada') && r.err.includes('nobase'),
      una(r.err)
    )
  }

  // --- (2) --------------------------------------------------------------------
  hr('(2) --stdin vacío: el tdb del host lo dice en el acto')
  {
    const r = await cliente(['query', 'nobase', '--stdin'], '')
    check('termina en el acto', r.ms < RAPIDO_MS, `${r.ms} ms`)
    check('«no llegó nada por la entrada estándar»', r.code === 1 && r.err.includes('No llegó nada por la entrada estándar'), una(r.err))
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
    check('el tdb del host lo leyó (falla por la base)', r.code === 1 && r.out.includes('nobase') && !r.out.includes('No existe el archivo'), una(r.out + r.err))
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
      check(`${args.slice(2).join(' ')}: «${texto}»`, r.code === 2 && r.err.includes(texto), una(r.err))
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
    check('y responde', r.code === 0 && r.out.includes('"ok":true'), una(r.out))
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
    const r = await ejecutarTdb({ ejecutable: process.execPath, argv: [TDB, 'query', 'nobase', '--stdin'], env: entornoTdb(), timeoutMs: TOPE_MS, maxBuffer: 1 << 20 })
    const ms = Date.now() - t0
    check('sin entrada: la entrada se cierra y tdb contesta en el acto', ms < RAPIDO_MS && r.stderr.includes('No llegó nada'), `${ms} ms · ${una(r.stderr)}`)

    const r2 = await ejecutarTdb({ ejecutable: process.execPath, argv: ['-e', 'setTimeout(() => {}, 20000)'], env: entornoTdb(), timeoutMs: 1000, maxBuffer: 1 << 20 })
    check('el tope de tiempo se dice en stderr', r2.exitCode !== 0 && r2.stderr.includes('no terminó en 1 s y se cortó'), una(r2.stderr))

    const r3 = await ejecutarTdb({ ejecutable: process.execPath, argv: ['-e', 'process.exit(0)'], env: entornoTdb(), entrada: 'x'.repeat(4 << 20), timeoutMs: TOPE_MS, maxBuffer: 1 << 20 })
    check('un proceso que no lee su entrada no tumba a quien escribe (EPIPE)', r3.exitCode === 0, JSON.stringify(r3))
  }
}

try {
  await main()
} finally {
  puente.stop()
  rmSync(raiz, { recursive: true, force: true })
}

hr('RESULTADO (PASS/FAIL)')
const total = results.length
const passed = results.filter((r) => r.pass).length
for (const r of results.filter((x) => !x.pass)) console.log(`  FAIL: ${r.name} -> ${r.evidence}`)
const allPass = passed === total
hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
