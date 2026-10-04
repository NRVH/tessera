#!/usr/bin/env node
// =============================================================================
// Prueba de textSearch (npm run test:text-search): el motor de búsqueda de las vistas
// renderizadas (.md y .docx), sin DOM. Lo que más duele: una regex a medio teclear no
// debe tumbar el panel, un patrón que casa vacío (`a*`) no debe colgar el renderer, y
// `mapearRango` (desplazamiento del texto concatenado a nodo+posición) no debe tener
// off-by-one. Cubre las opciones de búsqueda, el tope de coincidencias, moverIndice y
// mapearRango en límites, segmentos vacíos y fuera de rango.
// =============================================================================

import {
  MAX_COINCIDENCIAS,
  buscarCoincidencias,
  coincidenciasCon,
  compilarBusqueda,
  esRegexValida,
  mapearRango,
  moverIndice,
  type OpcionesBusqueda
} from './textSearch.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const LLANO: OpcionesBusqueda = { caseSensitive: false, wholeWord: false, regex: false }
const opts = (extra: Partial<OpcionesBusqueda> = {}): OpcionesBusqueda => ({ ...LLANO, ...extra })

/** Trozos y su texto concatenado: lo que domSearch arma con el TreeWalker. */
function corpus(segmentos: readonly string[]): { texto: string; longitudes: number[] } {
  return { texto: segmentos.join(''), longitudes: segmentos.map((s) => s.length) }
}

function trozo(texto: string, c: { inicio: number; fin: number }): string {
  return texto.slice(c.inicio, c.fin)
}

