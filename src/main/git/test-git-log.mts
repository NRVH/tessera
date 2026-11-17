#!/usr/bin/env node
// =============================================================================
// Prueba de la historia de ServicioGit que alimenta el panel de Git·Log (npm run test:git-log), en
// un repo temporal con fechas y autores fijos: `refs` solo en los tips y cortas aunque el repo tenga
// `log.decorate=full`; un asunto con ", " no se parte; `leerDetalleCommit` con cuerpo multilínea;
// `obtenerRamasQueContienen` sin `origin/HEAD`; `listarRamas` sin campos de más. Los hashes se descubren
// por asunto y el fixture se autolimpia.
// =============================================================================

import { execFileSync } from 'node:child_process'
import { register } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import type { Commit } from '../../shared/git-ipc.ts'

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
const ANA = { nombre: 'Ana López', email: 'ana.lopez@example.com' }
const BOB = { nombre: 'Bob Smith', email: 'bob@example.com' }

const ASUNTOS = {
  BASE: 'Base del repo',
  // Con ", " DENTRO del asunto: si el parseo de %D se colara en el mensaje,
  // este commit produciría refs fantasma.
  COMA: 'Ajusta A, B y C en el arranque',
  FUNCIONALIDAD: 'Trabajo en la rama feature',
  CUERPO: 'Commit con cuerpo largo',
  PUNTA: 'Punta de main'
} as const

/** Cuerpo multilínea CON línea en blanco: lo que rompería un parseo por líneas. */
const CUERPO = 'Primera línea del cuerpo.\n\n- Un punto\n- Otro punto con acento: configuración'

interface Fixture {
  base: string
  repo: string
}

let relojMs = Date.parse('2021-03-01T09:00:00Z')
function siguienteFecha(): string {
  const d = new Date(relojMs)
  relojMs += 3600_000
  return `${d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')} +0000`
}

