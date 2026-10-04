#!/usr/bin/env node
// =============================================================================
// Prueba de `workingStatus` y `workingBlob` de GitService (npm run test:git-working) contra un
// repo temporal con archivos en todos los estados del working-tree: alta y modificado preparados,
// modificado y borrado sin preparar, rename preparado y sin seguimiento. Se autolimpia.
// Solo Node core + GitService, llamando a los métodos públicos.
// =============================================================================

import { execFileSync } from 'node:child_process'
import { register } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import type { WorkingChange } from '../../shared/git-ipc.ts'

// El código de producción importa sin extensión: este hook reintenta con `.ts`. Se registra ANTES
// de cargar GitService, de ahí el import dinámico (los estáticos se hoistean).
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
// Reporte PASS/FAIL (mismo patrón que test-git.mts)
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

// Fixture. Commit base: mod_unstaged, mod_staged, del, rename_me y untouched. Sin commitear:
// mod_unstaged modificado (M sin preparar), mod_staged modificado y preparado (M preparado), del
// borrado (D sin preparar), rename_me renombrado a renamed con `git mv` (R preparado),
// untracked_new (sin seguimiento) y add_staged nuevo y preparado (A preparado).
function buildFixture(): string {
  const repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-wt-test-')))

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

  // --- commit base con los cinco archivos ---
  put('mod_unstaged.txt', 'linea1\nlinea2\n')
  put('mod_staged.txt', 'a\n')
  put('del.txt', 'borrar\n')
  put('rename_me.txt', 'viejo nombre\n')
  put('untouched.txt', 'base\n')
  git(['add', '-A'])
  git(['commit', '-m', 'base'])

  // --- genera CADA estado del working-tree, sin commitear ---
  put('mod_unstaged.txt', 'linea1\nMODIFICADA\n') // M, sin stage
  put('mod_staged.txt', 'a\nb\n')
  git(['add', 'mod_staged.txt']) // M, staged
  rmSync(path.join(repo, 'del.txt')) // D, sin stage
  git(['mv', 'rename_me.txt', 'renamed.txt']) // R, staged
  put('untracked_new.txt', 'nuevo\n') // untracked
  put('add_staged.txt', 'STAGED\n')
  git(['add', 'add_staged.txt']) // A, staged

  // CARPETA entera sin trackear. Con el `-unormal` por defecto, git la COLAPSA en
  // una sola entrada "tests/" y abrir su diff reventaba con EISDIR. Con `-uall`
  // debe enumerar sus DOS archivos por separado. (Pasó con una carpeta `tests/` sin seguimiento.)
  mkdirSync(path.join(repo, 'tests'))
  put(path.join('tests', 'test_a.py'), 'a\n')
  put(path.join('tests', 'test_b.py'), 'b\n')

  return repo
}