function main(): void {
  hr('buscarCoincidencias')

  {
    const r = buscarCoincidencias('hola mundo hola', 'hola', opts())
    check('(1) literal simple', r.length === 2 && r[0].inicio === 0 && r[1].inicio === 11, JSON.stringify(r))
  }
  {
    // Sin escapar, "a.c" casaría "abc". Con regex apagado NO debe.
    const r = buscarCoincidencias('abc a.c', 'a.c', opts())
    check('(2) metacaracteres escapados con regex apagado', r.length === 1 && r[0].inicio === 4, JSON.stringify(r))
  }
  {
    const r = buscarCoincidencias('Hola HOLA hola', 'hola', opts())
    check('(3) por defecto no distingue mayúsculas', r.length === 3, `n=${r.length}`)
  }
  {
    const r = buscarCoincidencias('Hola HOLA hola', 'hola', opts({ caseSensitive: true }))
    check('(4) caseSensitive', r.length === 1 && r[0].inicio === 10, JSON.stringify(r))
  }
  {
    const texto = 'casa casona casa'
    const r = buscarCoincidencias(texto, 'casa', opts({ wholeWord: true }))
    check(
      '(5) palabra completa ignora "casona"',
      r.length === 2 && r.every((c) => trozo(texto, c) === 'casa'),
      JSON.stringify(r)
    )
  }
  {
    const r = buscarCoincidencias('a1 b22 c333', '[0-9]+', opts({ regex: true }))
    check('(6) regex de verdad', r.length === 3, JSON.stringify(r.map((c) => trozo('a1 b22 c333', c))))
  }
  {
    const r = buscarCoincidencias('lo que sea', '(', opts({ regex: true }))
    check('(7) regex inválida no lanza y da []', r.length === 0 && !esRegexValida('('), `n=${r.length}`)
  }
  {
    check('(8) query vacía', buscarCoincidencias('hola', '', opts()).length === 0, 'n=0')
  }
  {
    check('(9) sin resultados', buscarCoincidencias('hola', 'zzz', opts()).length === 0, 'n=0')
  }
  {
    // Si el bucle no empujara lastIndex, esto no volvería NUNCA. Que el test
    // termine ya es media prueba; la otra media es que no invente coincidencias.
    const r = buscarCoincidencias('bbb', 'a*', opts({ regex: true }))
    check('(10) patrón que casa vacío no cuelga', r.length === 0, `n=${r.length}`)
  }
  {
    const r = buscarCoincidencias('x'.repeat(MAX_COINCIDENCIAS + 500), 'x', opts())
    check('(11) tope de coincidencias', r.length === MAX_COINCIDENCIAS, `n=${r.length}`)
  }

  hr('moverIndice')

  {
    const ok =
      moverIndice(3, -1, 'next') === 0 &&
      moverIndice(3, 0, 'next') === 1 &&
      moverIndice(3, 2, 'next') === 0 &&
      moverIndice(3, -1, 'prev') === 2 &&
      moverIndice(3, 0, 'prev') === 2 &&
      moverIndice(3, 2, 'prev') === 1
    check('(12) circular en ambos sentidos, y -1 de partida', ok, 'next/prev sobre 3')
  }
  {
    check('(13) sin coincidencias -> -1', moverIndice(0, -1, 'next') === -1, '-1')
  }

  hr('mapearRango')

  {
    const { longitudes } = corpus(['hola mundo'])
    const p = mapearRango(longitudes, 5, 10)
    check('(14) dentro de un solo segmento', !!p && p.iSegIni === 0 && p.offIni === 5 && p.iSegFin === 0 && p.offFin === 10, JSON.stringify(p))
  }
  {
    // "ho|la": la coincidencia 'olam' cruza el corte entre los dos nodos.
    const { texto, longitudes } = corpus(['hola ', 'mundo'])
    const c = buscarCoincidencias(texto, 'a mu', opts())[0]
    const p = mapearRango(longitudes, c.inicio, c.fin)
    check('(15) a caballo entre dos segmentos', !!p && p.iSegIni === 0 && p.offIni === 3 && p.iSegFin === 1 && p.offFin === 2, JSON.stringify(p))
  }
  {
    const { longitudes } = corpus(['hola ', 'mundo'])
    const p = mapearRango(longitudes, 5, 10)
    check('(16) arranca justo en el límite', !!p && p.iSegIni === 1 && p.offIni === 0 && p.iSegFin === 1 && p.offFin === 5, JSON.stringify(p))
  }
  {
    // Un nodo de texto VACÍO entre medias no puede alojar un borde del rango.
    const { longitudes } = corpus(['hola', '', 'mundo'])
    const p = mapearRango(longitudes, 4, 6)
    check('(17) segmento vacío intercalado se salta', !!p && p.iSegIni === 2 && p.offIni === 0 && p.iSegFin === 2 && p.offFin === 2, JSON.stringify(p))
  }
  {
    const { longitudes } = corpus(['hola ', 'mundo'])
    const p = mapearRango(longitudes, 6, 10)
    check('(18) hasta el último carácter', !!p && p.iSegFin === 1 && p.offFin === 5, JSON.stringify(p))
  }
  {
    const { longitudes } = corpus(['hola'])
    const fuera = mapearRango(longitudes, 2, 99)
    const vacio = mapearRango(longitudes, 3, 3)
    check('(19) fuera de rango o vacío -> null', fuera === null && vacio === null, `${fuera} / ${vacio}`)
  }
  {
    // Integración: para CADA coincidencia, el texto reconstruido desde los
    // segmentos mapeados tiene que ser exactamente el que se buscó.
    const segmentos = ['El ', 'zorro', ' marrón salta ', '', 'sobre el zorro perezoso']
    const { texto, longitudes } = corpus(segmentos)
    const cs = buscarCoincidencias(texto, 'zorro', opts())
    const todosCuadran = cs.every((c) => {
      const p = mapearRango(longitudes, c.inicio, c.fin)
      if (!p) return false
      let reconstruido = ''
      for (let i = p.iSegIni; i <= p.iSegFin; i++) {
        const desde = i === p.iSegIni ? p.offIni : 0
        const hasta = i === p.iSegFin ? p.offFin : segmentos[i].length
        reconstruido += segmentos[i].slice(desde, hasta)
      }
      return reconstruido === 'zorro'
    })
    check('(20) buscar + mapear reconstruyen el texto buscado', cs.length === 2 && todosCuadran, `n=${cs.length} cuadran=${todosCuadran}`)
  }

  hr('Compilar una vez y reutilizar (el camino de la vista previa)')
  {
    // La vista previa compila FUERA del bucle y recorre línea a línea. Lo que puede
    // romperse en silencio es `lastIndex`: una expresión con `g` recuerda dónde se
    // quedó, así que reutilizarla sin reiniciarlo haría que la segunda línea
    // empezara a buscar por la mitad y se saltara coincidencias sin dar la cara.
    const re = compilarBusqueda('foo', opts())
    const lineas = ['foo bar foo', 'baz foo', 'foo']
    const porLinea = re === null ? [] : lineas.map((l) => coincidenciasCon(l, re).length)
    check(
      '(21) la MISMA expresión reutilizada línea a línea no se salta nada',
      JSON.stringify(porLinea) === JSON.stringify([2, 1, 1]),
      `n por línea = ${JSON.stringify(porLinea)}`
    )
  }
  {
    // El criterio tiene que ser UNO: si compilar por separado diera otra cosa que
    // `buscarCoincidencias`, habría dos definiciones de "coincidir" conviviendo.
    const casos: Array<[string, string, OpcionesBusqueda]> = [
      ['Hola HOLA hola', 'hola', opts()],
      ['Hola HOLA hola', 'hola', opts({ caseSensitive: true })],
      ['StringUtils String', 'String', opts({ wholeWord: true })],
      ['a1 b2 c3', '[a-c]\\d', opts({ regex: true })]
    ]
    const iguales = casos.every(([texto, q, o]) => {
      const re = compilarBusqueda(q, o)
      const via = re === null ? [] : coincidenciasCon(texto, re)
      return JSON.stringify(via) === JSON.stringify(buscarCoincidencias(texto, q, o))
    })
    check('(22) compilar+recorrer da EXACTAMENTE lo mismo que buscarCoincidencias', iguales, `${casos.length} casos`)
  }
  {
    const vacia = compilarBusqueda('', opts())
    const rota = compilarBusqueda('(', opts({ regex: true }))
    check(
      '(23) sin nada que buscar (query vacía o patrón a medio teclear) -> null, no una excepción',
      vacia === null && rota === null,
      `vacía=${vacia} rota=${rota}`
    )
  }

  // ---------------------------------------------------------------------------
  // Reporte final
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
