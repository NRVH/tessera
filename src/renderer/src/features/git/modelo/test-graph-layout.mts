#!/usr/bin/env node
// =============================================================================
// Prueba del layout puro del grafo (`computeGraphLayout`) y de su geometría en píxeles. La
// red de la pieza más delicada del log: una fila mal colocada desalinea el SVG del texto.
// Cubre: lista vacía, cadena lineal (contrato posicional), commit raíz, bifurcación, merge y
// merge pulpo, reuso de lanes, cola truncada, color por lane, aristas saltadas, `yOf`, `xOf`,
// `anchoGrafo` y `edgePath`.
// (node src/renderer/src/features/git/modelo/test-graph-layout.mts)
// =============================================================================

import {
  computeGraphLayout,
  edgePath,
  anchoGrafo,
  xOf,
  yOf,
  GRAPH_PADDING,
  LANE_COLORS,
  LANE_WIDTH,
  ROW_HEIGHT,
  type GraphCommitInput,
  type GraphEdge
} from './graphLayout.ts'

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
function c(hash: string, ...parents: string[]): GraphCommitInput {
  return { hash, parents }
}

/** Aristas de SALIDA de una fila (las que nacen en el nodo: fromY === 'mid'). */
function salidas(edges: readonly GraphEdge[]): GraphEdge[] {
  return edges.filter((e) => e.fromY === 'mid')
}

