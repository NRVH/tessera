#!/usr/bin/env node
// =============================================================================
// Prueba de arbolArchivos (npm run test:arbol-archivos): el árbol de los archivos
// de un commit. Fija la compactación de cadenas de una sola carpeta y sus dos cortes,
// que el orden no dependa del de llegada, `segmentos`/`rutasSegmentos`, el conteo a
// cualquier profundidad, el orden (carpetas primero, con acentos) y el aplanado, donde
// el colapso se indexa por la HOJA de la cadena.
// =============================================================================

import {
  construirArbolArchivos,
  aplanarArbolArchivos,
  type ArchivoEntrada,
  type NodoArchivo,
  type FilaArbol
} from './arbolArchivos.ts'

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

/** Entrada mínima: la letra solo colorea, no cambia la forma del árbol. */
function ent(path: string, letra = 'M'): ArchivoEntrada {
  return { path, letra }
}

/** Etiqueta de un nodo: la cadena compactada con "/" final si es carpeta. */
function etiqueta(nodo: NodoArchivo): string {
  return nodo.tipo === 'carpeta' ? `${nodo.segmentos.join('/')}/` : nodo.nombre
}

/** Etiquetas de un nivel, en orden. */
function etiquetas(nodos: readonly NodoArchivo[]): string[] {
  return nodos.map(etiqueta)
}

/** Busca una carpeta por su ruta (la de la HOJA de su cadena). */
function carpeta(nodos: readonly NodoArchivo[], ruta: string): NodoArchivo | null {
  for (const n of nodos) {
    if (n.tipo !== 'carpeta') continue
    if (n.ruta === ruta) return n
    const dentro = carpeta(n.hijos, ruta)
    if (dentro) return dentro
  }
  return null
}

/** Vista textual del aplanado: sangría + etiqueta, para leer los FAIL de un vistazo. */
function pintar(filas: readonly FilaArbol[]): string[] {
  return filas.map((f) => `${'  '.repeat(f.profundidad)}${etiqueta(f.nodo)}`)
}

const SIN_COLAPSAR = new Set<string>()

