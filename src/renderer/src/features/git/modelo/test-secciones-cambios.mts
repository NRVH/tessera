#!/usr/bin/env node
// =============================================================================
// Prueba de seccionesCambios (npm run test:secciones-cambios): las reglas puras de
// la lista de Cambios. Fija el reparto ordenado en secciones, la lista aplanada, que
// las marcas válidas salgan de la MISMA regla que el reparto, la poda (que devuelve
// el mismo Set si no cayó nada), el agrupado de marcas por sección, el alto de la
// sección de un repo y que AA y DD cuentan como conflicto.
// Decisiones: docs/decisiones/git/cambios-lista-y-marcas.md
// =============================================================================

import type { RepoStatus, WorkingChange } from '../../../../../shared/git-ipc.ts'
import { contarItems } from './estadoRepos.ts'
import {
  agruparMarcadas,
  alturaSeccionExpandida,
  clavesDeRepo,
  clavesMarcables,
  construirItems,
  ejeDe,
  filaDe,
  marcaDeRepo,
  podarMarcas,
  repartirOrdenado,
  reposConCambios,
  rutaEnRepo,
  soloCambios
} from './seccionesCambios.ts'

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

function cambio(path: string, indexStatus: string, worktreeStatus: string): WorkingChange {
  return { path, indexStatus, worktreeStatus } as WorkingChange
}

const CAMBIOS: WorkingChange[] = [
  cambio('src/b.ts', 'M', '.'), // preparado
  cambio('src/a.ts', 'M', 'M'), // MM: preparado y modificado
  cambio('z/a.ts', '.', 'M'), // modificado (mismo nombre que src/a.ts)
  cambio('nuevo.txt', '.', '?'), // sin versionar
  cambio('choque.txt', 'U', 'U') // conflicto
]

