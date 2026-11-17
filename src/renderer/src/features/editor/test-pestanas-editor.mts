#!/usr/bin/env node
// =============================================================================
// Prueba del reducer puro de `modeloPestanasEditor` (node src/renderer/src/features/editor/test-pestanas-editor.mts).
// Cubre apertura y deduplicación, ids derivados, activación, cierre y vecinas, inmutabilidad,
// `claveDestinoEditor`, los archivos sin título (numeración con huecos y `reemplazarPestanaEditor`) y las
// pestañas efímeras (sustitución en su hueco, ascenso y «como mucho una»).
// Corre bajo `node` llano: el modelo no tiene React, DOM, IPC ni Monaco.
// =============================================================================

import {
  estadoInicialPestanasEditor,
  derivarIdPestana,
  claveDestinoEditor,
  perfilDeDestino,
  raizDeDestino,
  siguienteNumeroSinTitulo,
  abrirPestanaEditor,
  reemplazarPestanaEditor,
  activarPestanaEditor,
  cerrarPestanaEditor,
  obtenerPestanaActiva,
  nombreSinTitulo,
  type EstadoPestanasEditor
} from './modeloPestanasEditor.ts'
import type { PaneCentral } from './paneCentral.ts'
import type { DestinoDiff } from './diffEditorTipos.ts'

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
function paneArchivo(ruta: string): PaneCentral {
  return { tipo: 'file', archivo: { ruta, nombre: ruta.split('/').pop() ?? ruta } }
}

function destinoDiff(commitHash: string, ruta: string): DestinoDiff {
  return {
    commitHash,
    estado: 'M',
    ruta,
    // 'WORKTREE' es el CENTINELA real del diff del working-tree (ver
    // features/git/modelo/resolverDestinoDiffWorktree); cualquier otro valor se trata como un hash.
    antes: { origen: 'commit', hash: commitHash, ruta },
    despues: commitHash === 'WORKTREE' ? { origen: 'worktree', ruta } : { origen: 'commit', hash: commitHash, ruta }
  }
}

