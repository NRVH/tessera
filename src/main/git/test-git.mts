#!/usr/bin/env node
// =============================================================================
// Prueba de ServicioGit (npm run test:git) contra un repo-fixture temporal y determinista, en tres
// topologías: identidad (proyecto = raíz del repo), prefijo (proyecto = subcarpeta) y sin repo.
// Fechas de commit fijas y hashes descubiertos por asunto; el fixture se autolimpia.
// Solo Node core + ServicioGit, llamando a los métodos públicos.
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

// --- Marcador no-ASCII reutilizado en varios blobs (byte-exacto en UTF-8) ------
const MARCA = 'café ☕'

// --- Subjects: son la ÚNICA forma de localizar los commits (sin hardcodear sha) -
const ASUNTOS = {
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

const CANTIDAD_COMMITS_ESPERADA = Object.keys(ASUNTOS).length // 10

// --- Autores (uno con no-ASCII garantizado: "Zoë Müller") ----------------------
const ANA = { nombre: 'Ana López', email: 'ana.lopez@example.com' }
const BOB = { nombre: 'Bob Smith', email: 'bob@example.com' }
const ZOE = { nombre: 'Zoë Müller', email: 'zoe.muller@example.com' }

// =============================================================================
// Reporte PASS/FAIL (mismo patrón que test-onexit-recarga.mts)
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

// Fixture: main = C1 ─ C2 ─ C3 ─ Mrg ─ C7 ─ S1 ─ S2 ─ S3 (HEAD = S3), con feature = C2 ─ C4 ─ C5
// fusionada en Mrg. C4 renombra utils.js -> src/helpers.js; C7 borra notas.md; S1-S3 viven en sub/
// (alta, cambio y `git mv` dentro de sub). Autores Ana, Bob y Zoë; notas.md y S2 llevan no-ASCII.
interface Fixture {
  base: string
  repo: string
  sub: string
  sinRepo: string
}

/** Nombre corto de la rama remota de fixture, tal cual debe aparecer en listarRamas(). */
const RAMA_REMOTA = 'origin/main'

// Reloj FIJO: cada commit +1h, formato estricto que git parsea sin ambigüedad.
let relojMs = Date.parse('2021-01-01T12:00:00Z')
function siguienteFecha(): string {
  const d = new Date(relojMs)
  relojMs += 3600_000
  return `${d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')} +0000`
}

function crearEscenario(): Fixture {
  // Directorio temporal ÚNICO del SO, fuera del repo de Tessera (C: vs D:).
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-git-test-')))
  const repo = path.join(base, 'repo')
  const sub = path.join(repo, 'sub')
  const sinRepo = path.join(base, 'norepo')
  mkdirSync(repo, { recursive: true })
  mkdirSync(sinRepo, { recursive: true }) // dir SIN git para el caso (C)

  const git = (args: string[], extraEnv: Record<string, string> = {}): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...extraEnv } })

  const escribirArchivo = (rel: string, contenido: string): void => {
    const abs = path.join(repo, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, contenido, 'utf8') // UTF-8 sin BOM, LF
  }

  const commit = (autor: { nombre: string; email: string }, msg: string): void => {
    const fecha = siguienteFecha()
    git(['add', '-A'])
    git(['commit', '-m', msg], {
      GIT_AUTHOR_NAME: autor.nombre,
      GIT_AUTHOR_EMAIL: autor.email,
      GIT_AUTHOR_DATE: fecha,
      GIT_COMMITTER_NAME: autor.nombre,
      GIT_COMMITTER_EMAIL: autor.email,
      GIT_COMMITTER_DATE: fecha
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
  escribirArchivo('README.md', '# Fixture\n\nRepo de laboratorio para el test de ServicioGit.\n')
  escribirArchivo('app.js', "console.log('v1')\n")
  commit(ANA, ASUNTOS.C1)

  // --- C2 (Bob): M app.js, A utils.js  (feature parte de aquí) ---
  escribirArchivo('app.js', "console.log('v2')\nconsole.log('base para feature')\n")
  escribirArchivo('utils.js', 'export const add = (a, b) => a + b\n')
  commit(BOB, ASUNTOS.C2)
  git(['branch', 'feature'])

  // --- C3 (Zoë Müller): A notas.md con contenido no-ASCII ---
  escribirArchivo(
    'notas.md',
    `# Notas\n\nConfiguración del ${MARCA} para el niño. Año 2021.\n` +
      'Autores: José, María y Bjørn — Zoë Müller revisó el niño ñ.\n'
  )
  commit(ZOE, ASUNTOS.C3)

  // --- feature: C4 rename (git mv raíz), C5 modify (+ marca no-ASCII) ---
  git(['checkout', '-q', 'feature'])
  mkdirSync(path.join(repo, 'src'), { recursive: true })
  git(['mv', 'utils.js', 'src/helpers.js']) // R: rutaAnterior -> rutaNueva en la RAÍZ
  commit(BOB, ASUNTOS.C4)
  escribirArchivo(
    'src/helpers.js',
    'export const add = (a, b) => a + b\n' +
      'export const sub = (a, b) => a - b\n' +
      `// ${MARCA} marcador no-ASCII en el nuevo path del rename\n`
  )
  commit(ANA, ASUNTOS.C5)

  // --- Merge feature -> main (dos padres) ---
  git(['checkout', '-q', 'main'])
  const fechaMerge = siguienteFecha()
  git(['merge', '--no-ff', 'feature', '-m', ASUNTOS.MERGE], {
    GIT_AUTHOR_NAME: ANA.nombre,
    GIT_AUTHOR_EMAIL: ANA.email,
    GIT_AUTHOR_DATE: fechaMerge,
    GIT_COMMITTER_NAME: ANA.nombre,
    GIT_COMMITTER_EMAIL: ANA.email,
    GIT_COMMITTER_DATE: fechaMerge
  })

  // --- C7 (Bob): D notas.md (delete en la raíz) ---
  rmSync(path.join(repo, 'notas.md'))
  commit(BOB, ASUNTOS.C7)

  // --- Historia PROPIA de sub/: alta, modify, y rename DENTRO de sub/ ---
  escribirArchivo('sub/a.js', '// sub módulo v1\nexport const x = 1\n')
  commit(ANA, ASUNTOS.S1)
  escribirArchivo('sub/a.js', `// sub módulo v2 — ${MARCA}\nexport const x = 2\n`)
  commit(BOB, ASUNTOS.S2)
  git(['mv', 'sub/a.js', 'sub/b.js']) // R DENTRO de sub: de-prefija path Y rutaAnterior
  commit(ANA, ASUNTOS.S3)

  // --- Remoto REAL para listarRamas(): bare repo + fetch, así refs/remotes/
  // y el pseudo-ref simbólico origin/HEAD existen de verdad (no simulados). ---
  const remotoDesnudo = path.join(base, 'remote.git')
  execFileSync('git', ['init', '--bare', '-b', 'main', remotoDesnudo], { encoding: 'utf8' })
  git(['remote', 'add', 'origin', remotoDesnudo])
  git(['push', 'origin', 'main'])
  // set-head crea el symref origin/HEAD (equivalente a lo que deja un `clone`).
  git(['remote', 'set-head', 'origin', 'main'])
  git(['fetch', 'origin'])

  return { base, repo, sub, sinRepo }
}

// =============================================================================
// Helpers de aserción
// -----------------------------------------------------------------------------
// comprobarSinExcepcion: envuelve una aserción que llama a ServicioGit de modo que un
// throw inesperado (p.ej. el defecto de NUL en args) se convierta en un FAIL con
// evidencia, NUNCA en un abort de toda la suite. Así cada método se reporta de
// forma independiente.
// =============================================================================
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

/**
 * Descubre asunto -> hash SIN pasar por ServicioGit, con un `git log` propio de
 * campos separados por "|" (sin NUL, así que no choca con la guarda de args de
 * Node). NO hardcodea hashes: los localiza por asunto, igual que pide el spec.
 * Se usa como RED de seguridad cuando ServicioGit.listarCommits() está roto (mete
 * un NUL \x00 dentro del arg --format y Node lo rechaza), para poder ejercitar
 * igualmente obtenerArchivosCommit/leerBlobEnCommit en el caso del subdirectorio.
 */
function descubrirHashesConGit(repo: string): Map<string, string> {
  const salida = execFileSync('git', ['log', '--all', '--date-order', '--format=%H|%s'], {
    cwd: repo,
    encoding: 'utf8'
  })
  const mapa = new Map<string, string>()
  for (const linea of salida.split('\n')) {
    if (!linea) continue
    const sep = linea.indexOf('|')
    if (sep < 0) continue
    mapa.set(linea.slice(sep + 1), linea.slice(0, sep))
  }
  return mapa
}

// =============================================================================
// Main
// =============================================================================
async function main(): Promise<void> {
  hr('PASO 0 - construir fixture determinista en dir temporal del SO')
  const escenario = crearEscenario()
  console.log('base:  ', escenario.base)
  console.log('repo:  ', escenario.repo, '(raíz del repo git)')
  console.log('sub:   ', escenario.sub, '(proyecto en subdirectorio -> prefijo "sub")')
  console.log('norepo:', escenario.sinRepo, '(NO es repo git)')

  try {
    const silenciar = (): void => {}

    // -----------------------------------------------------------------------
    // CASO (A) IDENTIDAD — raizProyecto = raíz del repo, prefijo ""
    // -----------------------------------------------------------------------
    hr('CASO (A) IDENTIDAD — raizProyecto = raíz del repo (prefijo "")')
    const gitRaiz = new ServicioGit({ raizProyecto: escenario.repo, log: silenciar })

    // --- Descubrimiento de hashes por SUBJECT desde listarCommits() (spec) -----
    // Si listarCommits() lanza (defecto NUL), caemos a un `git log` propio para no
    // dejar sin ejercitar el caso del subdirectorio (que es el foco real).
    let commits: Commit[] | null = null
    let errorListado: unknown = null
    try {
      commits = await gitRaiz.listarCommits()
    } catch (err) {
      errorListado = err
    }

    const hashPorAsunto = new Map<string, string>()
    if (commits) {
      for (const c of commits) hashPorAsunto.set(c.asunto, c.hash)
    } else {
      console.log(
        '\n  ⚠  listarCommits() LANZÓ; se descubren los hashes con un `git log` propio\n' +
          `     (por asunto, sin hardcodear) para poder seguir. Causa: ${mensajeError(errorListado)}\n`
      )
      for (const [asunto, hash] of descubrirHashesConGit(escenario.repo)) hashPorAsunto.set(asunto, hash)
    }
    const hashDeAsunto = (asunto: string): string => {
      const h = hashPorAsunto.get(asunto)
      if (!h) throw new Error(`sin hash para asunto="${asunto}"`)
      return h
    }
    const hashHead = hashDeAsunto(ASUNTOS.S3) // HEAD = tip de main = S3

    // (1) longitud esperada + al menos un merge (padres >= 2)
    if (commits) {
      const hayMerge = commits.some((c) => c.padres.length >= 2)
      const merge = commits.find((c) => c.asunto === ASUNTOS.MERGE)
      check(
        `(1) listarCommits() longitud == ${CANTIDAD_COMMITS_ESPERADA} y hay un merge (padres>=2)`,
        commits.length === CANTIDAD_COMMITS_ESPERADA && hayMerge,
        `length=${commits.length} (esperado ${CANTIDAD_COMMITS_ESPERADA}); merge padres=${merge?.padres.length}`
      )
    } else {
      check(
        `(1) listarCommits() longitud == ${CANTIDAD_COMMITS_ESPERADA} y hay un merge (padres>=2)`,
        false,
        `listarCommits() LANZÓ: ${mensajeError(errorListado)}`
      )
    }

    // (2) rename en la raíz: status 'R' con rutaAnterior (commit C4)
    await comprobarSinExcepcion(
      '(2) obtenerArchivosCommit(C4) contiene R con rutaAnterior (rename raíz utils.js -> src/helpers.js)',
      async () => {
        const archivos = await gitRaiz.obtenerArchivosCommit(hashDeAsunto(ASUNTOS.C4))
        const r = archivos.find((f) => f.estado === 'R')
        return {
          pass: !!r && r.ruta === 'src/helpers.js' && r.rutaAnterior === 'utils.js',
          evidence: JSON.stringify(archivos)
        }
      }
    )

    // (3) delete: status 'D' (commit C7)
    await comprobarSinExcepcion('(3) obtenerArchivosCommit(C7) contiene D (delete notas.md)', async () => {
      const archivos = await gitRaiz.obtenerArchivosCommit(hashDeAsunto(ASUNTOS.C7))
      const d = archivos.find((f) => f.estado === 'D')
      return { pass: !!d && d.ruta === 'notas.md', evidence: JSON.stringify(archivos) }
    })

    // (4) autor no-ASCII byte-exacto ("Zoë Müller") — requiere un Commit real
    // Nota: el nombre lleva 'ë' (e con diéresis) y 'ü', NO 'ö' — la letra con
    // diéresis en "Zoë" es la e, no una o. El check comprobaba 'ö', que no
    // aparece en el nombre y por eso fallaba siempre, sin relación con git.
    if (commits) {
      const zoe = commits.find((c) => c.nombreAutor === ZOE.nombre)
      check(
        '(4) el autor no-ASCII aparece intacto (byte-exacto "Zoë Müller", con ë/ü)',
        !!zoe && zoe.nombreAutor.includes('ë') && zoe.nombreAutor.includes('ü'),
        `nombreAutor=${JSON.stringify(zoe?.nombreAutor)}`
      )
    } else {
      check(
        '(4) el autor no-ASCII aparece intacto (byte-exacto "Zoë Müller", con ë/ü)',
        false,
        'BLOQUEADO: depende de listarCommits(), que lanzó (ver #1)'
      )
    }

    // (5) leerHistorialArchivo(nuevo path del rename) cruza el rename (--follow) -> >= 2
    await comprobarSinExcepcion(
      '(5) leerHistorialArchivo("src/helpers.js") >= 2 commits (--follow cruza el rename raíz)',
      async () => {
        const { commits: hist } = await gitRaiz.leerHistorialArchivo('src/helpers.js')
        return {
          pass: hist.length >= 2,
          evidence: `n=${hist.length} subjects=${JSON.stringify(hist.map((h) => h.asunto))}`
        }
      }
    )

    // (6) leerBlobEnCommit(nuevo path, HEAD) -> existe:true con marcador no-ASCII byte-exacto
    await comprobarSinExcepcion(
      `(6) leerBlobEnCommit("src/helpers.js", HEAD) existe:true e incluye "${MARCA}" byte-exacto`,
      async () => {
        const blob = await gitRaiz.leerBlobEnCommit(hashHead, 'src/helpers.js')
        return {
          pass: blob.existe && blob.contenido.includes(MARCA),
          evidence: `existe=${blob.existe} len=${blob.contenido.length} tieneMarca=${blob.contenido.includes(MARCA)}`
        }
      }
    )

    // (7) leerBlobEnCommit(archivo borrado, HEAD) -> existe:false, contenido ''
    await comprobarSinExcepcion(
      '(7) leerBlobEnCommit("notas.md" (borrado en C7), HEAD) existe:false, contenido ""',
      async () => {
        const blob = await gitRaiz.leerBlobEnCommit(hashHead, 'notas.md')
        return {
          pass: blob.existe === false && blob.contenido === '',
          evidence: `existe=${blob.existe} contenido=${JSON.stringify(blob.contenido)}`
        }
      }
    )

    // (8) lado "before" de un alta: archivo en un commit ANTERIOR a su creación
    await comprobarSinExcepcion(
      '(8) leerBlobEnCommit("notas.md", C1) existe:false (before de un alta; notas.md nace en C3)',
      async () => {
        const blob = await gitRaiz.leerBlobEnCommit(hashDeAsunto(ASUNTOS.C1), 'notas.md')
        return {
          pass: blob.existe === false && blob.contenido === '',
          evidence: `existe=${blob.existe} contenido=${JSON.stringify(blob.contenido)}`
        }
      }
    )

    // (13) listarRamas(): locales (main, feature) + remota (origin/main),
    // origin/HEAD filtrado, y `esActual` correcto en cada caso.
    await comprobarSinExcepcion(
      '(13) listarRamas() -> locales [feature, main] + remota [origin/main]; origin/HEAD filtrado',
      async () => {
        const ramas = await gitRaiz.listarRamas()
        const porNombre = new Map(ramas.map((b) => [b.nombre, b]))
        const headOrigin = ramas.find((b) => b.nombre.endsWith('/HEAD'))
        const main = porNombre.get('main')
        const ramaFuncionalidad = porNombre.get('feature')
        const ramaPrincipalOrigin = porNombre.get(RAMA_REMOTA)
        const pass =
          !headOrigin &&
          !!main &&
          main.esRemota === false &&
          main.esActual === true &&
          !!ramaFuncionalidad &&
          ramaFuncionalidad.esRemota === false &&
          ramaFuncionalidad.esActual === false &&
          !!ramaPrincipalOrigin &&
          ramaPrincipalOrigin.esRemota === true &&
          ramaPrincipalOrigin.esActual === false
        return {
          pass,
          evidence: JSON.stringify(ramas)
        }
      }
    )

    // -----------------------------------------------------------------------
    // CASO (B) PREFIJO — raizProyecto = <raíz>/sub, prefijo "sub"
    // El repo real sigue siendo fx.repo; ServicioGit lo resuelve vía
    // rev-parse --show-toplevel y calcula el prefijo "sub".
    // -----------------------------------------------------------------------
    hr('CASO (B) PREFIJO — raizProyecto = <raíz>/sub (prefijo "sub")')
    const gitSub = new ServicioGit({ raizProyecto: escenario.sub, log: silenciar })

    // (9a) alta dentro de sub: path relativo a sub, SIN prefijo "sub/"
    await comprobarSinExcepcion(
      '(9a) obtenerArchivosCommit(S1) -> ruta relativa a sub SIN prefijo ("a.js", estado A)',
      async () => {
        const archivos = await gitSub.obtenerArchivosCommit(hashDeAsunto(ASUNTOS.S1))
        const a = archivos.find((f) => f.estado === 'A')
        return {
          pass: archivos.length === 1 && !!a && a.ruta === 'a.js',
          evidence: JSON.stringify(archivos)
        }
      }
    )

    // (9b) rename DENTRO de sub: path Y rutaAnterior SIN prefijo "sub/"
    await comprobarSinExcepcion(
      '(9b) obtenerArchivosCommit(S3) -> rename DENTRO de sub con ruta="b.js" y rutaAnterior="a.js" (sin prefijo)',
      async () => {
        const archivos = await gitSub.obtenerArchivosCommit(hashDeAsunto(ASUNTOS.S3))
        const r = archivos.find((f) => f.estado === 'R')
        return {
          pass: !!r && r.ruta === 'b.js' && r.rutaAnterior === 'a.js',
          evidence: JSON.stringify(archivos)
        }
      }
    )

    // (10) leerHistorialArchivo(archivo en sub, ruta relativa al PROYECTO sin "sub/")
    await comprobarSinExcepcion(
      '(10) leerHistorialArchivo("b.js") -> [S3,S2,S1] (--follow cruza el rename dentro de sub)',
      async () => {
        const { commits: hist } = await gitSub.leerHistorialArchivo('b.js')
        const asuntos = hist.map((h) => h.asunto)
        return {
          pass:
            hist.length === 3 &&
            asuntos.includes(ASUNTOS.S3) &&
            asuntos.includes(ASUNTOS.S2) &&
            asuntos.includes(ASUNTOS.S1),
          evidence: `n=${hist.length} subjects=${JSON.stringify(asuntos)}`
        }
      }
    )

    // (11) leerBlobEnCommit(archivo en sub relativo al proyecto) -> contenido esperado
    await comprobarSinExcepcion(
      `(11) leerBlobEnCommit("b.js", S3) existe:true e incluye "${MARCA}" (contenido movido por el rename)`,
      async () => {
        const blob = await gitSub.leerBlobEnCommit(hashDeAsunto(ASUNTOS.S3), 'b.js')
        return {
          pass: blob.existe && blob.contenido.includes(MARCA) && blob.contenido.includes('export const x = 2'),
          evidence: `existe=${blob.existe} contenido=${JSON.stringify(blob.contenido)}`
        }
      }
    )

    // CASO (D): monorepo con el cableado de producción. ServicioWorkspace llama
    // `fijarRaizProyecto(proyecto, contenedora)` y, si el escaneo no halla repos, el renderer manda la
    // CONTENEDORA como si fuera el repo: abrir `packages/app` de un monorepo no debe dejar vacía la
    // vista de git. Se prueba con las llamadas exactas de la app.
    hr('CASO (D) MONOREPO — contenedora = proyecto = <raíz>/sub (cableado de producción)')
    const ejecutarGitEnRepo = (args: string[]): string =>
      execFileSync('git', args, { cwd: escenario.repo, encoding: 'utf8' })

    const gitProd = new ServicioGit({ raizProyecto: escenario.sub, log: silenciar })
    gitProd.fijarRaizProyecto(escenario.sub, escenario.sub) // como hace ServicioWorkspace.setActiveProject

    // (14) rename que CRUZA el borde de la carpeta abierta, en un solo commit:
    //   sub/b.js -> fuera.js   (SALE  -> no se muestra: la UI no puede abrirlo)
    //   README.md -> sub/dentro.md (ENTRA -> se degrada a alta 'A', sin rutaAnterior)
    ejecutarGitEnRepo(['mv', 'sub/b.js', 'fuera.js'])
    ejecutarGitEnRepo(['mv', 'README.md', 'sub/dentro.md'])
    ejecutarGitEnRepo(['commit', '-m', 'S4 renames cruzando el borde de sub'])
    const hashCruce = ejecutarGitEnRepo(['rev-parse', 'HEAD']).trim()
    await comprobarSinExcepcion(
      '(14) obtenerArchivosCommit(S4): rename que SALE de sub se omite; el que ENTRA se degrada a A ("dentro.md")',
      async () => {
        const archivos = await gitProd.obtenerArchivosCommit(hashCruce)
        return {
          pass:
            archivos.length === 1 &&
            archivos[0].estado === 'A' &&
            archivos[0].ruta === 'dentro.md' &&
            archivos[0].rutaAnterior === undefined,
          evidence: JSON.stringify(archivos)
        }
      }
    )

    // (15) leerEstadoRepos([contenedora]): el renderer manda la carpeta abierta, que NO
    // es un repo. Debe resolverse al repo que la contiene, traer la rama, y listar
    // SOLO los cambios de dentro de sub, con rutas SIN el prefijo "sub/".
    writeFileSync(path.join(escenario.sub, 'dentro.md'), '# tocado dentro\n', 'utf8')
    writeFileSync(path.join(escenario.sub, 'nuevo.txt'), 'sin trackear\n', 'utf8')
    writeFileSync(path.join(escenario.repo, 'fuera.js'), '// tocado FUERA de sub\n', 'utf8')
    await comprobarSinExcepcion(
      '(15) leerEstadoRepos([sub]) -> 1 repo, rama "main", rutas sin prefijo y SIN los cambios de fuera de sub',
      async () => {
        const st = await gitProd.leerEstadoRepos([escenario.sub])
        const rutas = st[0]?.cambios.map((c) => c.ruta).sort() ?? []
        return {
          pass:
            st.length === 1 &&
            st[0].rama === 'main' &&
            st[0].error === undefined &&
            rutas.length === 2 &&
            rutas[0] === 'dentro.md' &&
            rutas[1] === 'nuevo.txt',
          evidence: JSON.stringify(st)
        }
      }
    )

    // (16) prepararArchivo con una ruta contenedora-relativa: git debe recibir "sub/…".
    await comprobarSinExcepcion(
      '(16) prepararArchivo("nuevo.txt") -> ok y el ÍNDICE contiene "sub/nuevo.txt"',
      async () => {
        const res = await gitProd.prepararArchivo('nuevo.txt')
        const preparados = ejecutarGitEnRepo(['diff', '--cached', '--name-only']).trim()
        return {
          pass: res.ok === true && preparados === 'sub/nuevo.txt',
          evidence: `prepararArchivo=${JSON.stringify(res)} índice=${JSON.stringify(preparados)}`
        }
      }
    )

    // (17) leerBlobWorktree con ruta contenedora-relativa: lee el disco de sub/, no de la
    // raíz del repo (con existe:false el visor de diff se rompería).
    await comprobarSinExcepcion(
      '(17) leerBlobWorktree("dentro.md") lee <repo>/sub/dentro.md (existe:true)',
      async () => {
        const blob = await gitProd.leerBlobWorktree('dentro.md')
        return {
          pass: blob.existe === true && blob.contenido === '# tocado dentro\n',
          evidence: `existe=${blob.existe} contenido=${JSON.stringify(blob.contenido)}`
        }
      }
    )

    // -----------------------------------------------------------------------
    // CASO (C) SIN REPO — raizProyecto = dir que NO es repo git
    // -----------------------------------------------------------------------
    hr('CASO (C) SIN REPO — raizProyecto = dir que NO es repo git')
    await comprobarSinExcepcion(
      '(12) sin repo: listarCommits/[], obtenerArchivosCommit/[], leerHistorialArchivo/[], leerBlobEnCommit/{false,""}',
      async () => {
        const gitNone = new ServicioGit({ raizProyecto: escenario.sinRepo, log: silenciar })
        const noCommits = await gitNone.listarCommits()
        const sinArchivos = await gitNone.obtenerArchivosCommit('cualquier')
        const noHist = await gitNone.leerHistorialArchivo('x')
        const noBlob = await gitNone.leerBlobEnCommit('y', 'x')
        return {
          pass:
            noCommits.length === 0 &&
            sinArchivos.length === 0 &&
            noHist.commits.length === 0 &&
            noBlob.existe === false &&
            noBlob.contenido === '',
          evidence:
            `commits=${noCommits.length} files=${sinArchivos.length} hist=${noHist.commits.length} ` +
            `blob=${JSON.stringify(noBlob)}`
        }
      }
    )
  } finally {
    hr('PASO FINAL - limpieza (borrar el fixture temporal)')
    try {
      rmSync(escenario.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      console.log('fixture temporal eliminado:', escenario.base)
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
