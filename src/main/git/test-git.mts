#!/usr/bin/env node
// =============================================================================
// Prueba de GitService (npm run test:git) contra un repo-fixture temporal y determinista, en tres
// topologías: identidad (proyecto = raíz del repo), prefijo (proyecto = subcarpeta) y sin repo.
// Fechas de commit fijas y hashes descubiertos por asunto; el fixture se autolimpia.
// Solo Node core + GitService, llamando a los métodos públicos.
// =============================================================================

import { execFileSync } from 'node:child_process'
import { register } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import type { Commit } from '../../shared/git-ipc.ts'

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

// --- Marcador no-ASCII reutilizado en varios blobs (byte-exacto en UTF-8) ------
const MARK = 'café ☕'

// --- Subjects: son la ÚNICA forma de localizar los commits (sin hardcodear sha) -
const SUBJ = {
  C1: 'C1 inicial: README y app.js',
  C2: 'C2 app.js v2 y utils.js',
  C3: 'C3 notas.md con acentos y UTF-8',
  C4: 'C4 rename utils.js -> src/helpers.js',
  C5: 'C5 helpers: add sub() y marca no-ASCII',
  MERGE: 'Mrg merge feature into main',
  C7: 'C7 borra notas.md',
  S1: 'S1 sub/a.js alta',
  S2: 'S2 sub/a.js modify',
  S3: 'S3 rename sub/a.js -> sub/b.js'
} as const

const EXPECTED_COMMIT_COUNT = Object.keys(SUBJ).length // 10

// --- Autores (uno con no-ASCII garantizado: "Zoë Müller") ----------------------
const ANA = { name: 'Ana López', email: 'ana.lopez@example.com' }
const BOB = { name: 'Bob Smith', email: 'bob@example.com' }
const ZOE = { name: 'Zoë Müller', email: 'zoe.muller@example.com' }

// =============================================================================
// Reporte PASS/FAIL (mismo patrón que test-onexit-reload.mts)
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

// Fixture: main = C1 ─ C2 ─ C3 ─ Mrg ─ C7 ─ S1 ─ S2 ─ S3 (HEAD = S3), con feature = C2 ─ C4 ─ C5
// fusionada en Mrg. C4 renombra utils.js -> src/helpers.js; C7 borra notas.md; S1-S3 viven en sub/
// (alta, cambio y `git mv` dentro de sub). Autores Ana, Bob y Zoë; notas.md y S2 llevan no-ASCII.
interface Fixture {
  base: string
  repo: string
  sub: string
  norepo: string
}

/** Nombre corto de la rama remota de fixture, tal cual debe aparecer en listBranches(). */
const REMOTE_BRANCH = 'origin/main'

// Reloj FIJO: cada commit +1h, formato estricto que git parsea sin ambigüedad.
let clockMs = Date.parse('2021-01-01T12:00:00Z')
function nextDate(): string {
  const d = new Date(clockMs)
  clockMs += 3600_000
  return `${d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')} +0000`
}

