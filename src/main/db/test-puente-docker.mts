// =============================================================================
// Prueba de integración del puente al host (modo Docker): el viaje completo, del `tdb` del contenedor por un
// bind-mount hasta el host y de vuelta con el código de salida. Necesita Docker (sin él se salta
// con aviso) y la imagen de pruebas del sandbox, que construye si falta. El `ejecutar` es un doble: se prueba el transporte.
// Las llamadas al contenedor van con `spawn` asíncrono: con `spawnSync` el vigilante del host no correría.
// (node src/main/db/test-puente-docker.mts)
// =============================================================================
import { crearCarpetaTemporal } from '../../../scripts/pruebas/temporales.mts'
import { spawn, spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PuenteDocker } from './puenteDocker.ts'
import { imagenDeLaInstancia } from '../sandbox/gestor/NucleoSandbox.ts'
import { GestorSandbox } from '../sandbox/GestorSandbox.ts'

// La imagen de las pruebas, no la de la Tessera del usuario que comparte el Docker.
const CONTENEDOR = 'pruebas-dbbridge'
const IMAGEN = imagenDeLaInstancia()

let fallos = 0
function ok(nombre: string, condicion: boolean, detalle?: string): void {
  if (condicion) {
    console.log(`  ✓ ${nombre}`)
  } else {
    fallos++
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ''}`)
  }
}

function docker(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync('docker', args, { encoding: 'utf-8' })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** `docker exec` que NO bloquea el bucle de eventos (ver el aviso de arriba). */
function ejecutar(args: string[], plazoMs = 25_000): Promise<{ codigo: number | null; salida: string; err: string }> {
  return new Promise((resolver) => {
    const p = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let salida = ''
    let err = ''
    const t = setTimeout(() => {
      p.kill()
      resolver({ codigo: null, salida, err: `${err}\n[TIMEOUT]` })
    }, plazoMs)
    p.stdout.on('data', (d) => (salida += String(d)))
    p.stderr.on('data', (d) => (err += String(d)))
    p.on('close', (codigo) => {
      clearTimeout(t)
      resolver({ codigo, salida, err })
    })
  })
}

console.log('\nPuente al host (modo Docker)\n')

if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) {
  console.log('  — saltado: Docker no está disponible\n')
  process.exit(0)
}
// Sin la imagen de pruebas se construye aquí: saltarse daría un verde sin haber probado nada.
if (docker(['image', 'inspect', IMAGEN]).status !== 0) {
  console.log(`  construyendo ${IMAGEN} (solo la primera vez)…`)
  await new GestorSandbox().asegurarImagen()
}

const raiz = crearCarpetaTemporal(path.join(tmpdir(), 'tessera-dbbridge-'))
const ejecutadas: Array<{ token: string; argv: string[] }> = []

const puente = new PuenteDocker({
  raiz,
  clienteOrigen: path.join(process.cwd(), 'src', 'tdb', 'tdb-container.cjs'),
  // Doble del `tdb` real: aquí se prueba el TRANSPORTE, no la consulta.
  ejecutar: async (token, argv) => {
    ejecutadas.push({ token, argv })
    return {
      exitCode: argv[0] === 'salir7' ? 7 : 0,
      stdout: `  host ejecuto: ${argv.join(' ')}\n`,
      stderr: ''
    }
  },
  log: () => {}
})

const buzon = puente.prepararPerfil('perfil-test')

docker(['rm', '-f', CONTENEDOR])
const ejecutarDocker = docker([
  'run',
  '-d',
  '--name',
  CONTENEDOR,
  '-v',
  `${buzon}:/agent-config/dbbridge`,
  IMAGEN,
  'sh',
  '-c',
  'while true; do sleep 3600; done'
])
if (ejecutarDocker.status !== 0) {
  console.log(`  — saltado: no se pudo crear el contenedor (${ejecutarDocker.stderr.trim()})\n`)
  puente.detener()
  rmSync(raiz, { recursive: true, force: true })
  process.exit(0)
}
docker(['exec', '-u', 'root', CONTENEDOR, 'ln', '-sf', '/agent-config/dbbridge/tdb', '/usr/local/bin/tdb'])

const CON_TOKEN = ['exec', '-e', 'TESSERA_DB_SESSION=tok-test', CONTENEDOR, 'tdb']

{
  const r = await ejecutar([...CON_TOKEN, 'ls', '--json'])
  ok('el contenedor recibe la salida que produjo el HOST', r.salida.includes('host ejecuto: ls --json'), r.salida + r.err)
  ok('la petición llega con su token', ejecutadas.at(-1)?.token === 'tok-test')
  ok('y con su argv intacto', ejecutadas.at(-1)?.argv.join(' ') === 'ls --json')
}
{
  // Sin esto, un `tdb query ... && algo` del agente seguiría adelante tras un fallo.
  const r = await ejecutar([...CON_TOKEN, 'salir7'])
  ok('el código de salida del host llega al shell del contenedor', r.codigo === 7, `code=${r.codigo}`)
}
{
  // El SQL cruza como argumento por JSON, así que no pasa por ningún parser de shell.
  const sql = "SELECT '%García%', \"x\", 'a!b', $HOME\nFROM t"
  await ejecutar([...CON_TOKEN, 'query', 'base', sql])
  ok('el SQL cruza INTACTO (comillas, %, $, saltos)', ejecutadas.at(-1)?.argv[2] === sql, JSON.stringify(ejecutadas.at(-1)?.argv))
}
{
  const grande = 'x'.repeat(4000)
  await ejecutar([...CON_TOKEN, 'grande', grande])
  ok('un argumento de 4 KB cruza sin romperse', ejecutadas.at(-1)?.argv[1].length === 4000)
}
{
  // Dos a la vez: el agente y una terminal de abajo del mismo proyecto.
  const antes = ejecutadas.length
  const [a, b] = await Promise.all([ejecutar([...CON_TOKEN, 'uno']), ejecutar([...CON_TOKEN, 'dos'])])
  ok(
    'dos invocaciones concurrentes no se cruzan',
    a.salida.includes('host ejecuto: uno') && b.salida.includes('host ejecuto: dos') && ejecutadas.length === antes + 2,
    JSON.stringify([a.salida, b.salida])
  )
}
{
  const t0 = Date.now()
  const r = await ejecutar(['exec', CONTENEDOR, 'tdb', 'ls'])
  ok('sin token, falla con un mensaje accionable', r.err.includes('Reinicie la terminal'), r.err)
  ok('y falla rápido, no al timeout', Date.now() - t0 < 8000, `${Date.now() - t0} ms`)
}
{
  // El caso que sin centinela sería un misterio: Docker recrea el contenedor, el bind
  // se pierde y `mkdir -p` deja la carpeta vacía. Sin este aviso, `tdb` escribiría al
  // vacío y esperaría el timeout largo sin decir por qué.
  puente.detener()
  docker(['exec', '-u', 'root', CONTENEDOR, 'sh', '-c', 'touch -d "2020-01-01" /agent-config/dbbridge/.alive'])
  const t0 = Date.now()
  const r = await ejecutar([...CON_TOKEN, 'ls'])
  ok('con el puente caído avisa en vez de colgarse', r.err.includes('está montado, pero Tessera no responde'), r.err)
  ok('y en segundos, no en minutos', Date.now() - t0 < 8000, `${Date.now() - t0} ms`)
}

docker(['rm', '-f', CONTENEDOR])
rmSync(raiz, { recursive: true, force: true })

console.log(`\n${fallos === 0 ? '✓ TODO VERDE' : `✗ ${fallos} FALLO(S)`}\n`)
process.exit(fallos === 0 ? 0 : 1)
