// =============================================================================
// Prueba de necesitaReescaneo() / rutaAfectaRepos() (npm run test:rescan-repos).
// Fija la regla que evita un bucle medido (un reescaneo de ~1000 `stat` por cada
// ráfaga del watcher): la lista de repos de primer nivel solo cambia con entradas de
// primer nivel y con los `.git` de la raíz o de una subcarpeta directa.
// =============================================================================

import { necesitaReescaneo, rutaAfectaRepos } from './rescanRepos.ts'

let pasadas = 0
let total = 0

function hr(title: string): void {
  console.log('')
  console.log('='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}

function check(name: string, pass: boolean, evidence: string): void {
  total++
  if (pass) pasadas++
  console.log(`${pass ? '[PASS]' : '[FAIL]'} ${name}`)
  console.log(`        ${evidence}`)
}

hr('RUTAS QUE SÍ afectan la lista de repos')

check(
  'una carpeta de primer nivel que aparece (git clone recién terminado)',
  rutaAfectaRepos('repo-nuevo'),
  'rutaAfectaRepos("repo-nuevo") = true'
)

// Las dos siguientes cubren ramas DEFENSIVAS, y hay que decirlo para no dar por
// probado un camino que hoy no existe: ninguna ruta con un segmento `.git` llega
// por `files:changed` (FileService.classifyPath la desvía antes a 'git' o 'noise').
// Quien cubre el `.git` en producción es `files:gitChanged`, que va SIN filtrar.
// Se prueban igual porque la pregunta que responde la función no depende del canal.
check(
  'DEFENSIVO: el .git de una subcarpeta directa (lo que decide si ES repo)',
  rutaAfectaRepos('mi-repo/.git/HEAD'),
  'rutaAfectaRepos("mi-repo/.git/HEAD") = true'
)

check(
  'DEFENSIVO: el .git de la propia raíz abierta',
  rutaAfectaRepos('.git/index'),
  'rutaAfectaRepos(".git/index") = true'
)

check(
  'el .git como ARCHIVO (worktree / submódulo)',
  rutaAfectaRepos('un-worktree/.git'),
  'rutaAfectaRepos("un-worktree/.git") = true'
)

hr('RUTAS QUE NO afectan (el ruido que causaba el bucle)')

check(
  'output de build a tres niveles: el caso real de mvn package',
  !rutaAfectaRepos('java-jee-intranet/target/classes/Foo.class'),
  'rutaAfectaRepos("java-jee-intranet/target/classes/Foo.class") = false'
)

check(
  'código fuente dentro de un repo',
  !rutaAfectaRepos('tessera/src/renderer/src/App.tsx'),
  'rutaAfectaRepos("tessera/src/renderer/src/App.tsx") = false'
)

check(
  'un fichero a dos niveles cuyo segundo segmento NO es .git',
  !rutaAfectaRepos('repo/dist'),
  'rutaAfectaRepos("repo/dist") = false'
)

check(
  'una carpeta llamada .github (no debe confundirse con .git)',
  !rutaAfectaRepos('repo/.github/workflows/ci.yml'),
  'rutaAfectaRepos("repo/.github/workflows/ci.yml") = false'
)

hr('NORMALIZACIÓN DEFENSIVA')

check(
  'ruta vacía no cuenta como entrada de primer nivel',
  !rutaAfectaRepos(''),
  'rutaAfectaRepos("") = false'
)

check(
  'barra inicial colada: no debe convertir la raíz en primer nivel',
  !rutaAfectaRepos('/repo/src/main.ts'),
  'rutaAfectaRepos("/repo/src/main.ts") = false'
)

check(
  'barra final colada en una carpeta de primer nivel sigue contando',
  rutaAfectaRepos('repo-nuevo/'),
  'rutaAfectaRepos("repo-nuevo/") = true'
)

hr('RÁFAGAS COMPLETAS')

check(
  'ráfaga de un build entero: ni un solo escaneo',
  !necesitaReescaneo({
    paths: [
      'java-jee-intranet/target/classes/A.class',
      'java-jee-intranet/target/classes/B.class',
      'java-jee-intranet/target/maven-status/x.lst',
      'otro-repo/dist/bundle.js'
    ],
    parcial: false
  }),
  'necesitaReescaneo(4 rutas de build, parcial=false) = false'
)

check(
  'una sola ruta relevante entre mucho ruido SÍ dispara',
  necesitaReescaneo({
    paths: [
      'java-jee-intranet/target/classes/A.class',
      'java-jee-intranet/target/classes/B.class',
      // Carpeta de PRIMER NIVEL: es la forma en que un clon recién terminado llega
      // de verdad por `files:changed` (su `.git` no llega por ahí; ver arriba).
      'repo-recien-clonado'
    ],
    parcial: false
  }),
  'necesitaReescaneo([...ruido, "repo-recien-clonado"]) = true'
)

check(
  'parcial=true SIEMPRE dispara: la lista está truncada y no se puede decidir',
  necesitaReescaneo({ paths: ['repo/target/classes/A.class'], parcial: true }),
  'necesitaReescaneo(ruido, parcial=true) = true — mismo criterio que reposTocados()'
)

check(
  'ráfaga vacía no dispara',
  !necesitaReescaneo({ paths: [], parcial: false }),
  'necesitaReescaneo([], parcial=false) = false'
)

hr('RESULTADO (PASS/FAIL)')
const allPass = pasadas === total
console.log(`VEREDICTO: ${pasadas}/${total} PASS${allPass ? ' — TODO PASS' : ' — HAY FALLOS'}`)
process.exit(allPass ? 0 : 1)
