#!/usr/bin/env node
// =============================================================================
// Prueba de `leerEstadoWorktree` y `leerBlobWorktree` de ServicioGit (npm run test:worktree) contra un
// repo temporal con archivos en todos los estados del working-tree: alta y modificado preparados,
// modificado y borrado sin preparar, rename preparado y sin seguimiento. Se autolimpia.
// Solo Node core + ServicioGit, llamando a los métodos públicos.
// =============================================================================

import '../../../scripts/pruebas/temporal-hooks-git.mts'
import { crearCarpetaTemporal } from '../../../scripts/pruebas/temporales.mts'
import { execFileSync } from 'node:child_process'
import { register } from 'node:module'
import { mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import type { CambioWorktree } from '../../shared/git-ipc.ts'

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

// Fixture. Commit base: mod_unstaged, mod_staged, del, rename_me y untouched. Sin commitear:
// mod_unstaged modificado (M sin preparar), mod_staged modificado y preparado (M preparado), del
// borrado (D sin preparar), rename_me renombrado a renamed con `git mv` (R preparado),
// untracked_new (sin seguimiento) y add_staged nuevo y preparado (A preparado).
function crearEscenario(): string {
  const repo = realpathSync(crearCarpetaTemporal(path.join(os.tmpdir(), 'tessera-wt-test-')))

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

  // --- commit base con los cinco archivos ---
  escribirArchivo('mod_unstaged.txt', 'linea1\nlinea2\n')
  escribirArchivo('mod_staged.txt', 'a\n')
  escribirArchivo('del.txt', 'borrar\n')
  escribirArchivo('rename_me.txt', 'viejo nombre\n')
  escribirArchivo('untouched.txt', 'base\n')
  git(['add', '-A'])
  git(['commit', '-m', 'base'])

  // --- genera CADA estado del working-tree, sin commitear ---
  escribirArchivo('mod_unstaged.txt', 'linea1\nMODIFICADA\n') // M, sin stage
  escribirArchivo('mod_staged.txt', 'a\nb\n')
  git(['add', 'mod_staged.txt']) // M, staged
  rmSync(path.join(repo, 'del.txt')) // D, sin stage
  git(['mv', 'rename_me.txt', 'renamed.txt']) // R, staged
  escribirArchivo('untracked_new.txt', 'nuevo\n') // untracked
  escribirArchivo('add_staged.txt', 'STAGED\n')
  git(['add', 'add_staged.txt']) // A, staged

  // CARPETA entera sin trackear. Con el `-unormal` por defecto, git la COLAPSA en
  // una sola entrada "tests/" y abrir su diff reventaba con EISDIR. Con `-uall`
  // debe enumerar sus DOS archivos por separado. (Pasó con una carpeta `tests/` sin seguimiento.)
  mkdirSync(path.join(repo, 'tests'))
  escribirArchivo(path.join('tests', 'test_a.py'), 'a\n')
  escribirArchivo(path.join('tests', 'test_b.py'), 'b\n')

  return repo
}

// =============================================================================
// Main
// =============================================================================
async function main(): Promise<void> {
  hr('PASO 0 - construir fixture del working-tree en dir temporal del SO')
  const repo = crearEscenario()
  console.log('repo:', repo)

  try {
    const silenciar = (): void => {}
    // single repo, sin rutaContenedora -> prefijo identidad.
    const git = new ServicioGit({ raizProyecto: repo, log: silenciar })
    git.fijarRaizProyecto(repo)

    // -----------------------------------------------------------------------
    // leerEstadoWorktree()
    // -----------------------------------------------------------------------
    hr('leerEstadoWorktree() — dos ejes (index/worktree) por archivo')
    let cambios: CambioWorktree[] = []
    let errorEstado: unknown = null
    try {
      cambios = await git.leerEstadoWorktree()
    } catch (err) {
      errorEstado = err
    }

    const porRuta = new Map<string, CambioWorktree>()
    for (const c of cambios) porRuta.set(c.ruta, c)

    // (1) exactamente 8 entradas: los 6 estados clásicos + los DOS archivos de la
    // carpeta `tests/` sin trackear (con -uall van uno a uno, no colapsados).
    check(
      '(1) leerEstadoWorktree() devuelve 8 entradas',
      errorEstado === null && cambios.length === 8,
      errorEstado ? `LANZÓ: ${mensajeError(errorEstado)}` : `n=${cambios.length} paths=${JSON.stringify([...porRuta.keys()])}`
    )

    // helper de aserción por path (index/worktree, rutaAnterior opcional)
    const comprobarCambio = (
      nombre: string,
      p: string,
      idx: string,
      wt: string,
      rutaAnterior?: string
    ): void => {
      const c = porRuta.get(p)
      const okAxes = !!c && c.estadoIndice === idx && c.estadoWorktree === wt
      const anteriorOk = rutaAnterior === undefined ? true : !!c && c.rutaAnterior === rutaAnterior
      check(nombre, okAxes && anteriorOk, c ? JSON.stringify(c) : `AUSENTE (${p})`)
    }

    // (2..7) cada archivo con sus dos ejes
    comprobarCambio("(2) add_staged.txt   -> index 'A', worktree '.'", 'add_staged.txt', 'A', '.')
    comprobarCambio("(3) del.txt          -> index '.', worktree 'D'", 'del.txt', '.', 'D')
    comprobarCambio("(4) mod_staged.txt   -> index 'M', worktree '.'", 'mod_staged.txt', 'M', '.')
    comprobarCambio("(5) mod_unstaged.txt -> index '.', worktree 'M'", 'mod_unstaged.txt', '.', 'M')
    comprobarCambio("(6) renamed.txt      -> index 'R', worktree '.', rutaAnterior 'rename_me.txt'", 'renamed.txt', 'R', '.', 'rename_me.txt')
    comprobarCambio("(7) untracked_new.txt -> index '.', worktree '?'", 'untracked_new.txt', '.', '?')

    // -----------------------------------------------------------------------
    // leerBlobWorktree()
    // -----------------------------------------------------------------------
    hr('leerBlobWorktree() — contenido en disco (lado "after"), con guarda anti-traversal')

    await comprobarSinExcepcion("(8) leerBlobWorktree('untracked_new.txt') -> existe:true, contenido 'nuevo\\n'", async () => {
      const blob = await git.leerBlobWorktree('untracked_new.txt')
      return {
        pass: blob.existe === true && blob.contenido === 'nuevo\n',
        evidence: `existe=${blob.existe} contenido=${JSON.stringify(blob.contenido)}`
      }
    })

    await comprobarSinExcepcion("(9) leerBlobWorktree('mod_unstaged.txt') -> existe:true e incluye 'MODIFICADA'", async () => {
      const blob = await git.leerBlobWorktree('mod_unstaged.txt')
      return {
        pass: blob.existe === true && blob.contenido.includes('MODIFICADA'),
        evidence: `existe=${blob.existe} contenido=${JSON.stringify(blob.contenido)}`
      }
    })

    await comprobarSinExcepcion("(10) leerBlobWorktree('del.txt') (borrado del disco) -> existe:false, contenido ''", async () => {
      const blob = await git.leerBlobWorktree('del.txt')
      return {
        pass: blob.existe === false && blob.contenido === '',
        evidence: `existe=${blob.existe} contenido=${JSON.stringify(blob.contenido)}`
      }
    })

    await comprobarSinExcepcion("(11) leerBlobWorktree('../escape.txt') (anti-traversal) -> existe:false, contenido '' (no lanza)", async () => {
      const blob = await git.leerBlobWorktree('../escape.txt')
      return {
        pass: blob.existe === false && blob.contenido === '',
        evidence: `existe=${blob.existe} contenido=${JSON.stringify(blob.contenido)}`
      }
    })

    // -----------------------------------------------------------------------
    // Carpeta sin trackear: el bug del EISDIR (ver `-uall` en workingStatusIn).
    // -----------------------------------------------------------------------
    hr('carpeta sin trackear — se enumera archivo a archivo, y una carpeta no revienta')

    const rutas = [...porRuta.keys()]
    check(
      '(12) NINGUNA entrada es una carpeta (ninguna ruta termina en "/")',
      rutas.every((p) => !p.endsWith('/')),
      `paths=${JSON.stringify(rutas.filter((p) => p.endsWith('/')))} (vacío = ninguna carpeta)`
    )
    check(
      '(13) los 2 archivos de la carpeta `tests/` se listan por separado como untracked',
      porRuta.get('tests/test_a.py')?.estadoWorktree === '?' &&
        porRuta.get('tests/test_b.py')?.estadoWorktree === '?' &&
        !porRuta.has('tests/'),
      `test_a=${porRuta.get('tests/test_a.py')?.estadoWorktree} test_b=${porRuta.get('tests/test_b.py')?.estadoWorktree} colapsada=${porRuta.has('tests/')}`
    )

    // Defensa en profundidad: aunque git nunca la devuelva ya, pedir el blob de una
    // CARPETA no debe lanzar EISDIR, sino describirse (submódulos hacen justo esto).
    await comprobarSinExcepcion(
      "(14) leerBlobWorktree('tests') (una CARPETA) -> esCarpeta:true, sin lanzar EISDIR",
      async () => {
        const blob = await git.leerBlobWorktree('tests')
        return {
          pass: blob.esCarpeta === true && blob.contenido === '',
          evidence: `esCarpeta=${blob.esCarpeta} existe=${blob.existe} contenido=${JSON.stringify(blob.contenido)}`
        }
      }
    )
    // Y con la barra final que emitía el `-unormal` de antes (por si acaso vuelve).
    await comprobarSinExcepcion(
      "(15) leerBlobWorktree('tests/') (con barra final) -> esCarpeta:true, sin lanzar",
      async () => {
        const blob = await git.leerBlobWorktree('tests/')
        return {
          pass: blob.esCarpeta === true,
          evidence: `esCarpeta=${blob.esCarpeta} existe=${blob.existe}`
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