function paneDiff(commitHash: string, ruta: string): PaneCentral {
  return { tipo: 'diff', destino: destinoDiff(commitHash, ruta) }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  const A = 'src/renderer/src/App.tsx'
  const B = 'src/renderer/src/features/pestanas/modeloPestanas.ts'

  // --- (1) initial -----------------------------------------------------------
  hr('(1) estado inicial: tabs vacío, pestanaActivaId null')
  const vacio = estadoInicialPestanasEditor
  check(
    '(1) tabs=[] y pestanaActivaId=null',
    vacio.pestanas.length === 0 && vacio.pestanaActivaId === null,
    JSON.stringify(vacio)
  )

  // --- (2) abrirPestanaEditor de un file ---------------------------------------
  hr('(2) abrirPestanaEditor de un file: 1 tab, activa, id === path')
  const s1 = abrirPestanaEditor(vacio, paneArchivo(A))
  check(
    '(2) 1 tab, pestanaActivaId === path, id === path',
    s1.pestanas.length === 1 && s1.pestanaActivaId === A && s1.pestanas[0].id === A,
    JSON.stringify(s1)
  )

  // --- (3) abrirPestanaEditor del MISMO file otra vez (dedup) ------------------
  hr('(3) reabrir el mismo file: sigue 1 tab (dedup), orden intacto')
  const s2 = abrirPestanaEditor(s1, paneArchivo(A))
  check(
    '(3) sigue 1 tab, activa, misma identidad',
    s2.pestanas.length === 1 && s2.pestanaActivaId === A && s2.pestanas[0].id === A,
    JSON.stringify(s2)
  )

  // --- (4) abrirPestanaEditor de un segundo file distinto ----------------------
  hr('(4) abrirPestanaEditor de un segundo file: 2 tabs, la nueva activa, orden [A, B]')
  const s3 = abrirPestanaEditor(s2, paneArchivo(B))
  check(
    '(4) 2 tabs en orden [A,B], activa B',
    s3.pestanas.length === 2 &&
      s3.pestanas[0].id === A &&
      s3.pestanas[1].id === B &&
      s3.pestanaActivaId === B,
    JSON.stringify(s3.pestanas.map((t) => t.id)) + ` active=${s3.pestanaActivaId}`
  )

  // --- (5) abrirPestanaEditor de un diff del MISMO path que un file abierto ----
  hr('(5) abrir un diff working del path A: tab DISTINTA de la file A, activa')
  const s4 = abrirPestanaEditor(s3, paneDiff('WORKTREE', A))
  const diffIdA = `diff:WORKTREE:${A}`
  check(
    '(5) 3 tabs (file A, file B, diff A), diff activa, ids distintos',
    s4.pestanas.length === 3 &&
      s4.pestanas.some((t) => t.id === A) &&
      s4.pestanas.some((t) => t.id === diffIdA) &&
      s4.pestanaActivaId === diffIdA,
    JSON.stringify(s4.pestanas.map((t) => t.id)) + ` active=${s4.pestanaActivaId}`
  )

  // --- (6) derivarIdPestana ----------------------------------------------------
  hr('(6) derivarIdPestana: file -> path; diff working -> diff:WORKTREE:<path>; diff commit -> diff:<hash>:<path>')
  const idArchivo = derivarIdPestana(paneArchivo(A))
  const idDiffHead = derivarIdPestana(paneDiff('WORKTREE', A))
  const idDiffCommit = derivarIdPestana(paneDiff('abc123', A))
  check(
    '(6) file->path, diff working->diff:WORKTREE:path, diff commit->diff:<hash>:path, todos distintos',
    idArchivo === A &&
      idDiffHead === `diff:WORKTREE:${A}` &&
      idDiffCommit === `diff:abc123:${A}` &&
      new Set([idArchivo, idDiffHead, idDiffCommit]).size === 3,
    `file=${idArchivo} diffHead=${idDiffHead} diffCommit=${idDiffCommit}`
  )

  // --- (7) activarPestanaEditor -----------------------------------------------
  hr('(7) activarPestanaEditor a id existente cambia el activo; a id inexistente es no-op')
  const s5 = activarPestanaEditor(s4, A)
  check('(7a) activar A (existente) -> pestanaActivaId=A', s5.pestanaActivaId === A, `pestanaActivaId=${s5.pestanaActivaId}`)
  const s6 = activarPestanaEditor(s5, 'ruta/que/no/existe')
  check('(7b) activar id inexistente -> no-op (mismo estado)', s6 === s5, `same=${s6 === s5}`)

  // --- (8) cerrarPestanaEditor de la ACTIVA con vecina a la derecha -------------
  hr('(8) cerrarPestanaEditor de la activa (B, índice 1 de 3): vecina a la derecha (diff A) la sucede')
  // s4: tabs = [A, B, diffA], activa = diffA. Activamos B para cerrarla en medio.
  const s7base = activarPestanaEditor(s4, B)
  const s7 = cerrarPestanaEditor(s7base, B)
  check(
    '(8) B desaparece; quedan [A, diffA] en orden; activa = diffA (vecina derecha)',
    s7.pestanas.length === 2 &&
      s7.pestanas[0].id === A &&
      s7.pestanas[1].id === diffIdA &&
      s7.pestanaActivaId === diffIdA,
    JSON.stringify(s7.pestanas.map((t) => t.id)) + ` active=${s7.pestanaActivaId}`
  )

  // --- (9) cerrarPestanaEditor de la ÚLTIMA tab --------------------------------
  hr('(9) cerrar todas las tabs hasta la última: pestanaActivaId -> null, tabs vacío')
  const s8 = cerrarPestanaEditor(s7, A)
  const s9 = cerrarPestanaEditor(s8, diffIdA)
  check(
    '(9) tabs vacío y pestanaActivaId null tras cerrar la última',
    s9.pestanas.length === 0 && s9.pestanaActivaId === null,
    JSON.stringify(s9)
  )

  // --- (10) cerrarPestanaEditor de una tab NO activa ---------------------------
  hr('(10) cerrar una tab que NO es la activa: pestanaActivaId intacto, esa tab desaparece')
  const s10base = abrirPestanaEditor(abrirPestanaEditor(abrirPestanaEditor(vacio, paneArchivo(A)), paneArchivo(B)), paneDiff('WORKTREE', A))
  // s10base: tabs=[A,B,diffA], activa=diffA
  const s10 = cerrarPestanaEditor(s10base, B)
  check(
    '(10) B desaparece, pestanaActivaId sigue siendo diffA',
    s10.pestanas.length === 2 &&
      !s10.pestanas.some((t) => t.id === B) &&
      s10.pestanaActivaId === diffIdA,
    JSON.stringify(s10.pestanas.map((t) => t.id)) + ` active=${s10.pestanaActivaId}`
  )

  // --- (11) cerrarPestanaEditor de id inexistente ------------------------------
  hr('(11) cerrarPestanaEditor de un id inexistente: no-op referencial')
  const s11 = cerrarPestanaEditor(s10, 'no/existe')
  check('(11) mismo estado (no-op)', s11 === s10, `same=${s11 === s10}`)

  // --- (12) inmutabilidad -------------------------------------------------------
  hr('(12) inmutabilidad: el state de entrada no se muta')
  const antes: EstadoPestanasEditor = abrirPestanaEditor(abrirPestanaEditor(vacio, paneArchivo(A)), paneArchivo(B))
  const lenAntes = antes.pestanas.length
  const pestanaActivaIdAntes = antes.pestanaActivaId
  const pestanasAntesRef = antes.pestanas
  cerrarPestanaEditor(antes, A)
  abrirPestanaEditor(antes, paneDiff('WORKTREE', B))
  activarPestanaEditor(antes, B)
  check(
    '(12) el objeto `before` conserva longitud/pestanaActivaId/referencia de tabs tras otras acciones',
    antes.pestanas.length === lenAntes && antes.pestanaActivaId === pestanaActivaIdAntes && antes.pestanas === pestanasAntesRef,
    `len=${antes.pestanas.length} active=${antes.pestanaActivaId} sameTabsArray=${antes.pestanas === pestanasAntesRef}`
  )

  // --- (13) obtenerPestanaActiva selector --------------------------------------
  hr('(13) obtenerPestanaActiva: devuelve la tab activa completa, o null si no hay activa')
  const pestanaActiva = obtenerPestanaActiva(s10)
  check(
    '(13a) obtenerPestanaActiva de s10 devuelve la tab diffA',
    pestanaActiva !== null && pestanaActiva.id === diffIdA && pestanaActiva.pane.tipo === 'diff',
    JSON.stringify(pestanaActiva)
  )
  check('(13b) obtenerPestanaActiva de estado vacío es null', obtenerPestanaActiva(vacio) === null, `${obtenerPestanaActiva(vacio)}`)

  // ---------------------------------------------------------------------------
  // (14) claveDestinoEditor: scoping por (perfil, proyecto). Distintos perfiles y
  //      distintos proyectos producen claves DISTINTAS (así sus tabs no se
  //      comparten); mismo (perfil, proyecto) produce la MISMA clave (estable).
  // ---------------------------------------------------------------------------
  hr('(14) claveDestinoEditor: claves distintas por perfil/proyecto, estable e inequívoca')
  const kBeta1 = claveDestinoEditor('beta', 'D:\\proj\\1')
  const kBeta2 = claveDestinoEditor('beta', 'D:\\proj\\2')
  const kAlfa1 = claveDestinoEditor('alfa', 'D:\\proj\\1')
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
    claveDestinoEditor('beta', 'D:\\proj\\1') === kBeta1,
    `${kBeta1}`
  )
  const raizPosix = raizDeDestino(claveDestinoEditor('beta', '/home/x/a|b'))
  check(
    '(14d) raizDeDestino devuelve la contenedora intacta, también con «|» en la ruta, y "" sin target',
    raizDeDestino(kBeta1) === 'D:\\proj\\1' && raizPosix === '/home/x/a|b' && raizDeDestino('suelta') === '',
    `${raizDeDestino(kBeta1)} | ${raizPosix}`
  )
  check(
    '(14e) perfilDeDestino devuelve el perfil, y "" sin target',
    perfilDeDestino(kBeta1) === 'beta' && perfilDeDestino(claveDestinoEditor('beta', '/home/x/a|b')) === 'beta' && perfilDeDestino(null) === '',
    perfilDeDestino(kBeta1)
  )

  // ---------------------------------------------------------------------------
  // (15) SIN TÍTULO (Ctrl+N): id por el id opaco del buffer (no por el nombre),
  //      numeración que reutiliza huecos, y reemplazarPestanaEditor (guardar = convertir la
  //      pestaña EN SU SITIO, sin duplicar ni reordenar).
  // ---------------------------------------------------------------------------
  hr('(15) archivos sin título: id, numeración y conversión al guardar')
  const u1: PaneCentral = { tipo: 'untitled', sinTitulo: { id: 'untitled-1', nombre: 'Sin título-1' } }
  check(
    '(15a) derivarIdPestana de un sin título -> untitled:<id opaco> (no depende del nombre)',
    derivarIdPestana(u1) === 'untitled:untitled-1' &&
      derivarIdPestana({ tipo: 'untitled', sinTitulo: { id: 'untitled-1', nombre: 'notas.txt', guardado: true } }) ===
        'untitled:untitled-1',
    derivarIdPestana(u1)
  )

  const t0 = abrirPestanaEditor(abrirPestanaEditor(vacio, paneArchivo(A)), u1)
  check(
    '(15b) numeración: con "Sin título-1" abierto, el siguiente libre es el 2',
    siguienteNumeroSinTitulo(t0) === 2 && nombreSinTitulo(2) === 'Sin título-2',
    `next=${siguienteNumeroSinTitulo(t0)}`
  )
  const t1 = abrirPestanaEditor(t0, { tipo: 'untitled', sinTitulo: { id: 'untitled-2', nombre: nombreSinTitulo(2) } })
  const t2 = cerrarPestanaEditor(t1, 'untitled:untitled-1')
  check(
    '(15c) al cerrar el 1 y quedar el 2, el hueco se reutiliza: el siguiente vuelve a ser 1',
    siguienteNumeroSinTitulo(t2) === 1,
    `next=${siguienteNumeroSinTitulo(t2)}`
  )
  check(
    '(15d) un sin título YA guardado (fuera del proyecto) libera su número',
    siguienteNumeroSinTitulo(
      abrirPestanaEditor(vacio, {
        tipo: 'untitled',
        sinTitulo: { id: 'untitled-9', nombre: 'notas.txt', guardado: true }
      })
    ) === 1,
    'next=1'
  )

  // Guardar DENTRO del proyecto: la pestaña se convierte en archivo, en su hueco.
  const t3 = reemplazarPestanaEditor(t1, 'untitled:untitled-1', paneArchivo('notas.txt'))
  check(
    '(15e) reemplazarPestanaEditor: mismo hueco (índice 1 de [A, u1, u2]), id nuevo, sigue activa la que era activa',
    t3.pestanas.length === 3 &&
      t3.pestanas[1].id === 'notas.txt' &&
      t3.pestanas[1].pane.tipo === 'file' &&
      t3.pestanas[0].id === A &&
      t3.pestanas[2].id === 'untitled:untitled-2' &&
      t3.pestanaActivaId === 'untitled:untitled-2',
    JSON.stringify(t3.pestanas.map((t) => t.id)) + ` active=${t3.pestanaActivaId}`
  )
  check(
    '(15f) reemplazarPestanaEditor de la tab ACTIVA: el activo migra al id nuevo',
    reemplazarPestanaEditor(activarPestanaEditor(t1, 'untitled:untitled-1'), 'untitled:untitled-1', paneArchivo('notas.txt'))
      .pestanaActivaId === 'notas.txt',
    'pestanaActivaId=notas.txt'
  )
  // Guardar ENCIMA de un archivo que ya estaba abierto: no se duplica la tab.
  const t4 = reemplazarPestanaEditor(t1, 'untitled:untitled-1', paneArchivo(A))
  check(
    '(15g) guardar encima de un archivo YA abierto: no duplica, se queda la existente y activa',
    t4.pestanas.length === 2 &&
      t4.pestanas.filter((t) => t.id === A).length === 1 &&
      t4.pestanaActivaId === A,
    JSON.stringify(t4.pestanas.map((t) => t.id)) + ` active=${t4.pestanaActivaId}`
  )
  check(
    '(15h) reemplazarPestanaEditor de un id inexistente: no-op referencial',
    reemplazarPestanaEditor(t1, 'untitled:no-existe', paneArchivo(B)) === t1,
    'same=true'
  )
  check(
    '(15i) reemplazarPestanaEditor CONSERVA el flag de efímera (hoy inalcanzable, mañana no)',
    (() => {
      const conEfimera = abrirPestanaEditor(vacio, u1, true)
      // u1 es untitled, así que abrirPestanaEditor NO la marca: se marca a mano para probar
      // exactamente la propagación de reemplazarPestanaEditor, que es lo que se está afirmando.
      const forzada: EstadoPestanasEditor = {
        pestanas: conEfimera.pestanas.map((t) => ({ ...t, efimera: true as const })),
        pestanaActivaId: conEfimera.pestanaActivaId
      }
      const tras = reemplazarPestanaEditor(forzada, 'untitled:untitled-1', paneArchivo('notas.txt'))
      return tras.pestanas[0].efimera === true
    })(),
    'efimera=true tras reemplazarPestanaEditor'
  )

  // ---------------------------------------------------------------------------
  // (16) PESTAÑA EFÍMERA (vista previa). Es lo que hace que recorrer el historial
  //      con las flechas deje UNA pestaña y no veinte. El invariante que sostiene
  //      todo —como mucho una efímera— se afirma al final de cada caso.
  // ---------------------------------------------------------------------------
  hr('(16) pestaña efímera: sustitución en su hueco, ascenso y confinamiento')
  const D1 = paneDiff('c0ffee1', 'src/uno.ts')
  const D2 = paneDiff('c0ffee2', 'src/dos.ts')
  const D3 = paneDiff('c0ffee3', 'src/tres.ts')
  const id1 = derivarIdPestana(D1)
  const id2 = derivarIdPestana(D2)

  /** El invariante duro de todo este grupo. */
  function unaSolaEfimera(s: EstadoPestanasEditor): boolean {
    return s.pestanas.filter((t) => t.efimera === true).length <= 1
  }

  const e1 = abrirPestanaEditor(vacio, D1, true)
  check(
    '(16a) abrir efímera: 1 tab marcada, activa',
    e1.pestanas.length === 1 && e1.pestanas[0].efimera === true && e1.pestanaActivaId === id1 && unaSolaEfimera(e1),
    JSON.stringify(e1.pestanas.map((t) => ({ id: t.id, ef: t.efimera })))
  )

  const e2 = abrirPestanaEditor(e1, D2, true)
  check(
    '(16b) abrir OTRA efímera la SUSTITUYE: sigue habiendo 1 tab, la nueva',
    e2.pestanas.length === 1 && e2.pestanas[0].id === id2 && e2.pestanaActivaId === id2 && unaSolaEfimera(e2),
    JSON.stringify(e2.pestanas.map((t) => t.id))
  )

  // Una normal delante y otra detrás: la sustitución NO puede reordenar nada.
  const conVecinas = abrirPestanaEditor(abrirPestanaEditor(abrirPestanaEditor(vacio, paneArchivo(A)), D1, true), paneArchivo(B))
  check(
    '(16c) orden de partida [A, efímera, B]',
    conVecinas.pestanas.map((t) => t.id).join('|') === `${A}|${id1}|${B}`,
    JSON.stringify(conVecinas.pestanas.map((t) => t.id))
  )
  const sustituida = abrirPestanaEditor(conVecinas, D2, true)
  check(
    '(16d) la efímera del MEDIO se sustituye en su índice, sin mover a los vecinos',
    sustituida.pestanas.map((t) => t.id).join('|') === `${A}|${id2}|${B}` &&
      sustituida.pestanaActivaId === id2 &&
      unaSolaEfimera(sustituida),
    JSON.stringify(sustituida.pestanas.map((t) => t.id)) + ` active=${sustituida.pestanaActivaId}`
  )

  const ascendida = abrirPestanaEditor(e1, D1, false)
  check(
    '(16e) reabrir la MISMA en modo normal la ASCIENDE (deja de ser efímera)',
    ascendida.pestanas.length === 1 &&
      ascendida.pestanas[0].efimera === undefined &&
      ascendida.pestanaActivaId === id1 &&
      unaSolaEfimera(ascendida),
    `efimera=${String(ascendida.pestanas[0].efimera)}`
  )
  check(
    '(16f) y al revés NUNCA: reabrirla como efímera no degrada una permanente',
    abrirPestanaEditor(ascendida, D1, true).pestanas[0].efimera === undefined,
    'sigue permanente'
  )
  check(
    '(16g) tras ascender, la siguiente efímera se AÑADE en vez de sustituirla',
    (() => {
      const s = abrirPestanaEditor(ascendida, D2, true)
      return s.pestanas.length === 2 && s.pestanas[1].efimera === true && unaSolaEfimera(s)
    })(),
    '2 tabs'
  )

  check(
    '(16h) abrir un archivo del explorador NO cierra la efímera (se añade al final)',
    (() => {
      const s = abrirPestanaEditor(e1, paneArchivo(A))
      return (
        s.pestanas.length === 2 &&
        s.pestanas[0].id === id1 &&
        s.pestanas[0].efimera === true &&
        s.pestanaActivaId === A &&
        unaSolaEfimera(s)
      )
    })(),
    'la efímera sobrevive'
  )
  check(
    '(16i) y el siguiente commit reutiliza el hueco de la efímera, no el del archivo',
    (() => {
      const s = abrirPestanaEditor(abrirPestanaEditor(e1, paneArchivo(A)), D3, true)
      return s.pestanas.length === 2 && s.pestanas[0].id === derivarIdPestana(D3) && s.pestanas[1].id === A
    })(),
    'hueco reutilizado'
  )

  check(
    '(16j) un SIN TÍTULO nunca es efímero, aunque se pida',
    (() => {
      const s = abrirPestanaEditor(vacio, u1, true)
      return s.pestanas[0].efimera === undefined && unaSolaEfimera(s)
    })(),
    'efimera=undefined'
  )

  check(
    '(16k) cerrar la efímera se comporta como cualquier otra (hereda la vecina)',
    (() => {
      const s = cerrarPestanaEditor(sustituida, id2)
      return s.pestanas.length === 2 && s.pestanaActivaId === B && unaSolaEfimera(s)
    })(),
    'vecina heredada'
  )

  check(
    '(16l) abrir en modo normal cuando NO estaba abierta no marca nada',
    (() => {
      const s = abrirPestanaEditor(vacio, D1)
      return s.pestanas[0].efimera === undefined && unaSolaEfimera(s)
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