function main(): void {
  hr('1) Reparto ordenado en secciones')
  const s = repartirOrdenado(CAMBIOS)
  check(
    'conflict solo lleva el conflicto',
    s.conflict.length === 1 && s.conflict[0].path === 'choque.txt',
    s.conflict.map((c) => c.path).join(',')
  )
  check(
    'staged: por nombre y, a igualdad, por ruta',
    s.staged.map((c) => c.path).join(',') === 'src/a.ts,src/b.ts',
    s.staged.map((c) => c.path).join(',')
  )
  check(
    'unstaged: el MM también está, y el orden desempata por carpeta',
    s.unstaged.map((c) => c.path).join(',') === 'src/a.ts,z/a.ts',
    s.unstaged.map((c) => c.path).join(',')
  )
  check(
    'untracked solo lleva lo sin rastrear',
    s.untracked.length === 1 && s.untracked[0].path === 'nuevo.txt',
    s.untracked.map((c) => c.path).join(',')
  )
  check('el eje de staged es staged y el de las demás unstaged', ejeDe('staged') === 'staged' && ejeDe('conflict') === 'unstaged' && ejeDe('untracked') === 'unstaged', 'ejeDe')

  hr('2) Lista aplanada')
  const items = construirItems(s)
  const ids = items.map((i) => i.id)
  check(
    'una cabecera por sección con algo, seguida de sus filas, en el orden de git status',
    ids.join('|') ===
      'h-conflict|conflict:choque.txt|h-staged|staged:src/a.ts|staged:src/b.ts|h-unstaged|unstaged:src/a.ts|unstaged:z/a.ts|h-untracked|untracked:nuevo.txt',
    ids.join('|')
  )
  check('sin cambios no hay ni cabeceras', construirItems(repartirOrdenado([])).length === 0, 'vacío')
  const fila = filaDe(cambio('src/a.ts', 'M', '.'), 'staged')
  check(
    'la fila lleva la letra de SU eje y profundidad 0',
    fila.profundidad === 0 &&
      fila.nodo.tipo === 'archivo' &&
      fila.nodo.entrada.letra === 'M' &&
      fila.nodo.nombre === 'a.ts',
    JSON.stringify(fila.nodo)
  )
  const alta = filaDe(cambio('nuevo.txt', '.', '?'), 'untracked')
  check(
    "un archivo sin rastrear se ve como alta ('A')",
    alta.nodo.tipo === 'archivo' && alta.nodo.entrada.letra === 'A',
    JSON.stringify(alta.nodo)
  )

  hr('3) Marcas: claves válidas y poda')
  const estado: RepoStatus[] = [{ repo: '/r', branch: 'main', changes: CAMBIOS }] as RepoStatus[]
  const validas = clavesMarcables(estado)
  check(
    'las claves salen de la misma regla que el reparto (el MM tiene dos, el conflicto una)',
    [...validas].sort().join('|') ===
      [
        'conflict choque.txt',
        'staged src/a.ts',
        'staged src/b.ts',
        'unstaged src/a.ts',
        'unstaged z/a.ts',
        'untracked nuevo.txt'
      ].join('|'),
    [...validas].sort().join('|')
  )
  const prev = new Set(['staged src/a.ts', 'unstaged z/a.ts'])
  check('si no cayó ninguna se devuelve el MISMO Set', podarMarcas(prev, validas) === prev, 'misma identidad')
  const podado = podarMarcas(new Set(['staged src/a.ts', 'staged fantasma.ts']), validas)
  check(
    'lo que ya no existe se quita y lo demás se conserva',
    podado.size === 1 && podado.has('staged src/a.ts'),
    [...podado].join(',')
  )

  hr('4) Agrupado de marcas por sección')
  const g = agruparMarcadas(new Set(['staged a b.ts', 'unstaged z.ts', 'sinespacio', 'rara x.ts']))
  check('la ruta conserva sus espacios (se corta en el primero)', g.staged.has('a b.ts'), [...g.staged].join(','))
  check('cada clave va a su sección', g.unstaged.has('z.ts') && g.untracked.size === 0 && g.conflict.size === 0, 'unstaged')
  check('una clave sin sección conocida o sin espacio se ignora', g.staged.size === 1 && g.unstaged.size === 1, 'ignoradas')

  hr('5) Alto de la sección de un repo')
  const cab = 30
  const alto = 20
  const { cabeceras, filas } = contarItems(CAMBIOS)
  check(
    'cargando (sin estado): la cabecera y una línea',
    alturaSeccionExpandida(undefined, cab, alto) === cab + alto,
    String(alturaSeccionExpandida(undefined, cab, alto))
  )
  check(
    'con error o sin cambios: la cabecera y una línea',
    alturaSeccionExpandida({ repo: '/r', branch: 'x', changes: [], error: 'boom' } as RepoStatus, cab, alto) === cab + alto &&
      alturaSeccionExpandida({ repo: '/r', branch: 'x', changes: [] } as RepoStatus, cab, alto) === cab + alto,
    'línea de aviso'
  )
  check(
    'con cambios: la cabecera, más sus cabeceras y filas (lo que pinta el cuerpo)',
    alturaSeccionExpandida(estado[0], cab, alto) === cab + cabeceras * cab + filas * alto,
    `${cabeceras} cabeceras, ${filas} filas`
  )

  hr('6) AA (los dos lo añaden) y DD (los dos lo borran) también son conflicto')
  const choques: WorkingChange[] = [
    cambio('ambos-anaden.txt', 'A', 'A'),
    cambio('ambos-borran.txt', 'D', 'D'),
    cambio('alta.txt', 'A', '.'),
    cambio('borrado.txt', 'D', '.'),
    cambio('intento.txt', '.', 'A')
  ]
  const sc = repartirOrdenado(choques)
  check(
    'AA y DD van a Conflictos y a ninguna otra sección',
    sc.conflict.map((c) => c.path).join(',') === 'ambos-anaden.txt,ambos-borran.txt' &&
      ![...sc.staged, ...sc.unstaged, ...sc.untracked].some((c) => c.path.startsWith('ambos-')),
    `conflict=${sc.conflict.map((c) => c.path).join(',')} staged=${sc.staged.map((c) => c.path).join(',')}`
  )
  check(
    'A. y D. (preparados) y .A (intento de añadir) no son conflicto',
    sc.staged.map((c) => c.path).join(',') === 'alta.txt,borrado.txt' && sc.unstaged.map((c) => c.path).join(',') === 'intento.txt',
    `staged=${sc.staged.map((c) => c.path).join(',')} unstaged=${sc.unstaged.map((c) => c.path).join(',')}`
  )
  const clavesChoque = clavesMarcables([{ repo: '/r', branch: 'main', changes: choques }] as RepoStatus[])
  check(
    'las marcas de AA y DD son de Conflictos (la misma regla que el reparto)',
    clavesChoque.has('conflict ambos-anaden.txt') &&
      clavesChoque.has('conflict ambos-borran.txt') &&
      !clavesChoque.has('staged ambos-anaden.txt') &&
      !clavesChoque.has('unstaged ambos-borran.txt'),
    [...clavesChoque].sort().join('|')
  )

  hr('7) La lista de varios repos: solo los que tienen cambios, sin la cabecera repetida y con rutas del repo')
  const soloModificados: WorkingChange[] = [cambio('area/repo/src/a.ts', '.', 'M'), cambio('area/repo/b.ts', '.', 'M')]
  const sm = repartirOrdenado(soloModificados)
  check('soloCambios: solo modificados sin preparar', soloCambios(sm) && !soloCambios(repartirOrdenado(choques)), '')
  check(
    'construirItems con omitirUnica quita la cabecera de «Cambios»; sin omitir, la conserva',
    construirItems(sm, true).every((i) => i.kind === 'fila') && construirItems(sm)[0].kind === 'header',
    construirItems(sm, true).map((i) => i.kind).join(',')
  )
  check(
    'y el alto en la lista de varios lo descuenta (lo mismo que se pinta)',
    alturaSeccionExpandida({ repo: '/r', branch: 'main', changes: soloModificados } as RepoStatus, cab, alto) === cab + 2 * alto,
    String(alturaSeccionExpandida({ repo: '/r', branch: 'main', changes: soloModificados } as RepoStatus, cab, alto))
  )
  check(
    'rutaEnRepo quita la carpeta del repo, y sin prefijo deja la ruta',
    rutaEnRepo('area/repo/src/a.ts', 'area/repo') === 'src/a.ts' && rutaEnRepo('src/a.ts', '') === 'src/a.ts' && rutaEnRepo('otro/a.ts', 'area/repo') === 'otro/a.ts',
    rutaEnRepo('area/repo/src/a.ts', 'area/repo')
  )
  const repos = [{ repoHostPath: '/limpio' }, { repoHostPath: '/sucio' }, { repoHostPath: '/roto' }, { repoHostPath: '/pendiente' }]
  const estados = new Map<string, RepoStatus>([
    ['/limpio', { repo: '/limpio', branch: 'main', changes: [] }],
    ['/sucio', { repo: '/sucio', branch: 'main', changes: soloModificados }],
    ['/roto', { repo: '/roto', branch: null, changes: [], error: 'boom' }]
  ])
  const ver = (perezosa: boolean): string => reposConCambios(repos, (r) => estados.get(r), perezosa).map((r) => r.repoHostPath).join(',')
  check(
    'reposConCambios: sin carga perezosa, solo los sucios o con error; con ella, todos (si no, un limpio no se volvería a pedir)',
    ver(false) === '/sucio,/roto' && ver(true) === '/limpio,/sucio,/roto,/pendiente',
    `${ver(false)} | ${ver(true)}`
  )
  const clavesSucio = clavesDeRepo(estados.get('/sucio'))
  check(
    'la casilla del repo: vacía, parcial y llena según sus marcas',
    marcaDeRepo(clavesSucio, new Set()) === 'vacia' &&
      marcaDeRepo(clavesSucio, new Set([clavesSucio[0]])) === 'parcial' &&
      marcaDeRepo(clavesSucio, new Set(clavesSucio)) === 'llena',
    clavesSucio.join('|')
  )

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