/** Aristas que ENTRAN por el borde superior (pass-through o cierre en el nodo). */
function entradas(edges: readonly GraphEdge[]): GraphEdge[] {
  return edges.filter((e) => e.fromY === 'top')
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('1) Lista vacía')
  // -------------------------------------------------------------------------
  {
    const l = computeGraphLayout([])
    check('sin filas', l.rows.length === 0, `rows=${l.rows.length}`)
    check('sin lanes', l.laneCount === 0, `laneCount=${l.laneCount}`)
  }

  // -------------------------------------------------------------------------
  hr('2-3) Cadena lineal A<-B<-C (newest first)')
  // -------------------------------------------------------------------------
  {
    // C es el más nuevo; su padre es B; el de B es A; A es raíz.
    const commits = [c('C', 'B'), c('B', 'A'), c('A')]
    const l = computeGraphLayout(commits)

    check('3 filas', l.rows.length === 3, `rows=${l.rows.length}`)
    // EL CONTRATO POSICIONAL: rows[i] describe a commits[i]. El render indexa
    // el layout por posición, así que si esto se rompe el grafo se desplaza
    // respecto del texto en toda la lista.
    const alineado = commits.every((cm, i) => l.rows[i].hash === cm.hash)
    check(
      'rows[i] casa con commits[i] (contrato posicional)',
      alineado,
      l.rows.map((r) => r.hash).join(',')
    )
    check('un solo lane', l.laneCount === 1, `laneCount=${l.laneCount}`)
    check(
      'todos los nodos en el lane 0',
      l.rows.every((r) => r.nodeLane === 0),
      l.rows.map((r) => r.nodeLane).join(',')
    )

    // C -> B: una salida recta en el mismo lane.
    const sC = salidas(l.rows[0].edges)
    check(
      'C emite 1 salida recta en su propio lane',
      sC.length === 1 && sC[0].fromLane === 0 && sC[0].toLane === 0 && sC[0].toY === 'bottom',
      JSON.stringify(sC)
    )
    // B recibe la línea de arriba y la cierra en su nodo.
    const eB = entradas(l.rows[1].edges)
    check(
      'B cierra la línea que venía de arriba (top -> mid)',
      eB.length === 1 && eB[0].toY === 'mid' && eB[0].toLane === 0,
      JSON.stringify(eB)
    )
    check('ninguna arista saltada sin filtro', l.rows.every((r) => r.edges.every((e) => !e.saltada)), 'saltada=false en todas')
  }

  // -------------------------------------------------------------------------
  hr('4) Commit raíz (0 padres)')
  // -------------------------------------------------------------------------
  {
    const l = computeGraphLayout([c('A')])
    check('1 fila', l.rows.length === 1, `rows=${l.rows.length}`)
    check('sin aristas de salida', salidas(l.rows[0].edges).length === 0, JSON.stringify(l.rows[0].edges))
    check('laneCount = 1', l.laneCount === 1, `laneCount=${l.laneCount}`)
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
    const l = computeGraphLayout([c('M', 'D', 'E'), c('D', 'B'), c('E', 'B'), c('B')])

    const sM = salidas(l.rows[0].edges)
    check('el merge emite 1 arista por padre (2)', sM.length === 2, `salidas=${sM.length}`)
    check(
      'las 2 salidas del merge van a lanes distintos',
      sM[0].toLane !== sM[1].toLane,
      `lanes=${sM[0].toLane},${sM[1].toLane}`
    )
    check(
      'el 1er padre continúa en el lane del nodo',
      sM[0].toLane === l.rows[0].nodeLane,
      `nodeLane=${l.rows[0].nodeLane} toLane=${sM[0].toLane}`
    )
    // D y E son ramas paralelas: ocupan columnas distintas.
    check('D y E en lanes distintos', l.rows[1].nodeLane !== l.rows[2].nodeLane, `D=${l.rows[1].nodeLane} E=${l.rows[2].nodeLane}`)
    check('el grafo usa 2 columnas', l.laneCount === 2, `laneCount=${l.laneCount}`)
    // CONVERGENCIA: la segunda rama vuelve al tronco en SU PROPIA fila (la
    // diagonal se dibuja en la fila de E), no en la de B. Es lo mismo que hace
    // `git log --graph`, y por eso B recibe UNA sola entrada y no dos: cuando se
    // llega a él, las dos ramas ya comparten columna.
    const sE = salidas(l.rows[2].edges)
    const laneB = l.rows[3].nodeLane
    check(
      'E converge al lane de B con una diagonal en su propia fila',
      sE.length === 1 && sE[0].fromLane === l.rows[2].nodeLane && sE[0].toLane === laneB,
      JSON.stringify(sE)
    )
    check('esa diagonal cruza de columna', sE[0].fromLane !== sE[0].toLane, `${sE[0].fromLane}->${sE[0].toLane}`)
    const eB = entradas(l.rows[3].edges)
    check(
      'B recibe UNA entrada, que cierra en su nodo (las ramas ya convergieron)',
      eB.length === 1 && eB[0].toY === 'mid' && eB[0].toLane === laneB,
      JSON.stringify(eB)
    )
  }

  // -------------------------------------------------------------------------
  hr('7) Merge pulpo (3 padres)')
  // -------------------------------------------------------------------------
  {
    const l = computeGraphLayout([c('O', 'P1', 'P2', 'P3'), c('P1'), c('P2'), c('P3')])
    const s = salidas(l.rows[0].edges)
    check('3 aristas de salida', s.length === 3, `salidas=${s.length}`)
    const lanes = new Set(s.map((e) => e.toLane))
    check('3 lanes destino distintos', lanes.size === 3, `lanes=${[...lanes].join(',')}`)
    check('laneCount = 3', l.laneCount === 3, `laneCount=${l.laneCount}`)
  }

  // -------------------------------------------------------------------------
  hr('8) Reuso de lane tras cerrar una rama')
  // -------------------------------------------------------------------------
  {
    // Rama corta que nace y muere arriba; luego, más abajo, otra rama nueva.
    //  T1   R1        R1 cierra pronto -> su columna queda libre
    //  T2   (libre)
    //  T3   R2        R2 debe REUSAR la columna 1, no abrir una tercera
    const l = computeGraphLayout([
      c('T1', 'T2', 'R1'),
      c('R1', 'T2'),
      c('T2', 'T3'),
      c('T3', 'T4', 'R2'),
      c('R2', 'T4'),
      c('T4')
    ])
    check(
      'nunca se abren más de 2 columnas (hay reuso)',
      l.laneCount === 2,
      `laneCount=${l.laneCount} (sin reuso serían 3)`
    )
    const laneR1 = l.rows.find((r) => r.hash === 'R1')?.nodeLane
    const laneR2 = l.rows.find((r) => r.hash === 'R2')?.nodeLane
    check('R2 reutiliza la columna que dejó R1', laneR1 === laneR2, `R1=${laneR1} R2=${laneR2}`)
  }

  // -------------------------------------------------------------------------
  hr('9) Cola truncada: padre fuera de la lista')
  // -------------------------------------------------------------------------
  {
    // Es el caso REAL de una página acotada (--max-count): el último commit
    // cargado apunta a un padre que no vino. Su lane queda abierto a propósito;
    // el grafo se corta abajo como en cualquier IDE, no se "arregla".
    const l = computeGraphLayout([c('X', 'FUERA')])
    const s = salidas(l.rows[0].edges)
    check('emite su arista de salida igualmente', s.length === 1, JSON.stringify(s))
    check('la arista sale por el borde inferior', s[0].toY === 'bottom', s[0].toY)
    check('laneCount cuenta el lane abierto', l.laneCount === 1, `laneCount=${l.laneCount}`)
  }

  // -------------------------------------------------------------------------
  hr('10) El color viaja con el lane y cicla')
  // -------------------------------------------------------------------------
  {
    check(
      'colorIndex del nodo == nodeLane % paleta',
      (() => {
        const l = computeGraphLayout([c('M', 'A', 'B'), c('A', 'Z'), c('B', 'Z'), c('Z')])
        return l.rows.every((r) => r.colorIndex === r.nodeLane % LANE_COLORS.length)
      })(),
      `paleta=${LANE_COLORS.length} colores`
    )
    // Un pulpo con más padres que colores obliga al ciclado.
    const muchos = Array.from({ length: LANE_COLORS.length + 2 }, (_, i) => `P${i}`)
    const l = computeGraphLayout([{ hash: 'O', parents: muchos }, ...muchos.map((p) => c(p))])
    const s = salidas(l.rows[0].edges)
    check(
      'con más lanes que colores, el índice cicla dentro del rango',
      s.every((e) => e.colorIndex === e.toLane % LANE_COLORS.length && e.colorIndex < LANE_COLORS.length),
      `lanes=${s.length} colores=${LANE_COLORS.length}`
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
    const l = computeGraphLayout([
      { hash: 'A', parents: ['B'], parentsSaltados: [true] },
      { hash: 'B', parents: ['C'] },
      { hash: 'C', parents: [] }
    ])
    const sA = salidas(l.rows[0].edges)
    check('la salida de A va marcada como saltada', sA[0].saltada === true, JSON.stringify(sA[0]))
    const eB = entradas(l.rows[1].edges)
    check('el cierre en B hereda la marca (línea entera punteada)', eB[0].saltada === true, JSON.stringify(eB[0]))
    const sB = salidas(l.rows[1].edges)
    check('lo que sale de B ya NO va marcado (ese tramo es contiguo)', sB[0].saltada !== true, JSON.stringify(sB[0]))

    // Sin `parentsSaltados` (el caso normal, sin filtros) nada se marca.
    const limpio = computeGraphLayout([c('A', 'B'), c('B')])
    check(
      'sin parentsSaltados no hay ninguna marca',
      limpio.rows.every((r) => r.edges.every((e) => e.saltada !== true)),
      'ninguna arista saltada'
    )
  }

  // -------------------------------------------------------------------------
  hr('12) Geometría: yOf / xOf / anchoGrafo')
  // -------------------------------------------------------------------------
  {
    check('yOf(top) = 0', yOf('top') === 0, String(yOf('top')))
    check('yOf(mid) = ROW_HEIGHT/2', yOf('mid') === ROW_HEIGHT / 2, String(yOf('mid')))
    check('yOf(bottom) = ROW_HEIGHT', yOf('bottom') === ROW_HEIGHT, String(yOf('bottom')))
    check(
      'xOf(0) es el CENTRO del primer lane',
      xOf(0) === GRAPH_PADDING + LANE_WIDTH / 2,
      `xOf(0)=${xOf(0)}`
    )
    check('los lanes están separados por LANE_WIDTH', xOf(1) - xOf(0) === LANE_WIDTH, `${xOf(1)}-${xOf(0)}`)
    check(
      'anchoGrafo(0) reserva un lane mínimo (no colapsa a 0)',
      anchoGrafo(0) === GRAPH_PADDING * 2 + LANE_WIDTH,
      `ancho=${anchoGrafo(0)}`
    )
    check(
      'anchoGrafo(3) = padding*2 + 3 lanes',
      anchoGrafo(3) === GRAPH_PADDING * 2 + 3 * LANE_WIDTH,
      `ancho=${anchoGrafo(3)}`
    )
  }

  // -------------------------------------------------------------------------
  hr('13) edgePath: recta vs bezier')
  // -------------------------------------------------------------------------
  {
    const recta = edgePath({ fromLane: 0, fromY: 'mid', toLane: 0, toY: 'bottom', colorIndex: 0 })
    check('misma columna -> segmento recto (L)', recta.includes(' L ') && !recta.includes(' C '), recta)
    const curva = edgePath({ fromLane: 0, fromY: 'mid', toLane: 2, toY: 'bottom', colorIndex: 0 })
    check('cambia de columna -> bezier (C)', curva.includes(' C '), curva)
    check(
      'la recta empieza y acaba en la misma X',
      recta.startsWith(`M ${xOf(0)} `) && recta.endsWith(`L ${xOf(0)} ${yOf('bottom')}`),
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
        edgePath({ fromLane: 1, fromY: a, toLane: 2, toY: b, colorIndex: 0 }).startsWith('M ')
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
