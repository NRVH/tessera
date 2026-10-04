#!/usr/bin/env node
// =============================================================================
// Prueba de reescribirPadres (npm run test:reescribir-padres): sin ella el grafo filtrado se
// vuelve un peine de líneas verticales y el fallo no lo ve el typecheck. La propiedad en todos
// los casos es la CLAUSURA: cada padre de salida está en lo visible. Cubre: sin filtro, hueco
// simple y encadenado, un DAG generado, merges con ramas ocultas, sin ancestro visible, padre
// fuera de la página, marcas, escala de 5000 commits, ciclo imposible y el alimento del layout.
// =============================================================================

import { reescribirPadres } from './reescribirPadres.ts'
import { computeGraphLayout } from './graphLayout.ts'
import type { Commit } from '../../../../../shared/git-ipc.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL
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

/** Commit de mentira: solo importan hash y parents; el resto rellena el tipo. */
function c(hash: string, ...parents: string[]): Commit {
  return {
    hash,
    parents,
    authorName: 'Autor',
    authorEmail: 'autor@example.com',
    isoDate: '2021-01-01T00:00:00Z',
    subject: `commit ${hash}`,
    refs: []
  }
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('1) Sin filtro: pasa la lista tal cual')
  // -------------------------------------------------------------------------
  {
    const todos = [c('A', 'B'), c('B', 'C'), c('C')]
    const r = reescribirPadres(todos, todos)
    check('misma longitud', r.length === 3, `${r.length}`)
    check(
      'mismos padres, sin tocar',
      r[0].parents[0] === 'B' && r[1].parents[0] === 'C' && r[2].parents.length === 0,
      JSON.stringify(r.map((x) => x.parents))
    )
    check(
      'ninguna marca de salto (el caso normal no paga nada)',
      r.every((x) => x.parentsSaltados === undefined),
      'parentsSaltados ausente en todos'
    )
    check(
      'orden preservado (contrato posicional)',
      r.every((x, i) => x.hash === todos[i].hash),
      r.map((x) => x.hash).join(',')
    )
  }

  // -------------------------------------------------------------------------
  hr('2) Hueco simple: A -> [B oculto] -> C')
  // -------------------------------------------------------------------------
  {
    const todos = [c('A', 'B'), c('B', 'C'), c('C')]
    const visibles = [todos[0], todos[2]] // A y C; B lo esconde el filtro
    const r = reescribirPadres(todos, visibles)
    check('2 entradas', r.length === 2, `${r.length}`)
    check('A ahora apunta a C', r[0].parents.length === 1 && r[0].parents[0] === 'C', JSON.stringify(r[0].parents))
    check('y ese padre va MARCADO como salto', r[0].parentsSaltados?.[0] === true, JSON.stringify(r[0].parentsSaltados))
    check('C sigue siendo raíz', r[1].parents.length === 0, JSON.stringify(r[1].parents))
  }

  // -------------------------------------------------------------------------
  hr('3) Huecos encadenados: A -> [B,C,D ocultos] -> E')
  // -------------------------------------------------------------------------
  {
    const todos = [c('A', 'B'), c('B', 'C'), c('C', 'D'), c('D', 'E'), c('E')]
    const visibles = [todos[0], todos[4]]
    const r = reescribirPadres(todos, visibles)
    check('A salta los tres ocultos hasta E', r[0].parents[0] === 'E', JSON.stringify(r[0].parents))
    check('un solo padre (no uno por cada oculto)', r[0].parents.length === 1, `${r[0].parents.length}`)
    check('marcado como salto', r[0].parentsSaltados?.[0] === true, JSON.stringify(r[0].parentsSaltados))
  }

  // -------------------------------------------------------------------------
  hr('4) CLAUSURA sobre un DAG generado')
  // -------------------------------------------------------------------------
  {
    // Cadena de 60 con merges cada 7 commits; se filtra dejando 1 de cada 3.
    const todos: Commit[] = []
    for (let i = 0; i < 60; i++) {
      const padres: string[] = []
      if (i < 59) padres.push(`n${i + 1}`)
      if (i % 7 === 0 && i + 4 < 60) padres.push(`n${i + 4}`) // segundo padre (merge)
      todos.push(c(`n${i}`, ...padres))
    }
    const visibles = todos.filter((_, i) => i % 3 === 0)
    const setVisible = new Set(visibles.map((x) => x.hash))
    const r = reescribirPadres(todos, visibles)

    const fuera = r.flatMap((x) => x.parents).filter((p) => !setVisible.has(p))
    check(
      'NINGÚN padre apunta fuera del conjunto visible (clausura)',
      fuera.length === 0,
      fuera.length === 0 ? `${r.length} commits, todos cerrados` : `fugas: ${fuera.join(',')}`
    )
    check(
      'se conservan todas las entradas visibles',
      r.length === visibles.length,
      `${r.length} vs ${visibles.length}`
    )
    check(
      'ningún commit repite padre',
      r.every((x) => new Set(x.parents).size === x.parents.length),
      'sin duplicados'
    )
    check(
      'parentsSaltados, cuando está, tiene la misma longitud que parents',
      r.every((x) => x.parentsSaltados === undefined || x.parentsSaltados.length === x.parents.length),
      'longitudes alineadas'
    )
  }

  // -------------------------------------------------------------------------
  hr('5) Merge con una rama entera oculta')
  // -------------------------------------------------------------------------
  {
    //   M(P,R1) ; R1 -> R2 -> P ; la rama R queda oculta del todo
    const todos = [c('M', 'P', 'R1'), c('R1', 'R2'), c('R2', 'P'), c('P', 'Z'), c('Z')]
    const visibles = [todos[0], todos[3], todos[4]] // M, P, Z
    const r = reescribirPadres(todos, visibles)
    check('M queda con UN solo padre visible', r[0].parents.length === 1, JSON.stringify(r[0].parents))
    check('y es P (las dos ramas convergen ahí)', r[0].parents[0] === 'P', JSON.stringify(r[0].parents))
    check(
      'ese padre NO va marcado: por la primera rama es contiguo',
      r[0].parentsSaltados === undefined || r[0].parentsSaltados[0] === false,
      JSON.stringify(r[0].parentsSaltados)
    )
  }

  // -------------------------------------------------------------------------
  hr('6) Merge con LAS DOS ramas ocultas confluyendo')
  // -------------------------------------------------------------------------
  {
    //   M(X,Y) ; X -> P ; Y -> P ; X e Y ocultos, P visible
    const todos = [c('M', 'X', 'Y'), c('X', 'P'), c('Y', 'P'), c('P')]
    const visibles = [todos[0], todos[3]]
    const r = reescribirPadres(todos, visibles)
    check(
      'no se emiten dos aristas al mismo destino',
      r[0].parents.length === 1 && r[0].parents[0] === 'P',
      JSON.stringify(r[0].parents)
    )
    check('marcado como salto (los dos caminos esconden historia)', r[0].parentsSaltados?.[0] === true, JSON.stringify(r[0].parentsSaltados))
  }

  // -------------------------------------------------------------------------
  hr('7-8) Sin ancestro visible y cola truncada')
  // -------------------------------------------------------------------------
  {
    // 7: todo lo de abajo está oculto.
    const todos = [c('A', 'B'), c('B', 'C'), c('C')]
    const r = reescribirPadres(todos, [todos[0]])
    check('un commit sin ancestro visible queda como raíz', r[0].parents.length === 0, JSON.stringify(r[0].parents))
    check('y sin marcas', r[0].parentsSaltados === undefined, JSON.stringify(r[0].parentsSaltados))

    // 8: el padre no está ni en `todos` (la página se cortó por --max-count).
    const truncado = [c('A', 'FUERA'), c('B', 'FUERA2')]
    const r2 = reescribirPadres(truncado, [truncado[0]])
    check('padre fuera de la página cargada -> raíz, sin colgarse', r2[0].parents.length === 0, JSON.stringify(r2[0].parents))
  }

  // -------------------------------------------------------------------------
  hr('9) Solo se marca lo reescrito')
  // -------------------------------------------------------------------------
  {
    // A -> B (visible, contiguo) ; B -> [C oculto] -> D (visible, salto)
    const todos = [c('A', 'B'), c('B', 'C'), c('C', 'D'), c('D')]
    const visibles = [todos[0], todos[1], todos[3]]
    const r = reescribirPadres(todos, visibles)
    check(
      'A->B es contiguo: sin marca',
      r[0].parentsSaltados === undefined || r[0].parentsSaltados[0] === false,
      JSON.stringify(r[0].parentsSaltados)
    )
    check('B->D es salto: marcado', r[1].parents[0] === 'D' && r[1].parentsSaltados?.[0] === true, JSON.stringify(r[1]))

    // REGLA DEL CAMINO CONTIGUO: si un merge llega al mismo ancestro por dos
    // vías —una directa y otra atravesando commits ocultos— la línea NO se
    // puntea. Puntearla diría "aquí falta historia" cuando en realidad hay un
    // camino completo a la vista.
    //   M(P, X) ; X oculto -> P
    const dosVias = [c('M', 'P', 'X'), c('X', 'P'), c('P')]
    const rr = reescribirPadres(dosVias, [dosVias[0], dosVias[2]])
    check(
      'un padre alcanzable también por camino contiguo NO se marca',
      rr[0].parents.length === 1 &&
        rr[0].parents[0] === 'P' &&
        (rr[0].parentsSaltados === undefined || rr[0].parentsSaltados[0] === false),
      JSON.stringify(rr[0])
    )
  }

  // -------------------------------------------------------------------------
  hr('10) Escala: 5000 commits, la mitad filtrada')
  // -------------------------------------------------------------------------
  {
    const N = 5000
    const todos: Commit[] = []
    for (let i = 0; i < N; i++) todos.push(c(`h${i}`, ...(i < N - 1 ? [`h${i + 1}`] : [])))
    const visibles = todos.filter((_, i) => i % 2 === 0)
    const t0 = Date.now()
    let r: ReturnType<typeof reescribirPadres> | null = null
    let error: string | null = null
    try {
      r = reescribirPadres(todos, visibles)
    } catch (e) {
      // Lo que se está cazando aquí es un RangeError de pila (la razón de que la
      // implementación sea iterativa y no recursiva).
      error = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    }
    const ms = Date.now() - t0
    check('no desborda la pila', error === null, error ?? `ok en ${ms} ms`)
    check('devuelve todas las entradas', r?.length === visibles.length, `${r?.length} vs ${visibles.length}`)
    const setVisible = new Set(visibles.map((x) => x.hash))
    check(
      'y sigue siendo cerrado',
      (r ?? []).every((x) => x.parents.every((p) => setVisible.has(p))),
      'clausura a escala'
    )
    check('tiempo razonable (< 2 s)', ms < 2000, `${ms} ms`)
  }

  // -------------------------------------------------------------------------
  hr('11) Historial corrupto con un ciclo: no cuelga')
  // -------------------------------------------------------------------------
  {
    // X -> Y -> X (imposible en git, pero un .git dañado no debe congelar la UI).
    const todos = [c('V', 'X'), c('X', 'Y'), c('Y', 'X'), c('Z')]
    const t0 = Date.now()
    let colgado = false
    let r: ReturnType<typeof reescribirPadres> | null = null
    try {
      r = reescribirPadres(todos, [todos[0], todos[3]])
    } catch {
      colgado = true
    }
    const ms = Date.now() - t0
    check('termina (no se cuelga en el ciclo)', !colgado && r !== null && ms < 1000, `${ms} ms`)
    check('V queda sin padres visibles', r?.[0].parents.length === 0, JSON.stringify(r?.[0].parents))
  }

  // -------------------------------------------------------------------------
  hr('12) Integración: el resultado produce un grafo CERRADO')
  // -------------------------------------------------------------------------
  {
    // Esta es la prueba de fuego de todo el bloque: filtrar y que el grafo
    // siga teniendo un nodo por fila y ningún lane huérfano.
    //   a -> b -> (c contiguo | x oculto -> y oculto -> d)
    //   c -> d -> raíz
    // La rama oculta converge en `d`, MÁS ABAJO que el padre contiguo `c`, así
    // que sí queda una arista saltada de verdad. (Si convergiera en el propio
    // `c`, la regla de "camino contiguo gana" la dejaría sólida — ver más abajo.)
    const todos = [
      c('a', 'b'),
      c('b', 'c', 'x'),
      c('x', 'y'),
      c('y', 'd'),
      c('c', 'd'),
      c('d')
    ]
    const visibles = [todos[0], todos[1], todos[4], todos[5]] // se ocultan x e y
    const entrada = reescribirPadres(todos, visibles)
    const layout = computeGraphLayout(entrada)

    check(
      'una fila por commit visible',
      layout.rows.length === visibles.length,
      `${layout.rows.length} filas`
    )
    check(
      'rows[i] casa con visibles[i]',
      layout.rows.every((row, i) => row.hash === visibles[i].hash),
      layout.rows.map((r) => r.hash).join(',')
    )
    // Un lane huérfano se delata así: la última fila deja aristas que salen por
    // abajo hacia commits que no existen. Con la reescritura, el commit raíz
    // visible no debe emitir ninguna.
    const ultima = layout.rows[layout.rows.length - 1]
    const salidasFinales = ultima.edges.filter((e) => e.fromY === 'mid')
    check(
      'la última fila (raíz visible) no deja lanes abiertos',
      salidasFinales.length === 0,
      JSON.stringify(salidasFinales)
    )
    check(
      'hay aristas punteadas donde el filtro escondió historia',
      layout.rows.some((r) => r.edges.some((e) => e.saltada === true)),
      'al menos una arista saltada'
    )
    check(
      'el ancho del grafo es razonable (no un peine)',
      layout.laneCount <= 2,
      `laneCount=${layout.laneCount}`
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
