#!/usr/bin/env node
// =============================================================================
// Prueba de la SIEMBRA del estado del working-tree (npm run test:cache-estado-repos).
// Lo delicado es qué entra en la clave: no lleva el tick de refresco, distingue
// proyectos y listas de repos, y usa NUL y no `|` como separador (legal en macOS).
// También fija que un mapa vacío no se guarda y que el tope desaloja el más antiguo.
// Decisiones: docs/decisiones/git/cambios-caches-de-estado.md
// =============================================================================

import {
  MAX_OBJETIVOS_RECORDADOS,
  claveObjetivoEstado,
  recordarEstadoRepos,
  semillaEstadoRepos
} from './cacheEstadoRepos.ts'
import type { RepoStatus } from '../../../../../shared/git-ipc.ts'

// ---------------------------------------------------------------------------
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

const st = (repo: string, n = 0): RepoStatus => ({
  repo,
  branch: 'main',
  changes: Array.from({ length: n }, (_, i) => ({
    path: `a${i}.ts`,
    indexStatus: '.' as const,
    worktreeStatus: 'M' as const
  }))
})
const mapaCon = (...repos: RepoStatus[]): ReadonlyMap<string, RepoStatus> =>
  new Map(repos.map((r) => [r.repo, r]))

// ---------------------------------------------------------------------------
function main(): void {
  // --- (1) LA CLAVE NO LLEVA EL TICK ---------------------------------------
  // Es la decisión que hace útil a esta caché. La clave de la GENERACIÓN sí lleva
  // el tick (un refresco abre generación nueva), pero lo que se sabe de un proyecto
  // no deja de ser lo último que se supo porque alguien pulse Ctrl+S. Con el tick
  // dentro, la siembra no habría servido nunca para el caso más común.
  hr('(1) la clave del objetivo NO depende del tick de refresco')
  {
    const a = claveObjetivoEstado('C:/p/uno', 'r1\nr2')
    const b = claveObjetivoEstado('C:/p/uno', 'r1\nr2')
    check('(1a) misma clave para el mismo proyecto y los mismos repos', a === b, JSON.stringify(a))
    recordarEstadoRepos(a, mapaCon(st('r1', 3)))
    check(
      '(1b) la siembra sigue ahí tras un refresco (que sube el tick, no la clave)',
      semillaEstadoRepos(b)?.get('r1')?.changes.length === 3,
      `changes=${semillaEstadoRepos(b)?.get('r1')?.changes.length}`
    )
  }

  // --- (2) objetivos distintos no se pisan ---------------------------------
  hr('(2) proyecto distinto, o lista de repos distinta, son objetivos distintos')
  {
    const uno = claveObjetivoEstado('C:/p/uno', 'r1')
    const dos = claveObjetivoEstado('C:/p/dos', 'r1')
    const unoOtrosRepos = claveObjetivoEstado('C:/p/uno', 'r1\nr3')
    recordarEstadoRepos(uno, mapaCon(st('r1', 1)))
    recordarEstadoRepos(dos, mapaCon(st('r1', 9)))
    check(
      '(2a) dos proyectos con el mismo nombre de repo no se pisan',
      semillaEstadoRepos(uno)?.get('r1')?.changes.length === 1 &&
        semillaEstadoRepos(dos)?.get('r1')?.changes.length === 9,
      'uno=1 dos=9'
    )
    check(
      '(2b) una lista de repos distinta es otro objetivo (aún sin siembra)',
      semillaEstadoRepos(unoOtrosRepos) === undefined,
      'undefined'
    )
    check(
      '(2c) sin proyecto, la clave es estable y no revienta',
      claveObjetivoEstado(null, '') === '\u0000',
      JSON.stringify(claveObjetivoEstado(null, ''))
    )
  }

  // --- (3) EL SEPARADOR, y por qué no puede ser `|` ------------------------
  // En este repo la costumbre es separar con `|` "porque Windows no lo admite en un
  // nombre de archivo". Tessera corre TAMBIÉN en macOS, donde `|` es un carácter de
  // ruta perfectamente legal: estos dos objetivos son distintos y con `|` habrían
  // dado la misma clave, sembrando uno con el estado del otro.
  hr('(3) el separador NUL no colisiona donde `|` sí lo haría')
  {
    const a = claveObjetivoEstado('/Users/x/a', 'b|c')
    const b = claveObjetivoEstado('/Users/x/a|b', 'c')
    check('(3a) dos objetivos que con `|` colisionarían dan claves distintas', a !== b, `${JSON.stringify(a)} != ${JSON.stringify(b)}`)
    recordarEstadoRepos(a, mapaCon(st('ra', 1)))
    recordarEstadoRepos(b, mapaCon(st('rb', 2)))
    check(
      '(3b) y cada uno conserva SU siembra',
      semillaEstadoRepos(a)?.has('ra') === true &&
        semillaEstadoRepos(a)?.has('rb') === false &&
        semillaEstadoRepos(b)?.has('rb') === true,
      'sin contaminación'
    )
    check(
      '(3c) el separador es el byte NUL, que ninguna ruta puede contener',
      claveObjetivoEstado('p', 'r').includes('\u0000'),
      JSON.stringify(claveObjetivoEstado('p', 'r'))
    )
  }

  // --- (4) un mapa vacío no se guarda --------------------------------------
  hr('(4) un mapa vacío no se recuerda')
  {
    const k = claveObjetivoEstado('C:/p/vacio', 'r')
    recordarEstadoRepos(k, new Map())
    check(
      '(4a) no se guarda: no aporta nada y ocuparía una ranura del tope',
      semillaEstadoRepos(k) === undefined,
      'undefined'
    )
  }

  // --- (5) el tope, y que usar un objetivo lo rejuvenece --------------------
  // Se llena con MAX claves NUEVAS, que por el propio tope expulsan a todo lo de las
  // secciones anteriores: así el caso no necesita una función de limpieza que en
  // producción no llamaría nadie.
  hr('(5) tope LRU de objetivos recordados')
  {
    const claves = Array.from({ length: MAX_OBJETIVOS_RECORDADOS }, (_, i) =>
      claveObjetivoEstado(`C:/lru/${i}`, 'r')
    )
    for (const k of claves) recordarEstadoRepos(k, mapaCon(st('r', 1)))
    check(
      '(5a) caben exactamente MAX_OBJETIVOS_RECORDADOS, y desalojan a los anteriores',
      claves.every((k) => semillaEstadoRepos(k) !== undefined) &&
        semillaEstadoRepos(claveObjetivoEstado('C:/p/uno', 'r1')) === undefined,
      `los ${MAX_OBJETIVOS_RECORDADOS} presentes; los viejos fuera`
    )
    // Re-escribir el más antiguo lo mueve al final; el siguiente desalojo debe
    // llevarse al que ahora es el más viejo, no a él.
    recordarEstadoRepos(claves[0], mapaCon(st('r', 2)))
    recordarEstadoRepos(claveObjetivoEstado('C:/lru/nuevo', 'r'), mapaCon(st('r', 1)))
    check(
      '(5b) re-escribir un objetivo lo rejuvenece: se desaloja el siguiente, no él',
      semillaEstadoRepos(claves[0]) !== undefined && semillaEstadoRepos(claves[1]) === undefined,
      'claves[0] dentro, claves[1] fuera'
    )
  }

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

main()