// =============================================================================
// Main
// =============================================================================
async function main(): Promise<void> {
  hr('PASO 0 - construir fixture del working-tree en dir temporal del SO')
  const repo = buildFixture()
  console.log('repo:', repo)

  try {
    const silent = (): void => {}
    // single repo, sin containerPath -> prefijo identidad.
    const git = new GitService({ projectRoot: repo, log: silent })
    git.setProjectRoot(repo)

    // -----------------------------------------------------------------------
    // workingStatus()
    // -----------------------------------------------------------------------
    hr('workingStatus() — dos ejes (index/worktree) por archivo')
    let changes: WorkingChange[] = []
    let statusErr: unknown = null
    try {
      changes = await git.workingStatus()
    } catch (err) {
      statusErr = err
    }

    const byPath = new Map<string, WorkingChange>()
    for (const c of changes) byPath.set(c.path, c)

    // (1) exactamente 8 entradas: los 6 estados clásicos + los DOS archivos de la
    // carpeta `tests/` sin trackear (con -uall van uno a uno, no colapsados).
    check(
      '(1) workingStatus() devuelve 8 entradas',
      statusErr === null && changes.length === 8,
      statusErr ? `LANZÓ: ${errMsg(statusErr)}` : `n=${changes.length} paths=${JSON.stringify([...byPath.keys()])}`
    )

    // helper de aserción por path (index/worktree, oldPath opcional)
    const expect = (
      name: string,
      p: string,
      idx: string,
      wt: string,
      oldPath?: string
    ): void => {
      const c = byPath.get(p)
      const okAxes = !!c && c.indexStatus === idx && c.worktreeStatus === wt
      const okOld = oldPath === undefined ? true : !!c && c.oldPath === oldPath
      check(name, okAxes && okOld, c ? JSON.stringify(c) : `AUSENTE (${p})`)
    }

    // (2..7) cada archivo con sus dos ejes
    expect("(2) add_staged.txt   -> index 'A', worktree '.'", 'add_staged.txt', 'A', '.')
    expect("(3) del.txt          -> index '.', worktree 'D'", 'del.txt', '.', 'D')
    expect("(4) mod_staged.txt   -> index 'M', worktree '.'", 'mod_staged.txt', 'M', '.')
    expect("(5) mod_unstaged.txt -> index '.', worktree 'M'", 'mod_unstaged.txt', '.', 'M')
    expect("(6) renamed.txt      -> index 'R', worktree '.', oldPath 'rename_me.txt'", 'renamed.txt', 'R', '.', 'rename_me.txt')
    expect("(7) untracked_new.txt -> index '.', worktree '?'", 'untracked_new.txt', '.', '?')

    // -----------------------------------------------------------------------
    // workingBlob()
    // -----------------------------------------------------------------------
    hr('workingBlob() — contenido en disco (lado "after"), con guarda anti-traversal')

    await checkThrows("(8) workingBlob('untracked_new.txt') -> exists:true, content 'nuevo\\n'", async () => {
      const blob = await git.workingBlob('untracked_new.txt')
      return {
        pass: blob.exists === true && blob.content === 'nuevo\n',
        evidence: `exists=${blob.exists} content=${JSON.stringify(blob.content)}`
      }
    })

    await checkThrows("(9) workingBlob('mod_unstaged.txt') -> exists:true e incluye 'MODIFICADA'", async () => {
      const blob = await git.workingBlob('mod_unstaged.txt')
      return {
        pass: blob.exists === true && blob.content.includes('MODIFICADA'),
        evidence: `exists=${blob.exists} content=${JSON.stringify(blob.content)}`
      }
    })

    await checkThrows("(10) workingBlob('del.txt') (borrado del disco) -> exists:false, content ''", async () => {
      const blob = await git.workingBlob('del.txt')
      return {
        pass: blob.exists === false && blob.content === '',
        evidence: `exists=${blob.exists} content=${JSON.stringify(blob.content)}`
      }
    })

    await checkThrows("(11) workingBlob('../escape.txt') (anti-traversal) -> exists:false, content '' (no lanza)", async () => {
      const blob = await git.workingBlob('../escape.txt')
      return {
        pass: blob.exists === false && blob.content === '',
        evidence: `exists=${blob.exists} content=${JSON.stringify(blob.content)}`
      }
    })

    // -----------------------------------------------------------------------
    // Carpeta sin trackear: el bug del EISDIR (ver `-uall` en workingStatusIn).
    // -----------------------------------------------------------------------
    hr('carpeta sin trackear — se enumera archivo a archivo, y una carpeta no revienta')

    const paths = [...byPath.keys()]
    check(
      '(12) NINGUNA entrada es una carpeta (ninguna ruta termina en "/")',
      paths.every((p) => !p.endsWith('/')),
      `paths=${JSON.stringify(paths.filter((p) => p.endsWith('/')))} (vacío = ninguna carpeta)`
    )
    check(
      '(13) los 2 archivos de la carpeta `tests/` se listan por separado como untracked',
      byPath.get('tests/test_a.py')?.worktreeStatus === '?' &&
        byPath.get('tests/test_b.py')?.worktreeStatus === '?' &&
        !byPath.has('tests/'),
      `test_a=${byPath.get('tests/test_a.py')?.worktreeStatus} test_b=${byPath.get('tests/test_b.py')?.worktreeStatus} colapsada=${byPath.has('tests/')}`
    )

    // Defensa en profundidad: aunque git nunca la devuelva ya, pedir el blob de una
    // CARPETA no debe lanzar EISDIR, sino describirse (submódulos hacen justo esto).
    await checkThrows(
      "(14) workingBlob('tests') (una CARPETA) -> isDirectory:true, sin lanzar EISDIR",
      async () => {
        const blob = await git.workingBlob('tests')
        return {
          pass: blob.isDirectory === true && blob.content === '',
          evidence: `isDirectory=${blob.isDirectory} exists=${blob.exists} content=${JSON.stringify(blob.content)}`
        }
      }
    )
    // Y con la barra final que emitía el `-unormal` de antes (por si acaso vuelve).
    await checkThrows(
      "(15) workingBlob('tests/') (con barra final) -> isDirectory:true, sin lanzar",
      async () => {
        const blob = await git.workingBlob('tests/')
        return {
          pass: blob.isDirectory === true,
          evidence: `isDirectory=${blob.isDirectory} exists=${blob.exists}`
        }
      }
    )
  } finally {
    hr('PASO FINAL - limpieza (borrar el fixture temporal)')
    try {
      rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      console.log('fixture temporal eliminado:', repo)
    } catch (err) {
      console.log('AVISO: no se pudo borrar el temporal (no afecta al veredicto):', String(err))
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
