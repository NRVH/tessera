#!/usr/bin/env node
// =============================================================================
// Prueba del proyecto en la caché de blobs (npm run test:blob-cache). Protege una fuga
// entre proyectos: la misma ruta relativa existe en varios, y una petición en vuelo de
// uno no puede entregarse a otro. Fija que el dedupe sigue dentro de un mismo
// proyecto, que no cruza entre proyectos, que índice y HEAD se comportan como el disco,
// que un hash real SÍ se comparte (deliberado) y que la contenedora viaja con la petición.
// Decisiones: docs/decisiones/git/cambios-blobs-y-diff.md
// =============================================================================

// El módulo toca `window.tessera` en tiempo de EJECUCIÓN, así que se monta el
// doble ANTES de importarlo. Su otro import es `import type`, que el
// type-stripping de Node borra: por eso esto se puede probar sin DOM ni JSX.
interface Llamada {
  clase: string
  raiz: string
  ruta: string
}
const llamadas: Llamada[] = []
/** Resolvedores pendientes: las peticiones se dejan EN VUELO a propósito. */
const pendientes: Array<(v: unknown) => void> = []

function espia(clase: string) {
  return (raiz: string, a: string, b?: string) => {
    const ruta = b ?? a
    llamadas.push({ clase, raiz, ruta })
    return new Promise((res) => pendientes.push(res as (v: unknown) => void))
  }
}

;(globalThis as unknown as { window: unknown }).window = {
  tessera: {
    git: {
      workingBlob: espia('w'),
      indexBlob: espia('i'),
      blobAtCommit: espia('c')
    }
  }
}

const { fetchBlob } = await import('./blobCache.ts')

// ---------------------------------------------------------------------------
let pasadas = 0
let total = 0
function hr(t: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(t)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  total++
  if (pass) pasadas++
  console.log(`${pass ? '[PASS]' : '[FAIL]'} ${name}`)
  console.log(`        ${evidence}`)
}

/** Cuántas peticiones IPC se han lanzado hasta ahora para una clase+ruta. */
const cuenta = (clase: string, ruta: string): number =>
  llamadas.filter((l) => l.clase === clase && l.ruta === ruta).length

const worktree = (path: string) => ({ source: 'worktree' as const, path })
const indice = (path: string) => ({ source: 'index' as const, path })
const commit = (hash: string, path: string) => ({ source: 'commit' as const, hash, path })

const A = 'D:/Proyectos/proyecto-a'
const B = 'D:/Proyectos/proyecto-b'

// El molde de los tests del repo no arrastra los tipos del renderer (no hay JSX ni
// DOM en la cadena de imports), así que el lado se pasa sin tipar del todo.
const b = (side: unknown, raiz: string): Promise<unknown> => fetchBlob(side as never, raiz)

hr('(1) DENTRO del mismo proyecto, el dedupe se conserva')
const p1 = b(worktree('src/App.tsx'), A)
const p2 = b(worktree('src/App.tsx'), A)
check(
  'dos peticiones de la misma ruta comparten UNA sola llamada IPC',
  cuenta('w', 'src/App.tsx') === 1 && p1 === p2,
  `llamadas=${cuenta('w', 'src/App.tsx')}, misma promesa=${p1 === p2}`
)
check('la petición lleva la contenedora de su proyecto', llamadas[0]?.raiz === A, `raiz=${llamadas[0]?.raiz}`)

hr('(2) En OTRO proyecto, la misma ruta NO reaprovecha la del primero')
const p3 = b(worktree('src/App.tsx'), B)
check(
  'el otro proyecto lanza SU propia petición',
  cuenta('w', 'src/App.tsx') === 2,
  `llamadas totales para esa ruta=${cuenta('w', 'src/App.tsx')} (una por proyecto)`
)
check('y no se le entregó la promesa del primero', p3 !== p1, 'promesas distintas')
check('con su contenedora', llamadas[1]?.raiz === B, `raiz=${llamadas[1]?.raiz}`)

hr('(3) índice y HEAD se comportan igual')
b(indice('pom.xml'), A)
b(indice('pom.xml'), B)
check('el ÍNDICE tampoco cruza proyectos', cuenta('i', 'pom.xml') === 2, `llamadas=${cuenta('i', 'pom.xml')}`)

b(commit('HEAD', 'README.md'), A)
b(commit('HEAD', 'README.md'), B)
check(
  'HEAD (ref MÓVIL, se resuelve distinto en cada repo) tampoco cruza',
  cuenta('c', 'README.md') === 2,
  `llamadas=${cuenta('c', 'README.md')}`
)

hr('(4) un HASH REAL sí se comparte entre proyectos (deliberado)')
const sha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const c1 = b(commit(sha, 'src/Main.java'), A)
const c2 = b(commit(sha, 'src/Main.java'), B)
check(
  'un SHA es único en el universo: se reaprovecha y NO lleva contenedora en la clave',
  cuenta('c', 'src/Main.java') === 1 && c1 === c2,
  `llamadas=${cuenta('c', 'src/Main.java')}, misma promesa=${c1 === c2}`
)

// Se sueltan las peticiones que quedaron colgadas, para que el proceso pueda salir.
for (const r of pendientes) r({ exists: false, content: '' })

hr('RESULTADO (PASS/FAIL)')
const allPass = pasadas === total
console.log(`VEREDICTO: ${pasadas}/${total} PASS${allPass ? ' — TODO PASS' : ' — HAY FALLOS'}`)
process.exit(allPass ? 0 : 1)