function crearEscenario(): Fixture {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-gitlog-test-')))
  const repo = path.join(base, 'repo')
  mkdirSync(repo, { recursive: true })

  const git = (args: string[], extraEnv: Record<string, string> = {}): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...extraEnv } })

  const escribirArchivo = (rel: string, contenido: string): void => {
    const abs = path.join(repo, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, contenido, 'utf8')
  }

  const commit = (
    autor: { nombre: string; email: string },
    msg: string,
    committer = autor
  ): void => {
    const fecha = siguienteFecha()
    git(['add', '-A'])
    git(['commit', '-m', msg], {
      GIT_AUTHOR_NAME: autor.nombre,
      GIT_AUTHOR_EMAIL: autor.email,
      GIT_AUTHOR_DATE: fecha,
      GIT_COMMITTER_NAME: committer.nombre,
      GIT_COMMITTER_EMAIL: committer.email,
      GIT_COMMITTER_DATE: fecha
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

  escribirArchivo('README.md', '# Fixture del log\n')
  commit(ANA, ASUNTOS.BASE)

  escribirArchivo('a.txt', 'A\n')
  commit(BOB, ASUNTOS.COMA)

  // Rama feature a partir de aquí: su punta será un commit propio, y el commit
  // anterior queda como ANCESTRO COMÚN de main y feature (caso 5).
  git(['branch', 'feature'])
  git(['checkout', '-q', 'feature'])
  escribirArchivo('f.txt', 'F\n')
  commit(BOB, ASUNTOS.FUNCIONALIDAD)

  git(['checkout', '-q', 'main'])
  // Cuerpo multilínea: dos -m separados producen asunto + cuerpo con la línea
  // en blanco de por medio, que es justo lo que hay que preservar.
  escribirArchivo('b.txt', 'B\n')
  git(['add', '-A'])
  {
    const fecha = siguienteFecha()
    git(['commit', '-m', ASUNTOS.CUERPO, '-m', CUERPO], {
      GIT_AUTHOR_NAME: ANA.nombre,
      GIT_AUTHOR_EMAIL: ANA.email,
      GIT_AUTHOR_DATE: fecha,
      // Committer DISTINTO del autor (lo que pasa tras un rebase o un merge de PR).
      GIT_COMMITTER_NAME: BOB.nombre,
      GIT_COMMITTER_EMAIL: BOB.email,
      GIT_COMMITTER_DATE: fecha
    })
  }

  escribirArchivo('c.txt', 'C\n')
  commit(ANA, ASUNTOS.PUNTA)
  // Un tag sobre la punta: %D debe listarlo junto a las ramas.
  git(['tag', 'v1.0'])

  return { base, repo }
}

// =============================================================================
async function main(): Promise<void> {
  const escenario = crearEscenario()
  try {
    const svc = new ServicioGit({ raizProyecto: escenario.repo, log: () => {} })

    const commits: Commit[] = await svc.listarCommits()
    const porAsunto = new Map(commits.map((c) => [c.asunto, c]))
    const de = (s: string): Commit => {
      const c = porAsunto.get(s)
      if (!c) throw new Error(`fixture roto: no se encontró el commit "${s}"`)
      return c
    }

    // -------------------------------------------------------------------------
    hr('1) refs de %D: solo en los tips')
    // -------------------------------------------------------------------------
    const punta = de(ASUNTOS.PUNTA)
    const base = de(ASUNTOS.BASE)
    const ramaFuncionalidad = de(ASUNTOS.FUNCIONALIDAD)

    check(
      'el tip de main lleva el token "HEAD -> main"',
      punta.refs.includes('HEAD -> main'),
      JSON.stringify(punta.refs)
    )
    check('el tip de main lleva también su tag', punta.refs.includes('tag: v1.0'), JSON.stringify(punta.refs))
    check('el tip de feature lleva su rama', ramaFuncionalidad.refs.includes('feature'), JSON.stringify(ramaFuncionalidad.refs))
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
      punta.refs.some((r) => r === 'HEAD -> main'),
      JSON.stringify(punta.refs)
    )

    // -------------------------------------------------------------------------
    hr('3) Un asunto con ", " no genera refs fantasma')
    // -------------------------------------------------------------------------
    const coma = de(ASUNTOS.COMA)
    check('el asunto con comas llegó ENTERO', coma.asunto === ASUNTOS.COMA, coma.asunto)
    check('y sin refs inventadas', coma.refs.length === 0, JSON.stringify(coma.refs))

    // -------------------------------------------------------------------------
    hr('4) leerDetalleCommit: cuerpo multilínea + committer + hash inexistente')
    // -------------------------------------------------------------------------
    const conCuerpo = de(ASUNTOS.CUERPO)
    const detalle = await svc.leerDetalleCommit(conCuerpo.hash)
    check('devuelve detalle para un hash real', detalle !== null, detalle ? detalle.hash : 'null')
    if (detalle) {
      check('el hash coincide', detalle.hash === conCuerpo.hash, detalle.hash)
      check('el asunto coincide', detalle.asunto === ASUNTOS.CUERPO, detalle.asunto)
      check(
        'el cuerpo llega ÍNTEGRO, con su línea en blanco',
        detalle.cuerpo === CUERPO,
        JSON.stringify(detalle.cuerpo)
      )
      check('el cuerpo conserva los saltos de línea', detalle.cuerpo.split('\n').length === 4, `${detalle.cuerpo.split('\n').length} líneas`)
      check('el autor es Ana', detalle.nombreAutor === ANA.nombre, detalle.nombreAutor)
      check(
        'el committer es Bob (distinto del autor)',
        detalle.nombreAplicador === BOB.nombre && detalle.nombreAplicador !== detalle.nombreAutor,
        `${detalle.nombreAutor} / ${detalle.nombreAplicador}`
      )
      check('trae fecha de committer', /^\d{4}-\d{2}-\d{2}T/.test(detalle.fechaIsoAplicacion), detalle.fechaIsoAplicacion)
    }
    // Un commit SIN cuerpo devuelve '' (no undefined, no el asunto repetido).
    const sinCuerpo = await svc.leerDetalleCommit(base.hash)
    check('un commit sin cuerpo devuelve cuerpo vacío', sinCuerpo?.cuerpo === '', JSON.stringify(sinCuerpo?.cuerpo))
    const inexistente = await svc.leerDetalleCommit('0'.repeat(40))
    check('hash inexistente -> null (no lanza)', inexistente === null, String(inexistente))

    // -------------------------------------------------------------------------
    hr('5) obtenerRamasQueContienen')
    // -------------------------------------------------------------------------
    // `base` es anterior a la bifurcación -> está en main Y en feature.
    const ramasDeBase = await svc.obtenerRamasQueContienen(base.hash)
    check(
      'un ancestro común aparece en las 2 ramas',
      ramasDeBase.includes('main') && ramasDeBase.includes('feature'),
      JSON.stringify(ramasDeBase)
    )
    // El tip de feature no está en main.
    const ramasDeFuncionalidad = await svc.obtenerRamasQueContienen(ramaFuncionalidad.hash)
    check(
      'el tip de feature solo aparece en feature',
      ramasDeFuncionalidad.length === 1 && ramasDeFuncionalidad[0] === 'feature',
      JSON.stringify(ramasDeFuncionalidad)
    )
    check(
      'ninguna respuesta incluye un pseudo-ref HEAD',
      [...ramasDeBase, ...ramasDeFuncionalidad].every((r) => !r.endsWith('HEAD')),
      JSON.stringify([...ramasDeBase, ...ramasDeFuncionalidad])
    )
    const ramasDeNada = await svc.obtenerRamasQueContienen('0'.repeat(40))
    check('hash inexistente -> [] (no lanza)', Array.isArray(ramasDeNada) && ramasDeNada.length === 0, JSON.stringify(ramasDeNada))

    // -------------------------------------------------------------------------
    hr('6) listarRamas()')
    // -------------------------------------------------------------------------
    const ramas = await svc.listarRamas()
    check('enumera las 2 ramas locales', ramas.length === 2, JSON.stringify(ramas.map((b) => b.nombre)))
    const ramaPrincipal = ramas.find((b) => b.nombre === 'main')
    check('main está marcada como esActual', ramaPrincipal?.esActual === true, String(ramaPrincipal?.esActual))
    // El hash de la punta NO se expone en `Rama`. Se comprueba que el
    // contrato está limpio, no solo que "no se usa".
    check(
      'ninguna rama trae campos de más',
      ramas.every((b) => Object.keys(b).sort().join(',') === 'esActual,esRemota,nombre'),
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
      de(ASUNTOS.BASE).padres.length === 0 && de(ASUNTOS.PUNTA).padres.length === 1,
      `base=${de(ASUNTOS.BASE).padres.length} tip=${de(ASUNTOS.PUNTA).padres.length}`
    )
    check('autor con acentos intacto', de(ASUNTOS.BASE).nombreAutor === ANA.nombre, de(ASUNTOS.BASE).nombreAutor)
    check('email del autor intacto', de(ASUNTOS.COMA).emailAutor === BOB.email, de(ASUNTOS.COMA).emailAutor)
    check(
      'fecha ISO-8601 parseable',
      commits.every((c) => !Number.isNaN(Date.parse(c.fechaIso))),
      de(ASUNTOS.BASE).fechaIso
    )
    check(
      'el orden sigue siendo newest-first',
      commits[0].asunto === ASUNTOS.PUNTA,
      commits.map((c) => c.asunto).join(' | ')
    )
    // La ref de la rama sale del propio commit, así que los padres del padre de la
    // punta tienen que apuntar al commit del cuerpo (encadenado correctamente).
    check(
      'el tip encadena con el commit del cuerpo',
      de(ASUNTOS.PUNTA).padres[0] === de(ASUNTOS.CUERPO).hash,
      `${de(ASUNTOS.PUNTA).padres[0]} vs ${de(ASUNTOS.CUERPO).hash}`
    )
  } finally {
    rmSync(escenario.base, { recursive: true, force: true })
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
