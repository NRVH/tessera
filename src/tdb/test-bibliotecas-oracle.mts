#!/usr/bin/env node
// =============================================================================
// Prueba de `bibliotecasOracle.cjs` (npm run test:bibliotecas-oracle): qué carpetas del Instant
// Client entran en LD_LIBRARY_PATH y en qué orden, el enlace de compatibilidad de `libaio` (solo
// si el sistema trae únicamente la `.1t64`), que fuera de Linux no cambia nada, que `tdb` se
// relanza UNA vez y solo si le faltan, y el remedio cuando falta `libaio`. Sin Instant Client real.
// =============================================================================

import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { posix } from 'node:path'

interface Ctx {
  packs: { id: string; motor: string; centinela: string }[]
  externos: Record<string, string>
  driversDir: string
}
type Env = Record<string, string | undefined>
const b = createRequire(import.meta.url)('./bibliotecasOracle.cjs') as {
  MARCA_RELANZADO: string
  carpetasInstantClient(ctx: Ctx, existe: (r: string) => boolean): string[]
  libaioDelSistema(existe: (r: string) => boolean, dirs?: string[]): string | null
  carpetaCompatLibaio(driversDir: string, deps: { existe?: (r: string) => boolean; dirs?: string[] }): string | null
  entornoConCarpetas(env: Env, carpetas: string[]): Env
  entornoOracle(env: Env, ctx: Ctx, plataforma: string, deps?: { existe?: (r: string) => boolean; dirs?: string[] }): Env
  relanzarSiFaltan(driversDir: string, deps: Record<string, unknown>): boolean
  remedioLibaio(mensaje: string, plataforma?: string): string | null
}

let passed = 0
let failed = 0
let noAplica = 0
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  if (pass) passed++
  else failed++
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

const PACK = { id: 'oracle-ic-19-linux-x64', motor: 'oracle', centinela: 'libclntsh.so' }
const ctx: Ctx = { packs: [PACK, { id: 'mongo', motor: 'mongodb', centinela: 'x' }], externos: {}, driversDir: '/d' }
const descargado = '/d/oracle/oracle-ic-19-linux-x64'

hr('(1) Qué carpetas')
check('(1a) el descargado, si tiene el centinela', b.carpetasInstantClient(ctx, (r) => r === `${descargado}/libclntsh.so`).join() === descargado, '')
check(
  '(1b) el externo registrado manda sobre el descargado (es el que se carga)',
  b.carpetasInstantClient({ ...ctx, externos: { [PACK.id]: '/opt/ic' } }, () => true).join() === '/opt/ic',
  ''
)
check('(1c) NEGATIVO: sin centinela, ninguna; los packs de otro motor no cuentan', b.carpetasInstantClient(ctx, () => false).length === 0, '')

