#!/usr/bin/env node
// =============================================================================
// Prueba de `stageFile`, `unstageFile`, `commit` e `indexBlob` de GitService (npm run
// test:git-stage) en repos temporales: preparar un rastreado y un archivo nuevo, quitarlo del
// índice sin tocar el disco, el blob del índice, y el commit (correcto, sin nada preparado, con
// mensaje vacío y sin repo activo). En un monorepo, una ruta vacía, `.`, con `..` o una carpeta
// (con o sin barra) no prepara ni quita nada, y un error de git se distingue de un git que no
// respondió. El fixture configura el autor y se autolimpia.
// =============================================================================

import { execFileSync } from 'node:child_process'
import { register } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import type { WorkingChange, WriteResult, CommitResult, BlobResult } from '../../shared/git-ipc.ts'

// El código de producción importa sin extensión: este hook reintenta con `.ts`.
const resolveTsHook = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook))
const { GitService } = await import('./GitService.ts')

// =============================================================================
// Reporte PASS/FAIL (mismo patrón que test-discard.mts)
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
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
async function checkThrows(
  name: string,
  fn: () => Promise<{ pass: boolean; evidence: string }>
): Promise<void> {
  try {
    const { pass, evidence } = await fn()
    check(name, pass, evidence)
  } catch (err) {
    check(name, false, `LANZÓ: ${errMsg(err)}`)
  }
}

// =============================================================================
// Fixture: repo con un commit base (base.txt) y user.name/email configurados
// (imprescindible para que commit() no falle por "who are you").
// =============================================================================
function buildFixture(): string {
  const repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-stage-test-')))

  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env } })

  const put = (rel: string, content: string): void => {
    writeFileSync(path.join(repo, rel), content, 'utf8') // UTF-8 sin BOM, LF
  }

  git(['init', '-b', 'main'])
  git(['config', 'user.name', 'Fixture Bot'])
  git(['config', 'user.email', 'fixture@example.com'])
  git(['config', 'core.autocrlf', 'false']) // blobs deterministas (LF)
  git(['config', 'commit.gpgsign', 'false'])

  put('base.txt', 'original\n')
  git(['add', '-A'])
  git(['commit', '-m', 'base'])

  return repo
}

/** Monorepo: el repo cuelga por encima de la carpeta abierta (`packages/app`). */
function buildMonorepo(): string {
  const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-stage-mono-')))
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: raiz, encoding: 'utf8', env: { ...process.env } })
  mkdirSync(path.join(raiz, 'packages', 'app'), { recursive: true })
  git(['init', '-b', 'main'])
  git(['config', 'user.name', 'Fixture Bot'])
  git(['config', 'user.email', 'fixture@example.com'])
  git(['config', 'core.autocrlf', 'false'])
  git(['config', 'commit.gpgsign', 'false'])
  writeFileSync(path.join(raiz, 'packages', 'app', 'a.txt'), 'original\n', 'utf8')
  git(['add', '-A'])
  git(['commit', '-m', 'base'])
  return raiz
}

/** Crea un dir temporal SIN git (para el caso "sin repo activo"). */
function buildNonRepo(): string {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-stage-norepo-')))
  writeFileSync(path.join(dir, 'x.txt'), 'sin git\n', 'utf8')
  return dir
}

