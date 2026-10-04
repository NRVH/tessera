#!/usr/bin/env node
// =============================================================================
// Prueba de la historia de GitService que alimenta el panel de Git·Log (npm run test:git-log), en
// un repo temporal con fechas y autores fijos: `refs` solo en los tips y cortas aunque el repo tenga
// `log.decorate=full`; un asunto con ", " no se parte; `commitDetail` con cuerpo multilínea;
// `branchesContaining` sin `origin/HEAD`; `listBranches` sin campos de más. Los hashes se descubren
// por asunto y el fixture se autolimpia.
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

// =============================================================================
// Reporte PASS/FAIL (mismo patrón que los demás test-*.mts)
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

// --- Autores: el committer se hace DISTINTO del autor en un commit a propósito -
const ANA = { name: 'Ana López', email: 'ana.lopez@example.com' }
const BOB = { name: 'Bob Smith', email: 'bob@example.com' }

const SUBJ = {
  BASE: 'Base del repo',
  // Con ", " DENTRO del subject: si el parseo de %D se colara en el mensaje,
  // este commit produciría refs fantasma.
  COMA: 'Ajusta A, B y C en el arranque',
  FEATURE: 'Trabajo en la rama feature',
  CUERPO: 'Commit con cuerpo largo',
  TIP: 'Punta de main'
} as const

/** Cuerpo multilínea CON línea en blanco: lo que rompería un parseo por líneas. */
const CUERPO = 'Primera línea del cuerpo.\n\n- Un punto\n- Otro punto con acento: configuración'

interface Fixture {
  base: string
  repo: string
}

let clockMs = Date.parse('2021-03-01T09:00:00Z')
function nextDate(): string {
  const d = new Date(clockMs)
  clockMs += 3600_000
  return `${d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')} +0000`
}

function buildFixture(): Fixture {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-gitlog-test-')))
  const repo = path.join(base, 'repo')
  mkdirSync(repo, { recursive: true })

  const git = (args: string[], extraEnv: Record<string, string> = {}): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...extraEnv } })

  const put = (rel: string, content: string): void => {
    const abs = path.join(repo, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }

  const commit = (
    author: { name: string; email: string },
    msg: string,
    committer = author
  ): void => {
    const date = nextDate()
    git(['add', '-A'])
    git(['commit', '-m', msg], {
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: committer.name,
      GIT_COMMITTER_EMAIL: committer.email,
      GIT_COMMITTER_DATE: date
    })
  }

  git(['init', '-b', 'main'])
  git(['config', 'user.name', 'Fixture Bot'])
  git(['config', 'user.email', 'fixture@example.com'])
  git(['config', 'core.autocrlf', 'false'])
  git(['config', 'commit.gpgsign', 'false'])
  // LA TRAMPA (caso 2): este repo pide decoración COMPLETA. Sin el
  // --decorate=short explícito del servicio, %D devolvería "refs/heads/main".
  git(['config', 'log.decorate', 'full'])

  put('README.md', '# Fixture del log\n')
  commit(ANA, SUBJ.BASE)

  put('a.txt', 'A\n')
  commit(BOB, SUBJ.COMA)

  // Rama feature a partir de aquí: su punta será un commit propio, y el commit
  // anterior queda como ANCESTRO COMÚN de main y feature (caso 5).
  git(['branch', 'feature'])
  git(['checkout', '-q', 'feature'])
  put('f.txt', 'F\n')
  commit(BOB, SUBJ.FEATURE)

  git(['checkout', '-q', 'main'])
  // Cuerpo multilínea: dos -m separados producen subject + cuerpo con la línea
  // en blanco de por medio, que es justo lo que hay que preservar.
  put('b.txt', 'B\n')
  git(['add', '-A'])
  {
    const date = nextDate()
    git(['commit', '-m', SUBJ.CUERPO, '-m', CUERPO], {
      GIT_AUTHOR_NAME: ANA.name,
      GIT_AUTHOR_EMAIL: ANA.email,
      GIT_AUTHOR_DATE: date,
      // Committer DISTINTO del autor (lo que pasa tras un rebase o un merge de PR).
      GIT_COMMITTER_NAME: BOB.name,
      GIT_COMMITTER_EMAIL: BOB.email,
      GIT_COMMITTER_DATE: date
    })
  }

  put('c.txt', 'C\n')
  commit(ANA, SUBJ.TIP)
  // Un tag sobre la punta: %D debe listarlo junto a las ramas.
  git(['tag', 'v1.0'])

  return { base, repo }
}

