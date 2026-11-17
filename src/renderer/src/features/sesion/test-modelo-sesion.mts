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
import { clavePaneEditor, type EstadoPestanasEditor } from '../editor/modeloPestanasEditor.ts'
import { modoInicialPara } from '../editor/modoVista.ts'
import { asegurarProyecto, restaurarTerminales, type TerminalesProyecto } from '../terminales/modeloTerminalesShell.ts'

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
const archivo = (ruta: string): EstadoPestanasEditor['pestanas'][number] => ({ id: ruta, pane: { tipo: 'file', archivo: { ruta, nombre: ruta.split('/').pop() ?? ruta } } })

function fuentes(extra: Partial<FuentesSesion> = {}): FuentesSesion {
  return {
    clavePane: clavePaneEditor,
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
  const pestanas: EstadoPestanasEditor = {
    pestanas: [
      archivo('src/a.ts'),
      { id: 'untitled:1', pane: { tipo: 'untitled', sinTitulo: { id: '1', nombre: 'Sin título-1' } } } as EstadoPestanasEditor['pestanas'][number],
      { id: 'diff:x', pane: { tipo: 'diff', destino: {} }, efimera: true } as unknown as EstadoPestanasEditor['pestanas'][number],
      archivo('LEEME.md')
    ],
    pestanaActivaId: 'LEEME.md'
  }
  const terminales: TerminalesProyecto = {
    lista: [
      { id: 't1', n: 1, indice: 1 },
      { id: 't3', n: 3, indice: 2, nombre: 'Servidor' }
    ],
    activoId: 't3',
    siguienteOrdinal: 4
  }
  const s = sesionDesde(
    CLAVE,
    fuentes({
      pestanas,
      // El pane informa siempre su modo: el de serie (código en un .ts) no se guarda.
      modoDe: () => 'codigo',
      cursorDe: (pk) => (pk === clavePaneEditor(CLAVE, 'src/a.ts') ? { linea: 40, columna: 7 } : pk === clavePaneEditor(CLAVE, 'LEEME.md') ? { linea: 1, columna: 1 } : undefined),
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
  const conDiffActivo = sesionDesde(CLAVE, fuentes({ pestanas: { ...pestanas, pestanaActivaId: 'diff:x' } }))
  check('si la activa es un diff, no hay activa guardada', conDiffActivo?.activa === null)
  check('un proyecto sin nada no se guarda', sesionDesde(CLAVE, fuentes()) === null)

  hr('(2) Al reabrir')
  if (!s) throw new Error('falta la sesión')
  const ap = aplicacionEditor(CLAVE, s, undefined, clavePaneEditor)
  check('vuelven las pestañas guardadas', JSON.stringify(ap.pestanas.pestanas.map((t) => t.id)) === '["src/a.ts","LEEME.md"]')
  check('con la activa guardada', ap.pestanas.pestanaActivaId === 'LEEME.md')
  check('con su modo', JSON.stringify(ap.modos) === JSON.stringify([[clavePaneEditor(CLAVE, 'LEEME.md'), 'codigo']]))
  check('y el cursor donde estaba', JSON.stringify(ap.cursores) === JSON.stringify([[clavePaneEditor(CLAVE, 'src/a.ts'), { linea: 40, columna: 7 }]]))
  check('el nombre de la pestaña es la última parte de la ruta', ap.pestanas.pestanas[0].pane.tipo === 'file' && ap.pestanas.pestanas[0].pane.archivo.nombre === 'a.ts')

  const abiertoDesdeElSistema: EstadoPestanasEditor = { pestanas: [archivo('nuevo.ts'), archivo('LEEME.md')], pestanaActivaId: 'nuevo.ts' }
  const mezcla = aplicacionEditor(CLAVE, s, abiertoDesdeElSistema, clavePaneEditor)
  check(
    'con pestañas ya abiertas: las guardadas que faltan van delante, sin repetir',
    JSON.stringify(mezcla.pestanas.pestanas.map((t) => t.id)) === '["src/a.ts","nuevo.ts","LEEME.md"]',
    JSON.stringify(mezcla.pestanas.pestanas.map((t) => t.id))
  )
  check('y la activa sigue siendo la que ya lo era', mezcla.pestanas.pestanaActivaId === 'nuevo.ts')
  const sinActivaValida = aplicacionEditor(CLAVE, { ...s, activa: 'borrado.ts' }, undefined, clavePaneEditor)
  check('una activa guardada que no vuelve cae a la primera', sinActivaValida.pestanas.pestanaActivaId === 'src/a.ts')

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
  check('se recrean en su orden, con sus nombres', JSON.stringify(restauradas.lista.map((t) => [t.id, t.nombre ?? null])) === '[["t1",null],["t2","Servidor"],["t3",null]]', JSON.stringify(restauradas.lista))
  check('un nombre igual al automático no se guarda como propio', restauradas.lista[2].nombre === undefined)
  check('con la activa y el siguiente ordinal', restauradas.activoId === 't2' && restauradas.siguienteOrdinal === 4)
  const sobreLaDeSerie = restaurarTerminales(asegurarProyecto({}, CLAVE), CLAVE, ['A', 'B'], 0)[CLAVE]
  check('sobre la primera de serie: la recrea conservando su id', sobreLaDeSerie.lista.length === 2 && sobreLaDeSerie.lista[0].id === 't1' && sobreLaDeSerie.lista[0].nombre === 'A')
  const tocadas = { [CLAVE]: { lista: [{ id: 't1', n: 1, indice: 1, nombre: 'Mía' }], activoId: 't1', siguienteOrdinal: 2 } }
  check('nunca pisa terminales que el usuario ya tocó', restaurarTerminales(tocadas, CLAVE, ['A', 'B'], 0) === tocadas)
  const vacio = { [CLAVE]: { lista: [], activoId: null, siguienteOrdinal: 2 } }
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