function buildFixture(): Fixture {
  // Directorio temporal ÚNICO del SO, fuera del repo de Tessera (C: vs D:).
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-git-test-')))
  const repo = path.join(base, 'repo')
  const sub = path.join(repo, 'sub')
  const norepo = path.join(base, 'norepo')
  mkdirSync(repo, { recursive: true })
  mkdirSync(norepo, { recursive: true }) // dir SIN git para el caso (C)

  const git = (args: string[], extraEnv: Record<string, string> = {}): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...extraEnv } })

  const put = (rel: string, content: string): void => {
    const abs = path.join(repo, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, content, 'utf8') // UTF-8 sin BOM, LF
  }

  const commit = (author: { name: string; email: string }, msg: string): void => {
    const date = nextDate()
    git(['add', '-A'])
    git(['commit', '-m', msg], {
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
      GIT_COMMITTER_DATE: date
    })
  }

  // Config LOCAL del fixture (independiente del git global del entorno).
  git(['init', '-b', 'main'])
  git(['config', 'user.name', 'Fixture Bot'])
  git(['config', 'user.email', 'fixture@example.com'])
  git(['config', 'core.autocrlf', 'false']) // blobs deterministas (LF)
  git(['config', 'i18n.commitEncoding', 'utf-8'])
  git(['config', 'commit.gpgsign', 'false'])

  // --- C1 (Ana): A README.md, A app.js ---
  put('README.md', '# Fixture\n\nRepo de laboratorio para el test de GitService.\n')
  put('app.js', "console.log('v1')\n")
  commit(ANA, SUBJ.C1)

  // --- C2 (Bob): M app.js, A utils.js  (feature parte de aquí) ---
  put('app.js', "console.log('v2')\nconsole.log('base para feature')\n")
  put('utils.js', 'export const add = (a, b) => a + b\n')
  commit(BOB, SUBJ.C2)
  git(['branch', 'feature'])

  // --- C3 (Zoë Müller): A notas.md con contenido no-ASCII ---
  put(
    'notas.md',
    `# Notas\n\nConfiguración del ${MARK} para el niño. Año 2021.\n` +
      'Autores: José, María y Bjørn — Zoë Müller revisó el niño ñ.\n'
  )
  commit(ZOE, SUBJ.C3)

  // --- feature: C4 rename (git mv raíz), C5 modify (+ marca no-ASCII) ---
  git(['checkout', '-q', 'feature'])
  mkdirSync(path.join(repo, 'src'), { recursive: true })
  git(['mv', 'utils.js', 'src/helpers.js']) // R: oldPath -> newPath en la RAÍZ
  commit(BOB, SUBJ.C4)
  put(
    'src/helpers.js',
    'export const add = (a, b) => a + b\n' +
      'export const sub = (a, b) => a - b\n' +
      `// ${MARK} marcador no-ASCII en el nuevo path del rename\n`
  )
  commit(ANA, SUBJ.C5)

  // --- Merge feature -> main (dos padres) ---
  git(['checkout', '-q', 'main'])
  const mergeDate = nextDate()
  git(['merge', '--no-ff', 'feature', '-m', SUBJ.MERGE], {
    GIT_AUTHOR_NAME: ANA.name,
    GIT_AUTHOR_EMAIL: ANA.email,
    GIT_AUTHOR_DATE: mergeDate,
    GIT_COMMITTER_NAME: ANA.name,
    GIT_COMMITTER_EMAIL: ANA.email,
    GIT_COMMITTER_DATE: mergeDate
  })

  // --- C7 (Bob): D notas.md (delete en la raíz) ---
  rmSync(path.join(repo, 'notas.md'))
  commit(BOB, SUBJ.C7)

  // --- Historia PROPIA de sub/: alta, modify, y rename DENTRO de sub/ ---
  put('sub/a.js', '// sub módulo v1\nexport const x = 1\n')
  commit(ANA, SUBJ.S1)
  put('sub/a.js', `// sub módulo v2 — ${MARK}\nexport const x = 2\n`)
  commit(BOB, SUBJ.S2)
  git(['mv', 'sub/a.js', 'sub/b.js']) // R DENTRO de sub: de-prefija path Y oldPath
  commit(ANA, SUBJ.S3)

  // --- Remoto REAL para listBranches(): bare repo + fetch, así refs/remotes/
  // y el pseudo-ref simbólico origin/HEAD existen de verdad (no simulados). ---
  const bareRemote = path.join(base, 'remote.git')
  execFileSync('git', ['init', '--bare', '-b', 'main', bareRemote], { encoding: 'utf8' })
  git(['remote', 'add', 'origin', bareRemote])
  git(['push', 'origin', 'main'])
  // set-head crea el symref origin/HEAD (equivalente a lo que deja un `clone`).
  git(['remote', 'set-head', 'origin', 'main'])
  git(['fetch', 'origin'])

  return { base, repo, sub, norepo }
}

// =============================================================================
// Helpers de aserción
// -----------------------------------------------------------------------------
// checkThrows: envuelve una aserción que llama a GitService de modo que un
// throw inesperado (p.ej. el defecto de NUL en args) se convierta en un FAIL con
// evidencia, NUNCA en un abort de toda la suite. Así cada método se reporta de
// forma independiente.
// =============================================================================
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

