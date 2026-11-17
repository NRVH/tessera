#!/usr/bin/env node
// =============================================================================
// Prueba del multi-repo de ServicioGit (npm run test:git-multirepo) con varios repos en una
// contenedora: `leerEstadoRepos` con rutas relativas a la contenedora, stage/unstage/descartar/blobs
// enrutados al repo DUEÑO del archivo aunque el activo sea otro, `commit` con repo explícito, y un
// `repo` fuera de la contenedora rechazado. El fixture temporal se autolimpia.
// =============================================================================

import { execFileSync } from 'node:child_process'
import { register } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, realpathSync, symlinkSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import type { EstadoRepo } from '../../shared/git-ipc.ts'

// El código de producción importa sin extensión: este hook reintenta con `.ts`.
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

function inicializarRepo(raiz: string, rama: string): void {
  mkdirSync(path.join(raiz, 'src'), { recursive: true })
  git(raiz, ['init', '-q', '-b', rama])
  git(raiz, ['config', 'user.email', 'test@tessera.local'])
  git(raiz, ['config', 'user.name', 'Tessera Test'])
}

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-multirepo-')))
const contenedora = path.join(tmp, 'contenedora')
const repoServidor = path.join(contenedora, 'back')
const repoInterfaz = path.join(contenedora, 'front')
// Un repo FUERA de la contenedora: el que la validación debe rechazar.
const repoAjeno = path.join(tmp, 'ajeno')