// =============================================================================
async function main(): Promise<void> {
  const fx = buildFixture()
  try {
    const svc = new GitService({ projectRoot: fx.repo, log: () => {} })

    const commits: Commit[] = await svc.listCommits()
    const porSubject = new Map(commits.map((c) => [c.subject, c]))
    const de = (s: string): Commit => {
      const c = porSubject.get(s)
      if (!c) throw new Error(`fixture roto: no se encontró el commit "${s}"`)
      return c
    }

    // -------------------------------------------------------------------------
    hr('1) refs de %D: solo en los tips')
    // -------------------------------------------------------------------------
    const tip = de(SUBJ.TIP)
    const base = de(SUBJ.BASE)
    const feature = de(SUBJ.FEATURE)

    check(
      'el tip de main lleva el token "HEAD -> main"',
      tip.refs.includes('HEAD -> main'),
      JSON.stringify(tip.refs)
    )
    check('el tip de main lleva también su tag', tip.refs.includes('tag: v1.0'), JSON.stringify(tip.refs))
    check('el tip de feature lleva su rama', feature.refs.includes('feature'), JSON.stringify(feature.refs))
    check('un commit interior no lleva refs', base.refs.length === 0, JSON.stringify(base.refs))
    check(
      'todos los commits traen el campo refs (nunca undefined)',
      commits.every((c) => Array.isArray(c.refs)),
      `${commits.length} commits`
    )

    // -------------------------------------------------------------------------
    hr('2) --decorate=short pese a log.decorate=full en el repo')
    // -------------------------------------------------------------------------
    check(
      'ninguna ref viene con el prefijo refs/ (la config del repo NO manda)',
      commits.every((c) => c.refs.every((r) => !r.includes('refs/'))),
      JSON.stringify(commits.flatMap((c) => c.refs))
    )
    check(
      'la rama es "main", no "refs/heads/main"',
      tip.refs.some((r) => r === 'HEAD -> main'),
      JSON.stringify(tip.refs)
    )

    // -------------------------------------------------------------------------
    hr('3) Un subject con ", " no genera refs fantasma')
    // -------------------------------------------------------------------------
    const coma = de(SUBJ.COMA)
    check('el subject con comas llegó ENTERO', coma.subject === SUBJ.COMA, coma.subject)
    check('y sin refs inventadas', coma.refs.length === 0, JSON.stringify(coma.refs))

    // -------------------------------------------------------------------------
    hr('4) commitDetail: cuerpo multilínea + committer + hash inexistente')
    // -------------------------------------------------------------------------
    const conCuerpo = de(SUBJ.CUERPO)
    const detalle = await svc.commitDetail(conCuerpo.hash)
    check('devuelve detalle para un hash real', detalle !== null, detalle ? detalle.hash : 'null')
    if (detalle) {
      check('el hash coincide', detalle.hash === conCuerpo.hash, detalle.hash)
      check('el subject coincide', detalle.subject === SUBJ.CUERPO, detalle.subject)
      check(
        'el cuerpo llega ÍNTEGRO, con su línea en blanco',
        detalle.body === CUERPO,
        JSON.stringify(detalle.body)
      )
      check('el cuerpo conserva los saltos de línea', detalle.body.split('\n').length === 4, `${detalle.body.split('\n').length} líneas`)
      check('el autor es Ana', detalle.authorName === ANA.name, detalle.authorName)
      check(
        'el committer es Bob (distinto del autor)',
        detalle.committerName === BOB.name && detalle.committerName !== detalle.authorName,
        `${detalle.authorName} / ${detalle.committerName}`
      )
      check('trae fecha de committer', /^\d{4}-\d{2}-\d{2}T/.test(detalle.committerIsoDate), detalle.committerIsoDate)
    }
    // Un commit SIN cuerpo devuelve '' (no undefined, no el subject repetido).
    const sinCuerpo = await svc.commitDetail(base.hash)
    check('un commit sin cuerpo devuelve body vacío', sinCuerpo?.body === '', JSON.stringify(sinCuerpo?.body))
    const inexistente = await svc.commitDetail('0'.repeat(40))
    check('hash inexistente -> null (no lanza)', inexistente === null, String(inexistente))

    // -------------------------------------------------------------------------
    hr('5) branchesContaining')
    // -------------------------------------------------------------------------
    // `base` es anterior a la bifurcación -> está en main Y en feature.
    const ramasDeBase = await svc.branchesContaining(base.hash)
    check(
      'un ancestro común aparece en las 2 ramas',
      ramasDeBase.includes('main') && ramasDeBase.includes('feature'),
      JSON.stringify(ramasDeBase)
    )
    // El tip de feature no está en main.
    const ramasDeFeature = await svc.branchesContaining(feature.hash)
    check(
      'el tip de feature solo aparece en feature',
      ramasDeFeature.length === 1 && ramasDeFeature[0] === 'feature',
      JSON.stringify(ramasDeFeature)
    )
    check(
      'ninguna respuesta incluye un pseudo-ref HEAD',
      [...ramasDeBase, ...ramasDeFeature].every((r) => !r.endsWith('HEAD')),
      JSON.stringify([...ramasDeBase, ...ramasDeFeature])
    )
    const ramasDeNada = await svc.branchesContaining('0'.repeat(40))
    check('hash inexistente -> [] (no lanza)', Array.isArray(ramasDeNada) && ramasDeNada.length === 0, JSON.stringify(ramasDeNada))

    // -------------------------------------------------------------------------
    hr('6) listBranches()')
    // -------------------------------------------------------------------------
    const ramas = await svc.listBranches()
    check('enumera las 2 ramas locales', ramas.length === 2, JSON.stringify(ramas.map((b) => b.name)))
    const mainBranch = ramas.find((b) => b.name === 'main')
    check('main está marcada como current', mainBranch?.current === true, String(mainBranch?.current))
    // El sha de la punta NO se expone (se retiró `Branch.tip`: nadie lo leía). Se
    // comprueba que el contrato quedó limpio, no solo que "no se usa".
    check(
      'ninguna rama trae campos de más',
      ramas.every((b) => Object.keys(b).sort().join(',') === 'current,name,remote'),
      JSON.stringify(ramas.map((b) => Object.keys(b)))
    )

    // -------------------------------------------------------------------------
    hr('7) NO REGRESIÓN de los campos de siempre')
    // -------------------------------------------------------------------------
    check(
      'todos los hash son de 40 hex',
      commits.every((c) => /^[0-9a-f]{40}$/.test(c.hash)),
      `${commits.length} commits`
    )
    check(
      'el commit raíz no tiene padres y los demás sí',
      de(SUBJ.BASE).parents.length === 0 && de(SUBJ.TIP).parents.length === 1,
      `base=${de(SUBJ.BASE).parents.length} tip=${de(SUBJ.TIP).parents.length}`
    )
    check('autor con acentos intacto', de(SUBJ.BASE).authorName === ANA.name, de(SUBJ.BASE).authorName)
    check('email del autor intacto', de(SUBJ.COMA).authorEmail === BOB.email, de(SUBJ.COMA).authorEmail)
    check(
      'fecha ISO-8601 parseable',
      commits.every((c) => !Number.isNaN(Date.parse(c.isoDate))),
      de(SUBJ.BASE).isoDate
    )
    check(
      'el orden sigue siendo newest-first',
      commits[0].subject === SUBJ.TIP,
      commits.map((c) => c.subject).join(' | ')
    )
    // La ref de la rama sale del propio commit, así que el parents del padre del
    // tip tiene que apuntar al commit del cuerpo (encadenado correctamente).
    check(
      'el tip encadena con el commit del cuerpo',
      de(SUBJ.TIP).parents[0] === de(SUBJ.CUERPO).hash,
      `${de(SUBJ.TIP).parents[0]} vs ${de(SUBJ.CUERPO).hash}`
    )
  } finally {
    rmSync(fx.base, { recursive: true, force: true })
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
