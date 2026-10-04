#!/usr/bin/env node
// =============================================================================
// Prueba del árbol de CARPETAS del selector de ámbito (npm run test:carpetas). Toca disco de
// verdad (árbol temporal). Cubre: solo carpetas, rutas relativas POSIX sin la raíz, el orden del
// explorador, la profundidad que cuadra con la ruta, las carpetas excluidas, el tope que corta
// por lo más hondo y lo DICE (`truncado`), y que una carpeta sin permisos no tumba la lista pero
// una raíz ilegible sí lanza.
// =============================================================================

import { register } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'

const resolveTsHook = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook))

const { listarCarpetas } = await import('./carpetas.ts')

const results: { name: string; pass: boolean; evidence: string }[] = []
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      -> ${evidence}`)
}

const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-carp-')))

try {
  const dir = (rel: string): void => {
    mkdirSync(path.join(raiz, rel), { recursive: true })
  }
  const file = (rel: string): void => {
    const abs = path.join(raiz, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, 'x')
  }

  dir('src/main/files')
  dir('src/main/search')
  dir('src/renderer/src/components')
  dir('docs')
  dir('scripts')
  // Ruido que NO debe salir en el desplegable.
  dir('node_modules/react/lib')
  dir('.git/refs/heads')
  dir('.idea')
  file('package.json')
  file('src/main/index.ts')
  file('docs/LEEME.md')

  hr('El árbol de carpetas')

  const { carpetas, truncado } = await listarCarpetas(raiz)
  const rutas = carpetas.map((c) => c.path)

  check(
    '(1) solo carpetas: ningún archivo se cuela',
    !rutas.some((r) => r.endsWith('.json') || r.endsWith('.ts') || r.endsWith('.md')),
    rutas.join(' ')
  )
  check(
    '(2a) las rutas son relativas y POSIX (nunca una barra de Windows)',
    rutas.every((r) => !r.includes('\\') && !path.isAbsolute(r) && r !== ''),
    rutas.slice(0, 4).join(' ')
  )
  check(
    '(2b) la RAÍZ no se lista: ese ámbito es el otro botón',
    !rutas.includes('') && !rutas.includes('.'),
    `n=${rutas.length}`
  )

  // El orden es lo único que hace legible la sangría: si una hija no viniera justo
  // detrás de su madre, el desplegable enseñaría niveles sueltos sin padre visible.
  const esperado = [
    'docs',
    'scripts',
    'src',
    'src/main',
    'src/main/files',
    'src/main/search',
    'src/renderer',
    'src/renderer/src',
    'src/renderer/src/components'
  ]
  check(
    '(3) orden del explorador: alfabético y cada carpeta seguida de las suyas',
    JSON.stringify(rutas) === JSON.stringify(esperado),
    JSON.stringify(rutas)
  )

  // Si la profundidad y la ruta se desincronizaran, la sangría del desplegable
  // mentiría sobre la jerarquía y no habría ningún error que lo delatara.
  check(
    '(4) la profundidad CUADRA con la ruta',
    carpetas.every((c) => c.profundidad === c.path.split('/').length - 1),
    carpetas.map((c) => `${c.profundidad}:${c.path}`).join(' ')
  )
  check(
    '(4b) el nombre es el último tramo de la ruta',
    carpetas.every((c) => c.nombre === c.path.slice(c.path.lastIndexOf('/') + 1)),
    carpetas.map((c) => c.nombre).join(' ')
  )

  check(
    '(5) node_modules, .git y .idea quedan fuera (y no se entra a mirarlas)',
    !rutas.some((r) => /(^|\/)(node_modules|\.git|\.idea)($|\/)/.test(r)),
    'ninguna'
  )
  check('(6a) sin truncar cuando cabe todo', truncado === false, `truncado=${truncado}`)

  hr('Los topes')

  {
    // El tope tiene que DECIRSE: un desplegable al que le faltan carpetas en
    // silencio hace creer que una carpeta no existe.
    const r = await listarCarpetas(raiz, { maxCarpetas: 3 })
    check(
      '(6b) el tope corta Y lo marca',
      r.carpetas.length === 3 && r.truncado === true,
      `n=${r.carpetas.length} truncado=${r.truncado}`
    )
  }
  {
    // LA GARANTÍA QUE IMPORTA, y que el recorrido en profundidad NO daba: al
    // truncar se pierde lo más HONDO, nunca una carpeta de primer nivel. Medido en
    // un proyecto Java EE real: `DefaultWebApp` traía 3397 carpetas, la lista se
    // cortaba dentro de ella y `src` —que va después alfabéticamente— no aparecía
    // en absoluto. El usuario la buscaba en el desplegable y concluía que no existe.
    //
    // Aquí el fixture reproduce esa forma: una carpeta temprana con muchas hijas y
    // otra de primer nivel que va DESPUÉS alfabéticamente.
    for (let i = 0; i < 40; i++) dir(`aaa-gorda/sub${String(i).padStart(2, '0')}`)
    dir('zzz-tardia')
    const r = await listarCarpetas(raiz, { maxCarpetas: 12 })
    const rutas = r.carpetas.map((c) => c.path)
    check(
      '(6b2) al truncar NO desaparece una carpeta de primer nivel',
      r.truncado === true && rutas.includes('zzz-tardia') && rutas.includes('aaa-gorda'),
      `truncado=${r.truncado} · ${JSON.stringify(rutas)}`
    )
    // Y el corolario que hace legible la sangría: NINGUNA carpeta se queda huérfana.
    // Recorriendo por niveles es imposible que aparezca una hija sin su madre, y es
    // justo lo que rompía la lista antes: niveles sueltos colgando de nada.
    const enLista = new Set(rutas)
    check(
      '(6b3) al truncar no queda ninguna carpeta huérfana (toda hija tiene a su madre)',
      r.carpetas.every((c) => c.profundidad === 0 || enLista.has(c.path.slice(0, c.path.lastIndexOf('/')))),
      `n=${rutas.length} profundidades=${JSON.stringify([...new Set(r.carpetas.map((c) => c.profundidad))])}`
    )
  }
  {
    // El orden por TRAMOS y no por cadena: con `localeCompare` sobre la ruta
    // entera, `src-old` se colaba entre `src` y `src/main` (el guion vale menos que
    // la barra) y con la sangría se leía como hija de otra carpeta.
    dir('src-old')
    const r = await listarCarpetas(raiz)
    const rutas = r.carpetas.map((c) => c.path)
    const iSrc = rutas.indexOf('src')
    const iMain = rutas.indexOf('src/main')
    const iOld = rutas.indexOf('src-old')
    check(
      '(6d) una carpeta hermana NO se cuela entre otra y sus hijas',
      iSrc >= 0 && iMain > iSrc && iOld > iMain,
      `src=${iSrc} src/main=${iMain} src-old=${iOld}`
    )
  }
  {
    // La red contra ciclos de enlaces simbólicos. Con profundidad 1 solo debe salir
    // el primer nivel.
    const completo = await listarCarpetas(raiz)
    const primerNivel = completo.carpetas.filter((c) => c.profundidad === 0).length
    const r = await listarCarpetas(raiz, { maxProfundidad: 1 })
    check(
      '(6c) la profundidad máxima corta por niveles, y el primero sale entero',
      r.carpetas.every((c) => c.profundidad === 0) && r.carpetas.length === primerNivel,
      `n=${r.carpetas.length} de ${primerNivel} de primer nivel · ${JSON.stringify(r.carpetas.map((c) => c.path))}`
    )
  }

  hr('Lo que no puede tumbar la lista')

  {
    // Una raíz que no existe SÍ lanza: no hay lista que enseñar, y devolver [] se
    // leería como "este proyecto no tiene carpetas", que es una mentira distinta.
    let lanzo = false
    try {
      await listarCarpetas(path.join(raiz, 'no-existe'))
    } catch {
      lanzo = true
    }
    check('(7a) una raíz ilegible lanza (no finge una lista vacía)', lanzo, `lanzó=${lanzo}`)
  }
  {
    // El tope tiene que acotar TAMBIÉN el nivel que se está armando, no solo lo que
    // se publica: si no, el nivel siguiente se materializa entero en memoria antes
    // de que el tope actúe una vuelta después. Con un tope de 2 sobre un árbol que
    // tiene decenas de carpetas, no puede haberse leído medio árbol para tirarlo.
    const r = await listarCarpetas(raiz, { maxCarpetas: 2 })
    check(
      '(6e) el tope corta pronto y no arrastra el nivel entero',
      r.carpetas.length === 2 && r.truncado === true,
      `n=${r.carpetas.length} truncado=${r.truncado}`
    )
  }
  {
    // Una carpeta vacía es una carpeta: sale, y sin hijas.
    dir('vacia')
    const r = await listarCarpetas(raiz)
    check(
      '(7b) una carpeta vacía se lista igual',
      r.carpetas.some((c) => c.path === 'vacia'),
      JSON.stringify(r.carpetas.map((c) => c.path))
    )
  }
} finally {
  rmSync(raiz, { recursive: true, force: true })
}

const allPass = results.every((r) => r.pass)
console.log('\n' + '='.repeat(78))
console.log(
  `VEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`
)
console.log('='.repeat(78))
process.exit(allPass ? 0 : 1)