try {
  inicializarRepo(repoServidor, 'fix/TK-101')
  writeFileSync(path.join(repoServidor, 'src', 'api.py'), 'v1\n')
  git(repoServidor, ['add', '-A'])
  git(repoServidor, ['commit', '-qm', 'back: inicial'])
  writeFileSync(path.join(repoServidor, 'src', 'api.py'), 'v2\n') // modificado, unstaged

  inicializarRepo(repoInterfaz, 'feature/TK-102')
  writeFileSync(path.join(repoInterfaz, 'src', 'panel.tsx'), 'v1\n')
  git(repoInterfaz, ['add', '-A'])
  git(repoInterfaz, ['commit', '-qm', 'front: inicial'])
  writeFileSync(path.join(repoInterfaz, 'src', 'panel.tsx'), 'v2\n') // modificado, unstaged
  writeFileSync(path.join(repoInterfaz, 'nuevo.md'), '# nuevo\n') // untracked

  inicializarRepo(repoAjeno, 'main')
  writeFileSync(path.join(repoAjeno, 'secreto.txt'), 'no tocar\n')
  git(repoAjeno, ['add', '-A'])
  git(repoAjeno, ['commit', '-qm', 'ajeno'])

  // Repo ACTIVO = back; contenedora = la carpeta que ve el explorador.
  const svc = new ServicioGit({ raizProyecto: repoServidor, log: () => {} })
  svc.fijarRaizProyecto(repoServidor, contenedora)

  hr('1. leerEstadoRepos: rama + cambios de los DOS repos, con prefijo de contenedora')

  const estados: EstadoRepo[] = await svc.leerEstadoRepos([repoServidor, repoInterfaz])
  const porRepo = new Map(estados.map((s) => [s.repo, s]))
  const estadoServidor = porRepo.get(repoServidor)
  const estadoInterfaz = porRepo.get(repoInterfaz)

  check(
    '1a',
    estados.length === 2,
    `leerEstadoRepos devuelve los 2 repos -> n=${estados.length}`
  )
  check(
    '1b',
    estadoServidor?.rama === 'fix/TK-101' && estadoInterfaz?.rama === 'feature/TK-102',
    `cada repo trae SU rama actual -> back="${estadoServidor?.rama}" front="${estadoInterfaz?.rama}"`
  )
  const rutasServidor = estadoServidor?.cambios.map((c) => c.ruta).sort() ?? []
  const rutasInterfaz = estadoInterfaz?.cambios.map((c) => c.ruta).sort() ?? []
  check(
    '1c',
    JSON.stringify(rutasServidor) === JSON.stringify(['back/src/api.py']),
    `rutas del back llevan su prefijo -> ${JSON.stringify(rutasServidor)}`
  )
  check(
    '1d',
    JSON.stringify(rutasInterfaz) === JSON.stringify(['front/nuevo.md', 'front/src/panel.tsx']),
    `rutas del front llevan su prefijo -> ${JSON.stringify(rutasInterfaz)}`
  )
  // Es la propiedad que hace posible unir las listas para las decoraciones.
  const union = new Set([...rutasServidor, ...rutasInterfaz])
  check('1e', union.size === 3, `la unión de ambos repos no colisiona -> ${union.size} rutas`)
  check(
    '1f',
    estadoInterfaz?.cambios.find((c) => c.ruta === 'front/nuevo.md')?.estadoWorktree === '?',
    'el untracked del front sale como "?" (verde de archivo nuevo en el explorador)'
  )

  hr('2. Enrutado POR RUTA: se opera en el repo DUEÑO, aunque el activo sea `back`')

  const stage = await svc.prepararArchivo('front/src/panel.tsx')
  const trasPreparar = await svc.leerEstadoRepos([repoInterfaz])
  const preparados = trasPreparar[0]?.cambios.find((c) => c.ruta === 'front/src/panel.tsx')
  check(
    '2a',
    stage.ok && preparados?.estadoIndice === 'M',
    `prepararArchivo de un archivo del FRONT lo stagea en el front -> ok=${stage.ok} index="${preparados?.estadoIndice}"`
  )
  // Y no ha tocado el back: su archivo sigue unstaged.
  const servidorDespues = (await svc.leerEstadoRepos([repoServidor]))[0]?.cambios[0]
  check(
    '2b',
    servidorDespues?.estadoIndice === '.' && servidorDespues?.estadoWorktree === 'M',
    `el back NO se tocó -> index="${servidorDespues?.estadoIndice}" worktree="${servidorDespues?.estadoWorktree}"`
  )

  const blob = await svc.leerBlobWorktree('front/src/panel.tsx')
  check('2c', blob.existe && blob.contenido === 'v2\n', `leerBlobWorktree lee del front -> "${blob.contenido}"`)

  const idx = await svc.leerBlobIndice('front/src/panel.tsx')
  check('2d', idx.existe && idx.contenido === 'v2\n', `leerBlobIndice lee el índice del front -> "${idx.contenido}"`)

  // leerBlobEnCommit('HEAD', …) es el lado "before" del diff staged: debe leer el HEAD
  // DEL FRONT (v1), no el del back.
  const head = await svc.leerBlobEnCommit('HEAD', 'front/src/panel.tsx')
  check('2e', head.existe && head.contenido === 'v1\n', `leerBlobEnCommit HEAD lee el HEAD del front -> "${head.contenido}"`)

  const unstage = await svc.quitarArchivoDelIndice('front/src/panel.tsx')
  const trasQuitarDelIndice = (await svc.leerEstadoRepos([repoInterfaz]))[0]?.cambios.find(
    (c) => c.ruta === 'front/src/panel.tsx'
  )
  check(
    '2f',
    unstage.ok && trasQuitarDelIndice?.estadoIndice === '.',
    `quitarArchivoDelIndice devuelve el archivo del front al working-tree -> index="${trasQuitarDelIndice?.estadoIndice}"`
  )

  hr('3. commit(msg, repo): commitea el repo indicado, no el activo')

  await svc.prepararArchivo('front/nuevo.md')
  const commitRes = await svc.commit('front: añade nuevo.md', repoInterfaz)
  check('3a', commitRes.ok === true, `commit en el front -> ok=${commitRes.ok} error=${commitRes.error ?? '-'}`)

  const logInterfaz = git(repoInterfaz, ['log', '--format=%s', '-n', '1']).trim()
  const logServidor = git(repoServidor, ['log', '--format=%s', '-n', '1']).trim()
  check('3b', logInterfaz === 'front: añade nuevo.md', `el commit fue al FRONT -> "${logInterfaz}"`)
  check('3c', logServidor === 'back: inicial', `el back NO recibió el commit -> "${logServidor}"`)

  hr('4. Validación: un repo fuera de la contenedora se rechaza')

  const rechazado = await svc.leerEstadoRepos([repoAjeno])
  check('4a', rechazado.length === 0, `leerEstadoRepos omite el repo ajeno -> n=${rechazado.length}`)

  const commitRechazado = await svc.commit('no debería ocurrir', repoAjeno)
  check(
    '4b',
    commitRechazado.ok === false,
    `commit en el repo ajeno -> ok=${commitRechazado.ok} error="${commitRechazado.error}"`
  )
  const logAjeno = git(repoAjeno, ['log', '--format=%s', '-n', '1']).trim()
  check('4c', logAjeno === 'ajeno', `el repo ajeno quedó intacto -> "${logAjeno}"`)

  // Un rutaHostRepo con traversal tampoco pasa (no es hijo directo de la contenedora).
  const traversal = await svc.leerEstadoRepos([path.join(contenedora, '..', 'ajeno')])
  check('4d', traversal.length === 0, `leerEstadoRepos rechaza "<contenedora>/../ajeno" -> n=${traversal.length}`)

  hr('6. Historial de archivo: dice EN QUÉ REPO lo resolvió')

  // LA REGRESIÓN QUE FIJA. `leerHistorialArchivo` deduce el repo de la RUTA, así que para
  // "front/src/panel.tsx" lista los commits del FRONT aunque el repo activo sea el
  // back. Pero las llamadas que vienen después —los archivos del commit, su padre—
  // caían al repo ACTIVO, y allí ese hash no existe: git respondía
  // `fatal: bad object <hash>` con un hash perfectamente válido. En la app se veía
  // como "el historial funciona en unos repos y en otros no", que era exactamente
  // esto: funcionaba cuando el repo del archivo resultaba ser también el activo.
  const historialInterfaz = await svc.leerHistorialArchivo('front/src/panel.tsx')
  check(
    '6a',
    historialInterfaz.rutaHostRepo === repoInterfaz,
    `leerHistorialArchivo del front devuelve SU repo -> "${path.basename(historialInterfaz.rutaHostRepo)}"`
  )
  check(
    '6b',
    historialInterfaz.commits.length >= 1 && historialInterfaz.commits[0].asunto.startsWith('front:'),
    `y sus commits son los del front -> ${JSON.stringify(historialInterfaz.commits.map((c) => c.asunto))}`
  )
  // El autor y la fecha vienen en el mismo `git log`, para que el historial pueda
  // pintarlos en columnas sin un spawn por commit.
  check(
    '6c',
    historialInterfaz.commits[0].autor === 'Tessera Test' && /^\d{4}-\d{2}-\d{2}T/.test(historialInterfaz.commits[0].fechaIso),
    `cada commit trae autor y fecha -> "${historialInterfaz.commits[0].autor}" / "${historialInterfaz.commits[0].fechaIso}"`
  )

  // Y con ese repo, la llamada siguiente SÍ encuentra el commit. Sin él (el camino
  // viejo) el hash se busca en el back y no está.
  const hashInterfaz = historialInterfaz.commits[0].hash
  const conRepo = await svc.obtenerArchivosCommit(hashInterfaz, historialInterfaz.rutaHostRepo)
  check(
    '6d',
    conRepo.some((c) => c.ruta === 'front/src/panel.tsx'),
    `obtenerArchivosCommit(hash, repoDelHistorial) encuentra el archivo -> ${JSON.stringify(conRepo.map((c) => c.ruta))}`
  )
  const padre = await svc.obtenerPrimerPadre(hashInterfaz, historialInterfaz.rutaHostRepo)
  check('6e', padre.hashPadre === null, `obtenerPrimerPadre del commit raíz del front -> ${padre.hashPadre}`)

  // POR QUÉ LA VISTA NO PASA UN REPO EXPLÍCITO, y por qué esto es un caso y no un
  // comentario: se intentó pasarle el repo SELECCIONADO en la vista de git, con el
  // argumento de quitar de en medio el puntero de "proyecto activo". Rompe justo lo
  // que el resto de este bloque protege. Con un repo explícito, `leerHistorialArchivo` toma
  // la rama `obtenerCtxParaRepo` y deja de deducir el dueño por la ruta; como
  // "front/src/panel.tsx" no empieza por el prefijo del back, `aRutaRepo` la
  // devuelve intacta y git la busca en el back, donde no está.
  const conRepoEquivocado = await svc.leerHistorialArchivo('front/src/panel.tsx', repoServidor)
  check(
    '6g',
    conRepoEquivocado.commits.length === 0,
    `pedir el historial del front CONTRA EL BACK no encuentra nada -> n=${conRepoEquivocado.commits.length}`
  )
  check(
    '6h',
    historialInterfaz.commits.length > 0,
    `y sin repo, deducido por la ruta, sí -> n=${historialInterfaz.commits.length}`
  )

  // El repo activo (back) sigue resolviéndose por su cuenta: nada de esto lo mueve.
  const historialServidor = await svc.leerHistorialArchivo('back/src/api.py')
  check('6f', historialServidor.rutaHostRepo === repoServidor, `el back sigue resolviéndose al back -> "${path.basename(historialServidor.rutaHostRepo)}"`)

  hr('5. Descartar por ruta: borra el untracked del repo dueño')

  writeFileSync(path.join(repoInterfaz, 'basura.tmp'), 'x\n')
  const servicioConConfirmacion = new ServicioGit({
    raizProyecto: repoServidor,
    log: () => {},
    confirmarDescarte: async () => true
  })
  servicioConConfirmacion.fijarRaizProyecto(repoServidor, contenedora)
  const descarte = await servicioConConfirmacion.descartarCambios('front/basura.tmp')
  check(
    '5a',
    descarte.ok && descarte.estabaSinSeguimiento && !existsSync(path.join(repoInterfaz, 'basura.tmp')),
    `descartar un untracked del front lo borra del front -> ok=${descarte.ok} untracked=${descarte.estabaSinSeguimiento}`
  )
  check('5b', existsSync(path.join(repoServidor, 'src', 'api.py')), 'el back sigue intacto tras el descarte')

  hr('7. Repos anidados: una carpeta que agrupa repos por área y por capa')

  // contenedora/area/capa/anidado es un repo a 3 niveles, como el que ofrece el escaneo.
  const anidado = path.join(contenedora, 'area', 'capa', 'anidado')
  inicializarRepo(anidado, 'main')
  writeFileSync(path.join(anidado, 'src', 'a.txt'), 'v1\n')
  writeFileSync(path.join(anidado, 'src', 'b.txt'), 'v1\n')
  git(anidado, ['add', '-A'])
  git(anidado, ['commit', '-qm', 'anidado: inicial'])
  writeFileSync(path.join(anidado, 'src', 'a.txt'), 'v2\n')
  writeFileSync(path.join(anidado, 'src', 'b.txt'), 'v2\n')
  const sAnidado = (await svc.leerEstadoRepos([anidado]))[0]
  check(
    '7a',
    JSON.stringify(sAnidado?.cambios.map((c) => c.ruta).sort()) === JSON.stringify(['area/capa/anidado/src/a.txt', 'area/capa/anidado/src/b.txt']),
    `leerEstadoRepos del anidado, con su ruta desde la contenedora -> ${JSON.stringify(sAnidado?.cambios.map((c) => c.ruta))}`
  )
  const stageAnidado = await svc.prepararArchivo('area/capa/anidado/src/a.txt')
  const trasStage = (await svc.leerEstadoRepos([anidado]))[0]?.cambios.find((c) => c.ruta === 'area/capa/anidado/src/a.txt')
  check('7b', stageAnidado.ok && trasStage?.estadoIndice === 'M', `prepararArchivo por ruta va al repo anidado -> ok=${stageAnidado.ok} index="${trasStage?.estadoIndice}"`)
  const lote = await svc.prepararArchivos(['area/capa/anidado/src/b.txt', 'front/src/panel.tsx'])
  const bLote = (await svc.leerEstadoRepos([anidado]))[0]?.cambios.find((c) => c.ruta === 'area/capa/anidado/src/b.txt')
  check('7c', lote.every((r) => r.ok) && bLote?.estadoIndice === 'M', `un lote reparte cada ruta a su repo -> ${JSON.stringify(lote.map((r) => r.ok))}`)
  const histAnidado = await svc.leerHistorialArchivo('area/capa/anidado/src/a.txt')
  check('7d', histAnidado.rutaHostRepo === anidado, `leerHistorialArchivo resuelve el repo anidado -> "${path.basename(histAnidado.rutaHostRepo)}"`)
  // Uno dentro de un repo y otro dentro de dependencias: el escaneo no los ofrece, y el main tampoco.
  const dentroDeRepo = path.join(anidado, 'libs', 'interno')
  inicializarRepo(dentroDeRepo, 'main')
  const enDependencias = path.join(contenedora, 'node_modules', 'paquete')
  inicializarRepo(enDependencias, 'main')
  check('7e', (await svc.leerEstadoRepos([dentroDeRepo])).length === 0, 'un repo DENTRO de un repo anidado no se ofrece')
  check('7f', (await svc.leerEstadoRepos([enDependencias])).length === 0, 'un repo dentro de node_modules no se ofrece')

  hr('8. Un enlace intermedio no lleva a un repo de fuera de la contenedora')

  // contenedora/enlace -> tmp/fuera, y tmp/fuera/r es un repo: el escaneo no baja por enlaces,
  // así que el main tampoco puede correr git ni descartar en él. (`junction` en Windows no pide permisos.)
  const fuera = path.join(tmp, 'fuera')
  const repoFuera = path.join(fuera, 'r')
  inicializarRepo(repoFuera, 'main')
  writeFileSync(path.join(repoFuera, 'suelto.txt'), 'no borrar\n')
  symlinkSync(fuera, path.join(contenedora, 'enlace'), 'junction')
  check('8a', (await svc.leerEstadoRepos([path.join(contenedora, 'enlace', 'r')])).length === 0, 'leerEstadoRepos rechaza el repo de fuera a través del enlace')
  const descarteFuera = await servicioConConfirmacion.descartarCambios('enlace/r/suelto.txt')
  check('8b', existsSync(path.join(repoFuera, 'suelto.txt')), `descartar a través del enlace no borra nada fuera -> ${JSON.stringify(descarteFuera)}`)

  hr(`VEREDICTO: ${passed}/${passed + failed} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
  if (failed > 0) process.exitCode = 1
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
