#!/usr/bin/env node
// =============================================================================
// Prueba de la selección de archivo AUTO-ABRIBLE (npm run test:auto-abrir). Los dos errores
// posibles tienen caso: abrir de más (descompilar un `.class` suelto por pulsación) y de
// menos (abrir un archivo que no es el resaltado). Cubre: extensiones excluidas, mayúsculas
// y rutas sin extensión, `carpeta.jar/x.ts`, entradas dentro de un jar, `primeraFilaAbrible`
// y `siguienteFilaAbrible` (las carpetas SÍ son destino, los extremos no envuelven).
// =============================================================================

import {
  esAutoAbrible,
  primeraFilaAbrible,
  siguienteFilaAbrible,
  NO_AUTO_ABRIBLES
} from './autoAbrir.ts'
import { EXT_COMPRIMIDOS } from '../../../../../shared/comprimidos.ts'
import type { FilaArbol } from './arbolArchivos.ts'

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

/** Fila de archivo del árbol aplanado. */
function arch(ruta: string, profundidad = 0): FilaArbol {
  const nombre = ruta.split('/').pop() ?? ruta
  return {
    nodo: { tipo: 'archivo', nombre, ruta, entrada: { path: ruta, letra: 'M' } },
    profundidad,
    expandida: true
  }
}
/** Fila de carpeta del árbol aplanado. */
function dir(ruta: string, profundidad = 0): FilaArbol {
  return {
    nodo: {
      tipo: 'carpeta',
      segmentos: ruta.split('/'),
      ruta,
      rutasSegmentos: [ruta],
      hijos: [],
      archivos: 1
    },
    profundidad,
    expandida: true
  }
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('1) Extensiones excluidas e incluidas')
  // -------------------------------------------------------------------------
  const fuera = [
    'backup/dump.7z',
    'backup/dump.rar',
    'backup/dump.tar',
    'backup/dump.tar.gz',
    'backup/dump.tgz',
    'imagenes/disco.iso',
    'paquetes/app.deb',
    'target/classes/com/ejemplo/Util.class'
  ]
  for (const p of fuera) {
    check(`NO se auto-abre: ${p}`, !esAutoAbrible(p), 'excluido')
  }
  const dentro = [
    'src/App.tsx',
    'src/main/java/Servicio.java',
    'docs/manual.pdf',
    'docs/acta.docx',
    'assets/logo.png',
    'assets/icono.svg',
    'config/app.properties',
    'README.md'
  ]
  for (const p of dentro) {
    check(`SÍ se auto-abre: ${p}`, esAutoAbrible(p), 'incluido')
  }

  // LA FAMILIA ZIP YA NO SE SALTA: desde que un comprimido tiene diff de verdad,
  // saltárselo sería saltarse justo el archivo que el usuario venía a mirar.
  const comprimidos = [
    'lib/comunes.jar',
    'dist/app.war',
    'dist/app.ear',
    'libs/soporte.aar',
    'docs/adjuntos.zip',
    'movil/app.apk',
    'python/paquete-1.0.whl'
  ]
  for (const p of comprimidos) {
    check(`SÍ se auto-abre (ya tiene diff): ${p}`, esAutoAbrible(p), 'incluido')
  }

  // EL INVARIANTE QUE IMPIDE QUE LAS DOS LISTAS SE PELEEN: nada de lo que el diff
  // sabe comparar puede estar en la lista de "no lo abras tú". Si alguien añade una
  // extensión al catálogo de comprimidos, este caso lo delata al instante.
  const solapadas = [...EXT_COMPRIMIDOS].filter((ext) => NO_AUTO_ABRIBLES.has(ext))
  check(
    'ninguna extensión comparable está en la lista de exclusión',
    solapadas.length === 0,
    solapadas.length === 0 ? 'sin solape' : `solapan: ${solapadas.join(', ')}`
  )

  // -------------------------------------------------------------------------
  hr('2-4) Casos borde del parser de extensión')
  // -------------------------------------------------------------------------
  check(
    'mayúsculas: BACKUP/DUMP.7Z se excluye igual',
    !esAutoAbrible('BACKUP/DUMP.7Z'),
    'excluido'
  )
  check('sin extensión (Makefile) se auto-abre', esAutoAbrible('Makefile'), 'incluido')
  check('sin extensión con carpeta (bin/run) se auto-abre', esAutoAbrible('bin/run'), 'incluido')
  check(
    'carpeta.jar/x.ts NO se excluye (el punto está antes del último "/")',
    esAutoAbrible('carpeta.jar/x.ts'),
    'incluido'
  )
  check(
    'una entrada DENTRO de un jar se clasifica por su propia extensión',
    esAutoAbrible('lib/x.jar!/com/config.properties') &&
      !esAutoAbrible('lib/x.jar!/com/Servicio.class'),
    'properties incluido, class excluido'
  )
  check('un archivo que solo es un punto final se auto-abre', esAutoAbrible('notas.'), 'incluido')

  // -------------------------------------------------------------------------
  hr('5) primeraFilaAbrible')
  // -------------------------------------------------------------------------
  {
    const filas = [dir('src'), dir('src/main', 1), arch('src/main/App.tsx', 2)]
    const f = primeraFilaAbrible(filas)
    check(
      'salta las carpetas y da el primer archivo',
      f !== null && f.nodo.tipo === 'archivo' && f.nodo.ruta === 'src/main/App.tsx',
      f && f.nodo.tipo === 'archivo' ? f.nodo.ruta : 'null'
    )
  }
  {
    const filas = [dir('lib'), arch('lib/comunes.jar', 1), dir('src'), arch('src/App.tsx', 1)]
    const f = primeraFilaAbrible(filas)
    check(
      'el .jar que va primero SÍ es el que se abre (ya tiene diff)',
      f !== null && f.nodo.tipo === 'archivo' && f.nodo.ruta === 'lib/comunes.jar',
      f && f.nodo.tipo === 'archivo' ? f.nodo.ruta : 'null'
    )
  }
  {
    const filas = [dir('backup'), arch('backup/a.7z', 1), arch('backup/b.iso', 1)]
    check(
      'solo comprimidos ILEGIBLES -> null (no se abre nada)',
      primeraFilaAbrible(filas) === null,
      'null'
    )
  }
  check('lista vacía -> null', primeraFilaAbrible([]) === null, 'null')

  // -------------------------------------------------------------------------
  hr('6) siguienteFilaAbrible')
  // -------------------------------------------------------------------------
  {
    //  0: src/            1: src/App.tsx     2: lib/
    //  3: lib/a.jar       4: lib/b.jar       5: lib/notas.md
    const filas = [
      dir('src'),
      arch('src/App.tsx', 1),
      dir('lib'),
      arch('lib/a.7z', 1),
      arch('lib/b.iso', 1),
      arch('lib/notas.md', 1)
    ]
    check(
      'hacia abajo desde 1 cae en la CARPETA de 2 (destino válido: ahí van ←/→)',
      siguienteFilaAbrible(filas, 1, 1) === 2,
      String(siguienteFilaAbrible(filas, 1, 1))
    )
    check(
      'hacia abajo desde 2 salta los dos ilegibles y cae en el 5',
      siguienteFilaAbrible(filas, 2, 1) === 5,
      String(siguienteFilaAbrible(filas, 2, 1))
    )
    check(
      'hacia arriba desde 5 salta los ilegibles y cae en la carpeta 2',
      siguienteFilaAbrible(filas, 5, -1) === 2,
      String(siguienteFilaAbrible(filas, 5, -1))
    )
    check(
      'entrar desde FUERA por arriba (-1) aterriza en la primera fila',
      siguienteFilaAbrible(filas, -1, 1) === 0,
      String(siguienteFilaAbrible(filas, -1, 1))
    )
    check(
      'entrar desde FUERA por abajo (n) aterriza en la última abrible',
      siguienteFilaAbrible(filas, filas.length, -1) === 5,
      String(siguienteFilaAbrible(filas, filas.length, -1))
    )
    check(
      'una lista de PURAS carpetas SÍ tiene destino (son plegables)',
      siguienteFilaAbrible([dir('a'), dir('a/b', 1)], -1, 1) === 0,
      String(siguienteFilaAbrible([dir('a'), dir('a/b', 1)], -1, 1))
    )
    check('en el tope, hacia arriba -> null', siguienteFilaAbrible(filas, 0, -1) === null, 'null')
    check(
      'en el fondo, hacia abajo -> null (no envuelve)',
      siguienteFilaAbrible(filas, 5, 1) === null,
      'null'
    )
  }
  {
    // Todo lo que queda por debajo está excluido: no hay a dónde ir.
    const filas = [arch('src/App.tsx'), arch('lib/a.7z'), arch('lib/b.rar')]
    check(
      'si lo que queda es todo ilegible -> null',
      siguienteFilaAbrible(filas, 0, 1) === null,
      'null'
    )
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

main()
