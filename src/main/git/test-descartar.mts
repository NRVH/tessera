#!/usr/bin/env node
// =============================================================================
// Prueba de `descartarCambios` de ServicioGit (npm run test:descartar) contra repos temporales:
// rastreado modificado (con y sin preparar) pregunta y revierte a HEAD, y cancelar no lo toca;
// sin repo activo devuelve `{ ok:false }` sin lanzar. Sin confirmación inyectada no se descarta
// nada, y una ruta vacía, `.`, con `..` o una carpeta se rechaza sin tocar nada, también en
// un monorepo. Cada rechazo lleva `error` (cancelar no), y si git no contesta no se borra nada.
// Ni una carpeta donde HEAD tiene el archivo, ni un conflicto, ni un borrado ya preparado (su copia
// se compara con los bytes de checkout), ni una rama con la ref dañada pierden datos.
// =============================================================================

import { execFileSync } from 'node:child_process'
import { register } from 'node:module'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  realpathSync,
  symlinkSync,
  readlinkSync
} from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import type { CambioWorktree, ResultadoDescarteCambios } from '../../shared/git-ipc.ts'

// El código de producción importa sin extensión: este hook reintenta con `.ts`. Se registra ANTES
// de cargar ServicioGit, de ahí el import dinámico (los estáticos se hoistean).
const hookResolucionTs = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(hookResolucionTs))
const { ServicioGit } = await import('./ServicioGit.ts')

