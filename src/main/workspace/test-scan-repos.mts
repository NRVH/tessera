#!/usr/bin/env node
// =============================================================================
// Prueba de `scanRepos()` (npm run test:scan) contra fixtures desechables en el temporal del SO.
// No necesita `git`: la detección es «existe `<dir>/.git`», así que se crea esa estructura mínima.
// Cubre: contenedor con varios repos hijos, carpeta que es un repo, repo con repos hijos, carpeta
// sin repos, subcarpetas sin `.git`, `.git` como ARCHIVO (worktree) además de como directorio, y
// repos anidados en carpetas que agrupan (con lo que no se recorre).
// =============================================================================

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import { scanRepos, type DetectedRepo } from './scanRepos.ts'

// =============================================================================
// Reporte PASS/FAIL
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

// =============================================================================
// Helpers de fixture
// -----------------------------------------------------------------------------
// makeRepoDir:    crea <dir>/.git como DIRECTORIO (con un HEAD mínimo) -> repo normal.
// makeWorktree:   crea <dir>/.git como ARCHIVO (gitdir: ...) -> worktree/submódulo.
// makePlainDir:   crea una carpeta normal con un archivo, SIN .git -> se ignora.
// =============================================================================
function makeRepoDir(dir: string): void {
  mkdirSync(path.join(dir, '.git'), { recursive: true })
  writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8')
  writeFileSync(path.join(dir, 'README.md'), '# repo\n', 'utf8')
}
function makeWorktree(dir: string): void {
  mkdirSync(dir, { recursive: true })
  // Un worktree/submódulo usa `.git` como ARCHIVO que apunta al gitdir real.
  writeFileSync(path.join(dir, '.git'), 'gitdir: /ruta/opaca/al/gitdir\n', 'utf8')
  writeFileSync(path.join(dir, 'main.js'), "console.log('wt')\n", 'utf8')
}
function makePlainDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'nota.txt'), 'sin git\n', 'utf8')
}

/** Conjunto de names devueltos, ordenado, para comparaciones estables. */
function names(repos: DetectedRepo[]): string[] {
  return repos.map((r) => r.name).sort()
}
/** Busca un repo por name (o undefined). */
function byName(repos: DetectedRepo[], name: string): DetectedRepo | undefined {
  return repos.find((r) => r.name === name)
}
/** ¿Todas las repoHostPath son absolutas? (invariante del shape) */
function allAbsolute(repos: DetectedRepo[]): boolean {
  return repos.every((r) => path.isAbsolute(r.repoHostPath))
}

