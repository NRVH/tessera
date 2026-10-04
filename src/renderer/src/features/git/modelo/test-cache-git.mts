#!/usr/bin/env node
// =============================================================================
// Prueba de la MEMORIA DEL CURSOR del historial (npm run test:cache-git). Lo delicado
// es decidir si lo guardado todavía sirve: un commit que ya no está en la lista no se
// restaura. Fija guardar y recuperar, la memoria por repo, lo que no se guarda, los
// casos sin memoria o sin lista, el tope de entradas y que `purgarRepo` respeta el
// cursor.
// Decisiones: docs/decisiones/git/cambios-caches-de-estado.md
// =============================================================================

import {
  MAX_CACHE_ENTRIES,
  MAX_COMMITS_RETENIDOS,
  ponerCommits,
  purgarRepo,
  recordarSeleccion,
  seleccionARestaurar,
  seleccionCache,
  totalCommitsRetenidos,
  commitsCache
} from './cacheGit.ts'
import type { Commit } from '../../../../../shared/git-ipc.ts'

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

/** Un commit con lo mínimo que mira la comprobación de existencia. */
function commit(hash: string): Commit {
  return {
    hash,
    parents: [],
    authorName: 'Fixture',
    authorEmail: 'fixture@example.com',
    date: '2026-01-01T00:00:00Z',
    refs: '',
    subject: 'x'
  } as unknown as Commit
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) Guardar y recuperar')
  {
    seleccionCache.clear()
    const lista = [commit('aaa'), commit('bbb'), commit('ccc')]
    recordarSeleccion('C:/repos/uno', { hash: 'bbb', ruta: 'src/App.tsx' })
    const sel = seleccionARestaurar('C:/repos/uno', lista)
    check(
      '(1a) vuelve el commit y el archivo',
      sel?.hash === 'bbb' && sel?.ruta === 'src/App.tsx',
      JSON.stringify(sel)
    )
    recordarSeleccion('C:/repos/uno', { hash: 'ccc', ruta: null })
    check(
      '(1b) el último gana, y una ruta nula es válida (nada marcado)',
      seleccionARestaurar('C:/repos/uno', lista)?.hash === 'ccc',
      JSON.stringify(seleccionARestaurar('C:/repos/uno', lista))
    )
  }

  // -------------------------------------------------------------------------
  hr('(2) El commit que ya no está NO se restaura')
  {
    seleccionCache.clear()
    recordarSeleccion('C:/repos/uno', { hash: 'rebasado', ruta: null })
    check(
      '(2a) un hash que no está en la lista -> null',
      seleccionARestaurar('C:/repos/uno', [commit('aaa'), commit('bbb')]) === null,
      'null'
    )
    check(
      '(2b) y la memoria NO se borra: al volver a la rama donde sí está, vuelve',
      seleccionARestaurar('C:/repos/uno', [commit('rebasado')])?.hash === 'rebasado',
      'rebasado'
    )
  }

  // -------------------------------------------------------------------------
  hr('(3) La memoria es POR REPO')
  {
    seleccionCache.clear()
    const listaA = [commit('a1')]
    const listaB = [commit('b1')]
    recordarSeleccion('C:/repos/uno', { hash: 'a1', ruta: 'uno.ts' })
    recordarSeleccion('C:/repos/dos', { hash: 'b1', ruta: 'dos.ts' })
    check(
      '(3a) cada repo recuerda el suyo',
      seleccionARestaurar('C:/repos/uno', listaA)?.ruta === 'uno.ts' &&
        seleccionARestaurar('C:/repos/dos', listaB)?.ruta === 'dos.ts',
      'uno.ts / dos.ts'
    )
    check(
      '(3b) y el de uno no se cuela en el otro',
      seleccionARestaurar('C:/repos/dos', listaA) === null,
      'null'
    )
  }

  // -------------------------------------------------------------------------
  hr('(4) Lo que NO se guarda')
  {
    seleccionCache.clear()
    recordarSeleccion(null, { hash: 'aaa', ruta: null })
    recordarSeleccion('', { hash: 'aaa', ruta: null })
    recordarSeleccion('C:/repos/uno', { hash: '', ruta: 'x' })
    check('(4a) repo nulo, repo vacío y hash vacío no dejan nada', seleccionCache.size === 0, '0 entradas')
  }

  // -------------------------------------------------------------------------
  hr('(5) Sin memoria y sin lista')
  {
    seleccionCache.clear()
    check('(5a) sin nada guardado -> null', seleccionARestaurar('C:/repos/uno', [commit('a')]) === null, 'null')
    recordarSeleccion('C:/repos/uno', { hash: 'a', ruta: null })
    check('(5b) lista todavía sin cargar (null) -> null', seleccionARestaurar('C:/repos/uno', null) === null, 'null')
    check('(5c) lista vacía -> null', seleccionARestaurar('C:/repos/uno', []) === null, 'null')
    check('(5d) repo nulo -> null', seleccionARestaurar(null, [commit('a')]) === null, 'null')
  }

  // -------------------------------------------------------------------------
  hr('(6) El tope desaloja lo más antiguo')
  {
    seleccionCache.clear()
    for (let i = 0; i < MAX_CACHE_ENTRIES + 3; i++) {
      recordarSeleccion(`C:/repos/r${i}`, { hash: `h${i}`, ruta: null })
    }
    check(
      `(6a) nunca pasa de ${MAX_CACHE_ENTRIES} entradas`,
      seleccionCache.size === MAX_CACHE_ENTRIES,
      `${seleccionCache.size}`
    )
    check(
      '(6b) el primero se desalojó y el último sigue',
      seleccionARestaurar('C:/repos/r0', [commit('h0')]) === null &&
        seleccionARestaurar(`C:/repos/r${MAX_CACHE_ENTRIES + 2}`, [
          commit(`h${MAX_CACHE_ENTRIES + 2}`)
        ]) !== null,
      'r0 fuera, el último dentro'
    )
  }

  // -------------------------------------------------------------------------
  hr('(7) purgarRepo NO borra el cursor')
  {
    seleccionCache.clear()
    commitsCache.clear()
    recordarSeleccion('C:/repos/uno', { hash: 'aaa', ruta: 'x.ts' })
    purgarRepo('C:/repos/uno')
    check(
      '(7a) purgar la lista de commits deja el cursor donde estaba',
      seleccionARestaurar('C:/repos/uno', [commit('aaa')])?.ruta === 'x.ts',
      'x.ts'
    )
    check('(7b) y sí purgó lo que le tocaba (la lista)', commitsCache.size === 0, '0')
  }

  // ---------------------------------------------------------------------------
  // (8) LOS DOS TOPES de `ponerCommits`. Contar entradas no basta: "cargar el
  //     historial completo" hace que UNA entrada pueda ser el repo entero, así que
  //     dos de ellas ocupan decenas de MB usando 2 de las 32 ranuras y el contador
  //     de entradas no vería nada raro. De ahí el segundo eje.
  // ---------------------------------------------------------------------------
  hr('(8) ponerCommits respeta el tope de ENTRADAS y el de COMMITS')
  {
    // SE VACÍA POR `purgarRepo`, NUNCA por `commitsCache.clear()`. El contador de
    // commits retenidos es incremental y solo lo mantiene el borrado interno del
    // módulo; un `clear()` desde fuera lo dejaría contando fantasmas, y el fallo
    // aparecería más tarde y señalando a `ponerCommits` en vez de a este `clear`.
    // Hoy pasaría igual (nada anterior escribe commits), pero el día que una sección
    // de arriba use `ponerCommits` este atajo convierte los casos de abajo en ruido.
    for (const k of [...commitsCache.keys()]) purgarRepo(k.split('\n')[0])
    const antes = totalCommitsRetenidos()

    // Tope de ENTRADAS: se meten MAX+3 entradas de 1 commit.
    for (let i = 0; i < MAX_CACHE_ENTRIES + 3; i++) {
      ponerCommits(`R${i}\n`, { commits: [commit(`h${i}`)], full: false })
    }
    check(
      '(8a) no se guardan más de MAX_CACHE_ENTRIES entradas',
      commitsCache.size === MAX_CACHE_ENTRIES,
      `size=${commitsCache.size} tope=${MAX_CACHE_ENTRIES}`
    )
    check(
      '(8b) desaloja las MÁS ANTIGUAS y conserva la última escrita',
      !commitsCache.has('R0\n') && commitsCache.has(`R${MAX_CACHE_ENTRIES + 2}\n`),
      `R0 fuera, R${MAX_CACHE_ENTRIES + 2} dentro`
    )

    // Tope de COMMITS: una entrada gigante desaloja a varias pequeñas.
    const gorda = Array.from({ length: MAX_COMMITS_RETENIDOS }, (_, i) => commit(`g${i}`))
    ponerCommits('GORDA\n', { commits: gorda, full: true })
    check(
      '(8c) una entrada gigante desaloja a las pequeñas hasta caber',
      commitsCache.has('GORDA\n') && commitsCache.size === 1,
      `size=${commitsCache.size}`
    )
    check(
      '(8d) el contador cuadra con lo que queda',
      totalCommitsRetenidos() === MAX_COMMITS_RETENIDOS,
      `retenidos=${totalCommitsRetenidos()}`
    )

    // NUNCA se desaloja la recién guardada, aunque ella sola pase del tope: borrar
    // lo que el usuario está mirando para cumplir un presupuesto es la peor forma
    // posible de cumplirlo.
    const enorme = Array.from({ length: MAX_COMMITS_RETENIDOS + 10 }, (_, i) => commit(`e${i}`))
    ponerCommits('ENORME\n', { commits: enorme, full: true })
    check(
      '(8e) la entrada recién guardada nunca se desaloja a sí misma',
      commitsCache.has('ENORME\n'),
      `size=${commitsCache.size} retenidos=${totalCommitsRetenidos()}`
    )

    // Y purgar deja el contador consistente: es lo que hace que llevarlo
    // incrementalmente (en vez de re-sumar) sea seguro.
    purgarRepo('ENORME')
    purgarRepo('GORDA')
    for (let i = 0; i < MAX_CACHE_ENTRIES + 3; i++) purgarRepo(`R${i}`)
    check(
      '(8f) tras purgarlo todo, el contador vuelve a donde estaba',
      commitsCache.size === 0 && totalCommitsRetenidos() === antes,
      `size=${commitsCache.size} retenidos=${totalCommitsRetenidos()} (antes=${antes})`
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