// =============================================================================
// Reporte PASS/FAIL (mismo patrón que test-worktree.mts)
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
function check(nombre: string, pass: boolean, evidence: string): void {
  results.push({ name: nombre, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${nombre} -> ${evidence}`)
}
function mensajeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
async function comprobarSinExcepcion(
  nombre: string,
  fn: () => Promise<{ pass: boolean; evidence: string }>
): Promise<void> {
  try {
    const { pass, evidence } = await fn()
    check(nombre, pass, evidence)
  } catch (err) {
    check(nombre, false, `LANZÓ: ${mensajeError(err)}`)
  }
}

// =============================================================================
// Fixture: repo con tres archivos trackeados, todos "original\n" en el commit
// base. Cada test opera sobre UN archivo distinto para no contaminarse entre sí.
// =============================================================================
function crearEscenario(): string {
  const repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-discard-test-')))

  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env } })

  const escribirArchivo = (rel: string, contenido: string): void => {
    writeFileSync(path.join(repo, rel), contenido, 'utf8') // UTF-8 sin BOM, LF
  }

  git(['init', '-b', 'main'])
  git(['config', 'user.name', 'Fixture Bot'])
  git(['config', 'user.email', 'fixture@example.com'])
  git(['config', 'core.autocrlf', 'false']) // blobs deterministas (LF)
  git(['config', 'commit.gpgsign', 'false'])

  escribirArchivo('unstaged.txt', 'original\n')
  escribirArchivo('staged.txt', 'original\n')
  escribirArchivo('clean.txt', 'original\n')
  git(['add', '-A'])
  git(['commit', '-m', 'base'])

  return repo
}

/**
 * Monorepo: el repo cuelga por encima de la carpeta abierta (`packages/app`), y `fuera.txt` vive
 * en el repo pero fuera de ella. Ahí una ruta vacía traduce a la carpeta abierta, no a ''.
 */
function crearMonorepo(): string {
  const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-discard-mono-')))
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: raiz, encoding: 'utf8', env: { ...process.env } })
  mkdirSync(path.join(raiz, 'packages', 'app'), { recursive: true })
  git(['init', '-b', 'main'])
  git(['config', 'user.name', 'Fixture Bot'])
  git(['config', 'user.email', 'fixture@example.com'])
  git(['config', 'core.autocrlf', 'false'])
  git(['config', 'commit.gpgsign', 'false'])
  writeFileSync(path.join(raiz, 'packages', 'app', 'a.txt'), 'original\n', 'utf8')
  writeFileSync(path.join(raiz, 'fuera.txt'), 'original\n', 'utf8')
  git(['add', '-A'])
  git(['commit', '-m', 'base'])
  return raiz
}

/** Temporales creados a mitad de prueba; se borran con los fixtures. */
const temporales: string[] = []

/** Hace fallar en `svc` los subcomandos de git dados, como si git no contestara (techo de la cola, `index.lock`). */
function fallarSubcomandos(svc: InstanceType<typeof ServicioGit>, subcomandos: readonly string[]): void {
  type Git = (args: string[], ...resto: unknown[]) => Promise<{ stdout: string; stderr: string }>
  const nucleo = (svc as unknown as { n: { git: Git } }).n
  const original = nucleo.git.bind(nucleo)
  nucleo.git = async (args, ...resto) => {
    if (subcomandos.includes(args[0] ?? '')) throw new Error(`simulado: git ${args[0]} no respondió`)
    return original(args, ...resto)
  }
}

/** Crea un dir temporal SIN git (para el caso "sin repo activo"). */
function crearCarpetaSinRepo(): string {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-discard-norepo-')))
  writeFileSync(path.join(dir, 'x.txt'), 'sin git\n', 'utf8')
  return dir
}

/** Repo desechable con `archivos` ya commiteados; devuelve su raíz, `cli` y `escribirArchivo` atados a ella. */
function repoCon(prefijo: string, archivos: Record<string, string>): {
  dir: string
  cli: (args: string[]) => string
  escribirArchivo: (rel: string, contenido: string) => void
  leer: (rel: string) => string
} {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), `tessera-discard-${prefijo}-`)))
  temporales.push(dir)
  const cli = (args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
  const escribirArchivo = (rel: string, contenido: string): void => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    writeFileSync(path.join(dir, rel), contenido, 'utf8')
  }
  cli(['init', '-b', 'main'])
  cli(['config', 'user.name', 'Fixture Bot'])
  cli(['config', 'user.email', 'fixture@example.com'])
  cli(['config', 'core.autocrlf', 'false'])
  cli(['config', 'commit.gpgsign', 'false'])
  for (const [rel, contenido] of Object.entries(archivos)) escribirArchivo(rel, contenido)
  cli(['add', '-A'])
  cli(['commit', '-q', '-m', 'base'])
  return { dir, cli, escribirArchivo, leer: (rel) => readFileSync(path.join(dir, rel), 'utf8') }
}

/**
 * Servicio sobre `dir` que CONFIRMA todo descarte y cuenta cuántas veces se le pidió BORRAR
 * (`pedidas`) y cuántas REVERTIR a HEAD (`revertidas`).
 */
function servicioQueConfirma(
  dir: string,
  silenciar: () => void
): { g: InstanceType<typeof ServicioGit>; pedidas: () => number; revertidas: () => number } {
  let borrar = 0
  let revertir = 0
  const g = new ServicioGit({
    raizProyecto: dir,
    log: silenciar,
    confirmarDescarte: async (_nombre, borra) => {
      if (borra) borrar++
      else revertir++
      return true
    }
  })
  g.fijarRaizProyecto(dir)
  return { g, pedidas: () => borrar, revertidas: () => revertir }
}

/**
 * (9) Casos que PERDÍAN datos sin confirmar (o confirmando algo que no era lo que pasaba): una
 * carpeta donde HEAD tiene un archivo, un archivo en conflicto, un borrado ya preparado y una rama
 * cuya ref está dañada. Todos con la confirmación en SÍ: si llegaran a borrar, borrarían.
 */
async function casosQuePerdianDatos(silenciar: () => void): Promise<void> {
  hr('(9) carpeta sobre archivo, conflicto, borrado preparado y rama rota -> nada se pierde')

  // (9a) `x` está en HEAD; el usuario lo borra y crea `x/trabajo.txt`. `checkout HEAD -- x` lo arrasaría.
  {
    const r = repoCon('dirsobre', { x: 'v1\n' })
    rmSync(path.join(r.dir, 'x'))
    r.escribirArchivo('x/trabajo.txt', 'IMPORTANTE\n')
    const { g, pedidas } = servicioQueConfirma(r.dir, silenciar)
    await comprobarSinExcepcion('(9a) carpeta donde HEAD tiene el archivo `x` -> error legible, x/trabajo.txt intacto', async () => {
      const res = await g.descartarCambios('x')
      return {
        pass:
          res.ok === false &&
          /carpeta/i.test(res.error ?? '') &&
          existsSync(path.join(r.dir, 'x', 'trabajo.txt')) &&
          pedidas() === 0,
        evidence: `res=${JSON.stringify(res)} trabajo=${existsSync(path.join(r.dir, 'x', 'trabajo.txt'))}`
      }
    })
  }

  // (9a-bis) Al revés: `a/b.txt` en HEAD y el usuario puso un ARCHIVO `a` donde estaba la carpeta.
  {
    const r = repoCon('archsobre', { 'a/b.txt': 'v1\n' })
    rmSync(path.join(r.dir, 'a'), { recursive: true })
    r.escribirArchivo('a', 'MIO\n')
    const { g } = servicioQueConfirma(r.dir, silenciar)
    await comprobarSinExcepcion('(9a-bis) archivo `a` donde HEAD tiene la carpeta de `a/b.txt` -> error, `a` intacto', async () => {
      const res = await g.descartarCambios('a/b.txt')
      const a = existsSync(path.join(r.dir, 'a')) ? r.leer('a') : '(no existe)'
      return { pass: res.ok === false && a === 'MIO\n', evidence: `res=${JSON.stringify(res)} a=${JSON.stringify(a)}` }
    })
  }

  // (9b) Conflicto de fusión: revertir a HEAD perdería el lado entrante y la resolución a medias.
  {
    const r = repoCon('conflicto', { 'c.txt': 'base\n' })
    r.cli(['checkout', '-q', '-b', 'otra'])
    r.escribirArchivo('c.txt', 'otra\n')
    r.cli(['commit', '-q', '-am', 'otra'])
    r.cli(['checkout', '-q', 'main'])
    r.escribirArchivo('c.txt', 'main\n')
    r.cli(['commit', '-q', '-am', 'main'])
    try {
      r.cli(['merge', 'otra'])
    } catch {
      // el conflicto es lo que se busca
    }
    r.escribirArchivo('c.txt', 'RESOLUCION A MEDIAS\n')
    const { g, pedidas } = servicioQueConfirma(r.dir, silenciar)
    await comprobarSinExcepcion('(9b) archivo en conflicto -> error «conflicto», la resolución a medias sigue y las etapas también', async () => {
      const res = await g.descartarCambios('c.txt')
      const etapas = r.cli(['ls-files', '-s', '--', 'c.txt']).trim().split(/\r?\n/).length
      return {
        pass: res.ok === false && /conflicto/i.test(res.error ?? '') && r.leer('c.txt') === 'RESOLUCION A MEDIAS\n' && etapas === 3 && pedidas() === 0,
        evidence: `res=${JSON.stringify(res)} c=${JSON.stringify(r.leer('c.txt'))} etapas=${etapas}`
      }
    })
  }

  // (9c-e) Borrados YA preparados: fuera del índice pero en HEAD. Lo correcto es restaurar, no borrar.
  {
    const r = repoCon('rmprep', { 'd.txt': 'v1\n', 'k.txt': 'v1\n', 'm.txt': 'v1\n' })
    r.cli(['rm', '-q', 'd.txt'])
    r.cli(['rm', '-q', '--cached', 'k.txt'])
    r.cli(['rm', '-q', '--cached', 'm.txt'])
    r.escribirArchivo('m.txt', 'v1 + TRABAJO\n')
    const { g, pedidas, revertidas } = servicioQueConfirma(r.dir, silenciar)
    await comprobarSinExcepcion('(9c) `git rm d.txt` -> se restaura (índice y disco) confirmando revertir, nunca borrar', async () => {
      const res = await g.descartarCambios('d.txt')
      const estado = r.cli(['status', '--porcelain', '--', 'd.txt'])
      return {
        pass:
          res.ok === true && existsSync(path.join(r.dir, 'd.txt')) && r.leer('d.txt') === 'v1\n' && estado === '' && pedidas() === 0 && revertidas() === 1,
        evidence: `res=${JSON.stringify(res)} estado=${JSON.stringify(estado)} pedidas=${pedidas()} revertidas=${revertidas()}`
      }
    })
    await comprobarSinExcepcion('(9d) `git rm --cached k.txt` con el disco igual a HEAD -> vuelve al índice, el disco intacto', async () => {
      const res = await g.descartarCambios('k.txt')
      const estado = r.cli(['status', '--porcelain', '--', 'k.txt'])
      return {
        pass: res.ok === true && existsSync(path.join(r.dir, 'k.txt')) && estado === '' && pedidas() === 0 && revertidas() === 2,
        evidence: `res=${JSON.stringify(res)} estado=${JSON.stringify(estado)} pedidas=${pedidas()} revertidas=${revertidas()}`
      }
    })
    await comprobarSinExcepcion('(9e) `git rm --cached m.txt` con cambios en disco -> error legible, el trabajo del disco intacto', async () => {
      const res = await g.descartarCambios('m.txt')
      const m = existsSync(path.join(r.dir, 'm.txt')) ? r.leer('m.txt') : '(borrado)'
      return {
        pass: res.ok === false && (res.error ?? '').length > 0 && m === 'v1 + TRABAJO\n' && pedidas() === 0,
        evidence: `res=${JSON.stringify(res)} m=${JSON.stringify(m)} pedidas=${pedidas()}`
      }
    })
  }

  // (9f) La ref de la rama con basura o vacía (un apagón al escribirla) NO es «repo sin commits».
  for (const [modo, contenido] of [
    ['basura', 'zzzz\n'],
    ['vacía', '']
  ] as const) {
    for (const conCambios of [false, true]) {
      const r = repoCon('refrota', { 'a.txt': 'v1\n' })
      if (conCambios) r.escribirArchivo('a.txt', 'TRABAJO\n')
      writeFileSync(path.join(r.dir, '.git', 'refs', 'heads', 'main'), contenido)
      const { g, pedidas } = servicioQueConfirma(r.dir, silenciar)
      const etiqueta = `(9f) ref ${modo}${conCambios ? ', a.txt con cambios' : ', a.txt limpio'}`
      await comprobarSinExcepcion(`${etiqueta} -> error, sin confirmar, a.txt en disco y en el índice`, async () => {
        const res = await g.descartarCambios('a.txt')
        const enIndice = r.cli(['ls-files', '--', 'a.txt']).trim()
        return {
          pass:
            res.ok === false &&
            (res.error ?? '').length > 0 &&
            existsSync(path.join(r.dir, 'a.txt')) &&
            r.leer('a.txt') === (conCambios ? 'TRABAJO\n' : 'v1\n') &&
            enIndice === 'a.txt' &&
            pedidas() === 0,
          evidence: `res=${JSON.stringify(res)} pedidas=${pedidas()} indice=${JSON.stringify(enIndice)}`
        }
      })
    }
  }

  // (9f-bis) La ref BORRADA (no vacía): git la da por rama sin nacer, pero su registro de movimientos
  // dice que tuvo commits. Tampoco es «repo sin commits».
  {
    const r = repoCon('refborrada', { 'a.txt': 'v1\n' })
    rmSync(path.join(r.dir, '.git', 'refs', 'heads', 'main'))
    const { g, pedidas } = servicioQueConfirma(r.dir, silenciar)
    await comprobarSinExcepcion('(9f-bis) ref borrada con registro de movimientos -> error, sin confirmar, a.txt sigue', async () => {
      const res = await g.descartarCambios('a.txt')
      return {
        pass: res.ok === false && /rama/i.test(res.error ?? '') && existsSync(path.join(r.dir, 'a.txt')) && pedidas() === 0,
        evidence: `res=${JSON.stringify(res)} pedidas=${pedidas()}`
      }
    })
  }

  // (9g) Git que CONTESTA con un error definitivo no es «git no respondió»: la ref apunta a un
  // objeto que no existe, así que `ls-tree HEAD` sale con 128 y su stderr dice por qué.
  {
    const r = repoCon('refceros', { 'a.txt': 'v1\n' })
    r.escribirArchivo('a.txt', 'TRABAJO\n')
    writeFileSync(path.join(r.dir, '.git', 'refs', 'heads', 'main'), '0'.repeat(40) + '\n')
    const { g, pedidas } = servicioQueConfirma(r.dir, silenciar)
    await comprobarSinExcepcion('(9g) HEAD a un objeto inexistente -> «git falló: …» con el motivo, no «no respondió»', async () => {
      const res = await g.descartarCambios('a.txt')
      return {
        pass:
          res.ok === false &&
          /^Git falló/.test(res.error ?? '') &&
          !/no respondió/.test(res.error ?? '') &&
          r.leer('a.txt') === 'TRABAJO\n' &&
          pedidas() === 0,
        evidence: JSON.stringify(res)
      }
    })
  }
}


/** Commitea en `r` un enlace simbólico `ruta` -> `destino` sin crearlo en disco (vale con o sin `core.symlinks`). */
function commitearEnlace(r: ReturnType<typeof repoCon>, ruta: string, destino: string): void {
  const oid = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: r.dir, input: destino, encoding: 'utf8' }).trim()
  r.cli(['update-index', '--add', '--cacheinfo', `120000,${oid},${ruta}`])
  r.cli(['commit', '-q', '-m', `enlace ${ruta}`])
}

/**
 * (10) La copia del disco de un borrado preparado se compara por BYTES con lo que `checkout`
 * escribiría: ni un filtro clean con pérdida ni `ident` esconden trabajo, y ni el fin de línea ni
 * un enlace simbólico dan un falso rechazo. Y un `skip-worktree` se rechaza con un mensaje legible.
 */
async function casosDeLaCopiaDelDisco(silenciar: () => void): Promise<void> {
  hr('(10) copia del disco de un borrado preparado: bytes de checkout, no lo que git ve')

  // (10a) Filtro clean que QUITA líneas: git ve la copia igual a HEAD, pero sus líneas OUT no están en git.
  {
    const r = repoCon('filtro', { '.gitattributes': '*.nb filter=strip\n', 'c.nb': 'celda 1\n', 'limpio.nb': 'celda 1\n' })
    r.cli(['config', 'filter.strip.clean', "sed -e '/^OUT/d'"])
    r.cli(['config', 'filter.strip.smudge', 'cat'])
    r.escribirArchivo('c.nb', 'celda 1\nOUT tres horas de cálculo\n')
    r.cli(['rm', '-q', '--cached', 'c.nb', 'limpio.nb'])
    const { g, pedidas } = servicioQueConfirma(r.dir, silenciar)
    await comprobarSinExcepcion('(10a) filtro clean con pérdida -> error, las líneas OUT siguen en disco', async () => {
      const res = await g.descartarCambios('c.nb')
      return {
        pass: res.ok === false && /cambios/.test(res.error ?? '') && r.leer('c.nb') === 'celda 1\nOUT tres horas de cálculo\n' && pedidas() === 0,
        evidence: `res=${JSON.stringify(res)} disco=${JSON.stringify(r.leer('c.nb'))}`
      }
    })
    await comprobarSinExcepcion('(10a-bis) mismo filtro, copia igual a HEAD -> se restaura sin pedir borrarla', async () => {
      const res = await g.descartarCambios('limpio.nb')
      const indice = r.cli(['ls-files', '--', 'limpio.nb']).trim()
      return { pass: res.ok === true && indice === 'limpio.nb' && pedidas() === 0, evidence: `res=${JSON.stringify(res)} indice=${indice}` }
    })
  }

  // (10b) `ident`: el clean colapsa «$Id: … $» a «$Id$», así que lo escrito dentro no lo ve git.
  {
    const r = repoCon('ident', { '.gitattributes': '*.c ident\n', 'a.c': 'x $Id$\n' })
    r.escribirArchivo('a.c', 'x $Id: TRABAJO $\n')
    r.cli(['rm', '-q', '--cached', 'a.c'])
    const { g, pedidas } = servicioQueConfirma(r.dir, silenciar)
    await comprobarSinExcepcion('(10b) `ident` con texto dentro de $Id$ -> error, el texto sigue en disco', async () => {
      const res = await g.descartarCambios('a.c')
      return {
        pass: res.ok === false && r.leer('a.c') === 'x $Id: TRABAJO $\n' && pedidas() === 0,
        evidence: `res=${JSON.stringify(res)} disco=${JSON.stringify(r.leer('a.c'))}`
      }
    })
  }

  // (10c) `core.autocrlf=true`: un blob commiteado CON CRLF y su copia idéntica no es «con cambios»
  // (`hash-object` convertía la copia a LF y daba otro hash); un blob LF con la copia en CRLF, tampoco.
  {
    const r = repoCon('crlf', { 'crlf.txt': 'uno\r\ndos\r\n', 'lf.txt': 'uno\ndos\n' })
    r.cli(['config', 'core.autocrlf', 'true'])
    r.escribirArchivo('lf.txt', 'uno\r\ndos\r\n')
    r.cli(['rm', '-q', '--cached', 'crlf.txt', 'lf.txt'])
    const { g, pedidas } = servicioQueConfirma(r.dir, silenciar)
    for (const [ruta, contenido] of [
      ['crlf.txt', 'uno\r\ndos\r\n'],
      ['lf.txt', 'uno\r\ndos\r\n']
    ] as const) {
      await comprobarSinExcepcion(`(10c) autocrlf=true, ${ruta} idéntica a lo que escribe checkout -> se restaura`, async () => {
        const res = await g.descartarCambios(ruta)
        const indice = r.cli(['ls-files', '--', ruta]).trim()
        return {
          pass: res.ok === true && indice === ruta && r.leer(ruta) === contenido && pedidas() === 0,
          evidence: `res=${JSON.stringify(res)} indice=${indice} disco=${JSON.stringify(r.leer(ruta))}`
        }
      })
    }
  }

  // (10d) Enlace de HEAD con `core.symlinks=false`: en disco es un archivo con el destino.
  {
    const r = repoCon('enlace-texto', { 'obj.txt': 'o\n' })
    r.cli(['config', 'core.symlinks', 'false'])
    commitearEnlace(r, 'enlace', 'obj.txt')
    commitearEnlace(r, 'otro', 'obj.txt')
    r.cli(['checkout', '--', 'enlace', 'otro'])
    r.escribirArchivo('otro', 'destino cambiado')
    r.cli(['rm', '-q', '--cached', 'enlace', 'otro'])
    const { g, pedidas } = servicioQueConfirma(r.dir, silenciar)
    await comprobarSinExcepcion('(10d) enlace como archivo de texto, igual al blob -> se restaura con su modo', async () => {
      const res = await g.descartarCambios('enlace')
      const indice = r.cli(['ls-files', '-s', '--', 'enlace']).trim()
      return {
        pass: res.ok === true && indice.startsWith('120000 ') && r.leer('enlace') === 'obj.txt' && pedidas() === 0,
        evidence: `res=${JSON.stringify(res)} indice=${indice}`
      }
    })
    await comprobarSinExcepcion('(10d-bis) enlace como archivo con otro contenido -> error, el disco intacto', async () => {
      const res = await g.descartarCambios('otro')
      return { pass: res.ok === false && r.leer('otro') === 'destino cambiado', evidence: JSON.stringify(res) }
    })
  }

  // (10e) Enlace de verdad en disco (`core.symlinks=true`): se compara su destino. Si el sistema no
  // deja crear enlaces (Windows sin modo desarrollador), queda SIN VERIFICAR aquí.
  {
    const r = repoCon('enlace-real', { 'obj.txt': 'o\n' })
    r.cli(['config', 'core.symlinks', 'true'])
    let sePuede = true
    try {
      symlinkSync('obj.txt', path.join(r.dir, 'enlace'))
      symlinkSync('obj.txt', path.join(r.dir, 'otro'))
    } catch {
      sePuede = false
    }
    if (!sePuede) {
      console.log('  [SIN VERIFICAR] (10e) este sistema no deja crear enlaces simbólicos')
    } else {
      r.cli(['add', '--', 'enlace', 'otro'])
      r.cli(['commit', '-q', '-m', 'enlaces'])
      rmSync(path.join(r.dir, 'otro'))
      symlinkSync('cambiado.txt', path.join(r.dir, 'otro'))
      r.cli(['rm', '-q', '--cached', 'enlace', 'otro'])
      const { g, pedidas } = servicioQueConfirma(r.dir, silenciar)
      await comprobarSinExcepcion('(10e) enlace real con el destino de HEAD -> se restaura', async () => {
        const res = await g.descartarCambios('enlace')
        const indice = r.cli(['ls-files', '-s', '--', 'enlace']).trim()
        return {
          pass: res.ok === true && indice.startsWith('120000 ') && readlinkSync(path.join(r.dir, 'enlace')) === 'obj.txt' && pedidas() === 0,
          evidence: `res=${JSON.stringify(res)} indice=${indice}`
        }
      })
      await comprobarSinExcepcion('(10e-bis) enlace real a otro destino -> error, el enlace intacto', async () => {
        const res = await g.descartarCambios('otro')
        return { pass: res.ok === false && readlinkSync(path.join(r.dir, 'otro')) === 'cambiado.txt', evidence: JSON.stringify(res) }
      })
    }
  }

  // (10f) `skip-worktree`: checkout no lo toca y git solo decía «no casa con ningún archivo».
  {
    const r = repoCon('skipwt', { 'a.txt': 'a\n' })
    r.cli(['update-index', '--skip-worktree', 'a.txt'])
    r.escribirArchivo('a.txt', 'cambio local\n')
    const { g } = servicioQueConfirma(r.dir, silenciar)
    await comprobarSinExcepcion('(10f) archivo skip-worktree -> error legible que lo nombra, el disco intacto', async () => {
      const res = await g.descartarCambios('a.txt')
      return {
        pass: res.ok === false && /skip-worktree/.test(res.error ?? '') && !/pathspec/.test(res.error ?? '') && r.leer('a.txt') === 'cambio local\n',
        evidence: JSON.stringify(res)
      }
    })
  }
}

// =============================================================================
// Main
// =============================================================================
async function main(): Promise<void> {
  hr('PASO 0 - construir fixtures en dir temporal del SO')
  const repo = crearEscenario()
  const sinRepo = crearCarpetaSinRepo()
  const monorepo = crearMonorepo()
  console.log('repo:', repo)
  console.log('sinRepo:', sinRepo)

  const gitCli = (args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env } })
  const leerArchivo = (rel: string): string => readFileSync(path.join(repo, rel), 'utf8')
  const tieneRuta = (lista: CambioWorktree[], p: string): CambioWorktree | undefined =>
    lista.find((c) => c.ruta === p)

  try {
    const silenciar = (): void => {}
    // single repo, sin rutaContenedora -> prefijo identidad. `git` CONFIRMA y anota cada
    // pregunta (nombre y si borra): revertir a HEAD también pierde trabajo y pregunta.
    const preguntas: Array<{ nombre: string; borra: boolean }> = []
    const git = new ServicioGit({
      raizProyecto: repo,
      log: silenciar,
      confirmarDescarte: async (nombre, borra) => {
        preguntas.push({ nombre, borra })
        return true
      }
    })
    git.fijarRaizProyecto(repo)

    // Instancias con la confirmación destructiva INYECTADA (sin diálogo real),
    // para ejercitar las ramas de borrado (added-sin-HEAD, untracked) de forma
    // no-interactiva y determinista.
    const mkGit = (confirmar: boolean): InstanceType<typeof ServicioGit> => {
      const g = new ServicioGit({ raizProyecto: repo, log: silenciar, confirmarDescarte: async () => confirmar })
      g.fijarRaizProyecto(repo)
      return g
    }
    const gitYes = mkGit(true)
    const gitNo = mkGit(false)

    // -----------------------------------------------------------------------
    // (1) TRACKEADO modificado (unstaged) -> revierte a git, WT limpio.
    // -----------------------------------------------------------------------
    hr('(1) discard de un trackeado modificado sin stage -> confirma y vuelve a original')
    writeFileSync(path.join(repo, 'unstaged.txt'), 'MODIFICADO\n', 'utf8')

    const estadoPrevioPrimerDescarte = await git.leerEstadoWorktree()
    check(
      '(1a) leerEstadoWorktree() ve unstaged.txt como cambio (worktree M) antes de descartar',
      !!tieneRuta(estadoPrevioPrimerDescarte, 'unstaged.txt') && tieneRuta(estadoPrevioPrimerDescarte, 'unstaged.txt')!.estadoWorktree === 'M',
      JSON.stringify(tieneRuta(estadoPrevioPrimerDescarte, 'unstaged.txt') ?? null)
    )

    // (1-cancelar) revertir pierde lo no commiteado: se pregunta, y cancelar no toca el archivo.
    await comprobarSinExcepcion('(1-cancelar) revertir con la confirmación en NO -> ok:false sin error, el disco intacto', async () => {
      const res: ResultadoDescarteCambios = await gitNo.descartarCambios('unstaged.txt')
      return {
        pass: res.ok === false && res.error === undefined && leerArchivo('unstaged.txt') === 'MODIFICADO\n',
        evidence: `${JSON.stringify(res)} disco=${JSON.stringify(leerArchivo('unstaged.txt'))}`
      }
    })

    await comprobarSinExcepcion('(1b) descartarCambios(unstaged.txt) -> { ok:true, estabaSinSeguimiento:false }', async () => {
      const res: ResultadoDescarteCambios = await git.descartarCambios('unstaged.txt')
      return {
        pass: res.ok === true && res.estabaSinSeguimiento === false,
        evidence: JSON.stringify(res)
      }
    })
    check(
      '(1-pregunta) revertir pidió UNA confirmación, de revertir (no de borrar), con su nombre',
      preguntas.length === 1 && preguntas[0].nombre === 'unstaged.txt' && preguntas[0].borra === false,
      JSON.stringify(preguntas)
    )

    check(
      '(1c) el CONTENIDO en disco volvió a "original\\n"',
      leerArchivo('unstaged.txt') === 'original\n',
      JSON.stringify(leerArchivo('unstaged.txt'))
    )

    const estadoPosteriorPrimerDescarte = await git.leerEstadoWorktree()
    check(
      '(1d) leerEstadoWorktree() ya NO lista unstaged.txt (revertido)',
      !tieneRuta(estadoPosteriorPrimerDescarte, 'unstaged.txt'),
      `paths=${JSON.stringify(estadoPosteriorPrimerDescarte.map((c) => c.ruta))}`
    )

    // -----------------------------------------------------------------------
    // (2) TRACKEADO modificado y STAGED -> revierte a HEAD.
    //     `git checkout HEAD -- <path>` revierte WT E ÍNDICE a HEAD: la
    //     modificación staged YA NO sobrevive; el archivo sale de los cambios.
    // -----------------------------------------------------------------------
    hr('(2) discard de un trackeado STAGED -> checkout HEAD -- revierte a HEAD (limpio)')
    writeFileSync(path.join(repo, 'staged.txt'), 'MODIFICADO\n', 'utf8')
    gitCli(['add', 'staged.txt'])

    await comprobarSinExcepcion('(2a) descartarCambios(staged.txt) -> { ok:true, estabaSinSeguimiento:false }', async () => {
      const res: ResultadoDescarteCambios = await git.descartarCambios('staged.txt')
      return {
        pass: res.ok === true && res.estabaSinSeguimiento === false,
        evidence: JSON.stringify(res)
      }
    })

    check(
      '(2b) disco volvió al contenido de HEAD ("original\\n"): NO se queda en el índice',
      leerArchivo('staged.txt') === 'original\n',
      JSON.stringify(leerArchivo('staged.txt'))
    )

    check(
      '(2c) leerEstadoWorktree() ya NO lista staged.txt (índice Y working-tree limpios vs HEAD)',
      !tieneRuta(await git.leerEstadoWorktree(), 'staged.txt'),
      `staged.txt=${JSON.stringify(tieneRuta(await git.leerEstadoWorktree(), 'staged.txt') ?? null)}`
    )

    // -----------------------------------------------------------------------
    // (2-bis) STAGED + MÁS cambios unstaged encima -> todo vuelve a HEAD.
    // -----------------------------------------------------------------------
    hr('(2-bis) staged + unstaged encima -> checkout HEAD -- descarta ambos')
    writeFileSync(path.join(repo, 'staged.txt'), 'STAGED\n', 'utf8')
    gitCli(['add', 'staged.txt'])
    writeFileSync(path.join(repo, 'staged.txt'), 'STAGED+UNSTAGED\n', 'utf8') // más cambios sin stage

    await comprobarSinExcepcion('(2d) descartarCambios(staged.txt) con staged+unstaged -> ok:true', async () => {
      const res: ResultadoDescarteCambios = await git.descartarCambios('staged.txt')
      return {
        pass: res.ok === true && res.estabaSinSeguimiento === false,
        evidence: JSON.stringify(res)
      }
    })
    check(
      '(2e) disco = HEAD ("original\\n") y working-tree limpio (ambos ejes descartados)',
      leerArchivo('staged.txt') === 'original\n' && !tieneRuta(await git.leerEstadoWorktree(), 'staged.txt'),
      JSON.stringify(leerArchivo('staged.txt'))
    )

    // -----------------------------------------------------------------------
    // (3) TRACKEADO limpio (sin cambios) -> no-op, ok:true, intacto.
    // -----------------------------------------------------------------------
    hr('(3) discard de un trackeado SIN cambios -> no-op, ok:true')
    await comprobarSinExcepcion('(3a) descartarCambios(clean.txt) -> { ok:true, estabaSinSeguimiento:false }', async () => {
      const res: ResultadoDescarteCambios = await git.descartarCambios('clean.txt')
      return {
        pass: res.ok === true && res.estabaSinSeguimiento === false,
        evidence: JSON.stringify(res)
      }
    })
    check(
      '(3b) clean.txt sigue "original\\n" y no aparece en leerEstadoWorktree()',
      leerArchivo('clean.txt') === 'original\n' && !tieneRuta(await git.leerEstadoWorktree(), 'clean.txt'),
      JSON.stringify(leerArchivo('clean.txt'))
    )

    // -----------------------------------------------------------------------
    // (4) Sin repo activo -> { ok:false, estabaSinSeguimiento:false }, sin lanzar.
    // -----------------------------------------------------------------------
    hr('(4) discard sin repo activo (carpeta sin git) -> { ok:false, estabaSinSeguimiento:false }')
    await comprobarSinExcepcion('(4a) descartarCambios en carpeta sin git no lanza y devuelve ok:false', async () => {
      const g2 = new ServicioGit({ raizProyecto: sinRepo, log: silenciar })
      g2.fijarRaizProyecto(sinRepo)
      const res: ResultadoDescarteCambios = await g2.descartarCambios('x.txt')
      return {
        pass: res.ok === false && res.estabaSinSeguimiento === false,
        evidence: JSON.stringify(res)
      }
    })

    // -----------------------------------------------------------------------
    // (5) ADDED-but-never-committed (staged, HEAD no lo tiene): irrecuperable.
    //     Con confirmación INYECTADA (sin diálogo real).
    // -----------------------------------------------------------------------
    hr('(5) added-sin-HEAD (git add sin commit) -> confirmación -> rm --cached + borrado')

    // (5a) confirm=NO: no toca nada, sigue staged (A), ok:false.
    writeFileSync(path.join(repo, 'added_keep.txt'), 'nuevo\n', 'utf8')
    gitCli(['add', 'added_keep.txt'])
    await comprobarSinExcepcion('(5a) added-sin-HEAD, confirm NO -> { ok:false, estabaSinSeguimiento:false }, intacto', async () => {
      const res: ResultadoDescarteCambios = await gitNo.descartarCambios('added_keep.txt')
      const siguenPreparados = tieneRuta(await git.leerEstadoWorktree(), 'added_keep.txt')
      return {
        pass:
          res.ok === false &&
          res.estabaSinSeguimiento === false &&
          existsSync(path.join(repo, 'added_keep.txt')) &&
          !!siguenPreparados &&
          siguenPreparados.estadoIndice === 'A',
        evidence: `res=${JSON.stringify(res)} status=${JSON.stringify(siguenPreparados ?? null)}`
      }
    })

    // (5b) confirm=SÍ: des-stagea y borra del disco, sale de los cambios.
    writeFileSync(path.join(repo, 'added_new.txt'), 'nuevo\n', 'utf8')
    gitCli(['add', 'added_new.txt'])
    await comprobarSinExcepcion('(5b) added-sin-HEAD, confirm SÍ -> { ok:true, estabaSinSeguimiento:false }, borrado', async () => {
      const res: ResultadoDescarteCambios = await gitYes.descartarCambios('added_new.txt')
      return {
        pass:
          res.ok === true &&
          res.estabaSinSeguimiento === false &&
          !existsSync(path.join(repo, 'added_new.txt')) &&
          !tieneRuta(await git.leerEstadoWorktree(), 'added_new.txt'),
        evidence: `res=${JSON.stringify(res)} existe=${existsSync(path.join(repo, 'added_new.txt'))}`
      }
    })

    // -----------------------------------------------------------------------
    // (6) UNTRACKED: borrado del disco. Con confirmación INYECTADA.
    // -----------------------------------------------------------------------
    hr('(6) untracked -> confirmación -> borrado del disco (estabaSinSeguimiento:true)')

    // (6a) confirm=NO: intacto, ok:false, estabaSinSeguimiento:true.
    writeFileSync(path.join(repo, 'untracked_keep.txt'), 'suelto\n', 'utf8')
    await comprobarSinExcepcion('(6a) untracked, confirm NO -> { ok:false, estabaSinSeguimiento:true }, intacto', async () => {
      const res: ResultadoDescarteCambios = await gitNo.descartarCambios('untracked_keep.txt')
      return {
        pass: res.ok === false && res.estabaSinSeguimiento === true && existsSync(path.join(repo, 'untracked_keep.txt')),
        evidence: `res=${JSON.stringify(res)} existe=${existsSync(path.join(repo, 'untracked_keep.txt'))}`
      }
    })

    // (6b) confirm=SÍ: borrado, ok:true, estabaSinSeguimiento:true, fuera de los cambios.
    writeFileSync(path.join(repo, 'untracked_go.txt'), 'suelto\n', 'utf8')
    await comprobarSinExcepcion('(6b) untracked, confirm SÍ -> { ok:true, estabaSinSeguimiento:true }, borrado', async () => {
      const res: ResultadoDescarteCambios = await gitYes.descartarCambios('untracked_go.txt')
      return {
        pass:
          res.ok === true &&
          res.estabaSinSeguimiento === true &&
          !existsSync(path.join(repo, 'untracked_go.txt')) &&
          !tieneRuta(await git.leerEstadoWorktree(), 'untracked_go.txt'),
        evidence: `res=${JSON.stringify(res)} existe=${existsSync(path.join(repo, 'untracked_go.txt'))}`
      }
    })

    // -----------------------------------------------------------------------
    // (7) Ruta que no nombra un archivo: rechazada sin tocar nada, CON la
    //     confirmación en SÍ (si llegara a una rama de borrado, borraría).
    // -----------------------------------------------------------------------
    hr('(7) ruta vacía, ".", con "..", una carpeta o un glob -> nada revertido de más (también en un monorepo)')

    const app = path.join(monorepo, 'packages', 'app')
    writeFileSync(path.join(app, 'a.txt'), 'cambiado\n', 'utf8')
    writeFileSync(path.join(monorepo, 'fuera.txt'), 'cambiado\n', 'utf8')
    const gitMonorepo = new ServicioGit({ raizProyecto: app, log: silenciar, confirmarDescarte: async () => true })
    gitMonorepo.fijarRaizProyecto(app)
    for (const ruta of ['', '.', 'sub/..', '..']) {
      await comprobarSinExcepcion(`(7) monorepo, descartarCambios(${JSON.stringify(ruta)}) -> ok:false, intacto`, async () => {
        const res: ResultadoDescarteCambios = await gitMonorepo.descartarCambios(ruta)
        const a = readFileSync(path.join(app, 'a.txt'), 'utf8')
        const fuera = readFileSync(path.join(monorepo, 'fuera.txt'), 'utf8')
        return {
          pass: res.ok === false && a === 'cambiado\n' && fuera === 'cambiado\n',
          evidence: `res=${JSON.stringify(res)} a=${JSON.stringify(a)} fuera=${JSON.stringify(fuera)}`
        }
      })
    }

    // Una CARPETA con un archivo trackeado y modificado debajo: el pathspec casaría todo lo de
    // dentro y `checkout HEAD` lo revertiría entero. Con y sin barra final.
    mkdirSync(path.join(app, 'sub'), { recursive: true })
    writeFileSync(path.join(app, 'sub', 'c.txt'), 'original\n', 'utf8')
    const cliMonorepo = (args: string[]): string =>
      execFileSync('git', args, { cwd: monorepo, encoding: 'utf8', env: { ...process.env } })
    cliMonorepo(['add', '--', 'packages/app/sub/c.txt'])
    cliMonorepo(['commit', '-q', '-m', 'sub'])
    writeFileSync(path.join(app, 'sub', 'c.txt'), 'cambiado\n', 'utf8')
    for (const ruta of ['sub', 'sub/']) {
      await comprobarSinExcepcion(`(7) monorepo, descartarCambios(${JSON.stringify(ruta)}) de una CARPETA -> ok:false, c.txt intacto`, async () => {
        const res: ResultadoDescarteCambios = await gitMonorepo.descartarCambios(ruta)
        const c = readFileSync(path.join(app, 'sub', 'c.txt'), 'utf8')
        return {
          pass: res.ok === false && c === 'cambiado\n',
          evidence: `res=${JSON.stringify(res)} c=${JSON.stringify(c)}`
        }
      })
    }

    // Un nombre con corchetes: como glob, el pathspec casaría también al vecino `r1.txt`.
    writeFileSync(path.join(app, 'r1.txt'), 'original\n', 'utf8')
    writeFileSync(path.join(app, 'r[1].txt'), 'original\n', 'utf8')
    cliMonorepo(['add', '--', 'packages/app/r1.txt', 'packages/app/r[1].txt'])
    cliMonorepo(['commit', '-q', '-m', 'glob'])
    writeFileSync(path.join(app, 'r1.txt'), 'cambiado\n', 'utf8')
    writeFileSync(path.join(app, 'r[1].txt'), 'cambiado\n', 'utf8')
    await comprobarSinExcepcion('(7) monorepo, descartarCambios("r[1].txt") revierte SOLO ese archivo, no al vecino r1.txt', async () => {
      const res: ResultadoDescarteCambios = await gitMonorepo.descartarCambios('r[1].txt')
      const glob = readFileSync(path.join(app, 'r[1].txt'), 'utf8')
      const vecino = readFileSync(path.join(app, 'r1.txt'), 'utf8')
      return {
        pass: res.ok === true && glob === 'original\n' && vecino === 'cambiado\n',
        evidence: `res=${JSON.stringify(res)} glob=${JSON.stringify(glob)} vecino=${JSON.stringify(vecino)}`
      }
    })

    writeFileSync(path.join(repo, 'clean.txt'), 'tocado\n', 'utf8')
    await comprobarSinExcepcion('(7) repo simple, descartarCambios(".") -> ok:false, no revierte el repo', async () => {
      const res: ResultadoDescarteCambios = await gitYes.descartarCambios('.')
      return {
        pass: res.ok === false && leerArchivo('clean.txt') === 'tocado\n',
        evidence: `res=${JSON.stringify(res)} clean=${JSON.stringify(leerArchivo('clean.txt'))}`
      }
    })

    // -----------------------------------------------------------------------
    // (8) Cada rechazo lleva `error` para el usuario; cancelar NO es error. Si
    //     git no contesta, se aborta sin borrar (aunque se confirme).
    // -----------------------------------------------------------------------
    hr('(8) rechazos con `error`, cancelar sin él, y git que no contesta -> nada borrado')

    writeFileSync(path.join(repo, 'cancelado.txt'), 'suelto\n', 'utf8')
    await comprobarSinExcepcion('(8a) cancelar la confirmación -> ok:false SIN error', async () => {
      const res: ResultadoDescarteCambios = await gitNo.descartarCambios('cancelado.txt')
      return { pass: res.ok === false && res.error === undefined, evidence: JSON.stringify(res) }
    })
    for (const ruta of ['', '.', 'sub/']) {
      await comprobarSinExcepcion(`(8b) descartarCambios(${JSON.stringify(ruta)}) -> error «Ruta no válida.»`, async () => {
        const res: ResultadoDescarteCambios = await gitYes.descartarCambios(ruta)
        return { pass: res.ok === false && res.error === 'Ruta no válida.', evidence: JSON.stringify(res) }
      })
    }
    await comprobarSinExcepcion('(8c) sin repo activo -> error legible', async () => {
      const g2 = new ServicioGit({ raizProyecto: sinRepo, log: silenciar })
      g2.fijarRaizProyecto(sinRepo)
      const res: ResultadoDescarteCambios = await g2.descartarCambios('x.txt')
      return { pass: res.ok === false && (res.error ?? '').length > 0, evidence: JSON.stringify(res) }
    })
    await comprobarSinExcepcion('(8d) carpeta RASTREADA sin barra -> error «Es una carpeta…», c.txt intacto', async () => {
      const res: ResultadoDescarteCambios = await gitMonorepo.descartarCambios('sub')
      const c = readFileSync(path.join(app, 'sub', 'c.txt'), 'utf8')
      return {
        pass: res.ok === false && /carpeta/i.test(res.error ?? '') && c === 'cambiado\n',
        evidence: `res=${JSON.stringify(res)} c=${JSON.stringify(c)}`
      }
    })
    mkdirSync(path.join(app, 'suelta'), { recursive: true })
    writeFileSync(path.join(app, 'suelta', 'n.txt'), 'suelto\n', 'utf8')
    await comprobarSinExcepcion('(8e) carpeta SIN SEGUIMIENTO, confirmando -> error «Es una carpeta…», intacta', async () => {
      const res: ResultadoDescarteCambios = await gitMonorepo.descartarCambios('suelta')
      return {
        pass: res.ok === false && /carpeta/i.test(res.error ?? '') && existsSync(path.join(app, 'suelta', 'n.txt')),
        evidence: JSON.stringify(res)
      }
    })

    writeFileSync(path.join(repo, 'sin_respuesta.txt'), 'suelto\n', 'utf8')
    await comprobarSinExcepcion('(8f) `ls-files` no contesta, confirmando -> error, el archivo sigue', async () => {
      const g = mkGit(true)
      fallarSubcomandos(g, ['ls-files'])
      const res: ResultadoDescarteCambios = await g.descartarCambios('sin_respuesta.txt')
      return {
        pass: res.ok === false && /no respondió/.test(res.error ?? '') && existsSync(path.join(repo, 'sin_respuesta.txt')),
        evidence: JSON.stringify(res)
      }
    })
    writeFileSync(path.join(repo, 'unstaged.txt'), 'TRABAJO\n', 'utf8')
    await comprobarSinExcepcion('(8g) la consulta de HEAD falla CON HEAD, confirmando -> error, ni borrado ni fuera del índice', async () => {
      const g = mkGit(true)
      fallarSubcomandos(g, ['ls-tree', 'cat-file'])
      const res: ResultadoDescarteCambios = await g.descartarCambios('unstaged.txt')
      const enIndice = gitCli(['ls-files', '--', 'unstaged.txt']).trim()
      return {
        pass:
          res.ok === false &&
          /no respondió/.test(res.error ?? '') &&
          existsSync(path.join(repo, 'unstaged.txt')) &&
          leerArchivo('unstaged.txt') === 'TRABAJO\n' &&
          enIndice === 'unstaged.txt',
        evidence: `res=${JSON.stringify(res)} existe=${existsSync(path.join(repo, 'unstaged.txt'))} indice=${JSON.stringify(enIndice)}`
      }
    })

    // Un repo SIN commits: `ls-tree HEAD` falla y eso significa «nada en HEAD», no un error.
    const vacio = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-discard-vacio-')))
    temporales.push(vacio)
    execFileSync('git', ['init', '-b', 'main'], { cwd: vacio, encoding: 'utf8' })
    writeFileSync(path.join(vacio, 'primero.txt'), 'nuevo\n', 'utf8')
    execFileSync('git', ['add', '--', 'primero.txt'], { cwd: vacio, encoding: 'utf8' })
    await comprobarSinExcepcion('(8h) repo sin commits: un añadido se descarta (confirmando) y se borra', async () => {
      const g = new ServicioGit({ raizProyecto: vacio, log: silenciar, confirmarDescarte: async () => true })
      g.fijarRaizProyecto(vacio)
      const res: ResultadoDescarteCambios = await g.descartarCambios('primero.txt')
      return {
        pass: res.ok === true && res.estabaSinSeguimiento === false && !existsSync(path.join(vacio, 'primero.txt')),
        evidence: JSON.stringify(res)
      }
    })

    await casosQuePerdianDatos(silenciar)
    await casosDeLaCopiaDelDisco(silenciar)
  } finally {
    hr('PASO FINAL - limpieza (borrar los fixtures temporales)')
    for (const dir of [repo, sinRepo, monorepo, ...temporales]) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
        console.log('fixture temporal eliminado:', dir)
      } catch (err) {
        console.log('AVISO: no se pudo borrar el temporal (no afecta al veredicto):', String(err))
      }
    }
  }

  // -------------------------------------------------------------------------
  // Resumen
  // -------------------------------------------------------------------------
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

main().catch((err: unknown) => {
  console.error('[FAIL] Error inesperado:', err)
  process.exit(1)
})