// =============================================================================
// Main
// =============================================================================
async function main(): Promise<void> {
  hr('PASO 0 - construir fixtures en dir temporal del SO')
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-scan-test-')))
  console.log('base:', base)

  try {
    // -----------------------------------------------------------------------
    // (a) CONTENEDOR con 2 repos hijos; la raíz NO es repo.
    //     Estructura: containerA/{alpha(.git dir), beta(.git dir)}
    // -----------------------------------------------------------------------
    hr('CASO (a) contenedor con 2 repos hijos (raíz NO es repo)')
    const containerA = path.join(base, 'containerA')
    mkdirSync(containerA, { recursive: true })
    makeRepoDir(path.join(containerA, 'alpha'))
    makeRepoDir(path.join(containerA, 'beta'))
    {
      const repos = await scanRepos(containerA)
      const roots = repos.filter((r) => r.isRoot)
      check(
        '(a) detecta exactamente [alpha, beta] como hijos, ningún isRoot',
        JSON.stringify(names(repos)) === JSON.stringify(['alpha', 'beta']) &&
          roots.length === 0 &&
          allAbsolute(repos),
        JSON.stringify(repos)
      )
      const alpha = byName(repos, 'alpha')
      check(
        '(a) repoHostPath de alpha apunta a la subcarpeta correcta',
        !!alpha && alpha.repoHostPath === path.join(containerA, 'alpha'),
        `alpha.repoHostPath=${alpha?.repoHostPath}`
      )
    }

    // -----------------------------------------------------------------------
    // (b) La carpeta ES un repo (un solo repo, como hoy). Sin hijos repo.
    // -----------------------------------------------------------------------
    hr('CASO (b) la carpeta ES un repo (un solo repo)')
    const soloRepo = path.join(base, 'soloRepo')
    makeRepoDir(soloRepo)
    makePlainDir(path.join(soloRepo, 'src')) // subcarpeta normal, no repo
    {
      const repos = await scanRepos(soloRepo)
      check(
        '(b) devuelve exactamente 1 repo, isRoot=true, name=basename',
        repos.length === 1 &&
          repos[0].isRoot === true &&
          repos[0].name === 'soloRepo' &&
          repos[0].repoHostPath === soloRepo,
        JSON.stringify(repos)
      )
    }

    // -----------------------------------------------------------------------
    // (c) La carpeta ES un repo Y tiene repos hijos -> reporta raíz + hijos.
    //     La raíz debe ir PRIMERO; los hijos ordenados por name.
    // -----------------------------------------------------------------------
    hr('CASO (c) carpeta que es repo Y tiene repos hijos (raíz + hijos)')
    const rootAndKids = path.join(base, 'rootAndKids')
    makeRepoDir(rootAndKids)
    makeRepoDir(path.join(rootAndKids, 'zeta'))
    makeRepoDir(path.join(rootAndKids, 'gamma'))
    {
      const repos = await scanRepos(rootAndKids)
      const root = repos.filter((r) => r.isRoot)
      check(
        '(c) reporta raíz + [gamma, zeta]; raíz primero e isRoot=true',
        repos.length === 3 &&
          repos[0].isRoot === true &&
          repos[0].name === 'rootAndKids' &&
          root.length === 1 &&
          JSON.stringify(names(repos)) === JSON.stringify(['gamma', 'rootAndKids', 'zeta']),
        JSON.stringify(repos.map((r) => ({ name: r.name, isRoot: r.isRoot })))
      )
    }

    // -----------------------------------------------------------------------
    // (d) Carpeta SIN ningún repo -> lista vacía.
    // -----------------------------------------------------------------------
    hr('CASO (d) carpeta sin ningún repo (lista vacía)')
    const noRepos = path.join(base, 'noRepos')
    makePlainDir(path.join(noRepos, 'docs'))
    makePlainDir(path.join(noRepos, 'assets'))
    {
      const repos = await scanRepos(noRepos)
      check('(d) devuelve lista vacía', repos.length === 0, JSON.stringify(repos))
    }

    // -----------------------------------------------------------------------
    // (e) Subcarpetas normales sin .git se ignoran (mezcla con 1 repo real).
    //     Contenedor con: uno(repo), dos(plain), tres(plain), un archivo suelto.
    // -----------------------------------------------------------------------
    hr('CASO (e) subcarpetas normales sin .git se ignoran')
    const mixed = path.join(base, 'mixed')
    mkdirSync(mixed, { recursive: true })
    makeRepoDir(path.join(mixed, 'uno'))
    makePlainDir(path.join(mixed, 'dos'))
    makePlainDir(path.join(mixed, 'tres'))
    writeFileSync(path.join(mixed, 'suelto.txt'), 'archivo de primer nivel\n', 'utf8')
    {
      const repos = await scanRepos(mixed)
      check(
        '(e) solo detecta [uno]; ignora dos/tres (sin .git) y el archivo suelto',
        JSON.stringify(names(repos)) === JSON.stringify(['uno']) && repos[0].isRoot === false,
        JSON.stringify(repos)
      )
    }

    // -----------------------------------------------------------------------
    // (f) .git como ARCHIVO (worktree) además de como directorio.
    //     Contenedor con: normalRepo(.git dir), wt(.git archivo). Ambos detectados.
    //     Y un contenedor cuya PROPIA raíz es un worktree (.git archivo).
    // -----------------------------------------------------------------------
    hr('CASO (f) .git como ARCHIVO (worktree) detectado igual que directorio')
    const withWorktrees = path.join(base, 'withWorktrees')
    mkdirSync(withWorktrees, { recursive: true })
    makeRepoDir(path.join(withWorktrees, 'normalRepo')) // .git DIRECTORIO
    makeWorktree(path.join(withWorktrees, 'wt')) // .git ARCHIVO
    {
      const repos = await scanRepos(withWorktrees)
      check(
        '(f) detecta hijo con .git-archivo (wt) y con .git-dir (normalRepo)',
        JSON.stringify(names(repos)) === JSON.stringify(['normalRepo', 'wt']),
        JSON.stringify(repos)
      )
    }
    // (f-bis) la propia raíz abierta es un worktree (.git como archivo).
    const rootWorktree = path.join(base, 'rootWorktree')
    makeWorktree(rootWorktree)
    {
      const repos = await scanRepos(rootWorktree)
      check(
        '(f-bis) raíz que es worktree (.git archivo) se detecta como isRoot',
        repos.length === 1 && repos[0].isRoot === true && repos[0].name === 'rootWorktree',
        JSON.stringify(repos)
      )
    }

    // -----------------------------------------------------------------------
    // (h) Carpeta que NO es repo con repos agrupados por área y por capa, a 2 y 3 niveles.
    //     Ni se entra en un repo ya encontrado, ni en dependencias, ni en ocultas, ni más hondo
    //     que PROFUNDIDAD_REPOS.
    // -----------------------------------------------------------------------
    hr('CASO (h) repos anidados en una carpeta que no es repo')
    const areas = path.join(base, 'areas')
    makeRepoDir(path.join(areas, 'utiles', 'generador'))
    makeRepoDir(path.join(areas, 'utiles', 'generador', 'sub', 'interno')) // dentro de un repo: no
    makeRepoDir(path.join(areas, 'ventas', 'back', 'api-ventas'))
    makeRepoDir(path.join(areas, 'ventas', 'front', 'web-ventas'))
    makePlainDir(path.join(areas, 'notas'))
    makeRepoDir(path.join(areas, 'node_modules', 'paquete')) // dependencias: no se baja
    makeRepoDir(path.join(areas, '.idea', 'oculto')) // oculta: no se baja
    makeRepoDir(path.join(areas, 'uno', 'dos', 'tres', 'cuatro')) // nivel 4: sí
    makeRepoDir(path.join(areas, 'a', 'b', 'c', 'd', 'cinco')) // nivel 5: no
    makeRepoDir(path.join(areas, 'build')) // un repo en primer nivel cuenta aunque se llame así
    {
      const repos = await scanRepos(areas)
      const rels = repos.map((r) => path.relative(areas, r.repoHostPath).split(path.sep).join('/'))
      check(
        '(h) detecta los de 2, 3 y 4 niveles, ordenados por ruta, y nada de dentro de repos, dependencias, ocultas ni más hondo',
        JSON.stringify(rels) ===
          JSON.stringify(['build', 'uno/dos/tres/cuatro', 'utiles/generador', 'ventas/back/api-ventas', 'ventas/front/web-ventas']) &&
          repos.every((r) => !r.isRoot),
        JSON.stringify(rels)
      )
      const api = repos.find((r) => r.name === 'api-ventas')
      check('(h) el nombre es el de la carpeta del repo', !!api && api.repoHostPath === path.join(areas, 'ventas', 'back', 'api-ventas'), String(api?.repoHostPath))
    }
    // (h-bis) una raíz que ES repo sigue mirando solo sus hijos directos (no cuesta un recorrido por proyecto).
    const repoConNietos = path.join(base, 'repoConNietos')
    makeRepoDir(repoConNietos)
    makeRepoDir(path.join(repoConNietos, 'hijo'))
    makeRepoDir(path.join(repoConNietos, 'libs', 'nieto'))
    {
      const repos = await scanRepos(repoConNietos)
      check('(h-bis) raíz que es repo: raíz + hijos directos, sin nietos', JSON.stringify(names(repos)) === JSON.stringify(['hijo', 'repoConNietos']), JSON.stringify(names(repos)))
    }

    // -----------------------------------------------------------------------
    // (i) El mismo repo por dos caminos: area/capa-a/repo es real y area/capa-b/repo es un enlace a él.
    //     Sale una vez, por el camino real, aunque el enlace se encuentre antes en el orden.
    // -----------------------------------------------------------------------
    hr('CASO (i) un enlace a un repo de la misma raíz no lo duplica')
    const conEnlace = path.join(base, 'conEnlace')
    makeRepoDir(path.join(conEnlace, 'area', 'capa-b', 'repo'))
    mkdirSync(path.join(conEnlace, 'area', 'capa-a'), { recursive: true })
    symlinkSync(path.join(conEnlace, 'area', 'capa-b', 'repo'), path.join(conEnlace, 'area', 'capa-a', 'repo'), 'junction')
    {
      const repos = await scanRepos(conEnlace)
      const rels = repos.map((r) => path.relative(conEnlace, r.repoHostPath).split(path.sep).join('/'))
      check('(i) una sola entrada, la del camino real', JSON.stringify(rels) === JSON.stringify(['area/capa-b/repo']), JSON.stringify(rels))
    }

    // -----------------------------------------------------------------------
    // (g) Robustez: ruta inexistente -> lista vacía, sin lanzar.
    // -----------------------------------------------------------------------
    hr('CASO (g) robustez: carpeta inexistente devuelve [] sin lanzar')
    {
      const ghost = path.join(base, 'no-existe-jamas')
      let threw = false
      let repos: DetectedRepo[] = []
      try {
        repos = await scanRepos(ghost)
      } catch {
        threw = true
      }
      check(
        '(g) carpeta inexistente -> [] y NO lanza',
        !threw && repos.length === 0,
        `threw=${threw} len=${repos.length}`
      )
    }
  } finally {
    hr('PASO FINAL - limpieza (borrar fixtures temporales)')
    try {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      console.log('fixtures temporales eliminados:', base)
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