hr('(2) libaio')
const dirs = ['/usr/lib/x86_64-linux-gnu']
check('(2a) con libaio.so.1, nada que hacer', b.libaioDelSistema((r) => r.endsWith('libaio.so.1'), dirs) === 'ok', '')
check('(2b) solo con la .1t64 (Ubuntu 24.04), su ruta', b.libaioDelSistema((r) => r.endsWith('.1t64'), dirs) === '/usr/lib/x86_64-linux-gnu/libaio.so.1t64', '')
check('(2c) sin ninguna, null', b.libaioDelSistema(() => false, dirs) === null, '')
check('(2d) NEGATIVO: con libaio.so.1 no se crea ningún enlace', b.carpetaCompatLibaio('/d', { existe: (r) => r.endsWith('libaio.so.1'), dirs }) === null, '')
if (process.platform !== 'linux') {
  noAplica++
  console.log('  [NO APLICA] (2e) el enlace de verdad es de Linux')
} else {
  const dir = mkdtempSync(join(tmpdir(), 'pruebas-libaio-'))
  try {
    const sistema = join(dir, 'sistema')
    const t64 = join(sistema, 'libaio.so.1t64')
    mkdirSync(sistema)
    writeFileSync(t64, 'lib')
    const compat = b.carpetaCompatLibaio(join(dir, 'drivers'), { dirs: [sistema] })
    const otraVez = b.carpetaCompatLibaio(join(dir, 'drivers'), { dirs: [sistema] })
    check(
      '(2e) solo con la .1t64: enlace libaio.so.1 en la carpeta de Tessera, idempotente',
      compat !== null && compat === otraVez && readlinkSync(join(compat, 'libaio.so.1')) === t64,
      String(compat)
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

hr('(3) El entorno')
check('(3a) sin LD_LIBRARY_PATH, solo las carpetas', b.entornoConCarpetas({}, ['/a', '/b']).LD_LIBRARY_PATH === '/a:/b', '')
check(
  '(3b) con uno previo, delante y sin repetir las que ya estaban',
  b.entornoConCarpetas({ LD_LIBRARY_PATH: '/b:/usr/local/lib' }, ['/a', '/b']).LD_LIBRARY_PATH === '/a:/b:/usr/local/lib',
  ''
)
const env: Env = { PATH: '/bin' }
const yaEstan: Env = { LD_LIBRARY_PATH: '/a' }
check('(3c) si ya están todas, el MISMO objeto (no hay que relanzar)', b.entornoConCarpetas(yaEstan, ['/a']) === yaEstan, '')
check('(3d) NEGATIVO: fuera de Linux no cambia nada', b.entornoOracle(env, ctx, 'win32', { existe: () => true }) === env && b.entornoOracle(env, ctx, 'darwin', { existe: () => true }) === env, '')
check('(3e) en Linux sin cliente instalado, tampoco', b.entornoOracle(env, ctx, 'linux', { existe: () => false }) === env, '')
const conLibaio = b.entornoOracle(env, ctx, 'linux', { existe: (r) => r.endsWith('libclntsh.so') || r.endsWith('libaio.so.1'), dirs })
check('(3f) en Linux con cliente: su carpeta en LD_LIBRARY_PATH y el resto intacto', conLibaio.LD_LIBRARY_PATH === descargado && conLibaio.PATH === '/bin' && env.LD_LIBRARY_PATH === undefined, String(conLibaio.LD_LIBRARY_PATH))

hr('(4) El relanzamiento de tdb')
{
  const dir = mkdtempSync(join(tmpdir(), 'pruebas-relanzar-'))
  try {
    writeFileSync(join(dir, 'catalogo.json'), JSON.stringify({ packs: [PACK], externos: {} }))
    const instalado = (r: string): boolean => r.endsWith('libclntsh.so') || r.endsWith('libaio.so.1')
    const llamadas: { env: Env }[] = []
    let salida: number | null = null
    const proceso = new EventEmitter() as EventEmitter & { exit: (c: number) => void }
    proceso.exit = (c: number) => {
      salida = c
    }
    const senales: string[] = []
    const hijo = new EventEmitter() as EventEmitter & { kill: (s: string) => void }
    hijo.kill = (s: string) => {
      senales.push(s)
    }
    const deps = (extra: Record<string, unknown>): Record<string, unknown> => ({
      plataforma: 'linux',
      existe: instalado,
      dirs,
      proceso,
      spawn: (_exe: string, _args: string[], o: { env: Env }) => {
        llamadas.push(o)
        return hijo
      },
      ...extra
    })
    const relanzado = b.relanzarSiFaltan(dir, deps({ env: { PATH: '/bin' } }))
    proceso.emit('SIGTERM')
    hijo.emit('exit', 7, null)
    check(
      '(4a) le faltan: se relanza con ellas y la marca, devuelve true y sale con el código del relanzado',
      relanzado === true && llamadas.length === 1 && (llamadas[0].env.LD_LIBRARY_PATH ?? '').startsWith(posix.join(dir, 'oracle', PACK.id)) && llamadas[0].env[b.MARCA_RELANZADO] === '1' && salida === 7,
      JSON.stringify({ ld: llamadas[0]?.env.LD_LIBRARY_PATH, salida })
    )
    check('(4a2) el tope de quien lo lanzó (SIGTERM) llega al relanzado: no queda huérfano', senales.join() === 'SIGTERM', senales.join())
    proceso.removeAllListeners()
    llamadas.length = 0
    salida = null
    const otraVez = b.relanzarSiFaltan(dir, deps({ env: { PATH: '/bin', [b.MARCA_RELANZADO]: '1' } }))
    check('(4b) NEGATIVO: ya relanzado, no se relanza otra vez (nunca en bucle)', otraVez === false && llamadas.length === 0 && salida === null, '')
    // Con una carpeta de drivers POSIX: en Windows los dos puntos de `C:` partirían LD_LIBRARY_PATH.
    const yaTiene = b.relanzarSiFaltan('/d', deps({ env: { PATH: '/bin', LD_LIBRARY_PATH: descargado }, ctx }))
    check('(4c) NEGATIVO: si ya las tiene, sigue sin relanzar', yaTiene === false && llamadas.length === 0, '')
    b.relanzarSiFaltan(dir, deps({ env: { PATH: '/bin' }, plataforma: 'win32' }))
    b.relanzarSiFaltan('', deps({ env: { PATH: '/bin' } }))
    check('(4d) NEGATIVO: fuera de Linux o sin carpeta de drivers, nada', llamadas.length === 0, '')
    const sinLanzar = b.relanzarSiFaltan(dir, deps({ env: { PATH: '/bin' }, spawn: () => { throw new Error('EAGAIN') } }))
    check('(4e) si el relanzado ni arranca, sigue (el error al cargar lo explicará)', sinLanzar === false && salida === null, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

hr('(5) El remedio de libaio')
const dpi = 'DPI-1047: Cannot locate a 64-bit Oracle Client library: "libaio.so.1: cannot open shared object file: No such file or directory"'
check('(5a) en Linux nombra el paquete de Ubuntu 24.04 y el de antes', (b.remedioLibaio(dpi, 'linux') ?? '').includes('libaio1t64') && (b.remedioLibaio(dpi, 'linux') ?? '').includes('libaio1;'), '')
check('(5b) NEGATIVO: otro error u otra plataforma, ninguno', b.remedioLibaio('ORA-01017', 'linux') === null && b.remedioLibaio(dpi, 'win32') === null, '')

const total = passed + failed
hr(`VEREDICTO: ${passed}/${total} PASS${noAplica ? ` (${noAplica} NO APLICA en este sistema)` : ''} — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(failed === 0 ? 0 : 1)