function main(): void {
  // -------------------------------------------------------------------------
  hr('1) CASOS BORDE: vacío y raíz')
  {
    check('lista vacía -> árbol vacío', construirArbolArchivos([]).length === 0, '0 nodos')

    const raiz = construirArbolArchivos([ent('README.md'), ent('package.json')])
    check(
      'archivos de la raíz son nodos de nivel 0',
      raiz.length === 2 && raiz.every((n) => n.tipo === 'archivo'),
      etiquetas(raiz).join(', ')
    )

    // Una ruta vacía no debe fabricar una carpeta fantasma.
    const conVacia = construirArbolArchivos([ent(''), ent('a.txt')])
    check('ruta vacía se descarta', conVacia.length === 1, etiquetas(conVacia).join(', '))
  }

  // -------------------------------------------------------------------------
  hr('2) COMPACTACIÓN de cadenas de un solo hijo')
  {
    const arbol = construirArbolArchivos([ent('src/renderer/src/App.tsx')])
    check(
      'src/renderer/src es UNA sola fila',
      arbol.length === 1 && etiqueta(arbol[0]) === 'src/renderer/src/',
      etiquetas(arbol).join(', ')
    )
    const nodo = arbol[0]
    check(
      'segmentos lleva los 3 tramos',
      nodo.tipo === 'carpeta' && nodo.segmentos.join('|') === 'src|renderer|src',
      nodo.tipo === 'carpeta' ? nodo.segmentos.join('|') : '?'
    )
    check(
      'rutasSegmentos acumula cada tramo',
      nodo.tipo === 'carpeta' && nodo.rutasSegmentos.join('|') === 'src|src/renderer|src/renderer/src',
      nodo.tipo === 'carpeta' ? nodo.rutasSegmentos.join('|') : '?'
    )
    check(
      'ruta es la HOJA de la cadena',
      nodo.tipo === 'carpeta' && nodo.ruta === 'src/renderer/src',
      nodo.tipo === 'carpeta' ? nodo.ruta : '?'
    )
  }

  // -------------------------------------------------------------------------
  hr('3) LOS DOS CORTES de la compactación')
  {
    // Corte por ramificación: src tiene dos hijos, así que no se funde con ninguno.
    const ramifica = construirArbolArchivos([ent('src/main/a.ts'), ent('src/preload/b.ts')])
    check(
      'una carpeta con DOS hijos no se compacta',
      ramifica.length === 1 && etiqueta(ramifica[0]) === 'src/',
      etiquetas(ramifica).join(', ')
    )
    const src = ramifica[0]
    check(
      'y sus dos hijas sí (cada una con su archivo)',
      src.tipo === 'carpeta' && etiquetas(src.hijos).join(', ') === 'main/, preload/',
      src.tipo === 'carpeta' ? etiquetas(src.hijos).join(', ') : '?'
    )

    // Corte por archivo: el único hijo de `docs` es un archivo, no una carpeta.
    const conArchivo = construirArbolArchivos([ent('docs/plan.md')])
    const docs = conArchivo[0]
    check(
      'el único hijo ARCHIVO corta la cadena (dos filas)',
      conArchivo.length === 1 &&
        etiqueta(conArchivo[0]) === 'docs/' &&
        docs.tipo === 'carpeta' &&
        docs.hijos.length === 1 &&
        docs.hijos[0].tipo === 'archivo',
      `${etiquetas(conArchivo).join(', ')} > ${docs.tipo === 'carpeta' ? etiquetas(docs.hijos).join(', ') : '?'}`
    )

    // Una carpeta con un archivo Y una carpeta tampoco se compacta.
    const mixta = construirArbolArchivos([ent('lib/index.ts'), ent('lib/util/x.ts')])
    const lib = mixta[0]
    check(
      'carpeta + archivo mezclados no compactan',
      lib.tipo === 'carpeta' && etiqueta(lib) === 'lib/' && etiquetas(lib.hijos).join(', ') === 'util/, index.ts',
      lib.tipo === 'carpeta' ? `lib/ > ${etiquetas(lib.hijos).join(', ')}` : '?'
    )
  }

  // -------------------------------------------------------------------------
  hr('4) El ORDEN DE LLEGADA no cambia el resultado')
  {
    const rutas = ['src/a/b/uno.ts', 'src/a/b/dos.ts', 'src/z.ts', 'docs/guia.md']
    const directo = pintar(aplanarArbolArchivos(construirArbolArchivos(rutas.map((r) => ent(r))), SIN_COLAPSAR))
    const alReves = pintar(
      aplanarArbolArchivos(construirArbolArchivos([...rutas].reverse().map((r) => ent(r))), SIN_COLAPSAR)
    )
    check(
      'insertar al revés da el MISMO árbol',
      directo.join('\n') === alReves.join('\n'),
      directo.join(' / ')
    )
  }

  // -------------------------------------------------------------------------
  hr('5) CONTEO recursivo de archivos')
  {
    const arbol = construirArbolArchivos([
      ent('src/main/git/GitService.ts'),
      ent('src/main/git/otro.ts'),
      ent('src/renderer/App.tsx'),
      ent('README.md')
    ])
    const src = carpeta(arbol, 'src')
    check(
      'src cuenta 3 (a cualquier profundidad, no hijos directos)',
      src?.tipo === 'carpeta' && src.archivos === 3,
      src?.tipo === 'carpeta' ? String(src.archivos) : '?'
    )
    const git = carpeta(arbol, 'src/main/git')
    check(
      'la cadena main/git cuenta 2',
      git?.tipo === 'carpeta' && git.archivos === 2,
      git?.tipo === 'carpeta' ? String(git.archivos) : '?'
    )
  }

  // -------------------------------------------------------------------------
  hr('6) ORDEN: carpetas primero, alfabético con acentos')
  {
    const arbol = construirArbolArchivos([
      ent('zeta.txt'),
      ent('alfa.txt'),
      ent('ñu/x.txt'),
      ent('nido/y.txt'),
      ent('árbol/z.txt')
    ])
    const tipos = arbol.map((n) => n.tipo)
    check(
      'los 3 primeros son carpetas y los 2 últimos archivos',
      tipos.join(',') === 'carpeta,carpeta,carpeta,archivo,archivo',
      tipos.join(',')
    )
    // localeCompare pone "árbol" antes de "nido" y "ñu" después de "nido"; un
    // sort por code unit dejaría los acentos al final, detrás de "zeta".
    check(
      'acentos ordenados por localeCompare',
      etiquetas(arbol).slice(0, 3).join(',') === 'árbol/,nido/,ñu/',
      etiquetas(arbol).slice(0, 3).join(',')
    )
    check(
      'archivos alfabéticos',
      etiquetas(arbol).slice(3).join(',') === 'alfa.txt,zeta.txt',
      etiquetas(arbol).slice(3).join(',')
    )
  }

  // -------------------------------------------------------------------------
  hr('7) Dos index.ts distintos son filas de PADRES distintos')
  {
    const arbol = construirArbolArchivos([ent('a/index.ts'), ent('b/index.ts')])
    const filas = aplanarArbolArchivos(arbol, SIN_COLAPSAR)
    const rutas = filas.filter((f) => f.nodo.tipo === 'archivo').map((f) => f.nodo.ruta)
    check(
      'ambos existen, con rutas distintas y bajo su carpeta',
      rutas.join(',') === 'a/index.ts,b/index.ts' && filas.length === 4,
      pintar(filas).join(' / ')
    )
  }

  // -------------------------------------------------------------------------
  hr('8) APLANADO: profundidad y colapso')
  {
    const arbol = construirArbolArchivos([
      ent('src/renderer/src/App.tsx'),
      ent('src/renderer/src/git/x.ts'),
      ent('README.md')
    ])
    const filas = aplanarArbolArchivos(arbol, SIN_COLAPSAR)
    check(
      'la cadena ocupa UN nivel y sus hijos van a +1',
      pintar(filas).join('\n') ===
        ['src/renderer/src/', '  git/', '    x.ts', '  App.tsx', 'README.md'].join('\n'),
      pintar(filas).join(' / ')
    )

    // El colapso se indexa por la HOJA de la cadena: es la única clave que existe.
    const colapsada = aplanarArbolArchivos(arbol, new Set(['src/renderer/src']))
    check(
      'colapsar por la HOJA de la cadena oculta todo lo de dentro',
      pintar(colapsada).join('\n') === ['src/renderer/src/', 'README.md'].join('\n'),
      pintar(colapsada).join(' / ')
    )
    check(
      'la fila colapsada se marca expandida:false',
      colapsada[0].expandida === false && filas[0].expandida === true,
      `colapsada=${colapsada[0].expandida} abierta=${filas[0].expandida}`
    )

    // Un tramo INTERMEDIO no es clave de nada: colapsar por él no hace nada.
    const porIntermedio = aplanarArbolArchivos(arbol, new Set(['src']))
    check(
      'un tramo intermedio de la cadena NO colapsa',
      porIntermedio.length === filas.length,
      `${porIntermedio.length} filas`
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
