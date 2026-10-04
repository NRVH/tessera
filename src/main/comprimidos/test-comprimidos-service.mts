#!/usr/bin/env node
// =============================================================================
// Prueba de INTEGRACIÓN del diff de comprimidos (npm run test:comprimidos-service): los bytes de
// dos revisiones salen de un solo `git cat-file --batch`, se leen como ZIP desde un buffer, se
// restan sus directorios centrales y se saca el contenido de UNA entrada, todo por los CANALES
// REGISTRADOS con `registrarIpcComprimidos`. Cubre A/M/D, el jar recompilado, el alta del
// contenedor, el lado del disco por rangos, anidados, texto en latin-1, `no-existe`, `binario`,
// el token que descarta una petición superada y el contenedor inexistente. Fixture temporal.
// =============================================================================

import { execFileSync } from 'node:child_process'
import { register } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import { zipSync } from 'fflate'
import { COMPRIMIDOS_CHANNELS } from '../../shared/comprimidos-ipc.ts'
import type {
  CompararRequest,
  CompararResult,
  EntradaRequest,
  EntradaResult
} from '../../shared/comprimidos-ipc.ts'

// -----------------------------------------------------------------------------
// Resolver-hook: 'electron' a un stub inerte (GitService importa `dialog`) + reintento .ts
// para los imports extensionless. Debe
// registrarse ANTES de cargar los servicios, de ahí el import DINÁMICO.
// -----------------------------------------------------------------------------
const electronStub =
  'export const dialog = { showMessageBox: async () => ({ response: 0 }) };' +
  'export const app = { getAppPath: () => process.cwd(), getPath: () => process.env.TEMP || "/tmp" };'