/**
 * Descubre subject -> hash SIN pasar por GitService, con un `git log` propio de
 * campos separados por "|" (sin NUL, así que no choca con la guarda de args de
 * Node). NO hardcodea hashes: los localiza por subject, igual que pide el spec.
 * Se usa como RED de seguridad cuando GitService.listCommits() está roto (mete
 * un NUL \x00 dentro del arg --format y Node lo rechaza), para poder ejercitar
 * igualmente filesForCommit/blobAtCommit en el caso del subdirectorio.
 */
function discoverHashesByGit(repo: string): Map<string, string> {
  const out = execFileSync('git', ['log', '--all', '--date-order', '--format=%H|%s'], {
    cwd: repo,
    encoding: 'utf8'
  })
  const map = new Map<string, string>()
  for (const line of out.split('\n')) {
    if (!line) continue
    const sep = line.indexOf('|')
    if (sep < 0) continue
    map.set(line.slice(sep + 1), line.slice(0, sep))
  }
  return map
}

// =============================================================================
// Main
// =============================================================================
async function main(): Promise<void> {
  hr('PASO 0 - construir fixture determinista en dir temporal del SO')
  const fx = buildFixture()
  console.log('base:  ', fx.base)
  console.log('repo:  ', fx.repo, '(raíz del repo git)')
  console.log('sub:   ', fx.sub, '(proyecto en subdirectorio -> prefijo "sub")')
  console.log('norepo:', fx.norepo, '(NO es repo git)')

  try {
    const silent = (): void => {}

    // -----------------------------------------------------------------------
    // CASO (A) IDENTIDAD — projectRoot = raíz del repo, prefijo ""
    // -----------------------------------------------------------------------
    hr('CASO (A) IDENTIDAD — projectRoot = raíz del repo (prefijo "")')
    const gitRoot = new GitService({ projectRoot: fx.repo, log: silent })

    // --- Descubrimiento de hashes por SUBJECT desde listCommits() (spec) -----
    // Si listCommits() lanza (defecto NUL), caemos a un `git log` propio para no
    // dejar sin ejercitar el caso del subdirectorio (que es el foco real).
    let commits: Commit[] | null = null
    let listErr: unknown = null
    try {
      commits = await gitRoot.listCommits()
    } catch (err) {
      listErr = err
    }

    const subjectToHash = new Map<string, string>()
    if (commits) {
      for (const c of commits) subjectToHash.set(c.subject, c.hash)
    } else {
      console.log(
        '\n  ⚠  listCommits() LANZÓ; se descubren los hashes con un `git log` propio\n' +
          `     (por subject, sin hardcodear) para poder seguir. Causa: ${errMsg(listErr)}\n`
      )
      for (const [subj, hash] of discoverHashesByGit(fx.repo)) subjectToHash.set(subj, hash)
    }
    const hashOf = (subject: string): string => {
      const h = subjectToHash.get(subject)
      if (!h) throw new Error(`sin hash para subject="${subject}"`)
      return h
    }
    const hHead = hashOf(SUBJ.S3) // HEAD = tip de main = S3

    // (1) longitud esperada + al menos un merge (parents >= 2)
    if (commits) {
      const hasMerge = commits.some((c) => c.parents.length >= 2)
      const merge = commits.find((c) => c.subject === SUBJ.MERGE)
      check(
        `(1) listCommits() longitud == ${EXPECTED_COMMIT_COUNT} y hay un merge (parents>=2)`,
        commits.length === EXPECTED_COMMIT_COUNT && hasMerge,
        `length=${commits.length} (esperado ${EXPECTED_COMMIT_COUNT}); merge parents=${merge?.parents.length}`
      )
    } else {
      check(
        `(1) listCommits() longitud == ${EXPECTED_COMMIT_COUNT} y hay un merge (parents>=2)`,
        false,
        `listCommits() LANZÓ: ${errMsg(listErr)}`
      )
    }

    // (2) rename en la raíz: status 'R' con oldPath (commit C4)
    await checkThrows(
      '(2) filesForCommit(C4) contiene R con oldPath (rename raíz utils.js -> src/helpers.js)',
      async () => {
        const files = await gitRoot.filesForCommit(hashOf(SUBJ.C4))
        const r = files.find((f) => f.status === 'R')
        return {
          pass: !!r && r.path === 'src/helpers.js' && r.oldPath === 'utils.js',
          evidence: JSON.stringify(files)
        }
      }
    )

    // (3) delete: status 'D' (commit C7)
    await checkThrows('(3) filesForCommit(C7) contiene D (delete notas.md)', async () => {
      const files = await gitRoot.filesForCommit(hashOf(SUBJ.C7))
      const d = files.find((f) => f.status === 'D')
      return { pass: !!d && d.path === 'notas.md', evidence: JSON.stringify(files) }
    })

    // (4) autor no-ASCII byte-exacto ("Zoë Müller") — requiere un Commit real
    // Nota: el nombre lleva 'ë' (e con diéresis) y 'ü', NO 'ö' — la letra con
    // diéresis en "Zoë" es la e, no una o. El check comprobaba 'ö', que no
    // aparece en el nombre y por eso fallaba siempre, sin relación con git.
    if (commits) {
      const zoe = commits.find((c) => c.authorName === ZOE.name)
      check(
        '(4) el autor no-ASCII aparece intacto (byte-exacto "Zoë Müller", con ë/ü)',
        !!zoe && zoe.authorName.includes('ë') && zoe.authorName.includes('ü'),
        `authorName=${JSON.stringify(zoe?.authorName)}`
      )
    } else {
      check(
        '(4) el autor no-ASCII aparece intacto (byte-exacto "Zoë Müller", con ë/ü)',
        false,
        'BLOQUEADO: depende de listCommits(), que lanzó (ver #1)'
      )
    }

    // (5) fileHistory(nuevo path del rename) cruza el rename (--follow) -> >= 2
    await checkThrows(
      '(5) fileHistory("src/helpers.js") >= 2 commits (--follow cruza el rename raíz)',
      async () => {
        const { commits: hist } = await gitRoot.fileHistory('src/helpers.js')
        return {
          pass: hist.length >= 2,
          evidence: `n=${hist.length} subjects=${JSON.stringify(hist.map((h) => h.subject))}`
        }
      }
    )

    // (6) blobAtCommit(nuevo path, HEAD) -> exists:true con marcador no-ASCII byte-exacto
    await checkThrows(
      `(6) blobAtCommit("src/helpers.js", HEAD) exists:true e incluye "${MARK}" byte-exacto`,
      async () => {
        const blob = await gitRoot.blobAtCommit(hHead, 'src/helpers.js')
        return {
          pass: blob.exists && blob.content.includes(MARK),
          evidence: `exists=${blob.exists} len=${blob.content.length} tieneMarca=${blob.content.includes(MARK)}`
        }
      }
    )

    // (7) blobAtCommit(archivo borrado, HEAD) -> exists:false, content ''
    await checkThrows(
      '(7) blobAtCommit("notas.md" (borrado en C7), HEAD) exists:false, content ""',
      async () => {
        const blob = await gitRoot.blobAtCommit(hHead, 'notas.md')
        return {
          pass: blob.exists === false && blob.content === '',
          evidence: `exists=${blob.exists} content=${JSON.stringify(blob.content)}`
        }
      }
    )

    // (8) lado "before" de un alta: archivo en un commit ANTERIOR a su creación
    await checkThrows(
      '(8) blobAtCommit("notas.md", C1) exists:false (before de un alta; notas.md nace en C3)',
      async () => {
        const blob = await gitRoot.blobAtCommit(hashOf(SUBJ.C1), 'notas.md')
        return {
          pass: blob.exists === false && blob.content === '',
          evidence: `exists=${blob.exists} content=${JSON.stringify(blob.content)}`
        }
      }
    )

    // (13) listBranches(): locales (main, feature) + remota (origin/main),
    // origin/HEAD filtrado, y `current` correcto en cada caso.
    await checkThrows(
      '(13) listBranches() -> locales [feature, main] + remota [origin/main]; origin/HEAD filtrado',
      async () => {
        const branches = await gitRoot.listBranches()
        const byName = new Map(branches.map((b) => [b.name, b]))
        const originHead = branches.find((b) => b.name.endsWith('/HEAD'))
        const main = byName.get('main')
        const feature = byName.get('feature')
        const originMain = byName.get(REMOTE_BRANCH)
        const pass =
          !originHead &&
          !!main &&
          main.remote === false &&
          main.current === true &&
          !!feature &&
          feature.remote === false &&
          feature.current === false &&
          !!originMain &&
          originMain.remote === true &&
          originMain.current === false
        return {
          pass,
          evidence: JSON.stringify(branches)
        }
      }
    )

    // -----------------------------------------------------------------------
    // CASO (B) PREFIJO — projectRoot = <raíz>/sub, prefijo "sub"
    // El repo real sigue siendo fx.repo; GitService lo resuelve vía
    // rev-parse --show-toplevel y calcula el prefijo "sub".
    // -----------------------------------------------------------------------
    hr('CASO (B) PREFIJO — projectRoot = <raíz>/sub (prefijo "sub")')
    const gitSub = new GitService({ projectRoot: fx.sub, log: silent })

    // (9a) alta dentro de sub: path relativo a sub, SIN prefijo "sub/"
    await checkThrows(
      '(9a) filesForCommit(S1) -> path relativo a sub SIN prefijo ("a.js", status A)',
      async () => {
        const files = await gitSub.filesForCommit(hashOf(SUBJ.S1))
        const a = files.find((f) => f.status === 'A')
        return {
          pass: files.length === 1 && !!a && a.path === 'a.js',
          evidence: JSON.stringify(files)
        }
      }
    )

    // (9b) rename DENTRO de sub: path Y oldPath SIN prefijo "sub/"
    await checkThrows(
      '(9b) filesForCommit(S3) -> rename DENTRO de sub con path="b.js" y oldPath="a.js" (sin prefijo)',
      async () => {
        const files = await gitSub.filesForCommit(hashOf(SUBJ.S3))
        const r = files.find((f) => f.status === 'R')
        return {
          pass: !!r && r.path === 'b.js' && r.oldPath === 'a.js',
          evidence: JSON.stringify(files)
        }
      }
    )

    // (10) fileHistory(archivo en sub, ruta relativa al PROYECTO sin "sub/")
    await checkThrows(
      '(10) fileHistory("b.js") -> [S3,S2,S1] (--follow cruza el rename dentro de sub)',
      async () => {
        const { commits: hist } = await gitSub.fileHistory('b.js')
        const subjects = hist.map((h) => h.subject)
        return {
          pass:
            hist.length === 3 &&
            subjects.includes(SUBJ.S3) &&
            subjects.includes(SUBJ.S2) &&
            subjects.includes(SUBJ.S1),
          evidence: `n=${hist.length} subjects=${JSON.stringify(subjects)}`
        }
      }
    )

    // (11) blobAtCommit(archivo en sub relativo al proyecto) -> contenido esperado
    await checkThrows(
      `(11) blobAtCommit("b.js", S3) exists:true e incluye "${MARK}" (contenido movido por el rename)`,
      async () => {
        const blob = await gitSub.blobAtCommit(hashOf(SUBJ.S3), 'b.js')
        return {
          pass: blob.exists && blob.content.includes(MARK) && blob.content.includes('export const x = 2'),
          evidence: `exists=${blob.exists} content=${JSON.stringify(blob.content)}`
        }
      }
    )

    // CASO (D): monorepo con el cableado de producción. WorkspaceService llama
    // `setProjectRoot(proyecto, contenedora)` y, si el escaneo no halla repos, el renderer manda la
    // CONTENEDORA como si fuera el repo: abrir `packages/app` de un monorepo no debe dejar vacía la
    // vista de git. Se prueba con las llamadas exactas de la app.
    hr('CASO (D) MONOREPO — contenedora = proyecto = <raíz>/sub (cableado de producción)')
    const gitIn = (args: string[]): string =>
      execFileSync('git', args, { cwd: fx.repo, encoding: 'utf8' })

    const gitProd = new GitService({ projectRoot: fx.sub, log: silent })
    gitProd.setProjectRoot(fx.sub, fx.sub) // como hace WorkspaceService.setActiveProject

    // (14) rename que CRUZA el borde de la carpeta abierta, en un solo commit:
    //   sub/b.js -> fuera.js   (SALE  -> no se muestra: la UI no puede abrirlo)
    //   README.md -> sub/dentro.md (ENTRA -> se degrada a alta 'A', sin oldPath)
    gitIn(['mv', 'sub/b.js', 'fuera.js'])
    gitIn(['mv', 'README.md', 'sub/dentro.md'])
    gitIn(['commit', '-m', 'S4 renames cruzando el borde de sub'])
    const hCross = gitIn(['rev-parse', 'HEAD']).trim()
    await checkThrows(
      '(14) filesForCommit(S4): rename que SALE de sub se omite; el que ENTRA se degrada a A ("dentro.md")',
      async () => {
        const files = await gitProd.filesForCommit(hCross)
        return {
          pass:
            files.length === 1 &&
            files[0].status === 'A' &&
            files[0].path === 'dentro.md' &&
            files[0].oldPath === undefined,
          evidence: JSON.stringify(files)
        }
      }
    )

    // (15) multiStatus([contenedora]): el renderer manda la carpeta abierta, que NO
    // es un repo. Debe resolverse al repo que la contiene, traer la rama, y listar
    // SOLO los cambios de dentro de sub, con rutas SIN el prefijo "sub/".
    writeFileSync(path.join(fx.sub, 'dentro.md'), '# tocado dentro\n', 'utf8')
    writeFileSync(path.join(fx.sub, 'nuevo.txt'), 'sin trackear\n', 'utf8')
    writeFileSync(path.join(fx.repo, 'fuera.js'), '// tocado FUERA de sub\n', 'utf8')
    await checkThrows(
      '(15) multiStatus([sub]) -> 1 repo, rama "main", rutas sin prefijo y SIN los cambios de fuera de sub',
      async () => {
        const st = await gitProd.multiStatus([fx.sub])
        const paths = st[0]?.changes.map((c) => c.path).sort() ?? []
        return {
          pass:
            st.length === 1 &&
            st[0].branch === 'main' &&
            st[0].error === undefined &&
            paths.length === 2 &&
            paths[0] === 'dentro.md' &&
            paths[1] === 'nuevo.txt',
          evidence: JSON.stringify(st)
        }
      }
    )

    // (16) stageFile con una ruta contenedora-relativa: git debe recibir "sub/…".
    await checkThrows(
      '(16) stageFile("nuevo.txt") -> ok y el ÍNDICE contiene "sub/nuevo.txt"',
      async () => {
        const res = await gitProd.stageFile('nuevo.txt')
        const staged = gitIn(['diff', '--cached', '--name-only']).trim()
        return {
          pass: res.ok === true && staged === 'sub/nuevo.txt',
          evidence: `stageFile=${JSON.stringify(res)} índice=${JSON.stringify(staged)}`
        }
      }
    )

    // (17) workingBlob con ruta contenedora-relativa: lee el disco de sub/, no de la
    // raíz del repo (antes devolvía exists:false y el visor de diff se rompía).
    await checkThrows(
      '(17) workingBlob("dentro.md") lee <repo>/sub/dentro.md (exists:true)',
      async () => {
        const blob = await gitProd.workingBlob('dentro.md')
        return {
          pass: blob.exists === true && blob.content === '# tocado dentro\n',
          evidence: `exists=${blob.exists} content=${JSON.stringify(blob.content)}`
        }
      }
    )

    // -----------------------------------------------------------------------
    // CASO (C) SIN REPO — projectRoot = dir que NO es repo git
    // -----------------------------------------------------------------------
    hr('CASO (C) SIN REPO — projectRoot = dir que NO es repo git')
    await checkThrows(
      '(12) sin repo: listCommits/[], filesForCommit/[], fileHistory/[], blobAtCommit/{false,""}',
      async () => {
        const gitNone = new GitService({ projectRoot: fx.norepo, log: silent })
        const noCommits = await gitNone.listCommits()
        const noFiles = await gitNone.filesForCommit('cualquier')
        const noHist = await gitNone.fileHistory('x')
        const noBlob = await gitNone.blobAtCommit('y', 'x')
        return {
          pass:
            noCommits.length === 0 &&
            noFiles.length === 0 &&
            noHist.commits.length === 0 &&
            noBlob.exists === false &&
            noBlob.content === '',
          evidence:
            `commits=${noCommits.length} files=${noFiles.length} hist=${noHist.commits.length} ` +
            `blob=${JSON.stringify(noBlob)}`
        }
      }
    )
  } finally {
    hr('PASO FINAL - limpieza (borrar el fixture temporal)')
    try {
      rmSync(fx.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      console.log('fixture temporal eliminado:', fx.base)
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
