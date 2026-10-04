#!/usr/bin/env node
// =============================================================================
// Prueba del multi-repo de GitService (npm run test:git-multirepo) con varios repos en una
// contenedora: `multiStatus` con rutas relativas a la contenedora, stage/unstage/descartar/blobs
// enrutados al repo DUEÑO del archivo aunque el activo sea otro, `commit` con repo explícito, y un
// `repo` fuera de la contenedora rechazado. El fixture temporal se autolimpia.
// =============================================================================

import { execFileSync } from 'node:child_process'
import { register } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import type { RepoStatus } from '../../shared/git-ipc.ts'

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
// Reporte PASS/FAIL (mismo patrón que test-git.mts)
// =============================================================================
let passed = 0
let failed = 0

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}

function check(id: string, ok: boolean, detail: string): void {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  (${id}) ${detail}`)
}

// =============================================================================
// Fixture: una CONTENEDORA con dos repos hermanos de primer nivel.
//
//   contenedora/
//     back/   (repo)  -> src/api.py modificado
//     front/  (repo)  -> src/panel.tsx modificado, nuevo.md untracked
//
// El repo ACTIVO será `back`, para poder comprobar que las operaciones sobre
// archivos de `front` van a `front` sin haberlo activado.
// =============================================================================
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function initRepo(root: string, branch: string): void {
  mkdirSync(path.join(root, 'src'), { recursive: true })
  git(root, ['init', '-q', '-b', branch])
  git(root, ['config', 'user.email', 'test@tessera.local'])
  git(root, ['config', 'user.name', 'Tessera Test'])
}

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-multirepo-')))
const container = path.join(tmp, 'contenedora')
const back = path.join(container, 'back')
const front = path.join(container, 'front')
// Un repo FUERA de la contenedora: el que la validación debe rechazar.
const outside = path.join(tmp, 'ajeno')

try {
  initRepo(back, 'fix/DA-2535')
  writeFileSync(path.join(back, 'src', 'api.py'), 'v1\n')
  git(back, ['add', '-A'])
  git(back, ['commit', '-qm', 'back: inicial'])
  writeFileSync(path.join(back, 'src', 'api.py'), 'v2\n') // modificado, unstaged

  initRepo(front, 'feature/DA-2521')
  writeFileSync(path.join(front, 'src', 'panel.tsx'), 'v1\n')
  git(front, ['add', '-A'])
  git(front, ['commit', '-qm', 'front: inicial'])
  writeFileSync(path.join(front, 'src', 'panel.tsx'), 'v2\n') // modificado, unstaged
  writeFileSync(path.join(front, 'nuevo.md'), '# nuevo\n') // untracked

  initRepo(outside, 'main')
  writeFileSync(path.join(outside, 'secreto.txt'), 'no tocar\n')
  git(outside, ['add', '-A'])
  git(outside, ['commit', '-qm', 'ajeno'])

  // Repo ACTIVO = back; contenedora = la carpeta que ve el explorador.
  const svc = new GitService({ projectRoot: back, log: () => {} })
  svc.setProjectRoot(back, container)

  hr('1. multiStatus: rama + cambios de los DOS repos, con prefijo de contenedora')

  const statuses: RepoStatus[] = await svc.multiStatus([back, front])
  const byRepo = new Map(statuses.map((s) => [s.repo, s]))
  const sBack = byRepo.get(back)
  const sFront = byRepo.get(front)

  check(
    '1a',
    statuses.length === 2,
    `multiStatus devuelve los 2 repos -> n=${statuses.length}`
  )
  check(
    '1b',
    sBack?.branch === 'fix/DA-2535' && sFront?.branch === 'feature/DA-2521',
    `cada repo trae SU rama actual -> back="${sBack?.branch}" front="${sFront?.branch}"`
  )
  const backPaths = sBack?.changes.map((c) => c.path).sort() ?? []
  const frontPaths = sFront?.changes.map((c) => c.path).sort() ?? []
  check(
    '1c',
    JSON.stringify(backPaths) === JSON.stringify(['back/src/api.py']),
    `rutas del back llevan su prefijo -> ${JSON.stringify(backPaths)}`
  )
  check(
    '1d',
    JSON.stringify(frontPaths) === JSON.stringify(['front/nuevo.md', 'front/src/panel.tsx']),
    `rutas del front llevan su prefijo -> ${JSON.stringify(frontPaths)}`
  )
  // Es la propiedad que hace posible unir las listas para las decoraciones.
  const union = new Set([...backPaths, ...frontPaths])
  check('1e', union.size === 3, `la unión de ambos repos no colisiona -> ${union.size} rutas`)
  check(
    '1f',
    sFront?.changes.find((c) => c.path === 'front/nuevo.md')?.worktreeStatus === '?',
    'el untracked del front sale como "?" (verde de archivo nuevo en el explorador)'
  )

  hr('2. Enrutado POR RUTA: se opera en el repo DUEÑO, aunque el activo sea `back`')

  const stage = await svc.stageFile('front/src/panel.tsx')
  const afterStage = await svc.multiStatus([front])
  const staged = afterStage[0]?.changes.find((c) => c.path === 'front/src/panel.tsx')
  check(
    '2a',
    stage.ok && staged?.indexStatus === 'M',
    `stageFile de un archivo del FRONT lo stagea en el front -> ok=${stage.ok} index="${staged?.indexStatus}"`
  )
  // Y no ha tocado el back: su archivo sigue unstaged.
  const backAfter = (await svc.multiStatus([back]))[0]?.changes[0]
  check(
    '2b',
    backAfter?.indexStatus === '.' && backAfter?.worktreeStatus === 'M',
    `el back NO se tocó -> index="${backAfter?.indexStatus}" worktree="${backAfter?.worktreeStatus}"`
  )

  const blob = await svc.workingBlob('front/src/panel.tsx')
  check('2c', blob.exists && blob.content === 'v2\n', `workingBlob lee del front -> "${blob.content}"`)

  const idx = await svc.indexBlob('front/src/panel.tsx')
  check('2d', idx.exists && idx.content === 'v2\n', `indexBlob lee el índice del front -> "${idx.content}"`)

  // blobAtCommit('HEAD', …) es el lado "before" del diff staged: debe leer el HEAD
  // DEL FRONT (v1), no el del back.
  const head = await svc.blobAtCommit('HEAD', 'front/src/panel.tsx')
  check('2e', head.exists && head.content === 'v1\n', `blobAtCommit HEAD lee el HEAD del front -> "${head.content}"`)

  const unstage = await svc.unstageFile('front/src/panel.tsx')
  const afterUnstage = (await svc.multiStatus([front]))[0]?.changes.find(
    (c) => c.path === 'front/src/panel.tsx'
  )
  check(
    '2f',
    unstage.ok && afterUnstage?.indexStatus === '.',
    `unstageFile devuelve el archivo del front al working-tree -> index="${afterUnstage?.indexStatus}"`
  )

  hr('3. commit(msg, repo): commitea el repo indicado, no el activo')

  await svc.stageFile('front/nuevo.md')
  const commitRes = await svc.commit('front: añade nuevo.md', front)
  check('3a', commitRes.ok === true, `commit en el front -> ok=${commitRes.ok} error=${commitRes.error ?? '-'}`)

  const frontLog = git(front, ['log', '--format=%s', '-n', '1']).trim()
  const backLog = git(back, ['log', '--format=%s', '-n', '1']).trim()
  check('3b', frontLog === 'front: añade nuevo.md', `el commit fue al FRONT -> "${frontLog}"`)
  check('3c', backLog === 'back: inicial', `el back NO recibió el commit -> "${backLog}"`)

  hr('4. Validación: un repo fuera de la contenedora se rechaza')

  const rejected = await svc.multiStatus([outside])
  check('4a', rejected.length === 0, `multiStatus omite el repo ajeno -> n=${rejected.length}`)

  const rejectedCommit = await svc.commit('no debería ocurrir', outside)
  check(
    '4b',
    rejectedCommit.ok === false,
    `commit en el repo ajeno -> ok=${rejectedCommit.ok} error="${rejectedCommit.error}"`
  )
  const outsideLog = git(outside, ['log', '--format=%s', '-n', '1']).trim()
  check('4c', outsideLog === 'ajeno', `el repo ajeno quedó intacto -> "${outsideLog}"`)

  // Un repoHostPath con traversal tampoco pasa (no es hijo directo de la contenedora).
  const traversal = await svc.multiStatus([path.join(container, '..', 'ajeno')])
  check('4d', traversal.length === 0, `multiStatus rechaza "<contenedora>/../ajeno" -> n=${traversal.length}`)

  hr('6. Historial de archivo: dice EN QUÉ REPO lo resolvió')

  // LA REGRESIÓN QUE FIJA. `fileHistory` deduce el repo de la RUTA, así que para
  // "front/src/panel.tsx" lista los commits del FRONT aunque el repo activo sea el
  // back. Pero las llamadas que vienen después —los archivos del commit, su padre—
  // caían al repo ACTIVO, y allí ese hash no existe: git respondía
  // `fatal: bad object <hash>` con un hash perfectamente válido. En la app se veía
  // como "el historial funciona en unos repos y en otros no", que era exactamente
  // esto: funcionaba cuando el repo del archivo resultaba ser también el activo.
  const histFront = await svc.fileHistory('front/src/panel.tsx')
  check(
    '6a',
    histFront.repoHostPath === front,
    `fileHistory del front devuelve SU repo -> "${path.basename(histFront.repoHostPath)}"`
  )
  check(
    '6b',
    histFront.commits.length >= 1 && histFront.commits[0].subject.startsWith('front:'),
    `y sus commits son los del front -> ${JSON.stringify(histFront.commits.map((c) => c.subject))}`
  )
  // El autor y la fecha vienen en el mismo `git log`, para que el historial pueda
  // pintarlos en columnas sin un spawn por commit.
  check(
    '6c',
    histFront.commits[0].author === 'Tessera Test' && /^\d{4}-\d{2}-\d{2}T/.test(histFront.commits[0].isoDate),
    `cada commit trae autor y fecha -> "${histFront.commits[0].author}" / "${histFront.commits[0].isoDate}"`
  )

  // Y con ese repo, la llamada siguiente SÍ encuentra el commit. Sin él (el camino
  // viejo) el hash se busca en el back y no está.
  const hashFront = histFront.commits[0].hash
  const conRepo = await svc.filesForCommit(hashFront, histFront.repoHostPath)
  check(
    '6d',
    conRepo.some((c) => c.path === 'front/src/panel.tsx'),
    `filesForCommit(hash, repoDelHistorial) encuentra el archivo -> ${JSON.stringify(conRepo.map((c) => c.path))}`
  )
  const parent = await svc.parentOf(hashFront, histFront.repoHostPath)
  check('6e', parent.parentHash === null, `parentOf del commit raíz del front -> ${parent.parentHash}`)

  // POR QUÉ LA VISTA NO PASA UN REPO EXPLÍCITO, y por qué esto es un caso y no un
  // comentario: se intentó pasarle el repo SELECCIONADO en la vista de git, con el
  // argumento de quitar de en medio el puntero de "proyecto activo". Rompe justo lo
  // que el resto de este bloque protege. Con un repo explícito, `fileHistory` toma
  // la rama `ctxForRepo` y deja de deducir el dueño por la ruta; como
  // "front/src/panel.tsx" no empieza por el prefijo del back, `toRepoPath` la
  // devuelve intacta y git la busca en el back, donde no está.
  const conRepoEquivocado = await svc.fileHistory('front/src/panel.tsx', back)
  check(
    '6g',
    conRepoEquivocado.commits.length === 0,
    `pedir el historial del front CONTRA EL BACK no encuentra nada -> n=${conRepoEquivocado.commits.length}`
  )
  check(
    '6h',
    histFront.commits.length > 0,
    `y sin repo, deducido por la ruta, sí -> n=${histFront.commits.length}`
  )

  // El repo activo (back) sigue resolviéndose por su cuenta: nada de esto lo mueve.
  const histBack = await svc.fileHistory('back/src/api.py')
  check('6f', histBack.repoHostPath === back, `el back sigue resolviéndose al back -> "${path.basename(histBack.repoHostPath)}"`)

  hr('5. Descartar por ruta: borra el untracked del repo dueño')

  writeFileSync(path.join(front, 'basura.tmp'), 'x\n')
  const svcConfirm = new GitService({
    projectRoot: back,
    log: () => {},
    confirmDiscard: async () => true
  })
  svcConfirm.setProjectRoot(back, container)
  const discard = await svcConfirm.discardChanges('front/basura.tmp')
  check(
    '5a',
    discard.ok && discard.wasUntracked && !existsSync(path.join(front, 'basura.tmp')),
    `descartar un untracked del front lo borra del front -> ok=${discard.ok} untracked=${discard.wasUntracked}`
  )
  check('5b', existsSync(path.join(back, 'src', 'api.py')), 'el back sigue intacto tras el descarte')

  hr(`VEREDICTO: ${passed}/${passed + failed} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
  if (failed > 0) process.exitCode = 1
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
