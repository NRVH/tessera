#!/usr/bin/env node
// =============================================================================
// Prueba del reducer puro de `editorTabsModel` (node src/renderer/src/features/editor/test-editor-tabs.mts).
// Cubre apertura y deduplicación, ids derivados, activación, cierre y vecinas, inmutabilidad,
// `editorTargetKey`, los archivos sin título (numeración con huecos y `replaceTab`) y las
// pestañas efímeras (sustitución en su hueco, ascenso y «como mucho una»).
// Corre bajo `node` llano: el modelo no tiene React, DOM, IPC ni Monaco.
// =============================================================================

import {
  initialEditorTabsState,
  deriveTabId,
  editorTargetKey,
  nextUntitledNumber,
  openTab,
  replaceTab,
  setActiveTab,
  closeTab,
  getActiveTab,
  untitledName,
  type EditorTabsState
} from './editorTabsModel.ts'
import type { CenterPane } from './centerPane.ts'
import type { DiffTarget } from './diffEditorTipos.ts'

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
function filePane(path: string): CenterPane {
  return { kind: 'file', file: { path, name: path.split('/').pop() ?? path } }
}

function diffTarget(commitHash: string, path: string): DiffTarget {
  return {
    commitHash,
    status: 'M',
    path,
    // 'WORKTREE' es el CENTINELA real del diff del working-tree (ver
    // features/git/modelo/resolveWorkingDiffTarget); cualquier otro valor se trata como un hash.
    before: { source: 'commit', hash: commitHash, path },
    after: commitHash === 'WORKTREE' ? { source: 'worktree', path } : { source: 'commit', hash: commitHash, path }
  }
}

