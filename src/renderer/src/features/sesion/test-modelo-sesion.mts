#!/usr/bin/env node
// =============================================================================
// Prueba del modelo de la sesión de cada proyecto (node src/renderer/src/features/sesion/test-modelo-sesion.mts):
// de lo vivo se guardan solo los archivos (no los diffs ni los sin título), con su modo y su cursor, las
// carpetas y las terminales con sus nombres y la activa; al reabrir, las pestañas guardadas vuelven delante de
// las que el proyecto ya tuviera, sin repetir ninguna, con la activa que corresponde; y lo guardado y lo
// restaurado coinciden. Las terminales: `restaurarTerminales` solo recrea sobre la primera de serie.
// Decisiones: docs/decisiones/workspace/sesion-de-cada-proyecto.md
// =============================================================================

import { aplicacionEditor, sesionDesde, type FuentesSesion } from './modeloSesion.ts'
import { paneKeyEditor, type EditorTabsState } from '../editor/editorTabsModel.ts'
import { modoInicialPara } from '../editor/modoVista.ts'
import { ensureProject, restaurarTerminales, type ProjectTerminals } from '../terminales/shellTerminalsModel.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: { name: string; pass: boolean; evidence: string }[] = []
function check(name: string, pass: boolean, evidence = ''): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${evidence ? ` -> ${evidence}` : ''}`)
}

const CLAVE = 'perfil|/proyecto'
const archivo = (path: string): EditorTabsState['tabs'][number] => ({ id: path, pane: { kind: 'file', file: { path, name: path.split('/').pop() ?? path } } })

function fuentes(extra: Partial<FuentesSesion> = {}): FuentesSesion {
  return {
    paneKey: paneKeyEditor,
    pestanas: undefined,
    modoDe: () => undefined,
    modoDeSerie: modoInicialPara,
    cursorDe: () => undefined,
    carpetas: undefined,
    terminales: undefined,
    ...extra
  }
}

function main(): void {
  hr('(1) Qué se guarda de lo vivo')
  const pestanas: EditorTabsState = {
    tabs: [
      archivo('src/a.ts'),
      { id: 'untitled:1', pane: { kind: 'untitled', untitled: { id: '1', name: 'Sin título-1' } } } as EditorTabsState['tabs'][number],
      { id: 'diff:x', pane: { kind: 'diff', target: {} }, efimera: true } as unknown as EditorTabsState['tabs'][number],
      archivo('LEEME.md')
    ],
    activeId: 'LEEME.md'
  }
  const terminales: ProjectTerminals = {
    list: [
      { id: 't1', n: 1, indice: 1 },
      { id: 't3', n: 3, indice: 2, nombre: 'Servidor' }
    ],
    activeId: 't3',
    nextN: 4
  }
  const s = sesionDesde(
    CLAVE,
    fuentes({
      pestanas,
      // El pane informa siempre su modo: el de serie (código en un .ts) no se guarda.
      modoDe: () => 'codigo',
      cursorDe: (pk) => (pk === paneKeyEditor(CLAVE, 'src/a.ts') ? { linea: 40, columna: 7 } : pk === paneKeyEditor(CLAVE, 'LEEME.md') ? { linea: 1, columna: 1 } : undefined),
      carpetas: ['src'],
      terminales
    })
  )
  check('solo los archivos, en su orden', JSON.stringify(s?.pestanas.map((p) => p.ruta)) === '["src/a.ts","LEEME.md"]', JSON.stringify(s?.pestanas))
  check('el cursor de un archivo se guarda', s?.pestanas[0].linea === 40 && s.pestanas[0].columna === 7)
  check('el principio no se guarda: es donde se abre igual', s?.pestanas[1].linea === undefined)
  check('el modo elegido se guarda', s?.pestanas[1].modo === 'codigo' && s.pestanas[0].modo === undefined)
  check('la activa', s?.activa === 'LEEME.md')
  check('las carpetas', JSON.stringify(s?.carpetas) === '["src"]')
  check('las terminales, con su nombre puesto y la activa por posición', JSON.stringify(s?.terminales) === '[{},{"nombre":"Servidor"}]' && s?.terminalActiva === 1, JSON.stringify(s))
  const conDiffActivo = sesionDesde(CLAVE, fuentes({ pestanas: { ...pestanas, activeId: 'diff:x' } }))
  check('si la activa es un diff, no hay activa guardada', conDiffActivo?.activa === null)
  check('un proyecto sin nada no se guarda', sesionDesde(CLAVE, fuentes()) === null)

  hr('(2) Al reabrir')
  if (!s) throw new Error('falta la sesión')
  const ap = aplicacionEditor(CLAVE, s, undefined, paneKeyEditor)
  check('vuelven las pestañas guardadas', JSON.stringify(ap.pestanas.tabs.map((t) => t.id)) === '["src/a.ts","LEEME.md"]')
  check('con la activa guardada', ap.pestanas.activeId === 'LEEME.md')
  check('con su modo', JSON.stringify(ap.modos) === JSON.stringify([[paneKeyEditor(CLAVE, 'LEEME.md'), 'codigo']]))
  check('y el cursor donde estaba', JSON.stringify(ap.cursores) === JSON.stringify([[paneKeyEditor(CLAVE, 'src/a.ts'), { linea: 40, columna: 7 }]]))
  check('el nombre de la pestaña es la última parte de la ruta', ap.pestanas.tabs[0].pane.kind === 'file' && ap.pestanas.tabs[0].pane.file.name === 'a.ts')

  const abiertoDesdeElSistema: EditorTabsState = { tabs: [archivo('nuevo.ts'), archivo('LEEME.md')], activeId: 'nuevo.ts' }
  const mezcla = aplicacionEditor(CLAVE, s, abiertoDesdeElSistema, paneKeyEditor)
  check(
    'con pestañas ya abiertas: las guardadas que faltan van delante, sin repetir',
    JSON.stringify(mezcla.pestanas.tabs.map((t) => t.id)) === '["src/a.ts","nuevo.ts","LEEME.md"]',
    JSON.stringify(mezcla.pestanas.tabs.map((t) => t.id))
  )
  check('y la activa sigue siendo la que ya lo era', mezcla.pestanas.activeId === 'nuevo.ts')
  const sinActivaValida = aplicacionEditor(CLAVE, { ...s, activa: 'borrado.ts' }, undefined, paneKeyEditor)
  check('una activa guardada que no vuelve cae a la primera', sinActivaValida.pestanas.activeId === 'src/a.ts')

  hr('(3) Lo guardado y lo restaurado coinciden')
  const vuelta = sesionDesde(
    CLAVE,
    fuentes({
      pestanas: ap.pestanas,
      modoDe: (pk) => new Map(ap.modos).get(pk),
      cursorDe: (pk) => new Map(ap.cursores).get(pk)
    })
  )
  check('las pestañas de ida y vuelta son las mismas', JSON.stringify(vuelta?.pestanas) === JSON.stringify(s.pestanas) && vuelta?.activa === s.activa, JSON.stringify(vuelta?.pestanas))

  hr('(4) Las terminales al reabrir')
  const restauradas = restaurarTerminales({}, CLAVE, [undefined, 'Servidor', 'Local (3)'], 1)[CLAVE]
  check('se recrean en su orden, con sus nombres', JSON.stringify(restauradas.list.map((t) => [t.id, t.nombre ?? null])) === '[["t1",null],["t2","Servidor"],["t3",null]]', JSON.stringify(restauradas.list))
  check('un nombre igual al automático no se guarda como propio', restauradas.list[2].nombre === undefined)
  check('con la activa y el siguiente ordinal', restauradas.activeId === 't2' && restauradas.nextN === 4)
  const sobreLaDeSerie = restaurarTerminales(ensureProject({}, CLAVE), CLAVE, ['A', 'B'], 0)[CLAVE]
  check('sobre la primera de serie: la recrea conservando su id', sobreLaDeSerie.list.length === 2 && sobreLaDeSerie.list[0].id === 't1' && sobreLaDeSerie.list[0].nombre === 'A')
  const tocadas = { [CLAVE]: { list: [{ id: 't1', n: 1, indice: 1, nombre: 'Mía' }], activeId: 't1', nextN: 2 } }
  check('nunca pisa terminales que el usuario ya tocó', restaurarTerminales(tocadas, CLAVE, ['A', 'B'], 0) === tocadas)
  const vacio = { [CLAVE]: { list: [], activeId: null, nextN: 2 } }
  check('ni un proyecto en el que cerró todas', restaurarTerminales(vacio, CLAVE, ['A'], 0) === vacio)
  check('sin guardadas no hace nada', restaurarTerminales({}, CLAVE, [], -1)[CLAVE] === undefined)

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
  const passed = results.filter((r) => r.pass).length
  const allPass = passed === results.length
  hr(`VEREDICTO: ${passed}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