// =============================================================================
// Main
// =============================================================================
async function main(): Promise<void> {
  hr('PASO 0 - construir fixtures en dir temporal del SO')
  const repo = buildFixture()
  const nonRepo = buildNonRepo()
  const mono = buildMonorepo()
  console.log('repo:', repo)
  console.log('nonRepo:', nonRepo)

  const gitCli = (args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env } })
  const read = (rel: string): string => readFileSync(path.join(repo, rel), 'utf8')
  const hasPath = (list: WorkingChange[], p: string): WorkingChange | undefined =>
    list.find((c) => c.path === p)

  try {
    const silent = (): void => {}
    // single repo, sin containerPath -> prefijo identidad.
    const git = new GitService({ projectRoot: repo, log: silent })
    git.setProjectRoot(repo)

    // -----------------------------------------------------------------------
    // (1) stageFile de un trackeado modificado -> indexStatus != '.'.
    // -----------------------------------------------------------------------
    hr('(1) stageFile de un trackeado modificado -> pasa a staged (indexStatus M)')
    writeFileSync(path.join(repo, 'base.txt'), 'MODIFICADO\n', 'utf8')

    const pre1 = await git.workingStatus()
    check(
      '(1a) base.txt visible como unstaged (worktree M) antes de stagear',
      !!hasPath(pre1, 'base.txt') &&
        hasPath(pre1, 'base.txt')!.indexStatus === '.' &&
        hasPath(pre1, 'base.txt')!.worktreeStatus === 'M',
      JSON.stringify(hasPath(pre1, 'base.txt') ?? null)
    )

    await checkThrows('(1b) stageFile(base.txt) -> { ok:true }', async () => {
      const res: WriteResult = await git.stageFile('base.txt')
      return { pass: res.ok === true, evidence: JSON.stringify(res) }
    })

    const post1 = await git.workingStatus()
    check(
      '(1c) base.txt ahora staged (indexStatus M, worktree limpio)',
      !!hasPath(post1, 'base.txt') &&
        hasPath(post1, 'base.txt')!.indexStatus === 'M' &&
        hasPath(post1, 'base.txt')!.worktreeStatus === '.',
      JSON.stringify(hasPath(post1, 'base.txt') ?? null)
    )

    // -----------------------------------------------------------------------
    // (2) stageFile de un untracked -> aparece staged (indexStatus 'A').
    // -----------------------------------------------------------------------
    hr('(2) stageFile de un untracked -> staged como alta (indexStatus A)')
    writeFileSync(path.join(repo, 'nuevo.txt'), 'contenido nuevo\n', 'utf8')

    const pre2 = await git.workingStatus()
    check(
      '(2a) nuevo.txt visible como untracked (worktree ?) antes de stagear',
      !!hasPath(pre2, 'nuevo.txt') && hasPath(pre2, 'nuevo.txt')!.worktreeStatus === '?',
      JSON.stringify(hasPath(pre2, 'nuevo.txt') ?? null)
    )

    await checkThrows('(2b) stageFile(nuevo.txt) -> { ok:true }', async () => {
      const res: WriteResult = await git.stageFile('nuevo.txt')
      return { pass: res.ok === true, evidence: JSON.stringify(res) }
    })

    const post2 = await git.workingStatus()
    check(
      '(2c) nuevo.txt ahora staged como alta (indexStatus A)',
      !!hasPath(post2, 'nuevo.txt') && hasPath(post2, 'nuevo.txt')!.indexStatus === 'A',
      JSON.stringify(hasPath(post2, 'nuevo.txt') ?? null)
    )

    // -----------------------------------------------------------------------
    // (3) unstageFile -> vuelve a unstaged, disco intacto.
    // -----------------------------------------------------------------------
    hr('(3) unstageFile(base.txt) -> vuelve a unstaged, el archivo NO se borra')
    await checkThrows('(3a) unstageFile(base.txt) -> { ok:true }', async () => {
      const res: WriteResult = await git.unstageFile('base.txt')
      return { pass: res.ok === true, evidence: JSON.stringify(res) }
    })

    const post3 = await git.workingStatus()
    check(
      '(3b) base.txt vuelve a unstaged (indexStatus ".", worktree M)',
      !!hasPath(post3, 'base.txt') &&
        hasPath(post3, 'base.txt')!.indexStatus === '.' &&
        hasPath(post3, 'base.txt')!.worktreeStatus === 'M',
      JSON.stringify(hasPath(post3, 'base.txt') ?? null)
    )
    check(
      '(3c) base.txt sigue en disco con su contenido modificado (unstage no borra)',
      existsSync(path.join(repo, 'base.txt')) && read('base.txt') === 'MODIFICADO\n',
      `existe=${existsSync(path.join(repo, 'base.txt'))} contenido=${JSON.stringify(read('base.txt'))}`
    )

    // -----------------------------------------------------------------------
    // (4) indexBlob -> versión STAGED (no la de disco); no staged -> exists:false.
    // -----------------------------------------------------------------------
    hr('(4) indexBlob devuelve la versión del ÍNDICE, no la de disco')
    // Stagea base.txt con contenido X, luego modifícalo MÁS en disco (Y).
    writeFileSync(path.join(repo, 'base.txt'), 'VERSION_STAGED\n', 'utf8')
    gitCli(['add', 'base.txt']) // índice = VERSION_STAGED
    writeFileSync(path.join(repo, 'base.txt'), 'VERSION_DISCO\n', 'utf8') // disco = VERSION_DISCO (sin stagear)

    await checkThrows('(4a) indexBlob(base.txt) -> { exists:true, content: staged (no disco) }', async () => {
      const blob: BlobResult = await git.indexBlob('base.txt')
      return {
        pass: blob.exists === true && blob.content === 'VERSION_STAGED\n',
        evidence: JSON.stringify(blob)
      }
    })

    // clean.txt existe en HEAD pero no está staged con cambios: su versión de
    // índice coincide con HEAD -> git show :clean.txt SÍ existe. Para probar
    // exists:false usamos un path que git no conoce en absoluto.
    await checkThrows('(4b) indexBlob de un path inexistente -> { exists:false }', async () => {
      const blob: BlobResult = await git.indexBlob('no-existe-jamas.txt')
      return {
        pass: blob.exists === false && blob.content === '',
        evidence: JSON.stringify(blob)
      }
    })

    // Deja base.txt limpio para no arrastrar ruido al check de WT limpio de (5).
    gitCli(['checkout', 'HEAD', '--', 'base.txt'])

    // -----------------------------------------------------------------------
    // (5) commit exitoso -> { ok:true, hash }, WT limpio de lo commiteado.
    // -----------------------------------------------------------------------
    hr('(5) commit de algo staged -> { ok:true, hash }, working-tree limpio')
    // nuevo.txt sigue staged desde (2). Confirmamos y commiteamos.
    let committedHash = ''
    await checkThrows('(5a) commit("mensaje test") -> { ok:true, hash: <sha> }', async () => {
      const res: CommitResult = await git.commit('mensaje test')
      committedHash = res.hash ?? ''
      return {
        pass: res.ok === true && typeof res.hash === 'string' && /^[0-9a-f]{40}$/.test(res.hash),
        evidence: JSON.stringify(res)
      }
    })

    check(
      '(5b) git log muestra el commit creado con su mensaje',
      (() => {
        const log = gitCli(['log', '-1', '--format=%H%x00%s']).trim()
        const [hash, subject] = log.split('\x00')
        return hash === committedHash && subject === 'mensaje test'
      })(),
      gitCli(['log', '-1', '--format=%H %s']).trim()
    )

    check(
      '(5c) working-tree ya no lista nuevo.txt (commiteado -> limpio)',
      !hasPath(await git.workingStatus(), 'nuevo.txt'),
      `paths=${JSON.stringify((await git.workingStatus()).map((c) => c.path))}`
    )

    // -----------------------------------------------------------------------
    // (6) commit sin nada staged -> { ok:false, error }, sin lanzar.
    // -----------------------------------------------------------------------
    hr('(6) commit con NADA staged -> { ok:false, error legible }, sin lanzar')
    check(
      '(6-pre) working-tree limpio (nada staged) antes del commit vacío',
      (await git.workingStatus()).length === 0,
      `paths=${JSON.stringify((await git.workingStatus()).map((c) => c.path))}`
    )
    await checkThrows('(6a) commit("x") sin nada staged -> { ok:false, error }', async () => {
      const res: CommitResult = await git.commit('x')
      return {
        pass: res.ok === false && typeof res.error === 'string' && res.error.length > 0,
        evidence: JSON.stringify(res)
      }
    })

    // -----------------------------------------------------------------------
    // (7) commit con mensaje vacío -> { ok:false, error }, sin tocar git.
    // -----------------------------------------------------------------------
    hr('(7) commit con mensaje vacío ("  ") -> { ok:false, error }, sin llamar a git')
    await checkThrows('(7a) commit("  ") -> { ok:false, error }', async () => {
      const res: CommitResult = await git.commit('  ')
      return {
        pass: res.ok === false && typeof res.error === 'string' && res.error.length > 0,
        evidence: JSON.stringify(res)
      }
    })

    // -----------------------------------------------------------------------
    // (8) sin repo activo -> { ok:false, error }, sin lanzar.
    // -----------------------------------------------------------------------
    hr('(8) stage/commit sin repo activo (carpeta sin git) -> { ok:false, error }')
    await checkThrows('(8a) stageFile en carpeta sin git -> { ok:false, error }, no lanza', async () => {
      const g2 = new GitService({ projectRoot: nonRepo, log: silent })
      g2.setProjectRoot(nonRepo)
      const res: WriteResult = await g2.stageFile('x.txt')
      return {
        pass: res.ok === false && typeof res.error === 'string' && res.error.length > 0,
        evidence: JSON.stringify(res)
      }
    })
    await checkThrows('(8b) commit en carpeta sin git -> { ok:false, error }, no lanza', async () => {
      const g2 = new GitService({ projectRoot: nonRepo, log: silent })
      g2.setProjectRoot(nonRepo)
      const res: CommitResult = await g2.commit('algo')
      return {
        pass: res.ok === false && typeof res.error === 'string' && res.error.length > 0,
        evidence: JSON.stringify(res)
      }
    })

    // -----------------------------------------------------------------------
    // (9) Monorepo: una ruta que no nombra un archivo no prepara ni quita la
    //     carpeta abierta entera.
    // -----------------------------------------------------------------------
    hr('(9) monorepo: stage/unstage de "", ".", con ".." o de una carpeta "sub/" -> "Ruta no válida.", índice intacto')
    const app = path.join(mono, 'packages', 'app')
    const monoCli = (args: string[]): string =>
      execFileSync('git', args, { cwd: mono, encoding: 'utf8', env: { ...process.env } })
    writeFileSync(path.join(app, 'a.txt'), 'cambiado\n', 'utf8')
    writeFileSync(path.join(app, 'b.txt'), 'preparado\n', 'utf8')
    monoCli(['add', '--', 'packages/app/b.txt'])
    const gitMono = new GitService({ projectRoot: app, log: silent })
    gitMono.setProjectRoot(app)
    const preparados = (): string => monoCli(['diff', '--cached', '--name-only']).trim()
    for (const ruta of ['', '.', 'sub/..', '..', 'sub/']) {
      await checkThrows(`(9) stageFile(${JSON.stringify(ruta)}) -> rechazada, a.txt sin preparar`, async () => {
        const res: WriteResult = await gitMono.stageFile(ruta)
        return {
          pass: res.ok === false && res.error === 'Ruta no válida.' && preparados() === 'packages/app/b.txt',
          evidence: `res=${JSON.stringify(res)} preparados=${JSON.stringify(preparados())}`
        }
      })
      await checkThrows(`(9) unstageFile(${JSON.stringify(ruta)}) -> rechazada, b.txt sigue preparado`, async () => {
        const res: WriteResult = await gitMono.unstageFile(ruta)
        return {
          pass: res.ok === false && res.error === 'Ruta no válida.' && preparados() === 'packages/app/b.txt',
          evidence: `res=${JSON.stringify(res)} preparados=${JSON.stringify(preparados())}`
        }
      })
    }

    // Un nombre con corchetes: como glob, `add` prepararía también al vecino `r1.txt`.
    writeFileSync(path.join(app, 'r1.txt'), 'uno\n', 'utf8')
    writeFileSync(path.join(app, 'r[1].txt'), 'dos\n', 'utf8')
    await checkThrows('(9) stageFile("r[1].txt") prepara SOLO ese archivo, no al vecino r1.txt', async () => {
      const res: WriteResult = await gitMono.stageFile('r[1].txt')
      const lista = preparados().split(/\r?\n/).sort().join(',')
      return {
        pass: res.ok === true && lista === 'packages/app/b.txt,packages/app/r[1].txt',
        evidence: `res=${JSON.stringify(res)} preparados=${JSON.stringify(lista)}`
      }
    })

    // -----------------------------------------------------------------------
    // (10) Una CARPETA sin barra final no se prepara ni se quita entera: el gesto
    //      es de un archivo. Rastreada, sin seguimiento, y la contraprueba de que
    //      un archivo borrado del disco o un borrado preparado siguen funcionando.
    // -----------------------------------------------------------------------
    hr('(10) monorepo: stage/unstage de una carpeta SIN barra -> rechazada, índice intacto')
    mkdirSync(path.join(app, 'sub'), { recursive: true })
    writeFileSync(path.join(app, 'sub', 'x.txt'), 'original\n', 'utf8')
    writeFileSync(path.join(app, 'sub', 'y.txt'), 'original\n', 'utf8')
    monoCli(['add', '--', 'packages/app/sub/x.txt', 'packages/app/sub/y.txt'])
    monoCli(['commit', '-q', '-m', 'sub'])
    writeFileSync(path.join(app, 'sub', 'x.txt'), 'cambiado\n', 'utf8')
    writeFileSync(path.join(app, 'sub', 'nuevo.txt'), 'suelto\n', 'utf8')
    mkdirSync(path.join(app, 'suelta'), { recursive: true })
    writeFileSync(path.join(app, 'suelta', 'n.txt'), 'suelto\n', 'utf8')
    const antes = preparados()
    for (const carpeta of ['sub', 'suelta']) {
      await checkThrows(`(10) stageFile(${JSON.stringify(carpeta)}) -> «Es una carpeta…», nada preparado`, async () => {
        const res: WriteResult = await gitMono.stageFile(carpeta)
        return {
          pass: res.ok === false && /carpeta/i.test(res.error ?? '') && preparados() === antes,
          evidence: `res=${JSON.stringify(res)} preparados=${JSON.stringify(preparados())}`
        }
      })
    }
    monoCli(['add', '--', 'packages/app/sub/x.txt'])
    const conX = preparados()
    await checkThrows('(10) unstageFile("sub") -> «Es una carpeta…», sub/x.txt sigue preparado', async () => {
      const res: WriteResult = await gitMono.unstageFile('sub')
      return {
        pass: res.ok === false && /carpeta/i.test(res.error ?? '') && preparados() === conX,
        evidence: `res=${JSON.stringify(res)} preparados=${JSON.stringify(preparados())}`
      }
    })
    rmSync(path.join(app, 'sub', 'y.txt'))
    await checkThrows('(10) stageFile de un archivo BORRADO del disco sigue preparando el borrado', async () => {
      const res: WriteResult = await gitMono.stageFile('sub/y.txt')
      const lista = preparados()
      return {
        pass: res.ok === true && lista.split(/\r?\n/).includes('packages/app/sub/y.txt'),
        evidence: `res=${JSON.stringify(res)} preparados=${JSON.stringify(lista)}`
      }
    })
    await checkThrows('(10) unstageFile de un borrado preparado (fuera del índice) sigue funcionando', async () => {
      const res: WriteResult = await gitMono.unstageFile('sub/y.txt')
      const lista = preparados()
      return {
        pass: res.ok === true && !lista.split(/\r?\n/).includes('packages/app/sub/y.txt'),
        evidence: `res=${JSON.stringify(res)} preparados=${JSON.stringify(lista)}`
      }
    })

    // -----------------------------------------------------------------------
    // (11) La comprobación previa falla: si git CONTESTÓ con un error, se dice cuál; si no
    //      contestó (sin código de salida: techo, cola), «no respondió». Nada se prepara.
    // -----------------------------------------------------------------------
    hr('(11) comprobación previa que falla: «git falló: …» con el motivo, o «no respondió»')
    writeFileSync(path.join(repo, 'base.txt'), 'otra vez\n', 'utf8')
    const conFallo = (fallo: () => Error): InstanceType<typeof GitService> => {
      const g = new GitService({ projectRoot: repo, log: silent })
      g.setProjectRoot(repo)
      type Git = (args: string[], ...resto: unknown[]) => Promise<{ stdout: string; stderr: string }>
      const nucleo = (g as unknown as { n: { git: Git } }).n
      const original = nucleo.git.bind(nucleo)
      nucleo.git = async (args, ...resto) => {
        if (args[0] === 'ls-files') throw fallo()
        return original(args, ...resto)
      }
      return g
    }
    const conCodigo = (): Error =>
      Object.assign(new Error('Command failed: git ls-files'), { code: 128, stderr: 'fatal: index file corrupt\n' })
    await checkThrows('(11a) git sale con 128 -> «git falló: fatal: index file corrupt», nada preparado', async () => {
      const res: WriteResult = await conFallo(conCodigo).stageFile('base.txt')
      const preparado = gitCli(['diff', '--cached', '--name-only']).trim()
      return {
        pass: res.ok === false && res.error === 'git falló: fatal: index file corrupt' && preparado === '',
        evidence: `res=${JSON.stringify(res)} preparado=${JSON.stringify(preparado)}`
      }
    })
    const sinCodigo = (): Error => Object.assign(new Error('timeout'), { killed: true, signal: 'SIGKILL' })
    await checkThrows('(11b) git matado por el techo -> «git no respondió…», nada preparado', async () => {
      const res: WriteResult = await conFallo(sinCodigo).stageFile('base.txt')
      return { pass: res.ok === false && /no respondió/.test(res.error ?? ''), evidence: JSON.stringify(res) }
    })
  } finally {
    hr('PASO FINAL - limpieza (borrar los fixtures temporales)')
    for (const dir of [repo, nonRepo, mono]) {
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
