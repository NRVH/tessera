#!/usr/bin/env node
// =============================================================================
// Prueba del layout puro del grafo (`calcularLayoutGrafo`) y de su geometría en píxeles. La
// red de la pieza más delicada del log: una fila mal colocada desalinea el SVG del texto.
// Cubre: lista vacía, cadena lineal (contrato posicional), commit raíz, bifurcación, merge y
// merge pulpo, reuso de lanes, cola truncada, color por lane, aristas saltadas, `yDe`, `xDe`,
// `anchoGrafo` y `trazoArista`.
// (node src/renderer/src/features/git/modelo/test-layout-grafo.mts)
// =============================================================================

import {
  calcularLayoutGrafo,
  trazoArista,
  anchoGrafo,
  xDe,
  yDe,
  RELLENO_GRAFO,
  COLORES_CARRIL,
  ANCHO_CARRIL,
  ALTO_FILA,
  type EntradaCommitGrafo,
  type AristaGrafo
} from './layoutGrafo.ts'

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

/** Atajo: commit con hash `h` y los padres dados. */
function c(hash: string, ...padres: string[]): EntradaCommitGrafo {
  return { hash, padres }
}

/** Aristas de SALIDA de una fila (las que nacen en el nodo: desdeY === 'mid'). */
function salidas(aristas: readonly AristaGrafo[]): AristaGrafo[] {
  return aristas.filter((e) => e.desdeY === 'mid')
}