function diffPane(commitHash: string, path: string): CenterPane {
  return { kind: 'diff', target: diffTarget(commitHash, path) }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  const A = 'src/renderer/src/App.tsx'
  const B = 'src/renderer/src/features/pestanas/tabsModel.ts'

  // --- (1) initial -----------------------------------------------------------
  hr('(1) estado inicial: tabs vacío, activeId null')
  const empty = initialEditorTabsState
  check(
    '(1) tabs=[] y activeId=null',
    empty.tabs.length === 0 && empty.activeId === null,
    JSON.stringify(empty)
  )

  // --- (2) openTab de un file --------------------------------------------------
  hr('(2) openTab de un file: 1 tab, activa, id === path')
  const s1 = openTab(empty, filePane(A))
  check(
    '(2) 1 tab, activeId === path, id === path',
    s1.tabs.length === 1 && s1.activeId === A && s1.tabs[0].id === A,
    JSON.stringify(s1)
  )

  // --- (3) openTab del MISMO file otra vez (dedup) ----------------------------
  hr('(3) reabrir el mismo file: sigue 1 tab (dedup), orden intacto')
  const s2 = openTab(s1, filePane(A))
  check(
    '(3) sigue 1 tab, activa, misma identidad',
    s2.tabs.length === 1 && s2.activeId === A && s2.tabs[0].id === A,
    JSON.stringify(s2)
  )

  // --- (4) openTab de un segundo file distinto --------------------------------
  hr('(4) openTab de un segundo file: 2 tabs, la nueva activa, orden [A, B]')
  const s3 = openTab(s2, filePane(B))
  check(
    '(4) 2 tabs en orden [A,B], activa B',
    s3.tabs.length === 2 &&
      s3.tabs[0].id === A &&
      s3.tabs[1].id === B &&
      s3.activeId === B,
    JSON.stringify(s3.tabs.map((t) => t.id)) + ` active=${s3.activeId}`
  )

  // --- (5) openTab de un diff del MISMO path que un file abierto --------------
  hr('(5) abrir un diff working del path A: tab DISTINTA de la file A, activa')
  const s4 = openTab(s3, diffPane('WORKTREE', A))
  const diffIdA = `diff:WORKTREE:${A}`
  check(
    '(5) 3 tabs (file A, file B, diff A), diff activa, ids distintos',
    s4.tabs.length === 3 &&
      s4.tabs.some((t) => t.id === A) &&
      s4.tabs.some((t) => t.id === diffIdA) &&
      s4.activeId === diffIdA,
    JSON.stringify(s4.tabs.map((t) => t.id)) + ` active=${s4.activeId}`
  )

  // --- (6) deriveTabId ---------------------------------------------------------
  hr('(6) deriveTabId: file -> path; diff working -> diff:WORKTREE:<path>; diff commit -> diff:<hash>:<path>')
  const idFile = deriveTabId(filePane(A))
  const idDiffHead = deriveTabId(diffPane('WORKTREE', A))
  const idDiffCommit = deriveTabId(diffPane('abc123', A))
  check(
    '(6) file->path, diff working->diff:WORKTREE:path, diff commit->diff:<hash>:path, todos distintos',
    idFile === A &&
      idDiffHead === `diff:WORKTREE:${A}` &&
      idDiffCommit === `diff:abc123:${A}` &&
      new Set([idFile, idDiffHead, idDiffCommit]).size === 3,
    `file=${idFile} diffHead=${idDiffHead} diffCommit=${idDiffCommit}`
  )

  // --- (7) setActiveTab --------------------------------------------------------
  hr('(7) setActiveTab a id existente cambia el activo; a id inexistente es no-op')
  const s5 = setActiveTab(s4, A)
  check('(7a) activar A (existente) -> activeId=A', s5.activeId === A, `activeId=${s5.activeId}`)
  const s6 = setActiveTab(s5, 'ruta/que/no/existe')
  check('(7b) activar id inexistente -> no-op (mismo estado)', s6 === s5, `same=${s6 === s5}`)

  // --- (8) closeTab de la ACTIVA con vecina a la derecha -----------------------
  hr('(8) closeTab de la activa (B, índice 1 de 3): vecina a la derecha (diff A) la sucede')
  // s4: tabs = [A, B, diffA], activa = diffA. Activamos B para cerrarla en medio.
  const s7base = setActiveTab(s4, B)
  const s7 = closeTab(s7base, B)
  check(
    '(8) B desaparece; quedan [A, diffA] en orden; activa = diffA (vecina derecha)',
    s7.tabs.length === 2 &&
      s7.tabs[0].id === A &&
      s7.tabs[1].id === diffIdA &&
      s7.activeId === diffIdA,
    JSON.stringify(s7.tabs.map((t) => t.id)) + ` active=${s7.activeId}`
  )

  // --- (9) closeTab de la ÚLTIMA tab ------------------------------------------
  hr('(9) cerrar todas las tabs hasta la última: activeId -> null, tabs vacío')
  const s8 = closeTab(s7, A)
  const s9 = closeTab(s8, diffIdA)
  check(
    '(9) tabs vacío y activeId null tras cerrar la última',
    s9.tabs.length === 0 && s9.activeId === null,
    JSON.stringify(s9)
  )

  // --- (10) closeTab de una tab NO activa --------------------------------------
  hr('(10) cerrar una tab que NO es la activa: activeId intacto, esa tab desaparece')
  const s10base = openTab(openTab(openTab(empty, filePane(A)), filePane(B)), diffPane('WORKTREE', A))
  // s10base: tabs=[A,B,diffA], activa=diffA
  const s10 = closeTab(s10base, B)
  check(
    '(10) B desaparece, activeId sigue siendo diffA',
    s10.tabs.length === 2 &&
      !s10.tabs.some((t) => t.id === B) &&
      s10.activeId === diffIdA,
    JSON.stringify(s10.tabs.map((t) => t.id)) + ` active=${s10.activeId}`
  )

  // --- (11) closeTab de id inexistente -----------------------------------------
  hr('(11) closeTab de un id inexistente: no-op referencial')
  const s11 = closeTab(s10, 'no/existe')
  check('(11) mismo estado (no-op)', s11 === s10, `same=${s11 === s10}`)

  // --- (12) inmutabilidad -------------------------------------------------------
  hr('(12) inmutabilidad: el state de entrada no se muta')
  const before: EditorTabsState = openTab(openTab(empty, filePane(A)), filePane(B))
  const beforeLen = before.tabs.length
  const beforeActive = before.activeId
  const beforeTabsRef = before.tabs
  closeTab(before, A)
  openTab(before, diffPane('WORKTREE', B))
  setActiveTab(before, B)
  check(
    '(12) el objeto `before` conserva longitud/activeId/referencia de tabs tras otras acciones',
    before.tabs.length === beforeLen && before.activeId === beforeActive && before.tabs === beforeTabsRef,
    `len=${before.tabs.length} active=${before.activeId} sameTabsArray=${before.tabs === beforeTabsRef}`
  )

  // --- (13) getActiveTab selector -----------------------------------------------
  hr('(13) getActiveTab: devuelve la tab activa completa, o null si no hay activa')
  const activeTab = getActiveTab(s10)
  check(
    '(13a) getActiveTab de s10 devuelve la tab diffA',
    activeTab !== null && activeTab.id === diffIdA && activeTab.pane.kind === 'diff',
    JSON.stringify(activeTab)
  )
  check('(13b) getActiveTab de estado vacío es null', getActiveTab(empty) === null, `${getActiveTab(empty)}`)

  // ---------------------------------------------------------------------------
  // (14) editorTargetKey: scoping por (perfil, proyecto). Distintos perfiles y
  //      distintos proyectos producen claves DISTINTAS (así sus tabs no se
  //      comparten); mismo (perfil, proyecto) produce la MISMA clave (estable).
  // ---------------------------------------------------------------------------
  hr('(14) editorTargetKey: claves distintas por perfil/proyecto, estable e inequívoca')
  const kBeta1 = editorTargetKey('beta', 'D:\\proj\\1')
  const kBeta2 = editorTargetKey('beta', 'D:\\proj\\2')
  const kAlfa1 = editorTargetKey('alfa', 'D:\\proj\\1')
  check(
    '(14a) mismo proyecto en perfiles distintos -> claves DISTINTAS (no se comparten tabs)',
    kBeta1 !== kAlfa1,
    `beta=${kBeta1} alfa=${kAlfa1}`
  )
  check(
    '(14b) proyectos distintos en el mismo perfil -> claves DISTINTAS',
    kBeta1 !== kBeta2,
    `p1=${kBeta1} p2=${kBeta2}`
  )
  check(
    '(14c) mismo (perfil, proyecto) -> MISMA clave (estable)',
    editorTargetKey('beta', 'D:\\proj\\1') === kBeta1,
    `${kBeta1}`
  )

  // ---------------------------------------------------------------------------
  // (15) SIN TÍTULO (Ctrl+N): id por el id opaco del buffer (no por el nombre),
  //      numeración que reutiliza huecos, y replaceTab (guardar = convertir la
  //      pestaña EN SU SITIO, sin duplicar ni reordenar).
  // ---------------------------------------------------------------------------
  hr('(15) archivos sin título: id, numeración y conversión al guardar')
  const u1: CenterPane = { kind: 'untitled', untitled: { id: 'untitled-1', name: 'Sin título-1' } }
  check(
    '(15a) deriveTabId de un sin título -> untitled:<id opaco> (no depende del nombre)',
    deriveTabId(u1) === 'untitled:untitled-1' &&
      deriveTabId({ kind: 'untitled', untitled: { id: 'untitled-1', name: 'notas.txt', saved: true } }) ===
        'untitled:untitled-1',
    deriveTabId(u1)
  )

  const t0 = openTab(openTab(empty, filePane(A)), u1)
  check(
    '(15b) numeración: con "Sin título-1" abierto, el siguiente libre es el 2',
    nextUntitledNumber(t0) === 2 && untitledName(2) === 'Sin título-2',
    `next=${nextUntitledNumber(t0)}`
  )
  const t1 = openTab(t0, { kind: 'untitled', untitled: { id: 'untitled-2', name: untitledName(2) } })
  const t2 = closeTab(t1, 'untitled:untitled-1')
  check(
    '(15c) al cerrar el 1 y quedar el 2, el hueco se reutiliza: el siguiente vuelve a ser 1',
    nextUntitledNumber(t2) === 1,
    `next=${nextUntitledNumber(t2)}`
  )
  check(
    '(15d) un sin título YA guardado (fuera del proyecto) libera su número',
    nextUntitledNumber(
      openTab(empty, {
        kind: 'untitled',
        untitled: { id: 'untitled-9', name: 'notas.txt', saved: true }
      })
    ) === 1,
    'next=1'
  )

  // Guardar DENTRO del proyecto: la pestaña se convierte en archivo, en su hueco.
  const t3 = replaceTab(t1, 'untitled:untitled-1', filePane('notas.txt'))
  check(
    '(15e) replaceTab: mismo hueco (índice 1 de [A, u1, u2]), id nuevo, sigue activa la que era activa',
    t3.tabs.length === 3 &&
      t3.tabs[1].id === 'notas.txt' &&
      t3.tabs[1].pane.kind === 'file' &&
      t3.tabs[0].id === A &&
      t3.tabs[2].id === 'untitled:untitled-2' &&
      t3.activeId === 'untitled:untitled-2',
    JSON.stringify(t3.tabs.map((t) => t.id)) + ` active=${t3.activeId}`
  )
  check(
    '(15f) replaceTab de la tab ACTIVA: el activo migra al id nuevo',
    replaceTab(setActiveTab(t1, 'untitled:untitled-1'), 'untitled:untitled-1', filePane('notas.txt'))
      .activeId === 'notas.txt',
    'activeId=notas.txt'
  )
  // Guardar ENCIMA de un archivo que ya estaba abierto: no se duplica la tab.
  const t4 = replaceTab(t1, 'untitled:untitled-1', filePane(A))
  check(
    '(15g) guardar encima de un archivo YA abierto: no duplica, se queda la existente y activa',
    t4.tabs.length === 2 &&
      t4.tabs.filter((t) => t.id === A).length === 1 &&
      t4.activeId === A,
    JSON.stringify(t4.tabs.map((t) => t.id)) + ` active=${t4.activeId}`
  )
  check(
    '(15h) replaceTab de un id inexistente: no-op referencial',
    replaceTab(t1, 'untitled:no-existe', filePane(B)) === t1,
    'same=true'
  )
  check(
    '(15i) replaceTab CONSERVA el flag de efímera (hoy inalcanzable, mañana no)',
    (() => {
      const conEfimera = openTab(empty, u1, true)
      // u1 es untitled, así que openTab NO la marca: se marca a mano para probar
      // exactamente la propagación de replaceTab, que es lo que se está afirmando.
      const forzada: EditorTabsState = {
        tabs: conEfimera.tabs.map((t) => ({ ...t, efimera: true as const })),
        activeId: conEfimera.activeId
      }
      const tras = replaceTab(forzada, 'untitled:untitled-1', filePane('notas.txt'))
      return tras.tabs[0].efimera === true
    })(),
    'efimera=true tras replaceTab'
  )

  // ---------------------------------------------------------------------------
  // (16) PESTAÑA EFÍMERA (vista previa). Es lo que hace que recorrer el historial
  //      con las flechas deje UNA pestaña y no veinte. El invariante que sostiene
  //      todo —como mucho una efímera— se afirma al final de cada caso.
  // ---------------------------------------------------------------------------
  hr('(16) pestaña efímera: sustitución en su hueco, ascenso y confinamiento')
  const D1 = diffPane('c0ffee1', 'src/uno.ts')
  const D2 = diffPane('c0ffee2', 'src/dos.ts')
  const D3 = diffPane('c0ffee3', 'src/tres.ts')
  const id1 = deriveTabId(D1)
  const id2 = deriveTabId(D2)

  /** El invariante duro de todo este grupo. */
  function unaSolaEfimera(s: EditorTabsState): boolean {
    return s.tabs.filter((t) => t.efimera === true).length <= 1
  }

  const e1 = openTab(empty, D1, true)
  check(
    '(16a) abrir efímera: 1 tab marcada, activa',
    e1.tabs.length === 1 && e1.tabs[0].efimera === true && e1.activeId === id1 && unaSolaEfimera(e1),
    JSON.stringify(e1.tabs.map((t) => ({ id: t.id, ef: t.efimera })))
  )

  const e2 = openTab(e1, D2, true)
  check(
    '(16b) abrir OTRA efímera la SUSTITUYE: sigue habiendo 1 tab, la nueva',
    e2.tabs.length === 1 && e2.tabs[0].id === id2 && e2.activeId === id2 && unaSolaEfimera(e2),
    JSON.stringify(e2.tabs.map((t) => t.id))
  )

  // Una normal delante y otra detrás: la sustitución NO puede reordenar nada.
  const conVecinas = openTab(openTab(openTab(empty, filePane(A)), D1, true), filePane(B))
  check(
    '(16c) orden de partida [A, efímera, B]',
    conVecinas.tabs.map((t) => t.id).join('|') === `${A}|${id1}|${B}`,
    JSON.stringify(conVecinas.tabs.map((t) => t.id))
  )
  const sustituida = openTab(conVecinas, D2, true)
  check(
    '(16d) la efímera del MEDIO se sustituye en su índice, sin mover a los vecinos',
    sustituida.tabs.map((t) => t.id).join('|') === `${A}|${id2}|${B}` &&
      sustituida.activeId === id2 &&
      unaSolaEfimera(sustituida),
    JSON.stringify(sustituida.tabs.map((t) => t.id)) + ` active=${sustituida.activeId}`
  )

  const ascendida = openTab(e1, D1, false)
  check(
    '(16e) reabrir la MISMA en modo normal la ASCIENDE (deja de ser efímera)',
    ascendida.tabs.length === 1 &&
      ascendida.tabs[0].efimera === undefined &&
      ascendida.activeId === id1 &&
      unaSolaEfimera(ascendida),
    `efimera=${String(ascendida.tabs[0].efimera)}`
  )
  check(
    '(16f) y al revés NUNCA: reabrirla como efímera no degrada una permanente',
    openTab(ascendida, D1, true).tabs[0].efimera === undefined,
    'sigue permanente'
  )
  check(
    '(16g) tras ascender, la siguiente efímera se AÑADE en vez de sustituirla',
    (() => {
      const s = openTab(ascendida, D2, true)
      return s.tabs.length === 2 && s.tabs[1].efimera === true && unaSolaEfimera(s)
    })(),
    '2 tabs'
  )

  check(
    '(16h) abrir un archivo del explorador NO cierra la efímera (se añade al final)',
    (() => {
      const s = openTab(e1, filePane(A))
      return (
        s.tabs.length === 2 &&
        s.tabs[0].id === id1 &&
        s.tabs[0].efimera === true &&
        s.activeId === A &&
        unaSolaEfimera(s)
      )
    })(),
    'la efímera sobrevive'
  )
  check(
    '(16i) y el siguiente commit reutiliza el hueco de la efímera, no el del archivo',
    (() => {
      const s = openTab(openTab(e1, filePane(A)), D3, true)
      return s.tabs.length === 2 && s.tabs[0].id === deriveTabId(D3) && s.tabs[1].id === A
    })(),
    'hueco reutilizado'
  )

  check(
    '(16j) un SIN TÍTULO nunca es efímero, aunque se pida',
    (() => {
      const s = openTab(empty, u1, true)
      return s.tabs[0].efimera === undefined && unaSolaEfimera(s)
    })(),
    'efimera=undefined'
  )

  check(
    '(16k) cerrar la efímera se comporta como cualquier otra (hereda la vecina)',
    (() => {
      const s = closeTab(sustituida, id2)
      return s.tabs.length === 2 && s.activeId === B && unaSolaEfimera(s)
    })(),
    'vecina heredada'
  )

  check(
    '(16l) abrir en modo normal cuando NO estaba abierta no marca nada',
    (() => {
      const s = openTab(empty, D1)
      return s.tabs[0].efimera === undefined && unaSolaEfimera(s)
    })(),
    'efimera=undefined'
  )

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
