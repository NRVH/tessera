#!/usr/bin/env node
// =============================================================================
// Prueba del ÁMBITO de la caché de blobs (npm run test:blob-cache). Protege una fuga
// entre perfiles: las claves mutables eran la ruta relativa pelada y una petición en
// vuelo de un perfil se entregaba a otro. Fija que el dedupe sigue dentro de un mismo
// ámbito, que no cruza entre ámbitos, que índice y HEAD se comportan como el disco,
// que un hash real SÍ se comparte (deliberado) y que `fijarAmbito` es idempotente.
// Decisiones: docs/decisiones/git/cambios-blobs-y-diff.md
// =============================================================================

// El módulo toca `window.tessera` en tiempo de EJECUCIÓN, así que se monta el
// doble ANTES de importarlo. Su otro import es `import type`, que el
// type-stripping de Node borra: por eso esto se puede probar sin DOM ni JSX.
interface Llamada {
  clase: string
  ruta: string
}
const llamadas: Llamada[] = []
/** Resolvedores pendientes: las peticiones se dejan EN VUELO a propósito. */
const pendientes: Array<(v: unknown) => void> = []

function espia(clase: string) {
  return (a: string, b?: string) => {
    const ruta = b ?? a
    llamadas.push({ clase, ruta })
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

const { fetchBlob, fijarAmbito } = await import('./blobCache.ts')

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

// El molde de los tests del repo no arrastra los tipos del renderer (no hay JSX ni
// DOM en la cadena de imports), así que el lado se pasa sin tipar del todo.
const b = (side: unknown): Promise<unknown> => fetchBlob(side as never)

hr('(1) DENTRO del mismo ámbito, el dedupe se conserva')
fijarAmbito('alfa|D:/Proyectos/proyecto-a')
const p1 = b(worktree('src/App.tsx'))
const p2 = b(worktree('src/App.tsx'))
check(
  'dos peticiones de la misma ruta comparten UNA sola llamada IPC',
  cuenta('w', 'src/App.tsx') === 1 && p1 === p2,
  `llamadas=${cuenta('w', 'src/App.tsx')}, misma promesa=${p1 === p2}`
)

hr('(2) AL CAMBIAR de ámbito, la misma ruta NO reaprovecha la del anterior')
fijarAmbito('beta|D:/Proyectos/proyecto-b')
const p3 = b(worktree('src/App.tsx'))
check(
  'la contenedora nueva lanza SU propia petición',
  cuenta('w', 'src/App.tsx') === 2,
  `llamadas totales para esa ruta=${cuenta('w', 'src/App.tsx')} (una por ámbito)`
)
check(
  'y no se le entregó la promesa del ámbito anterior',
  p3 !== p1,
  'promesas distintas'
)

hr('(3) índice y HEAD se comportan igual')
fijarAmbito('alfa|D:/Proyectos/proyecto-a')
b(indice('pom.xml'))
fijarAmbito('beta|D:/Proyectos/proyecto-b')
b(indice('pom.xml'))
check(
  'el ÍNDICE tampoco cruza ámbitos',
  cuenta('i', 'pom.xml') === 2,
  `llamadas=${cuenta('i', 'pom.xml')}`
)

fijarAmbito('alfa|D:/Proyectos/proyecto-a')
b(commit('HEAD', 'README.md'))
fijarAmbito('beta|D:/Proyectos/proyecto-b')
b(commit('HEAD', 'README.md'))
check(
  'HEAD (ref MÓVIL, se resuelve distinto en cada repo) tampoco cruza',
  cuenta('c', 'README.md') === 2,
  `llamadas=${cuenta('c', 'README.md')}`
)

hr('(4) un HASH REAL sí se comparte entre ámbitos (deliberado)')
const sha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
fijarAmbito('alfa|D:/Proyectos/proyecto-a')
const c1 = b(commit(sha, 'src/Main.java'))
fijarAmbito('beta|D:/Proyectos/proyecto-b')
const c2 = b(commit(sha, 'src/Main.java'))
check(
  'un SHA es único en el universo: se reaprovecha y NO debe llevar ámbito',
  cuenta('c', 'src/Main.java') === 1 && c1 === c2,
  `llamadas=${cuenta('c', 'src/Main.java')}, misma promesa=${c1 === c2}`
)

hr('(5) fijarAmbito es idempotente')
fijarAmbito('gamma|D:/Proyectos/proyecto-c')
b(worktree('build.gradle'))
fijarAmbito('gamma|D:/Proyectos/proyecto-c')
b(worktree('build.gradle'))
check(
  'repetir el mismo ámbito NO tira el dedupe en vuelo',
  cuenta('w', 'build.gradle') === 1,
  `llamadas=${cuenta('w', 'build.gradle')}`
)

// Se sueltan las peticiones que quedaron colgadas, para que el proceso pueda salir.
for (const r of pendientes) r({ exists: false, content: '' })

hr('RESULTADO (PASS/FAIL)')
const allPass = pasadas === total
console.log(`VEREDICTO: ${pasadas}/${total} PASS${allPass ? ' — TODO PASS' : ' — HAY FALLOS'}`)
process.exit(allPass ? 0 : 1)