/** Aristas que ENTRAN por el borde superior (pass-through o cierre en el nodo). */
function entradas(aristas: readonly AristaGrafo[]): AristaGrafo[] {
  return aristas.filter((e) => e.desdeY === 'top')
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('1) Lista vacía')
  // -------------------------------------------------------------------------
  {
    const l = calcularLayoutGrafo([])
    check('sin filas', l.filas.length === 0, `filas=${l.filas.length}`)
    check('sin lanes', l.cantidadCarriles === 0, `cantidadCarriles=${l.cantidadCarriles}`)
  }

  // -------------------------------------------------------------------------
  hr('2-3) Cadena lineal A<-B<-C (newest first)')
  // -------------------------------------------------------------------------
  {
    // C es el más nuevo; su padre es B; el de B es A; A es raíz.
    const commits = [c('C', 'B'), c('B', 'A'), c('A')]
    const l = calcularLayoutGrafo(commits)

    check('3 filas', l.filas.length === 3, `filas=${l.filas.length}`)
    // EL CONTRATO POSICIONAL: filas[i] describe a commits[i]. El render indexa
    // el layout por posición, así que si esto se rompe el grafo se desplaza
    // respecto del texto en toda la lista.
    const alineado = commits.every((cm, i) => l.filas[i].hash === cm.hash)
    check(
      'filas[i] casa con commits[i] (contrato posicional)',
      alineado,
      l.filas.map((r) => r.hash).join(',')
    )
    check('un solo lane', l.cantidadCarriles === 1, `cantidadCarriles=${l.cantidadCarriles}`)
    check(
      'todos los nodos en el lane 0',
      l.filas.every((r) => r.carrilNodo === 0),
      l.filas.map((r) => r.carrilNodo).join(',')
    )

    // C -> B: una salida recta en el mismo lane.
    const sC = salidas(l.filas[0].aristas)
    check(
      'C emite 1 salida recta en su propio lane',
      sC.length === 1 && sC[0].desdeCarril === 0 && sC[0].hastaCarril === 0 && sC[0].hastaY === 'bottom',
      JSON.stringify(sC)
    )
    // B recibe la línea de arriba y la cierra en su nodo.
    const eB = entradas(l.filas[1].aristas)
    check(
      'B cierra la línea que venía de arriba (top -> mid)',
      eB.length === 1 && eB[0].hastaY === 'mid' && eB[0].hastaCarril === 0,
      JSON.stringify(eB)
    )
    check('ninguna arista saltada sin filtro', l.filas.every((r) => r.aristas.every((e) => !e.saltada)), 'saltada=false en todas')
  }

  // -------------------------------------------------------------------------
  hr('4) Commit raíz (0 padres)')
  // -------------------------------------------------------------------------
  {
    const l = calcularLayoutGrafo([c('A')])
    check('1 fila', l.filas.length === 1, `filas=${l.filas.length}`)
    check('sin aristas de salida', salidas(l.filas[0].aristas).length === 0, JSON.stringify(l.filas[0].aristas))
    check('cantidadCarriles = 1', l.cantidadCarriles === 1, `cantidadCarriles=${l.cantidadCarriles}`)
  }

  // -------------------------------------------------------------------------
  hr('5-6) Bifurcación y merge')
  // -------------------------------------------------------------------------
  {
    //    M (merge de D y E)
    //   / \
    //  D   E
    //   \ /
    //    B
    const l = calcularLayoutGrafo([c('M', 'D', 'E'), c('D', 'B'), c('E', 'B'), c('B')])

    const sM = salidas(l.filas[0].aristas)
    check('el merge emite 1 arista por padre (2)', sM.length === 2, `salidas=${sM.length}`)
    check(
      'las 2 salidas del merge van a lanes distintos',
      sM[0].hastaCarril !== sM[1].hastaCarril,
      `lanes=${sM[0].hastaCarril},${sM[1].hastaCarril}`
    )
    check(
      'el 1er padre continúa en el lane del nodo',
      sM[0].hastaCarril === l.filas[0].carrilNodo,
      `carrilNodo=${l.filas[0].carrilNodo} hastaCarril=${sM[0].hastaCarril}`
    )
    // D y E son ramas paralelas: ocupan columnas distintas.
    check('D y E en lanes distintos', l.filas[1].carrilNodo !== l.filas[2].carrilNodo, `D=${l.filas[1].carrilNodo} E=${l.filas[2].carrilNodo}`)
    check('el grafo usa 2 columnas', l.cantidadCarriles === 2, `cantidadCarriles=${l.cantidadCarriles}`)
    // CONVERGENCIA: la segunda rama vuelve al tronco en SU PROPIA fila (la
    // diagonal se dibuja en la fila de E), no en la de B. Es lo mismo que hace
    // `git log --graph`, y por eso B recibe UNA sola entrada y no dos: cuando se
    // llega a él, las dos ramas ya comparten columna.
    const sE = salidas(l.filas[2].aristas)
    const carrilB = l.filas[3].carrilNodo
    check(
      'E converge al lane de B con una diagonal en su propia fila',
      sE.length === 1 && sE[0].desdeCarril === l.filas[2].carrilNodo && sE[0].hastaCarril === carrilB,
      JSON.stringify(sE)
    )
    check('esa diagonal cruza de columna', sE[0].desdeCarril !== sE[0].hastaCarril, `${sE[0].desdeCarril}->${sE[0].hastaCarril}`)
    const eB = entradas(l.filas[3].aristas)
    check(
      'B recibe UNA entrada, que cierra en su nodo (las ramas ya convergieron)',
      eB.length === 1 && eB[0].hastaY === 'mid' && eB[0].hastaCarril === carrilB,
      JSON.stringify(eB)
    )
  }

  // -------------------------------------------------------------------------
  hr('7) Merge pulpo (3 padres)')
  // -------------------------------------------------------------------------
  {
    const l = calcularLayoutGrafo([c('O', 'P1', 'P2', 'P3'), c('P1'), c('P2'), c('P3')])
    const s = salidas(l.filas[0].aristas)
    check('3 aristas de salida', s.length === 3, `salidas=${s.length}`)
    const carriles = new Set(s.map((e) => e.hastaCarril))
    check('3 lanes destino distintos', carriles.size === 3, `lanes=${[...carriles].join(',')}`)
    check('cantidadCarriles = 3', l.cantidadCarriles === 3, `cantidadCarriles=${l.cantidadCarriles}`)
  }

  // -------------------------------------------------------------------------
  hr('8) Reuso de lane tras cerrar una rama')
  // -------------------------------------------------------------------------
  {
    // Rama corta que nace y muere arriba; luego, más abajo, otra rama nueva.
    //  T1   R1        R1 cierra pronto -> su columna queda libre
    //  T2   (libre)
    //  T3   R2        R2 debe REUSAR la columna 1, no abrir una tercera
    const l = calcularLayoutGrafo([
      c('T1', 'T2', 'R1'),
      c('R1', 'T2'),
      c('T2', 'T3'),
      c('T3', 'T4', 'R2'),
      c('R2', 'T4'),
      c('T4')
    ])
    check(
      'nunca se abren más de 2 columnas (hay reuso)',
      l.cantidadCarriles === 2,
      `cantidadCarriles=${l.cantidadCarriles} (sin reuso serían 3)`
    )
    const carrilR1 = l.filas.find((r) => r.hash === 'R1')?.carrilNodo
    const carrilR2 = l.filas.find((r) => r.hash === 'R2')?.carrilNodo
    check('R2 reutiliza la columna que dejó R1', carrilR1 === carrilR2, `R1=${carrilR1} R2=${carrilR2}`)
  }

  // -------------------------------------------------------------------------
  hr('9) Cola truncada: padre fuera de la lista')
  // -------------------------------------------------------------------------
  {
    // Es el caso REAL de una página acotada (--max-count): el último commit
    // cargado apunta a un padre que no vino. Su lane queda abierto a propósito;
    // el grafo se corta abajo como en cualquier IDE, no se "arregla".
    const l = calcularLayoutGrafo([c('X', 'FUERA')])
    const s = salidas(l.filas[0].aristas)
    check('emite su arista de salida igualmente', s.length === 1, JSON.stringify(s))
    check('la arista sale por el borde inferior', s[0].hastaY === 'bottom', s[0].hastaY)
    check('cantidadCarriles cuenta el lane abierto', l.cantidadCarriles === 1, `cantidadCarriles=${l.cantidadCarriles}`)
  }

  // -------------------------------------------------------------------------
  hr('10) El color viaja con el lane y cicla')
  // -------------------------------------------------------------------------
  {
    check(
      'indiceColor del nodo == carrilNodo % paleta',
      (() => {
        const l = calcularLayoutGrafo([c('M', 'A', 'B'), c('A', 'Z'), c('B', 'Z'), c('Z')])
        return l.filas.every((r) => r.indiceColor === r.carrilNodo % COLORES_CARRIL.length)
      })(),
      `paleta=${COLORES_CARRIL.length} colores`
    )
    // Un pulpo con más padres que colores obliga al ciclado.
    const muchos = Array.from({ length: COLORES_CARRIL.length + 2 }, (_, i) => `P${i}`)
    const l = calcularLayoutGrafo([{ hash: 'O', padres: muchos }, ...muchos.map((p) => c(p))])
    const s = salidas(l.filas[0].aristas)
    check(
      'con más lanes que colores, el índice cicla dentro del rango',
      s.every((e) => e.indiceColor === e.hastaCarril % COLORES_CARRIL.length && e.indiceColor < COLORES_CARRIL.length),
      `lanes=${s.length} colores=${COLORES_CARRIL.length}`
    )
  }

  // -------------------------------------------------------------------------
  hr('11) Aristas SALTADAS (log filtrado)')
  // -------------------------------------------------------------------------
  {
    // Tres commits visibles en cadena, pero el salto de A a B esconde historia.
    // La marca debe viajar por el lane: la salida de A, y también el tramo que
    // pasa/cierra más abajo. Si solo se marcara la salida, la línea se vería
    // mitad punteada mitad sólida, que se lee como un fallo de render.
    const l = calcularLayoutGrafo([
      { hash: 'A', padres: ['B'], padresSaltados: [true] },
      { hash: 'B', padres: ['C'] },
      { hash: 'C', padres: [] }
    ])
    const sA = salidas(l.filas[0].aristas)
    check('la salida de A va marcada como saltada', sA[0].saltada === true, JSON.stringify(sA[0]))
    const eB = entradas(l.filas[1].aristas)
    check('el cierre en B hereda la marca (línea entera punteada)', eB[0].saltada === true, JSON.stringify(eB[0]))
    const sB = salidas(l.filas[1].aristas)
    check('lo que sale de B ya NO va marcado (ese tramo es contiguo)', sB[0].saltada !== true, JSON.stringify(sB[0]))

    // Sin `padresSaltados` (el caso normal, sin filtros) nada se marca.
    const limpio = calcularLayoutGrafo([c('A', 'B'), c('B')])
    check(
      'sin padresSaltados no hay ninguna marca',
      limpio.filas.every((r) => r.aristas.every((e) => e.saltada !== true)),
      'ninguna arista saltada'
    )
  }

  // -------------------------------------------------------------------------
  hr('12) Geometría: yDe / xDe / anchoGrafo')
  // -------------------------------------------------------------------------
  {
    check('yDe(top) = 0', yDe('top') === 0, String(yDe('top')))
    check('yDe(mid) = ALTO_FILA/2', yDe('mid') === ALTO_FILA / 2, String(yDe('mid')))
    check('yDe(bottom) = ALTO_FILA', yDe('bottom') === ALTO_FILA, String(yDe('bottom')))
    check(
      'xDe(0) es el CENTRO del primer lane',
      xDe(0) === RELLENO_GRAFO + ANCHO_CARRIL / 2,
      `xDe(0)=${xDe(0)}`
    )
    check('los lanes están separados por ANCHO_CARRIL', xDe(1) - xDe(0) === ANCHO_CARRIL, `${xDe(1)}-${xDe(0)}`)
    check(
      'anchoGrafo(0) reserva un lane mínimo (no colapsa a 0)',
      anchoGrafo(0) === RELLENO_GRAFO * 2 + ANCHO_CARRIL,
      `ancho=${anchoGrafo(0)}`
    )
    check(
      'anchoGrafo(3) = padding*2 + 3 lanes',
      anchoGrafo(3) === RELLENO_GRAFO * 2 + 3 * ANCHO_CARRIL,
      `ancho=${anchoGrafo(3)}`
    )
  }

  // -------------------------------------------------------------------------
  hr('13) trazoArista: recta vs bezier')
  // -------------------------------------------------------------------------
  {
    const recta = trazoArista({ desdeCarril: 0, desdeY: 'mid', hastaCarril: 0, hastaY: 'bottom', indiceColor: 0 })
    check('misma columna -> segmento recto (L)', recta.includes(' L ') && !recta.includes(' C '), recta)
    const curva = trazoArista({ desdeCarril: 0, desdeY: 'mid', hastaCarril: 2, hastaY: 'bottom', indiceColor: 0 })
    check('cambia de columna -> bezier (C)', curva.includes(' C '), curva)
    check(
      'la recta empieza y acaba en la misma X',
      recta.startsWith(`M ${xDe(0)} `) && recta.endsWith(`L ${xDe(0)} ${yDe('bottom')}`),
      recta
    )
    // Las cuatro combinaciones de anclas producen un path bien formado.
    const anclas: Array<[('top' | 'mid'), ('mid' | 'bottom')]> = [
      ['top', 'mid'],
      ['top', 'bottom'],
      ['mid', 'bottom'],
      ['mid', 'mid']
    ]
    check(
      'las 4 combinaciones de anclas dan un path que empieza en M',
      anclas.every(([a, b]) =>
        trazoArista({ desdeCarril: 1, desdeY: a, hastaCarril: 2, hastaY: b, indiceColor: 0 }).startsWith('M ')
      ),
      anclas.map(([a, b]) => `${a}->${b}`).join(' ')
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