const resolveTsHook = `
const ELECTRON_STUB = 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(electronStub)});
export async function resolve(spec, ctx, next) {
  if (spec === 'electron') {
    return { url: ELECTRON_STUB, shortCircuit: true };
  }
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook))
const { GitService } = await import('../git/GitService.ts')
const { ComprimidosService } = await import('./ComprimidosService.ts')
const { registrarIpcComprimidos } = await import('./ipc.ts')

// =============================================================================
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

/** IpcMain de mentira: guarda los handlers para poder invocarlos como el renderer. */
function ipcFalso(): {
  handle: (canal: string, fn: (e: unknown, req: unknown) => unknown) => void
  llamar: <T>(canal: string, req: unknown) => Promise<T>
} {
  const mapa = new Map<string, (e: unknown, req: unknown) => unknown>()
  return {
    handle: (canal, fn) => void mapa.set(canal, fn),
    llamar: async <T,>(canal: string, req: unknown): Promise<T> => {
      const fn = mapa.get(canal)
      if (fn === undefined) throw new Error(`canal no registrado: ${canal}`)
      return (await fn(null, req)) as T
    }
  }
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)
const latin1 = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'latin1'))

/** Un .class de mentira: la firma 0xCAFEBABE basta para lo que aquí se prueba. */
const CLASE_A = Uint8Array.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x34, 0x01, 0x02])
const CLASE_B = Uint8Array.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x34, 0x09, 0x09])

const MANIFEST_V1 =
  'Manifest-Version: 1.0\nAnt-Version: Apache Ant 1.10.14\nCreated-By: 17.0.12+8-LTS-286\n'
const MANIFEST_V2 =
  'Manifest-Version: 1.0\nAnt-Version: Apache Ant 1.10.15\nCreated-By: 17.0.2+8-LTS-86\n'

// =============================================================================
// Fixture: un repo con dos commits que tocan un .jar y un .ear con un jar dentro.
// =============================================================================
interface Fixture {
  repo: string
  commit1: string
  commit2: string
}

function buildFixture(): Fixture {
  const repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-comprimidos-test-')))
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env } })

  git(['init', '-b', 'main'])
  git(['config', 'user.name', 'Fixture Bot'])
  git(['config', 'user.email', 'fixture@example.com'])
  git(['config', 'core.autocrlf', 'false'])
  git(['config', 'commit.gpgsign', 'false'])

  const jarV1 = zipSync({
    'META-INF/MANIFEST.MF': utf8(MANIFEST_V1),
    'com/ejemplo/Servicio.class': CLASE_A,
    'com/ejemplo/Viejo.class': CLASE_A,
    'recursos/mensajes.properties': latin1('saludo=Configuración añadida\n'),
    'recursos/logo.bin': Uint8Array.from([0x00, 0x01, 0x00, 0x02])
  })
  writeFileSync(path.join(repo, 'cliente.jar'), Buffer.from(jarV1))
  git(['add', '-A'])
  git(['commit', '-m', 'primer entregable'])
  const commit1 = git(['rev-parse', 'HEAD']).trim()

  // Segundo commit: MANIFEST cambiado, una clase modificada, otra borrada, una
  // nueva; y el .properties INTACTO (para que cuente como idéntico). Además
  // aparece un .ear con el jar dentro.
  const jarV2 = zipSync({
    'META-INF/MANIFEST.MF': utf8(MANIFEST_V2),
    'com/ejemplo/Servicio.class': CLASE_B,
    'com/ejemplo/Nuevo.class': CLASE_A,
    'recursos/mensajes.properties': latin1('saludo=Configuración añadida\n'),
    'recursos/logo.bin': Uint8Array.from([0x00, 0x01, 0x00, 0x02])
  })
  writeFileSync(path.join(repo, 'cliente.jar'), Buffer.from(jarV2))

  const ear = zipSync({
    'META-INF/application.xml': utf8('<application/>\n'),
    'lib/cliente.jar': new Uint8Array(jarV2)
  })
  writeFileSync(path.join(repo, 'entregable.ear'), Buffer.from(ear))

  git(['add', '-A'])
  git(['commit', '-m', 'segundo entregable'])
  const commit2 = git(['rev-parse', 'HEAD']).trim()

  // Y en DISCO, una tercera versión sin commitear: para el lado 'worktree'.
  const jarV3 = zipSync({
    'META-INF/MANIFEST.MF': utf8(MANIFEST_V2 + 'Build-Jdk: 17\n'),
    'com/ejemplo/Servicio.class': CLASE_B,
    'com/ejemplo/Nuevo.class': CLASE_A,
    'recursos/mensajes.properties': latin1('saludo=Configuración añadida\n'),
    'recursos/logo.bin': Uint8Array.from([0x00, 0x01, 0x00, 0x02])
  })
  writeFileSync(path.join(repo, 'cliente.jar'), Buffer.from(jarV3))

  return { repo, commit1, commit2 }
}

// =============================================================================
async function main(): Promise<void> {
  hr('PASO 0 - construir el fixture en un dir temporal del SO')
  const fx = buildFixture()
  console.log('repo:', fx.repo)

  try {
    const silent = (): void => {}
    const git = new GitService({ projectRoot: fx.repo, log: silent })
    git.setProjectRoot(fx.repo)

    const ipc = ipcFalso()
    const servicio = new ComprimidosService({
      git,
      // El descompilador no se toca en este test: todas las entradas se piden como
      // texto. Va un doble que grita si alguien lo llama sin querer.
      decompiler: {
        descompilar: () => {
          throw new Error('no se esperaba descompilar en este test')
        }
      } as never,
      resolver: (rel: string) => path.join(fx.repo, rel),
      log: silent
    })
    registrarIpcComprimidos({ ipc: ipc as never, comprimidos: servicio })

    const comparar = (req: CompararRequest): Promise<CompararResult> =>
      ipc.llamar<CompararResult>(COMPRIMIDOS_CHANNELS.COMPARAR, req)
    const entrada = (req: EntradaRequest): Promise<EntradaResult> =>
      ipc.llamar<EntradaResult>(COMPRIMIDOS_CHANNELS.ENTRADA, req)

    const enCommit = (hash: string, p = 'cliente.jar'): CompararRequest['antes'] => ({
      source: 'commit',
      hash,
      path: p
    })

    // -----------------------------------------------------------------------
    hr('(1) Comparar dos revisiones del mismo .jar')
    const r1 = await comparar({
      antes: enCommit(fx.commit1),
      despues: enCommit(fx.commit2),
      dentro: []
    })
    const nombres = r1.entradas.map((e) => `${e.nombre}:${e.estado}`).sort()
    check('(1a) sin error', r1.error === '', JSON.stringify(r1.error))
    check(
      '(1b) las cuatro que cambiaron, con su letra',
      nombres.join(' ') ===
        'META-INF/MANIFEST.MF:M com/ejemplo/Nuevo.class:A com/ejemplo/Servicio.class:M com/ejemplo/Viejo.class:D',
      nombres.join(' ')
    )
    check(
      '(1c) las dos idénticas se cuentan y NO se envían',
      r1.iguales === 2 && r1.entradas.length === 4,
      `iguales=${r1.iguales}, enviadas=${r1.entradas.length}`
    )
    const manifest = r1.entradas.find((e) => e.nombre === 'META-INF/MANIFEST.MF')
    check(
      '(1d) los dos tamaños viajan en la fila',
      manifest?.tamanoAntes === MANIFEST_V1.length && manifest?.tamanoDespues === MANIFEST_V2.length,
      `${manifest?.tamanoAntes} -> ${manifest?.tamanoDespues}`
    )

    // -----------------------------------------------------------------------
    hr('(2) La misma revisión contra sí misma: cero cambios')
    const r2 = await comparar({
      antes: enCommit(fx.commit2),
      despues: enCommit(fx.commit2),
      dentro: []
    })
    check(
      '(2a) nada cambiado y todo idéntico',
      r2.entradas.length === 0 && r2.iguales === 5,
      `cambiadas=${r2.entradas.length}, iguales=${r2.iguales}`
    )

    // -----------------------------------------------------------------------
    hr('(3) Alta del contenedor entero (lado vacío)')
    const r3 = await comparar({
      antes: { source: 'empty', path: 'entregable.ear' },
      despues: enCommit(fx.commit2, 'entregable.ear'),
      dentro: []
    })
    check(
      '(3a) todas las entradas salen como alta',
      r3.entradas.length === 2 && r3.entradas.every((e) => e.estado === 'A'),
      r3.entradas.map((e) => `${e.nombre}:${e.estado}`).join(' ')
    )
    check(
      '(3b) el .jar de dentro se marca como contenedor (se puede entrar)',
      r3.entradas.find((e) => e.nombre === 'lib/cliente.jar')?.contenedor === true,
      'true'
    )

    // -----------------------------------------------------------------------
    hr('(4) El lado del DISCO (worktree) contra un commit')
    const r4 = await comparar({
      antes: enCommit(fx.commit2),
      despues: { source: 'worktree', path: 'cliente.jar' },
      dentro: []
    })
    check(
      '(4a) sólo el MANIFEST cambió respecto al disco',
      r4.entradas.length === 1 && r4.entradas[0].nombre === 'META-INF/MANIFEST.MF',
      r4.entradas.map((e) => e.nombre).join(' ')
    )

    // -----------------------------------------------------------------------
    hr('(5) ANIDADOS: bajar al .jar que vive dentro del .ear')
    const r5 = await comparar({
      antes: { source: 'empty', path: 'entregable.ear' },
      despues: enCommit(fx.commit2, 'entregable.ear'),
      dentro: ['lib/cliente.jar']
    })
    check(
      '(5a) se listan las entradas del jar INTERIOR, no las del ear',
      r5.entradas.length === 5 && r5.entradas.some((e) => e.nombre === 'com/ejemplo/Servicio.class'),
      r5.entradas.map((e) => e.nombre).join(' ')
    )

    // -----------------------------------------------------------------------
    hr('(6) Contenido de una entrada de TEXTO por los dos lados')
    const e6 = await entrada({
      antes: enCommit(fx.commit1),
      despues: enCommit(fx.commit2),
      dentro: [],
      nombre: 'META-INF/MANIFEST.MF',
      como: 'texto',
      paneKey: 'p1',
      token: 1
    })
    check(
      '(6a) el lado "antes" trae el texto de su revisión',
      e6.antes.estado === 'ok' && e6.antes.texto === MANIFEST_V1,
      JSON.stringify(e6.antes.texto.slice(0, 40))
    )
    check(
      '(6b) y el lado "después" el suyo',
      e6.despues.estado === 'ok' && e6.despues.texto.includes('1.10.15'),
      JSON.stringify(e6.despues.texto.slice(0, 40))
    )
    check('(6c) no viene marcado como descartado', !e6.descartado, 'false')

    const e6b = await entrada({
      antes: enCommit(fx.commit1),
      despues: enCommit(fx.commit2),
      dentro: [],
      nombre: 'recursos/mensajes.properties',
      como: 'texto',
      paneKey: 'p1',
      token: 2
    })
    check(
      '(6d) una entrada latin-1 se decodifica con el MISMO códec que el editor',
      e6b.antes.texto.includes('Configuración') && !e6b.antes.texto.includes('�'),
      JSON.stringify(e6b.antes.texto)
    )

    // -----------------------------------------------------------------------
    hr('(7) Una entrada que sólo existe en un lado')
    const e7 = await entrada({
      antes: enCommit(fx.commit1),
      despues: enCommit(fx.commit2),
      dentro: [],
      nombre: 'com/ejemplo/Nuevo.class',
      como: 'texto',
      paneKey: 'p1',
      token: 3
    })
    check(
      '(7a) el lado que no la tiene dice "no-existe", no un error',
      e7.antes.estado === 'no-existe' && e7.antes.texto === '' && e7.antes.mensaje === '',
      JSON.stringify(e7.antes)
    )

    // -----------------------------------------------------------------------
    hr('(8) Una entrada binaria no se convierte en texto de mentira')
    const e8 = await entrada({
      antes: enCommit(fx.commit1),
      despues: enCommit(fx.commit2),
      dentro: [],
      nombre: 'recursos/logo.bin',
      como: 'texto',
      paneKey: 'p1',
      token: 4
    })
    check(
      '(8a) estado "binario" en los dos lados y sin texto',
      e8.antes.estado === 'binario' && e8.despues.estado === 'binario' && e8.antes.texto === '',
      `${e8.antes.estado}/${e8.despues.estado}`
    )

    // -----------------------------------------------------------------------
    hr('(9) El TOKEN: una petición superada se marca como descartada')
    // Se lanzan dos del MISMO pane sin esperar a la primera. La segunda sube el
    // token, así que la primera —que aún está leyendo blobs— tiene que rendirse
    // antes de arrancar nada. Sólo se comprueba con 'java', que es el camino que
    // mira el token (el de texto no arranca procesos y no hace falta cortarlo).
    const servicioToken = new ComprimidosService({
      git,
      decompiler: {
        descompilar: async () => {
          throw new Error('no debería llegar a descompilar: la petición estaba superada')
        }
      } as never,
      resolver: (rel: string) => path.join(fx.repo, rel),
      log: silent
    })
    const ipc2 = ipcFalso()
    registrarIpcComprimidos({ ipc: ipc2 as never, comprimidos: servicioToken })
    const pedir = (token: number): Promise<EntradaResult> =>
      ipc2.llamar<EntradaResult>(COMPRIMIDOS_CHANNELS.ENTRADA, {
        antes: enCommit(fx.commit1),
        despues: enCommit(fx.commit2),
        dentro: [],
        nombre: 'com/ejemplo/Servicio.class',
        como: 'java',
        paneKey: 'mismoPane',
        token
      })
    const [vieja, nueva] = await Promise.all([pedir(1), pedir(2)])
    check(
      '(9a) la superada vuelve `descartado` y sin arrancar el motor',
      vieja.descartado === true,
      `descartado=${vieja.descartado}`
    )
    check(
      '(9b) y la vigente NO se descarta (aunque aquí el motor falle a propósito)',
      nueva.descartado === false,
      `descartado=${nueva.descartado}, estado=${nueva.antes.estado}`
    )

    // -----------------------------------------------------------------------
    hr('(9b) El tope de anidamiento se cumple, no sólo se documenta')
    {
      // Cinco niveles: por encima del tope, `componerRutaArchivo` produce una ruta
      // que `parseRutaArchivo` ya no sabe leer, y el descompilador acabaría
      // escribiendo la clase FUERA de su paquete sin decir nada. Se corta antes.
      const demasiado = await comparar({
        antes: enCommit(fx.commit1, 'entregable.ear'),
        despues: enCommit(fx.commit2, 'entregable.ear'),
        dentro: ['a.jar', 'b.jar', 'c.jar', 'd.jar', 'e.jar']
      })
      check(
        '(9c) bajar más de 4 niveles da un error humano, no una ruta rota',
        demasiado.error.includes('4 niveles'),
        JSON.stringify(demasiado.error)
      )
      // Y justo en el tope sigue intentándolo (falla por otra razón: no existe).
      const enElTope = await comparar({
        antes: { source: 'empty', path: 'entregable.ear' },
        despues: enCommit(fx.commit2, 'entregable.ear'),
        dentro: ['lib/cliente.jar']
      })
      check(
        '(9d) dentro del tope sigue funcionando',
        enElTope.error === '' && enElTope.entradas.length > 0,
        `${enElTope.entradas.length} entradas`
      )
    }

    // -----------------------------------------------------------------------
    hr('(10) Un contenedor que no existe en ninguna de las dos revisiones')
    const r10 = await comparar({
      antes: enCommit(fx.commit1, 'no-existe.jar'),
      despues: enCommit(fx.commit2, 'no-existe.jar'),
      dentro: []
    })
    check(
      '(10a) error con mensaje humano, no una excepción',
      r10.error !== '' && r10.entradas.length === 0,
      JSON.stringify(r10.error)
    )
  } finally {
    // En Windows, el `git cat-file` recién matado conserva el repo como cwd unos
    // milisegundos y el borrado sale EBUSY. Se reintenta con espera, y si aun así
    // no se puede, se avisa y se sigue: dejar un temporal del SO sin borrar no
    // puede convertir una batería verde en roja.
    try {
      rmSync(fx.repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    } catch (err) {
      console.log(`  (aviso) no se pudo borrar el fixture ${fx.repo}: ${String(err)}`)
    }
  }

  // ---------------------------------------------------------------------------
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

await main()
